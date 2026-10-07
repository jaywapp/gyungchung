alter table public.events
  add column mixed_zone_days integer not null default 3,
  add constraint events_mixed_zone_days_range check (mixed_zone_days between 1 and 30);
comment on column public.events.mixed_zone_days is
  'Mixed-zone duration after scheduled end, in exact 24-hour periods; independent of POTM.';

create function private.require_mixed_zone_manager()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare actor_profile public.profiles%rowtype;
begin
  select profile.* into actor_profile from public.profiles as profile
  where profile.auth_user_id = (select auth.uid()) for share nowait;
  if actor_profile.id is null or actor_profile.status <> 'active'::public.member_status
    or actor_profile.must_change_password or actor_profile.is_test_account then
    raise exception 'Only eligible event managers can configure mixed zone' using errcode = '42501';
  end if;
  if not actor_profile.is_system_admin then
    if actor_profile.role <> 'manager'::public.account_role or actor_profile.officer_title is null then
      raise exception 'Only eligible event managers can configure mixed zone' using errcode = '42501';
    end if;
    perform permission.officer_title from public.officer_permissions as permission
    where permission.officer_title = actor_profile.officer_title and permission.permission = 'events.manage'
    for share nowait;
    if not found then
      raise exception 'Only eligible event managers can configure mixed zone' using errcode = '42501';
    end if;
  end if;
exception when lock_not_available then
  raise exception 'Membership or event permission changed; reload before configuring mixed zone' using errcode = '40001';
end;
$$;
revoke all on function private.require_mixed_zone_manager() from public, anon, authenticated, service_role;
grant execute on function private.require_mixed_zone_manager() to authenticated;

create function public.protect_event_mixed_zone_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' or new.mixed_zone_days is distinct from old.mixed_zone_days
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    perform private.require_mixed_zone_manager();
  end if;
  return new;
end;
$$;
revoke all on function public.protect_event_mixed_zone_window() from public, anon, authenticated, service_role;
create trigger protect_event_mixed_zone_window_before_write
before insert or update of starts_at, ends_at, mixed_zone_days on public.events
for each row execute function public.protect_event_mixed_zone_window();

create function private.mixed_zone_is_open(
  p_starts_at timestamptz, p_ends_at timestamptz, p_days integer, p_at timestamptz
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p_starts_at is not null and p_days between 1 and 30
    and p_at >= coalesce(p_ends_at, p_starts_at + interval '2 hours')
    and p_at < coalesce(p_ends_at, p_starts_at + interval '2 hours')
      + p_days * interval '24 hours', false);
$$;
revoke all on function private.mixed_zone_is_open(timestamptz,timestamptz,integer,timestamptz)
from public, anon, authenticated, service_role;

create table private.mixed_zone_entries (
  event_id uuid not null references public.events(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  pace smallint not null check (pace between 1 and 5),
  shooting smallint not null check (shooting between 1 and 5),
  passing smallint not null check (passing between 1 and 5),
  dribbling smallint not null check (dribbling between 1 and 5),
  defending smallint not null check (defending between 1 and 5),
  physical smallint not null check (physical between 1 and 5),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (event_id, actor_id, member_id),
  check (actor_id <> member_id)
);
create index mixed_zone_entries_actor_idx on private.mixed_zone_entries (actor_id);
create index mixed_zone_entries_member_event_idx on private.mixed_zone_entries (member_id, event_id);
alter table private.mixed_zone_entries enable row level security;
revoke all on table private.mixed_zone_entries from public, anon, authenticated, service_role;

create function private.get_mixed_zone_entries(p_event_id uuid)
returns table (
  event_id uuid, member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare actor_profile_id uuid;
begin
  actor_profile_id := private.current_mom_voter_id();
  if actor_profile_id is null then
    raise exception 'Mixed-zone membership access is required' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'Event is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.attendance as attendance
    where attendance.event_id = p_event_id and attendance.member_id = actor_profile_id
      and (attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status)
        or (attendance.check_in_status is null and attendance.checked_in_at is not null))) then
    raise exception 'Actual event attendance is required' using errcode = '42501';
  end if;
  -- The author can review their own responses after the writing deadline.
  return query select entry.event_id, entry.member_id, entry.pace, entry.shooting,
    entry.passing, entry.dribbling, entry.defending, entry.physical, entry.revision, entry.updated_at
  from private.mixed_zone_entries as entry
  where entry.event_id = p_event_id and entry.actor_id = actor_profile_id order by entry.member_id;
end;
$$;

