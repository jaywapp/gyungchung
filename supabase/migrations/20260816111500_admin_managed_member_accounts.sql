-- Profiles are the canonical club roster. Authentication is an optional link.
alter table public.profiles
  add column auth_user_id uuid references auth.users(id) on delete set null;

update public.profiles
set auth_user_id = id
where exists (select 1 from auth.users where auth.users.id = profiles.id);

alter table public.profiles
  alter column id set default gen_random_uuid();

alter table public.profiles
  drop constraint profiles_id_fkey;

create unique index profiles_auth_user_id_unique_idx
on public.profiles (auth_user_id)
where auth_user_id is not null;

create or replace function private.normalize_member_phone(raw_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_phone is null or pg_catalog.btrim(raw_phone) = '' then null
    when pg_catalog.regexp_replace(raw_phone, '[^0-9+]', '', 'g') ~ '^\+82[0-9]{9,10}$'
      then pg_catalog.regexp_replace(raw_phone, '[^0-9+]', '', 'g')
    when pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$'
      then '+82' || pg_catalog.substr(pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g'), 2)
    else null
  end;
$$;

revoke execute on function private.normalize_member_phone(text) from public, anon, authenticated;

update public.profiles as profile
set phone = private.normalize_member_phone(application.phone)
from public.membership_applications as application
where application.member_id = profile.id
  and profile.phone is null
  and private.normalize_member_phone(application.phone) is not null;

update public.profiles
set phone = private.normalize_member_phone(phone)
where phone is not null;

create unique index profiles_phone_unique_idx
on public.profiles (phone)
where phone is not null;

create or replace function public.prepare_member_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(new.name);
  new.phone := private.normalize_member_phone(new.phone);
  if new.phone is null then
    raise exception 'A valid Korean mobile phone number is required';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.prepare_member_profile() from public, anon, authenticated;
drop trigger if exists prepare_member_profile_before_write on public.profiles;
create trigger prepare_member_profile_before_write
before insert or update of name, phone on public.profiles
for each row execute function public.prepare_member_profile();

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid());
$$;

revoke all on function private.current_profile_id() from public, anon, authenticated, service_role;
grant execute on function private.current_profile_id() to authenticated, service_role;

create or replace function private.has_permission(requested_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'active'::public.member_status
      and (
        profile.is_system_admin
        or (
          profile.role = 'manager'::public.account_role
          and exists (
            select 1 from public.officer_permissions as officer_permission
            where officer_permission.officer_title = profile.officer_title
              and officer_permission.permission = requested_permission
          )
        )
      )
  );
$$;

create or replace function private.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = (select auth.uid()) and status = 'active'
  );
$$;

create or replace function private.form_is_open(target_form_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participation_forms f
    where f.id = target_form_id and f.status = 'open'
      and (f.starts_at is null or f.starts_at <= now())
      and (f.ends_at is null or f.ends_at > now())
  ) and (select private.is_active_member());
$$;

create or replace function private.is_own_submission(target_submission_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participation_submissions s
    where s.id = target_submission_id
      and s.participant_id = (select private.current_profile_id())
  );
$$;

create or replace function private.can_manage_officer_permission(target_title public.officer_title)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    (select private.has_permission('roles.manage'))
    or (
      target_title <> 'president'::public.officer_title
      and exists (
        select 1
        from public.profiles as profile
        join public.officer_permissions as officer_permission
          on officer_permission.officer_title = profile.officer_title
        where profile.auth_user_id = (select auth.uid())
          and profile.status = 'active'::public.member_status
          and profile.role = 'manager'::public.account_role
          and profile.officer_title = 'president'::public.officer_title
          and officer_permission.permission = 'officers.manage'
      )
    );
$$;

drop trigger if exists require_membership_application_before_approval on public.profiles;

drop policy if exists "Members read own profile" on public.profiles;
create policy "Members read own profile"
on public.profiles for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy "Member managers insert profiles"
on public.profiles for insert to authenticated
with check ((select private.has_permission('members.manage')));

drop policy if exists "Applicants and managers read applications" on public.membership_applications;
create policy "Applicants and managers read applications"
on public.membership_applications for select to authenticated
using (
  member_id = (select private.current_profile_id())
  or (select private.has_permission('members.manage'))
);

drop policy if exists "Members read own fees" on public.fees;
create policy "Members read own fees"
on public.fees for select to authenticated
using (
  member_id = (select private.current_profile_id())
  or (select private.has_permission('fees.manage'))
);

drop policy if exists "Members and event managers insert attendance" on public.attendance;
create policy "Members and event managers insert attendance"
on public.attendance for insert to authenticated
with check (
  (member_id = (select private.current_profile_id()) and (select private.is_active_member()))
  or (select private.has_permission('events.manage'))
);

