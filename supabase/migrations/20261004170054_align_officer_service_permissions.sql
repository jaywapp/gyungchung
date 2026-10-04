-- Authority to configure services belongs to active system administrators.
create or replace function private.can_manage_officer_permission(target_title public.officer_title)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_title is not null
    and (select auth.uid()) is not null
    and (select private.has_permission('roles.manage'))
    and exists (
      select 1 from public.profiles as profile
      where profile.auth_user_id = (select auth.uid())
        and profile.status = 'active'::public.member_status
        and profile.is_system_admin
    );
$$;

revoke all on function private.can_manage_officer_permission(public.officer_title)
from public, anon, authenticated, service_role;
grant execute on function private.can_manage_officer_permission(public.officer_title) to authenticated;

-- Keep the existing batch RPC as the only client write path. Its validation,
-- advisory lock, expected_enabled conflict check and transaction are unchanged.
revoke insert, update, delete on public.officer_permissions from authenticated;
drop policy if exists "Authorized officers insert officer permissions" on public.officer_permissions;
drop policy if exists "Authorized officers update officer permissions" on public.officer_permissions;
drop policy if exists "Authorized officers delete officer permissions" on public.officer_permissions;
drop trigger if exists protect_officer_permissions_before_write on public.officer_permissions;
drop function if exists public.protect_officer_permissions();
delete from public.officer_permissions where permission = 'officers.manage';

alter table public.officer_permissions drop constraint officer_permissions_permission_check;
alter table public.officer_permissions add constraint officer_permissions_permission_check
check (permission in (
  'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
  'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage'
));

-- Apply the agreed baseline once through migration history. No recurring seed
-- or runtime fallback restores services subsequently excluded by an administrator.
insert into public.officer_permissions (officer_title, permission)
select title.value, service.value
from unnest(enum_range(null::public.officer_title)) as title(value)
cross join unnest(array[
  'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
  'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage'
]) as service(value)
on conflict (officer_title, permission) do nothing;

-- Resolve one eligible roster member without exposing private profile fields.
-- This helper also checks the caller independently of the invoker's profile RLS.
create or replace function private.get_managed_event_member(target_member_id uuid)
returns table (id uuid, name text, "position" text, status public.member_status)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.name, profile.position, profile.status
  from public.profiles as profile
  where profile.id = target_member_id
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
    and (select auth.uid()) is not null
    and (select private.has_permission('events.manage'))
    and exists (
      select 1 from public.profiles as actor
      where actor.auth_user_id = (select auth.uid())
        and actor.status = 'active'::public.member_status
        and not actor.is_test_account
    );
$$;

revoke all on function private.get_managed_event_member(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.get_managed_event_member(uuid) to authenticated;

create or replace function public.save_attendance_batch(
  target_event_id uuid,
  target_changes jsonb
)
returns table (
  result_index integer,
  result_member_id uuid,
  succeeded boolean,
  error_message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  change_data jsonb;
  change_index integer := 0;
  target_response_status public.attendance_status;
  target_check_in_status public.attendance_check_in_status;
  seen_member_ids uuid[] := array[]::uuid[];
begin
  if not exists (
    select 1 from private.get_managed_event_member((select private.current_profile_id()))
  ) then
    raise exception 'Only event managers can save attendance';
  end if;
  if target_event_id is null or not exists (select 1 from public.events where id = target_event_id) then
    raise exception 'Event not found';
  end if;
  if target_changes is null or jsonb_typeof(target_changes) <> 'array' then
    raise exception 'Attendance changes must be an array';
  end if;
  if jsonb_array_length(target_changes) > 500 then
    raise exception 'Attendance changes cannot exceed 500 rows';
  end if;

  for change_data in select value from jsonb_array_elements(target_changes) loop
    change_index := change_index + 1;
    result_index := change_index;
    result_member_id := null;
    succeeded := false;
    error_message := null;

    begin
      result_member_id := nullif(change_data ->> 'member_id', '')::uuid;
      if result_member_id is null then
        raise exception 'Member id is required';
      end if;
      if result_member_id = any(seen_member_ids) then
        raise exception 'Duplicate member in attendance changes';
      end if;
      seen_member_ids := array_append(seen_member_ids, result_member_id);
      if not exists (
        select 1 from private.get_managed_event_member(result_member_id)
      ) then
        raise exception 'Active member not found';
      end if;

      target_response_status := coalesce(nullif(change_data ->> 'response_status', ''), 'undecided')::public.attendance_status;
      if not (change_data ? 'check_in_status') then
        raise exception 'Check-in status is required';
      end if;
      target_check_in_status := case
        when jsonb_typeof(change_data -> 'check_in_status') = 'null' then null
        else (change_data ->> 'check_in_status')::public.attendance_check_in_status
      end;

      if target_check_in_status is null then
        update public.attendance
        set check_in_status = null,
            checked_in_at = null,
            checked_in_by = null
        where event_id = target_event_id and member_id = result_member_id;
      else
        insert into public.attendance (event_id, member_id, status, check_in_status)
        values (target_event_id, result_member_id, target_response_status, target_check_in_status)
        on conflict (event_id, member_id) do update
        set check_in_status = excluded.check_in_status;
      end if;

      succeeded := true;
    exception when others then
      succeeded := false;
      error_message := sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

revoke all on function public.save_attendance_batch(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_batch(uuid, jsonb) to authenticated;

create or replace function public.save_event_teams(target_event_id uuid, target_mode text, target_teams jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  team_data jsonb;
  participant_data jsonb;
  saved_team_id uuid;
  participant_kind text;
  participant_id uuid;
  participant_name text;
  participant_position text;
begin
  if not exists (
    select 1 from private.get_managed_event_member((select private.current_profile_id()))
  ) then raise exception 'Event management permission is required'; end if;
  if target_mode not in ('random', 'balanced') or jsonb_typeof(target_teams) <> 'array' then raise exception 'Invalid team generation request'; end if;
  if jsonb_array_length(target_teams) < 2 or jsonb_array_length(target_teams) > 4 then raise exception 'Create between two and four teams'; end if;
  delete from public.event_teams where event_id = target_event_id;
  for team_data in select value from jsonb_array_elements(target_teams) loop
    insert into public.event_teams (event_id, team_number, team_name, generation_mode, created_by)
    values (target_event_id, (team_data ->> 'team_number')::integer, team_data ->> 'team_name', target_mode, (select private.current_profile_id()))
    returning id into saved_team_id;
    for participant_data in select value from jsonb_array_elements(team_data -> 'participants') loop
      participant_kind := participant_data ->> 'kind';
      participant_id := (participant_data ->> 'id')::uuid;
      participant_name := null;
      participant_position := null;
      if participant_kind = 'member' then
        select profile.name, profile.position into participant_name, participant_position
        from private.get_managed_event_member(participant_id) as profile;
      elsif participant_kind = 'guest' then
        select guest_name, guest_position into participant_name, participant_position
        from public.event_guest_players where event_id = target_event_id and guest_player_id = participant_id;
      else
        raise exception 'Invalid participant type';
      end if;
      if participant_name is null then raise exception 'Participant is not eligible for this event'; end if;
      insert into public.event_team_members (event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position)
      values (target_event_id, saved_team_id, case when participant_kind = 'member' then participant_id end, case when participant_kind = 'guest' then participant_id end, participant_name, participant_position);
    end loop;
  end loop;
  update public.events set team_mode = target_mode where id = target_event_id;
end;
$$;

revoke all on function public.save_event_teams(uuid, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_event_teams(uuid, text, jsonb) to authenticated;
