alter table public.profiles
add column is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'Marks a non-roster account used for authenticated application testing.';

create index profiles_test_account_idx
on public.profiles (is_test_account)
where is_test_account;

drop policy if exists "Member managers read all profiles" on public.profiles;
create policy "Member managers read all profiles"
on public.profiles for select to authenticated
using (
  (
    not is_test_account
    or auth_user_id = (select auth.uid())
  )
  and (select private.has_permission('members.manage'))
);

create or replace function public.get_member_directory()
returns table (
  id uuid,
  name text,
  role public.account_role,
  officer_title public.officer_title,
  is_system_admin boolean,
  "position" text,
  jersey_number integer,
  joined_at date,
  status public.member_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.name,
    profile.role,
    profile.officer_title,
    profile.is_system_admin,
    profile.position,
    profile.jersey_number,
    profile.joined_at,
    profile.status
  from public.profiles as profile
  where auth.uid() is not null
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
  order by profile.name;
$$;

create or replace function private.get_member_rankings_data()
returns table (member_id uuid, member_name text, attendance_count bigint, paid_fee_count bigint, total_score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.name,
    count(distinct attendance.event_id) filter (where attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or attendance.checked_in_at is not null),
    count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status),
    count(distinct attendance.event_id) filter (where attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or attendance.checked_in_at is not null) * 3 + count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status)
  from public.profiles as profile
  left join public.attendance as attendance on attendance.member_id = profile.id
  left join public.fees as fee on fee.member_id = profile.id
  where profile.status = 'active'::public.member_status
    and not profile.is_test_account
    and (select private.is_active_member())
  group by profile.id, profile.name order by 5 desc, 3 desc, 4 desc, profile.name;
$$;

create or replace function private.get_event_mom_results_data()
returns table (event_id uuid, candidate_profile_id uuid, candidate_name text, vote_count bigint, mom_rank bigint)
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
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank
    from vote_counts
  )
  select ranked.event_id, ranked.candidate_profile_id, profile.name, ranked.vote_count, ranked.mom_rank
  from ranked
  join public.profiles as profile on profile.id = ranked.candidate_profile_id
  where ranked.mom_rank <= 3
    and not profile.is_test_account
    and (select private.is_active_member())
  order by ranked.event_id, ranked.mom_rank, profile.name;
$$;

create or replace function private.get_mom_leaderboard_data()
returns table (member_id uuid, member_name text, first_place_count bigint, second_place_count bigint, third_place_count bigint, total_votes bigint)
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
    select vote_counts.*, dense_rank() over (partition by vote_counts.event_id order by vote_counts.vote_count desc) as mom_rank
    from vote_counts
  )
  select profile.id, profile.name,
    count(*) filter (where ranked.mom_rank = 1),
    count(*) filter (where ranked.mom_rank = 2),
    count(*) filter (where ranked.mom_rank = 3),
    coalesce(sum(ranked.vote_count), 0)::bigint
  from public.profiles as profile
  left join ranked on ranked.candidate_profile_id = profile.id
  where profile.status = 'active'::public.member_status
    and not profile.is_test_account
    and (select private.is_active_member())
  group by profile.id, profile.name order by 3 desc, 4 desc, 5 desc, 6 desc, profile.name;
$$;