drop policy if exists "Members update own attendance" on public.attendance;
create policy "Members update own attendance"
on public.attendance for update to authenticated
using (
  member_id = (select private.current_profile_id())
  or (select private.has_permission('events.manage'))
)
with check (
  member_id = (select private.current_profile_id())
  or (select private.has_permission('events.manage'))
);

drop policy if exists "Active members create feedback" on public.feedback;
create policy "Active members create feedback"
on public.feedback for insert to authenticated
with check (
  author_id = (select private.current_profile_id())
  and (select private.is_active_member())
);

drop policy if exists "Authors and managers read feedback" on public.feedback;
create policy "Authors and managers read feedback"
on public.feedback for select to authenticated
using (
  author_id = (select private.current_profile_id())
  or (select private.has_permission('feedback.manage'))
);

drop policy if exists "Members read own submission receipts" on public.participation_submissions;
create policy "Members read own submission receipts"
on public.participation_submissions for select to authenticated
using (
  participant_id = (select private.current_profile_id())
  or exists (
    select 1 from public.participation_forms f
    where f.id = participation_submissions.form_id
      and not f.secret_ballot
      and (select private.can_manage_form(f.kind))
  )
);

drop policy if exists "Members submit once to open forms" on public.participation_submissions;
create policy "Members submit once to open forms"
on public.participation_submissions for insert to authenticated
with check (
  participant_id = (select private.current_profile_id())
  and (select private.form_is_open(participation_submissions.form_id))
);

drop policy if exists "Checked-in members create MOM vote" on public.event_mom_votes;
create policy "Checked-in members create MOM vote"
on public.event_mom_votes for insert to authenticated
with check (
  voter_id = (select private.current_profile_id())
  and (select private.is_active_member())
);

drop policy if exists "Checked-in members update MOM vote" on public.event_mom_votes;
create policy "Checked-in members update MOM vote"
on public.event_mom_votes for update to authenticated
using (voter_id = (select private.current_profile_id()) and (select private.is_active_member()))
with check (voter_id = (select private.current_profile_id()) and (select private.is_active_member()));

drop policy if exists "Members read own MOM vote" on public.event_mom_votes;
create policy "Members read own MOM vote"
on public.event_mom_votes for select to authenticated
using (voter_id = (select private.current_profile_id()));

drop policy if exists "Members withdraw own MOM vote" on public.event_mom_votes;
create policy "Members withdraw own MOM vote"
on public.event_mom_votes for delete to authenticated
using (voter_id = (select private.current_profile_id()));

create or replace function public.sync_profile_email_from_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
  set email = lower(new.email),
      phone = coalesce(private.normalize_member_phone(new.phone), phone),
      updated_at = now()
  where auth_user_id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_email_after_auth_update on auth.users;
create trigger sync_profile_email_after_auth_update
after update of email, phone on auth.users
for each row
when (old.email is distinct from new.email or old.phone is distinct from new.phone)
execute function public.sync_profile_email_from_auth();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_member_id uuid;
  normalized_phone text := private.normalize_member_phone(new.phone);
