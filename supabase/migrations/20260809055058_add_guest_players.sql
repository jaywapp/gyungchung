create table public.guest_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  phone text check (phone is null or char_length(phone) <= 30),
  preferred_position text check (preferred_position is null or preferred_position in ('GK', 'DF', 'MF', 'FW', 'ANY')),
  note text check (note is null or char_length(note) <= 500),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_guest_players (
  event_id uuid not null references public.events(id) on delete cascade,
  guest_player_id uuid not null references public.guest_players(id) on delete restrict,
  guest_name text not null check (char_length(guest_name) between 1 and 50),
  guest_position text check (guest_position is null or guest_position in ('GK', 'DF', 'MF', 'FW', 'ANY')),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, guest_player_id)
);

create index event_guest_players_guest_idx
on public.event_guest_players (guest_player_id, created_at desc);

create or replace function public.prepare_guest_player()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke execute on function public.prepare_guest_player()
from public, anon, authenticated;

create trigger prepare_guest_player_before_write
before insert or update on public.guest_players
for each row execute function public.prepare_guest_player();

create or replace function public.prepare_event_guest_player()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select guest.name, guest.preferred_position
  into new.guest_name, new.guest_position
  from public.guest_players as guest
  where guest.id = new.guest_player_id;

  if new.guest_name is null then
    raise exception 'Guest player does not exist';
  end if;

  new.added_by := (select auth.uid());
  return new;
end;
$$;

revoke execute on function public.prepare_event_guest_player()
from public, anon, authenticated;

create trigger prepare_event_guest_player_before_write
before insert or update on public.event_guest_players
for each row execute function public.prepare_event_guest_player();

alter table public.guest_players enable row level security;
alter table public.event_guest_players enable row level security;

create policy "Event managers read guest directory"
on public.guest_players
for select
to authenticated
using ((select private.has_permission('events.manage')));

create policy "Event managers create guests"
on public.guest_players
for insert
to authenticated
with check ((select private.has_permission('events.manage')));

create policy "Event managers update guests"
on public.guest_players
for update
to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));

create policy "Event managers delete unused guests"
on public.guest_players
for delete
to authenticated
using ((select private.has_permission('events.manage')));

create policy "Scheduled guests are public"
on public.event_guest_players
for select
to anon, authenticated
using (true);

create policy "Event managers schedule guests"
on public.event_guest_players
for insert
to authenticated
with check ((select private.has_permission('events.manage')));

create policy "Event managers update scheduled guests"
on public.event_guest_players
for update
to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));

create policy "Event managers remove scheduled guests"
on public.event_guest_players
for delete
to authenticated
using ((select private.has_permission('events.manage')));

grant select, insert, update, delete on public.guest_players to authenticated;
grant select on public.event_guest_players to anon, authenticated;
grant insert, update, delete on public.event_guest_players to authenticated;

alter table public.events
add column is_competitive boolean not null default false,
add column team_mode text check (team_mode is null or team_mode in ('random', 'balanced'));

create table public.event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  team_number integer not null check (team_number between 1 and 4),
  team_name text not null check (char_length(team_name) between 1 and 30),
  score integer check (score is null or score >= 0),
  generation_mode text not null check (generation_mode in ('random', 'balanced')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, team_number),
  unique (id, event_id)
);

create table public.event_team_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  event_team_id uuid not null,
  profile_id uuid references public.profiles(id) on delete restrict,
  guest_player_id uuid references public.guest_players(id) on delete restrict,
  participant_name text not null check (char_length(participant_name) between 1 and 50),
  participant_position text check (participant_position is null or participant_position in ('GK', 'DF', 'MF', 'FW', 'ANY')),
  goals integer not null default 0 check (goals >= 0),
  rating numeric(3,1) check (rating is null or rating between 0 and 10),
  created_at timestamptz not null default now(),
  foreign key (event_team_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  check ((profile_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);

create unique index event_team_members_profile_idx
on public.event_team_members (event_id, profile_id)
where profile_id is not null;

create unique index event_team_members_guest_idx
on public.event_team_members (event_id, guest_player_id)
where guest_player_id is not null;

alter table public.event_teams enable row level security;
alter table public.event_team_members enable row level security;

create policy "Event teams are public"
on public.event_teams for select to anon, authenticated using (true);
create policy "Event managers create teams"
on public.event_teams for insert to authenticated
with check ((select private.has_permission('events.manage')));
create policy "Event managers update teams"
on public.event_teams for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));
create policy "Event managers delete teams"
on public.event_teams for delete to authenticated
using ((select private.has_permission('events.manage')));