create function private.set_mixed_zone_entry(
  p_event_id uuid, p_member_id uuid, p_scores jsonb, p_expected_revision bigint
)
returns table (
  event_id uuid, member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  target_event public.events%rowtype;
  saved private.mixed_zone_entries%rowtype;
  score record;
  saved_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Mixed-zone membership access is required' using errcode = '42501';
  end if;
  if p_event_id is null or p_member_id is null or p_expected_revision is null
    or p_expected_revision < 0 or pg_catalog.jsonb_typeof(p_scores) is distinct from 'object' then
    raise exception 'Event, member, six scores and a nonnegative revision are required' using errcode = '22023';
  end if;
  if not (p_scores ?& array['pace','shooting','passing','dribbling','defending','physical'])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_scores)) <> 6 then
    raise exception 'Provide exactly the six mixed-zone scores' using errcode = '22023';
  end if;
  for score in select * from pg_catalog.jsonb_each(p_scores) loop
    if pg_catalog.jsonb_typeof(score.value) is distinct from 'number' then
      raise exception 'Mixed-zone scores must be integers between 1 and 5' using errcode = '22023';
    end if;
    if score.value::numeric < 1 or score.value::numeric > 5
      or pg_catalog.trunc(score.value::numeric) <> score.value::numeric then
      raise exception 'Mixed-zone scores must be integers between 1 and 5' using errcode = '22023';
    end if;
  end loop;

  -- SHARE conflicts with all membership/attendance/configuration updates.
  -- NOWAIT also avoids reverse parent-delete/cascade lock-order deadlocks.
  perform profile.id from public.profiles as profile
  where profile.auth_user_id = (select auth.uid()) or profile.id = p_member_id
  order by profile.id for share nowait;
  select profile.* into actor_profile from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());
  select profile.* into target_profile from public.profiles as profile where profile.id = p_member_id;
  if actor_profile.id is null or actor_profile.status <> 'active'::public.member_status
    or actor_profile.must_change_password or actor_profile.is_test_account then
    raise exception 'Mixed-zone membership access is required' using errcode = '42501';
  end if;
  if target_profile.id is null or target_profile.id = actor_profile.id
    or target_profile.status <> 'active'::public.member_status or target_profile.is_test_account then
    raise exception 'Another active visible member is required' using errcode = '42501';
  end if;
  select event.* into target_event from public.events as event
  where event.id = p_event_id for share nowait;
  if not found then
    raise exception 'Mixed-zone event is not available' using errcode = '42501';
  end if;
  perform attendance.member_id from public.attendance as attendance
  where attendance.event_id = p_event_id
    and attendance.member_id in (actor_profile.id, p_member_id)
  order by attendance.member_id for share nowait;
  if (select pg_catalog.count(*) from public.attendance as attendance
    where attendance.event_id = p_event_id and attendance.member_id in (actor_profile.id, p_member_id)
      and (attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status)
        or (attendance.check_in_status is null and attendance.checked_in_at is not null))) <> 2 then
    raise exception 'Both members must have actual event attendance' using errcode = '42501';
  end if;
  -- Serialize both first inserts and edits without waiting across the deadline.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'mixed_zone:' || p_event_id::text || ':' || actor_profile.id::text || ':' || p_member_id::text, 0)) then
    raise exception 'Mixed-zone response changed; reload before saving' using errcode = '40001';
  end if;
  perform entry.event_id from private.mixed_zone_entries as entry
  where entry.event_id = p_event_id and entry.actor_id = actor_profile.id and entry.member_id = p_member_id
  for update nowait;
  saved_at := pg_catalog.clock_timestamp();
  if not private.mixed_zone_is_open(target_event.starts_at, target_event.ends_at, target_event.mixed_zone_days, saved_at) then
    raise exception 'Mixed zone is outside the event response period' using errcode = '42501';
  end if;
  if p_expected_revision = 0 then
    insert into private.mixed_zone_entries as entry (
      event_id, actor_id, member_id, pace, shooting, passing, dribbling, defending, physical,
      revision, created_at, updated_at
    ) values (p_event_id, actor_profile.id, p_member_id,
      (p_scores ->> 'pace')::numeric::smallint, (p_scores ->> 'shooting')::numeric::smallint,
      (p_scores ->> 'passing')::numeric::smallint, (p_scores ->> 'dribbling')::numeric::smallint,
      (p_scores ->> 'defending')::numeric::smallint, (p_scores ->> 'physical')::numeric::smallint,
      1, saved_at, saved_at)
    on conflict on constraint mixed_zone_entries_pkey do nothing returning entry.* into saved;
  else
    update private.mixed_zone_entries as entry set
      pace = (p_scores ->> 'pace')::numeric::smallint, shooting = (p_scores ->> 'shooting')::numeric::smallint,
      passing = (p_scores ->> 'passing')::numeric::smallint, dribbling = (p_scores ->> 'dribbling')::numeric::smallint,
      defending = (p_scores ->> 'defending')::numeric::smallint, physical = (p_scores ->> 'physical')::numeric::smallint,
      revision = entry.revision + 1, updated_at = saved_at
    where entry.event_id = p_event_id and entry.actor_id = actor_profile.id
      and entry.member_id = p_member_id and entry.revision = p_expected_revision returning entry.* into saved;
  end if;
  if saved.event_id is null then
    raise exception 'Mixed-zone response changed; reload before saving' using errcode = '40001';
  end if;
  return query select saved.event_id, saved.member_id, saved.pace, saved.shooting, saved.passing,
    saved.dribbling, saved.defending, saved.physical, saved.revision, saved.updated_at;
