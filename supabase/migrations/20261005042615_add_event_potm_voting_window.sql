alter table public.events
  add column ends_at timestamptz,
  add column mom_voting_days integer not null default 3,
  add constraint events_end_after_start check (ends_at is null or ends_at > starts_at),
  add constraint events_mom_voting_days_range check (mom_voting_days between 1 and 30);

comment on column public.events.ends_at is
  'Scheduled end; NULL uses starts_at plus two hours, not a recorded completion.';
comment on column public.events.mom_voting_days is
  'POTM voting duration after scheduled end, in exact 24-hour periods.';

create function private.current_mom_voter_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select profile.id from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'active'::public.member_status
    and not profile.must_change_password
    and not profile.is_test_account;
$$;
revoke all on function private.current_mom_voter_id() from public, anon, authenticated, service_role;
grant execute on function private.current_mom_voter_id() to authenticated;

create function public.protect_event_mom_window()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  -- The existing weekly scheduler and trusted server provisioning run as the
  -- definer owner. A missing JWT never makes an ordinary client trusted.
  if current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if (select private.current_mom_voter_id()) is null
      or not (select private.has_permission('events.manage')) then
      raise exception 'Only eligible event managers can configure POTM voting' using errcode = '42501';
    end if;
  elsif new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.mom_voting_days is distinct from old.mom_voting_days then
    if (select private.current_mom_voter_id()) is null
      or not (select private.has_permission('events.manage')) then
      raise exception 'Only eligible event managers can configure POTM voting' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_event_mom_window() from public, anon, authenticated, service_role;
create trigger protect_event_mom_window_before_write
before insert or update of starts_at, ends_at, mom_voting_days on public.events
for each row execute function public.protect_event_mom_window();

-- Pure time comparison shared by the trigger and exact-boundary SQL tests.
-- Explicit hours preserve 24-hour days across session time zones and DST.
create function private.event_mom_voting_is_open(
  p_starts_at timestamptz, p_ends_at timestamptz, p_voting_days integer, p_at timestamptz
)
returns boolean
language sql immutable security invoker set search_path = ''
as $$
  select coalesce(
    p_starts_at is not null and p_voting_days between 1 and 30
    and p_at >= coalesce(p_ends_at, p_starts_at + interval '2 hours')
    and p_at < coalesce(p_ends_at, p_starts_at + interval '2 hours')
      + p_voting_days * interval '24 hours', false);
$$;
revoke all on function private.event_mom_voting_is_open(timestamptz, timestamptz, integer, timestamptz)
from public, anon, authenticated, service_role;

create function private.validate_event_mom_vote()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  vote_event_id uuid;
  vote_voter_id uuid;
  actor_profile public.profiles%rowtype;
  target_event public.events%rowtype;
  voting_at timestamptz;
begin
  -- Parent deletion remains governed by the existing event/profile RLS. Only
  -- a nested FK cascade with an actually missing parent bypasses vote-window
  -- checks; a member's direct DELETE never receives this exception.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 and (
    not exists (select 1 from public.events where id = old.event_id)
    or not exists (select 1 from public.profiles where id = old.voter_id)
    or not exists (select 1 from public.profiles where id = old.candidate_profile_id)
  ) then
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    new.event_id is distinct from old.event_id
    or new.voter_id is distinct from old.voter_id
  ) then
    raise exception 'A vote cannot be moved to another event or voter' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    vote_event_id := old.event_id;
    vote_voter_id := old.voter_id;
  else
    vote_event_id := new.event_id;
    vote_voter_id := new.voter_id;
  end if;

  -- Direct UPDATE may already hold a vote row while parent DELETE holds an
  -- event row. NOWAIT avoids an event -> vote / vote -> event deadlock.
  select event.* into target_event from public.events as event
  where event.id = vote_event_id for share nowait;
  if not found then
    raise exception 'POTM event is not available' using errcode = '42501';
  end if;

  select profile.* into actor_profile from public.profiles as profile
  where profile.auth_user_id = (select auth.uid()) for share nowait;
  if not found or actor_profile.id is distinct from vote_voter_id
    or actor_profile.status <> 'active'::public.member_status
    or actor_profile.must_change_password or actor_profile.is_test_account then
    raise exception 'POTM voting access is not available' using errcode = '42501';
  end if;

  perform attendance.member_id from public.attendance as attendance
  where attendance.event_id = vote_event_id and attendance.member_id = vote_voter_id
    and (attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status)
      or (attendance.check_in_status is null and attendance.checked_in_at is not null))
  for share nowait;
  if not found then
    raise exception 'Only checked-in members can vote or withdraw a vote' using errcode = '42501';
  end if;

  if tg_op <> 'DELETE' then
    if new.candidate_profile_id = vote_voter_id then
      raise exception 'Members cannot vote for themselves' using errcode = '42501';
    end if;
    perform candidate.id from public.profiles as candidate
    where candidate.id = new.candidate_profile_id
      and candidate.status = 'active'::public.member_status and not candidate.is_test_account
    for share nowait;
    if not found then
      raise exception 'POTM candidate is not available' using errcode = '42501';
    end if;
    perform attendance.member_id from public.attendance as attendance
    where attendance.event_id = vote_event_id and attendance.member_id = new.candidate_profile_id
      and (attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status)
        or (attendance.check_in_status is null and attendance.checked_in_at is not null))
    for share nowait;
    if not found then
      raise exception 'POTM candidates must be checked in' using errcode = '42501';
    end if;
  end if;

  -- Use wall-clock time after acquiring all guards, not transaction-start now().
  voting_at := pg_catalog.clock_timestamp();
  if not private.event_mom_voting_is_open(
    target_event.starts_at, target_event.ends_at, target_event.mom_voting_days, voting_at
  ) then
    raise exception 'POTM voting is outside the event voting period' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.voted_at := voting_at;
  return new;