create policy "Event team members are public"
on public.event_team_members for select to anon, authenticated using (true);
create policy "Event managers create team members"
on public.event_team_members for insert to authenticated
with check ((select private.has_permission('events.manage')));
create policy "Event managers update team members"
on public.event_team_members for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));
create policy "Event managers delete team members"
on public.event_team_members for delete to authenticated
using ((select private.has_permission('events.manage')));

grant select on public.event_teams, public.event_team_members to anon, authenticated;
grant insert, update, delete on public.event_teams, public.event_team_members to authenticated;

create or replace function public.save_event_teams(
  target_event_id uuid,
  target_mode text,
  target_teams jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  team_data jsonb;
  participant_data jsonb;
  saved_team_id uuid;
  participant_kind text;
  participant_id uuid;
  participant_name text;
  participant_position text;
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Event management permission is required';
  end if;
  if target_mode not in ('random', 'balanced') or jsonb_typeof(target_teams) <> 'array' then
    raise exception 'Invalid team generation request';
  end if;
  if jsonb_array_length(target_teams) < 2 or jsonb_array_length(target_teams) > 4 then
    raise exception 'Create between two and four teams';
  end if;

  delete from public.event_teams where event_id = target_event_id;

  for team_data in select value from jsonb_array_elements(target_teams)
  loop
    insert into public.event_teams (event_id, team_number, team_name, generation_mode, created_by)
    values (
      target_event_id,
      (team_data ->> 'team_number')::integer,
      team_data ->> 'team_name',
      target_mode,
      (select auth.uid())
    )
    returning id into saved_team_id;

    for participant_data in select value from jsonb_array_elements(team_data -> 'participants')
    loop
      participant_kind := participant_data ->> 'kind';
      participant_id := (participant_data ->> 'id')::uuid;

      if participant_kind = 'member' then
        select profile.name, profile.position
        into participant_name, participant_position
        from public.profiles as profile
        where profile.id = participant_id
          and profile.status = 'active'::public.member_status
          and exists (
            select 1 from public.attendance as attendance
            where attendance.event_id = target_event_id
              and attendance.member_id = profile.id
              and (attendance.status = 'going'::public.attendance_status or attendance.checked_in_at is not null)
          );
      elsif participant_kind = 'guest' then
        select scheduled_guest.guest_name, scheduled_guest.guest_position
        into participant_name, participant_position
        from public.event_guest_players as scheduled_guest
        where scheduled_guest.event_id = target_event_id
          and scheduled_guest.guest_player_id = participant_id;
      else
        raise exception 'Invalid participant type';
      end if;

      if participant_name is null then
        raise exception 'Participant is not eligible for this event';
      end if;

      insert into public.event_team_members (
        event_id, event_team_id, profile_id, guest_player_id,
        participant_name, participant_position
      ) values (
        target_event_id,
        saved_team_id,
        case when participant_kind = 'member' then participant_id end,
        case when participant_kind = 'guest' then participant_id end,
        participant_name,
        participant_position
      );
    end loop;
  end loop;

  update public.events
  set team_mode = target_mode
  where id = target_event_id;
end;
$$;

revoke all on function public.save_event_teams(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.save_event_teams(uuid, text, jsonb) to authenticated;

create or replace function public.save_competitive_event_stats(
  target_event_id uuid,
  target_team_stats jsonb,
  target_player_stats jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Event management permission is required';
  end if;
  if not exists (
    select 1 from public.events
    where id = target_event_id and is_competitive
  ) then
    raise exception 'Competitive mode is not enabled for this event';
  end if;

  for item in select value from jsonb_array_elements(target_team_stats)
  loop
    update public.event_teams
    set score = (item ->> 'score')::integer,
        updated_at = now()
    where id = (item ->> 'id')::uuid
      and event_id = target_event_id;
  end loop;

  for item in select value from jsonb_array_elements(target_player_stats)
  loop
    update public.event_team_members
    set goals = (item ->> 'goals')::integer,
        rating = nullif(item ->> 'rating', '')::numeric
    where id = (item ->> 'id')::uuid
      and event_id = target_event_id;
  end loop;
end;
$$;

revoke all on function public.save_competitive_event_stats(uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.save_competitive_event_stats(uuid, jsonb, jsonb) to authenticated;

alter table public.attendance
add column checked_in_at timestamptz,
add column checked_in_by uuid references public.profiles(id) on delete set null;

create index attendance_checked_in_member_idx
on public.attendance (member_id, checked_in_at desc)
where checked_in_at is not null;

create policy "Event managers insert attendance"
on public.attendance
for insert
to authenticated
with check ((select private.has_permission('events.manage')));

create or replace function public.protect_attendance_check_in()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    (tg_op = 'INSERT' and new.checked_in_at is not null)
    or (tg_op = 'UPDATE' and (
      new.checked_in_at is distinct from old.checked_in_at
      or new.checked_in_by is distinct from old.checked_in_by
    ))
  ) and not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can change check-in records';
  end if;

  if new.checked_in_at is null then
    new.checked_in_by := null;
  elsif tg_op = 'INSERT' or new.checked_in_at is distinct from old.checked_in_at or new.checked_in_by is null then
    new.checked_in_by := (select auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.protect_attendance_check_in()
from public, anon, authenticated;

create trigger protect_attendance_check_in_before_write
before insert or update on public.attendance
for each row execute function public.protect_attendance_check_in();

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
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.name,
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null) as attendance_count,
    count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status) as paid_fee_count,
    count(distinct attendance.event_id) filter (where attendance.checked_in_at is not null) * 3
      + count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status) as total_score
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
  order by total_score desc, attendance_count desc, paid_fee_count desc, profile.name;
$$;

revoke all on function public.get_member_rankings()
from public, anon, authenticated;
grant execute on function public.get_member_rankings() to authenticated;

create table public.event_mom_votes (
  event_id uuid not null references public.events(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  candidate_profile_id uuid not null references public.profiles(id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (event_id, voter_id),
  check (voter_id <> candidate_profile_id)
);

create index event_mom_votes_candidate_idx
on public.event_mom_votes (event_id, candidate_profile_id);

create or replace function public.validate_event_mom_vote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.voter_id is distinct from (select auth.uid()) then
    raise exception 'Votes can only be submitted for the signed-in member';
  end if;
  if new.voter_id = new.candidate_profile_id then
    raise exception 'Members cannot vote for themselves';
  end if;
  if not exists (
    select 1 from public.events
    where id = new.event_id and starts_at < now()
  ) then
    raise exception 'MOM voting opens after the event starts';
  end if;
  if not exists (
    select 1 from public.attendance
    where event_id = new.event_id
      and member_id = new.voter_id
      and checked_in_at is not null
  ) then
    raise exception 'Only checked-in members can vote';
  end if;
  if not exists (
    select 1 from public.attendance
    where event_id = new.event_id
      and member_id = new.candidate_profile_id
      and checked_in_at is not null
  ) then
    raise exception 'MOM candidates must be checked in';
  end if;
  new.voted_at := now();
  return new;
end;
$$;

revoke execute on function public.validate_event_mom_vote()
from public, anon, authenticated;

create trigger validate_event_mom_vote_before_write
before insert or update on public.event_mom_votes
for each row execute function public.validate_event_mom_vote();

alter table public.event_mom_votes enable row level security;

create policy "Members read own MOM vote"
on public.event_mom_votes for select to authenticated
using (voter_id = (select auth.uid()));
create policy "Checked-in members create MOM vote"
on public.event_mom_votes for insert to authenticated
with check (voter_id = (select auth.uid()) and (select private.is_active_member()));
create policy "Checked-in members update MOM vote"
on public.event_mom_votes for update to authenticated
using (voter_id = (select auth.uid()) and (select private.is_active_member()))
with check (voter_id = (select auth.uid()) and (select private.is_active_member()));
create policy "Members withdraw own MOM vote"
on public.event_mom_votes for delete to authenticated
using (voter_id = (select auth.uid()));

grant select, insert, update, delete on public.event_mom_votes to authenticated;

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
security definer
set search_path = ''
as $$
  with vote_counts as (
    select
      vote.event_id,
      vote.candidate_profile_id,
      count(*) as vote_count
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

revoke all on function public.get_event_mom_results()
from public, anon, authenticated;
grant execute on function public.get_event_mom_results() to authenticated;

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
    count(*) filter (where ranked.mom_rank = 1) as first_place_count,
    count(*) filter (where ranked.mom_rank = 2) as second_place_count,
    count(*) filter (where ranked.mom_rank = 3) as third_place_count,
    coalesce(sum(ranked.vote_count), 0)::bigint as total_votes
  from public.profiles as profile
  left join ranked on ranked.candidate_profile_id = profile.id
  where profile.status = 'active'::public.member_status
    and exists (
      select 1 from public.profiles as viewer
      where viewer.id = (select auth.uid())
        and viewer.status = 'active'::public.member_status
    )
  group by profile.id, profile.name
  order by first_place_count desc, second_place_count desc, third_place_count desc, total_votes desc, profile.name;
$$;

revoke all on function public.get_mom_leaderboard()
from public, anon, authenticated;
grant execute on function public.get_mom_leaderboard() to authenticated;