exception when lock_not_available then
  raise exception 'The event, attendance or membership changed; reload before saving' using errcode = '40001';
end;
$$;

create function private.get_mixed_zone_overalls(p_member_ids uuid[])
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz, response_count bigint, event_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_mom_voter_id() is null or not private.has_permission('ratings.manage') then
    raise exception 'Member overall management access is required' using errcode = '42501';
  end if;
  if p_member_ids is null or pg_catalog.cardinality(p_member_ids) > 300
    or exists (select 1 from pg_catalog.unnest(p_member_ids) as requested(id) where requested.id is null) then
    raise exception 'Request at most 300 non-null member ids' using errcode = '22023';
  end if;
  -- Only current target visibility is filtered. Historically valid responses
  -- remain valid after the author or attendance record changes.
  return query with per_event as (
    select entry.member_id, entry.event_id,
      pg_catalog.avg(entry.pace) pace, pg_catalog.avg(entry.shooting) shooting,
      pg_catalog.avg(entry.passing) passing, pg_catalog.avg(entry.dribbling) dribbling,
      pg_catalog.avg(entry.defending) defending, pg_catalog.avg(entry.physical) physical,
      pg_catalog.count(*) response_count, pg_catalog.sum(entry.revision) revision,
      pg_catalog.max(entry.updated_at) updated_at,
      coalesce(event.ends_at, event.starts_at + interval '2 hours') ended_at
    from private.mixed_zone_entries as entry
    join public.events as event on event.id = entry.event_id
    join public.profiles as target on target.id = entry.member_id
    where entry.member_id = any(p_member_ids)
      and target.status = 'active'::public.member_status and not target.is_test_account
    group by entry.member_id, entry.event_id, event.ends_at, event.starts_at
  ), ranked as (
    select per_event.*, pg_catalog.row_number() over (
      partition by per_event.member_id order by per_event.ended_at desc, per_event.event_id desc
    ) event_rank from per_event
  )
  select ranked.member_id,
    pg_catalog.round(pg_catalog.avg(ranked.pace) * 20)::smallint,
    pg_catalog.round(pg_catalog.avg(ranked.shooting) * 20)::smallint,
    pg_catalog.round(pg_catalog.avg(ranked.passing) * 20)::smallint,
    pg_catalog.round(pg_catalog.avg(ranked.dribbling) * 20)::smallint,
    pg_catalog.round(pg_catalog.avg(ranked.defending) * 20)::smallint,
    pg_catalog.round(pg_catalog.avg(ranked.physical) * 20)::smallint,
    pg_catalog.sum(ranked.revision)::bigint, pg_catalog.max(ranked.updated_at),
    pg_catalog.sum(ranked.response_count)::bigint, pg_catalog.count(*)
  from ranked where ranked.event_rank <= 10 group by ranked.member_id order by ranked.member_id;
end;
$$;

create or replace function private.get_member_overalls(p_member_ids uuid[])
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select overall.member_id, overall.pace, overall.shooting, overall.passing,
    overall.dribbling, overall.defending, overall.physical, overall.revision, overall.updated_at
  from private.get_mixed_zone_overalls(p_member_ids) as overall;
end;
$$;

-- Preserve installed legacy RPC signatures/ACLs and the manual audit rows.
-- Installed mobile clients receive an authorization error instead of mutating them.
create or replace function private.set_member_overall(p_member_id uuid, p_scores jsonb, p_expected_revision bigint)
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $$
begin
  raise exception 'Manual overall editing has been retired; use mixed-zone responses' using errcode = '42501';
end;
$$;

create function public.get_mixed_zone_entries(p_event_id uuid)
returns table (
  event_id uuid, member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_mixed_zone_entries(p_event_id);
$$;
create function public.set_mixed_zone_entry(p_event_id uuid, p_member_id uuid, p_scores jsonb, p_expected_revision bigint)
returns table (
  event_id uuid, member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint, revision bigint, updated_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.set_mixed_zone_entry(p_event_id, p_member_id, p_scores, p_expected_revision);
$$;
create function public.get_mixed_zone_overalls(p_member_ids uuid[])
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz, response_count bigint, event_count bigint
)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_mixed_zone_overalls(p_member_ids);
$$;
revoke all on function private.get_mixed_zone_entries(uuid), private.set_mixed_zone_entry(uuid,uuid,jsonb,bigint),
  private.get_mixed_zone_overalls(uuid[]), public.get_mixed_zone_entries(uuid),
  public.set_mixed_zone_entry(uuid,uuid,jsonb,bigint), public.get_mixed_zone_overalls(uuid[])
from public, anon, authenticated, service_role;
grant execute on function private.get_mixed_zone_entries(uuid), private.set_mixed_zone_entry(uuid,uuid,jsonb,bigint),
  private.get_mixed_zone_overalls(uuid[]), public.get_mixed_zone_entries(uuid),
  public.set_mixed_zone_entry(uuid,uuid,jsonb,bigint), public.get_mixed_zone_overalls(uuid[])
to authenticated;

notify pgrst, 'reload schema';
