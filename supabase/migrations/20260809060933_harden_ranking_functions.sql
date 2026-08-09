create index attendance_checked_in_by_idx
on public.attendance (checked_in_by);

create index event_guest_players_added_by_idx
on public.event_guest_players (added_by);

create index event_mom_votes_candidate_profile_idx
on public.event_mom_votes (candidate_profile_id);

create index event_mom_votes_voter_idx
on public.event_mom_votes (voter_id);

create index event_team_members_event_team_idx
on public.event_team_members (event_team_id, event_id);

create index event_team_members_guest_player_idx
on public.event_team_members (guest_player_id);

create index event_team_members_profile_fk_idx
on public.event_team_members (profile_id);

create index event_teams_created_by_idx
on public.event_teams (created_by);

create index guest_players_created_by_idx
on public.guest_players (created_by);

drop policy "Active members insert own attendance" on public.attendance;
drop policy "Event managers insert attendance" on public.attendance;

create policy "Members and event managers insert attendance"
on public.attendance for insert to authenticated
with check (
  (
    member_id = (select auth.uid())
    and (select private.is_active_member())
  )
  or (select private.has_permission('events.manage'))
);

create or replace function private.get_member_rankings_data()
returns table (
  member_id uuid,
  member_name text,
  attendance_count bigint,
  paid_fee_count bigint,
  total_score bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.name,
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null),
    count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status),
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null) * 3
      + count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status)
  from public.profiles as profile
  left join public.attendance as attendance on attendance.member_id = profile.id
  left join public.fees as fee on fee.member_id = profile.id
  where profile.status = 'active'::public.member_status
    and exists (
      select 1
      from public.profiles as viewer
      where viewer.id = (select auth.uid())
        and viewer.status = 'active'::public.member_status
    )
  group by profile.id, profile.name
  order by 5 desc, 3 desc, 4 desc, profile.name;
$$;

revoke all on function private.get_member_rankings_data()
from public, anon, authenticated;
grant execute on function private.get_member_rankings_data() to authenticated;

create or replace function public.get_member_rankings()
returns table (
  member_id uuid,
  member_name text,
  attendance_count bigint,
  paid_fee_count bigint,
  total_score bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_member_rankings_data();
$$;

revoke all on function public.get_member_rankings()
from public, anon, authenticated;
grant execute on function public.get_member_rankings() to authenticated;

create or replace function private.get_event_mom_results_data()
returns table (
  event_id uuid,
  candidate_profile_id uuid,
  candidate_name text,
  vote_count bigint,
  mom_rank bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote
    group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select
      vote_counts.*,
      dense_rank() over (
        partition by vote_counts.event_id
        order by vote_counts.vote_count desc
      ) as mom_rank
    from vote_counts
  )
  select
    ranked.event_id,
    ranked.candidate_profile_id,
    profile.name,
    ranked.vote_count,
    ranked.mom_rank
  from ranked
  join public.profiles as profile on profile.id = ranked.candidate_profile_id
  where ranked.mom_rank <= 3
    and exists (
      select 1 from public.profiles as viewer
      where viewer.id = (select auth.uid())
        and viewer.status = 'active'::public.member_status
    )
  order by ranked.event_id, ranked.mom_rank, profile.name;
$$;

revoke all on function private.get_event_mom_results_data()
from public, anon, authenticated;
grant execute on function private.get_event_mom_results_data() to authenticated;

create or replace function public.get_event_mom_results()
returns table (
  event_id uuid,
  candidate_profile_id uuid,
  candidate_name text,
  vote_count bigint,
  mom_rank bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_event_mom_results_data();
$$;

revoke all on function public.get_event_mom_results()
from public, anon, authenticated;
grant execute on function public.get_event_mom_results() to authenticated;

create or replace function private.get_mom_leaderboard_data()
returns table (
  member_id uuid,
  member_name text,
  first_place_count bigint,
  second_place_count bigint,
  third_place_count bigint,
  total_votes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with vote_counts as (
    select vote.event_id, vote.candidate_profile_id, count(*) as vote_count
    from public.event_mom_votes as vote
    group by vote.event_id, vote.candidate_profile_id
  ), ranked as (
    select
      vote_counts.*,
      dense_rank() over (
        partition by vote_counts.event_id
        order by vote_counts.vote_count desc
      ) as mom_rank
    from vote_counts
  )
  select
    profile.id,
    profile.name,
    count(*) filter (where ranked.mom_rank = 1),
    count(*) filter (where ranked.mom_rank = 2),
    count(*) filter (where ranked.mom_rank = 3),
    coalesce(sum(ranked.vote_count), 0)::bigint
  from public.profiles as profile
  left join ranked on ranked.candidate_profile_id = profile.id
  where profile.status = 'active'::public.member_status
    and exists (
      select 1 from public.profiles as viewer
      where viewer.id = (select auth.uid())
        and viewer.status = 'active'::public.member_status
    )
  group by profile.id, profile.name
  order by 3 desc, 4 desc, 5 desc, 6 desc, profile.name;
$$;

revoke all on function private.get_mom_leaderboard_data()
from public, anon, authenticated;
grant execute on function private.get_mom_leaderboard_data() to authenticated;

create or replace function public.get_mom_leaderboard()
returns table (
  member_id uuid,
  member_name text,
  first_place_count bigint,
  second_place_count bigint,
  third_place_count bigint,
  total_votes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_mom_leaderboard_data();
$$;

revoke all on function public.get_mom_leaderboard()
from public, anon, authenticated;
grant execute on function public.get_mom_leaderboard() to authenticated;