exception when lock_not_available then
  raise exception 'The event or membership is being changed. Refresh and try again' using errcode = '40001';
end;
$$;
revoke all on function private.validate_event_mom_vote() from public, anon, authenticated, service_role;

drop trigger validate_event_mom_vote_before_write on public.event_mom_votes;
drop function public.validate_event_mom_vote();
create trigger validate_event_mom_vote_before_write
before insert or update or delete on public.event_mom_votes
for each row execute function private.validate_event_mom_vote();

drop policy "Checked-in members create MOM vote" on public.event_mom_votes;
create policy "Checked-in members create MOM vote"
on public.event_mom_votes for insert to authenticated
with check (voter_id = (select private.current_mom_voter_id()));
drop policy "Checked-in members update MOM vote" on public.event_mom_votes;
create policy "Checked-in members update MOM vote"
on public.event_mom_votes for update to authenticated
using (voter_id = (select private.current_mom_voter_id()))
with check (voter_id = (select private.current_mom_voter_id()));
drop policy "Members read own MOM vote" on public.event_mom_votes;
create policy "Members read own MOM vote"
on public.event_mom_votes for select to authenticated
using (voter_id = (select private.current_mom_voter_id()));
drop policy "Members withdraw own MOM vote" on public.event_mom_votes;
create policy "Members withdraw own MOM vote"
on public.event_mom_votes for delete to authenticated
using (voter_id = (select private.current_mom_voter_id()));

-- Keep direct CRUD for older clients; RLS and the definer trigger guard every
-- path, including upsert and DELETE. No existing vote is rewritten or removed.
-- Legacy default grants include operations that RLS does not protect.
revoke truncate, references, trigger on public.event_mom_votes from public, anon, authenticated;

create or replace function private.get_event_mom_results_data()
returns table (event_id uuid, candidate_profile_id uuid, candidate_name text, vote_count bigint, mom_rank bigint)
language sql stable security definer set search_path = ''
as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote
    join public.profiles as voter on voter.id = vote.voter_id and not voter.is_test_account
    join public.profiles as candidate on candidate.id = vote.candidate_profile_id and not candidate.is_test_account
    group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank
    from vote_counts
  )
  select ranked.event_id, ranked.candidate_profile_id, profile.name, ranked.vote_count, ranked.mom_rank
  from ranked join public.profiles as profile on profile.id = ranked.candidate_profile_id
  where ranked.mom_rank <= 3 and (select private.current_mom_voter_id()) is not null
  order by ranked.event_id, ranked.mom_rank, profile.name;
$$;
revoke all on function private.get_event_mom_results_data() from public, anon, authenticated, service_role;
grant execute on function private.get_event_mom_results_data() to authenticated;

create or replace function private.get_mom_leaderboard_data()
returns table (member_id uuid, member_name text, first_place_count bigint, second_place_count bigint, third_place_count bigint, total_votes bigint)
language sql stable security definer set search_path = ''
as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote
    join public.events as event on event.id = vote.event_id
    join public.profiles as voter on voter.id = vote.voter_id and not voter.is_test_account
    join public.profiles as candidate on candidate.id = vote.candidate_profile_id and not candidate.is_test_account
    where coalesce(event.ends_at, event.starts_at + interval '2 hours')
      + event.mom_voting_days * interval '24 hours' <= pg_catalog.statement_timestamp()
    group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank
    from vote_counts
  )
  select profile.id, profile.name,
    count(*) filter (where ranked.mom_rank = 1),
    count(*) filter (where ranked.mom_rank = 2),
    count(*) filter (where ranked.mom_rank = 3),
    coalesce(sum(ranked.vote_count), 0)::bigint
  from public.profiles as profile left join ranked on ranked.candidate_profile_id = profile.id
  where profile.status = 'active'::public.member_status and not profile.is_test_account
    and (select private.current_mom_voter_id()) is not null
  group by profile.id, profile.name order by 3 desc, 4 desc, 5 desc, 6 desc, profile.name;
$$;
revoke all on function private.get_mom_leaderboard_data() from public, anon, authenticated, service_role;
grant execute on function private.get_mom_leaderboard_data() to authenticated;

-- Public result wrappers retain their five/six-column invoker contracts.
notify pgrst, 'reload schema';