begin
  begin
    target_member_id := nullif(new.raw_user_meta_data ->> 'member_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid member provisioning request';
  end;

  if target_member_id is null then
    raise exception 'An administrator must provision this member account';
  end if;

  update public.profiles
  set auth_user_id = new.id,
      phone = coalesce(normalized_phone, phone),
      email = lower(new.email),
      updated_at = now()
  where id = target_member_id
    and auth_user_id is null
    and phone = normalized_phone;

  if not found then
    raise exception 'The provisioned member record does not match this account';
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.prepare_guest_player()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := (select private.current_profile_id()); end if;
  return new;
end;
$$;

create or replace function public.prepare_event_guest_player()
returns trigger language plpgsql set search_path = '' as $$
begin
  select guest.name, guest.preferred_position into new.guest_name, new.guest_position
  from public.guest_players as guest where guest.id = new.guest_player_id;
  if new.guest_name is null then raise exception 'Guest player does not exist'; end if;
  new.added_by := (select private.current_profile_id());
  return new;
end;
$$;

create or replace function public.prepare_venue()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := trim(new.name);
  new.address := trim(new.address);
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := (select private.current_profile_id()); end if;
  return new;
end;
$$;

create or replace function public.protect_attendance_check_in()
returns trigger language plpgsql set search_path = '' as $$
begin
  if ((tg_op = 'INSERT' and new.checked_in_at is not null)
    or (tg_op = 'UPDATE' and (new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is distinct from old.checked_in_by)))
    and not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can change check-in records';
  end if;
  if new.checked_in_at is null then
    new.checked_in_by := null;
  elsif tg_op = 'INSERT' or new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is null then
    new.checked_in_by := (select private.current_profile_id());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.submit_participation(target_form_id uuid, submitted_answers jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare new_submission_id uuid;
declare current_member_id uuid := (select private.current_profile_id());
begin
  if current_member_id is null or not (select private.form_is_open(target_form_id)) then raise exception 'Form is not open for this member'; end if;
  if jsonb_typeof(submitted_answers) is distinct from 'array' then raise exception 'Answers must be an array'; end if;
  if exists (
    select 1 from public.participation_questions q
    where q.form_id = target_form_id and q.is_required
      and not exists (select 1 from jsonb_array_elements(submitted_answers) item where item ->> 'question_id' = q.id::text)
  ) then raise exception 'Required answer is missing'; end if;
  insert into public.participation_submissions (form_id, participant_id)
  values (target_form_id, current_member_id) returning id into new_submission_id;
  insert into public.participation_answers (submission_id, question_id, answer)
  select new_submission_id, (item ->> 'question_id')::uuid, item -> 'answer'
  from jsonb_array_elements(submitted_answers) item;
  return new_submission_id;
end;
$$;

create or replace function public.validate_event_mom_vote()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.voter_id is distinct from (select private.current_profile_id()) then raise exception 'Votes can only be submitted for the signed-in member'; end if;
  if new.voter_id = new.candidate_profile_id then raise exception 'Members cannot vote for themselves'; end if;
  if not exists (select 1 from public.events where id = new.event_id and starts_at < now()) then raise exception 'MOM voting opens after the event starts'; end if;
  if not exists (select 1 from public.attendance where event_id = new.event_id and member_id = new.voter_id and checked_in_at is not null) then raise exception 'Only checked-in members can vote'; end if;
  if not exists (select 1 from public.attendance where event_id = new.event_id and member_id = new.candidate_profile_id and checked_in_at is not null) then raise exception 'MOM candidates must be checked in'; end if;
  new.voted_at := now();
  return new;
end;
$$;

create or replace function public.submit_membership_application(
  applicant_name text, applicant_phone text, applicant_birth_date date,
  applicant_residence text, applicant_preferred_position text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Public membership applications are disabled';
end;
$$;

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
  if not (select private.has_permission('events.manage')) then raise exception 'Event management permission is required'; end if;
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
        from public.profiles as profile
        where profile.id = participant_id and profile.status = 'active'::public.member_status;
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

create or replace function private.get_member_rankings_data()
returns table (member_id uuid, member_name text, attendance_count bigint, paid_fee_count bigint, total_score bigint)
language sql stable security definer set search_path = '' as $$
  select profile.id, profile.name,
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null),
    count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status),
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null) * 3 + count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status)
  from public.profiles as profile
  left join public.attendance as attendance on attendance.member_id = profile.id
  left join public.fees as fee on fee.member_id = profile.id
  where profile.status = 'active'::public.member_status and (select private.is_active_member())
  group by profile.id, profile.name order by 5 desc, 3 desc, 4 desc, profile.name;
$$;

create or replace function private.get_event_mom_results_data()
returns table (event_id uuid, candidate_profile_id uuid, candidate_name text, vote_count bigint, mom_rank bigint)
language sql stable security definer set search_path = '' as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank from vote_counts
  )
  select ranked.event_id, ranked.candidate_profile_id, profile.name, ranked.vote_count, ranked.mom_rank
  from ranked join public.profiles as profile on profile.id = ranked.candidate_profile_id
  where ranked.mom_rank <= 3 and (select private.is_active_member())
  order by ranked.event_id, ranked.mom_rank, profile.name;
$$;

create or replace function private.get_mom_leaderboard_data()
returns table (member_id uuid, member_name text, first_place_count bigint, second_place_count bigint, third_place_count bigint, total_votes bigint)
language sql stable security definer set search_path = '' as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank from vote_counts
  )
  select profile.id, profile.name,
    count(*) filter (where ranked.mom_rank = 1), count(*) filter (where ranked.mom_rank = 2), count(*) filter (where ranked.mom_rank = 3),
    coalesce(sum(ranked.vote_count), 0)::bigint
  from public.profiles as profile left join ranked on ranked.candidate_profile_id = profile.id
  where profile.status = 'active'::public.member_status and (select private.is_active_member())
  group by profile.id, profile.name order by 3 desc, 4 desc, 5 desc, 6 desc, profile.name;
$$;
