create table public.event_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  match_number integer not null check (match_number >= 1),
  team_a_id uuid not null,
  team_b_id uuid not null,
  team_a_score integer not null default 0 check (team_a_score >= 0),
  team_b_score integer not null default 0 check (team_b_score >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, match_number),
  unique (id, event_id),
  foreign key (team_a_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  foreign key (team_b_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  check (team_a_id <> team_b_id)
);

create index event_matches_event_idx
on public.event_matches (event_id, match_number);

create table public.event_match_scorers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid not null,
  team_id uuid not null,
  profile_id uuid references public.profiles(id) on delete restrict,
  guest_player_id uuid references public.guest_players(id) on delete restrict,
  scorer_name text not null check (char_length(btrim(scorer_name)) between 1 and 50),
  goals integer not null default 1 check (goals >= 1),
  created_at timestamptz not null default now(),
  foreign key (match_id, event_id) references public.event_matches(id, event_id) on delete cascade,
  foreign key (team_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  check ((profile_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);

create index event_match_scorers_match_idx
on public.event_match_scorers (match_id, team_id);

alter table public.event_matches enable row level security;
alter table public.event_match_scorers enable row level security;

create policy "Event matches are public"
on public.event_matches for select to anon, authenticated using (true);
create policy "Event managers create matches"
on public.event_matches for insert to authenticated
with check ((select private.has_permission('events.manage')));
create policy "Event managers update matches"
on public.event_matches for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));
create policy "Event managers delete matches"
on public.event_matches for delete to authenticated
using ((select private.has_permission('events.manage')));

create policy "Match scorers are public"
on public.event_match_scorers for select to anon, authenticated using (true);
create policy "Event managers create match scorers"
on public.event_match_scorers for insert to authenticated
with check ((select private.has_permission('events.manage')));
create policy "Event managers update match scorers"
on public.event_match_scorers for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));
create policy "Event managers delete match scorers"
on public.event_match_scorers for delete to authenticated
using ((select private.has_permission('events.manage')));

grant select on public.event_matches, public.event_match_scorers to anon, authenticated, service_role;
grant insert, update, delete on public.event_matches, public.event_match_scorers to authenticated, service_role;

create or replace function public.validate_event_match_scorer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.event_matches as event_match
    where event_match.id = new.match_id
      and event_match.event_id = new.event_id
      and (new.team_id = event_match.team_a_id or new.team_id = event_match.team_b_id)
  ) then
    raise exception 'Scorer team is not part of the selected match';
  end if;

  if not exists (
    select 1
    from public.event_team_members as member
    where member.event_id = new.event_id
      and member.event_team_id = new.team_id
      and (
        (new.profile_id is not null and member.profile_id = new.profile_id)
        or (new.guest_player_id is not null and member.guest_player_id = new.guest_player_id)
      )
  ) then
    raise exception 'Scorer is not a member of the selected team';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_event_match_scorer() from public, anon, authenticated;
grant execute on function public.validate_event_match_scorer() to authenticated, service_role;

create trigger validate_event_match_scorer_before_write
before insert or update on public.event_match_scorers
for each row execute function public.validate_event_match_scorer();

create or replace function public.save_event_match_history(
  target_event_id uuid,
  target_matches jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  match_data jsonb;
  scorer_data jsonb;
  saved_match_id uuid;
  match_number integer;
  team_a_id uuid;
  team_b_id uuid;
  team_a_score integer;
  team_b_score integer;
  profile_id uuid;
  guest_player_id uuid;
  scorer_name text;
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Event management permission is required';
  end if;
  if not exists (select 1 from public.events where id = target_event_id) then
    raise exception 'Event not found';
  end if;
  if target_matches is null or jsonb_typeof(target_matches) <> 'array' then
    raise exception 'Invalid match history request';
  end if;

  delete from public.event_matches where event_id = target_event_id;

  for match_data in select value from jsonb_array_elements(target_matches)
  loop
    match_number := nullif(btrim(match_data ->> 'match_number'), '')::integer;
    team_a_id := nullif(btrim(match_data ->> 'team_a_id'), '')::uuid;
    team_b_id := nullif(btrim(match_data ->> 'team_b_id'), '')::uuid;
    team_a_score := coalesce(nullif(btrim(match_data ->> 'team_a_score'), '')::integer, 0);
    team_b_score := coalesce(nullif(btrim(match_data ->> 'team_b_score'), '')::integer, 0);

    if match_number is null or match_number < 1 then
      raise exception 'Match number must be positive';
    end if;
    if team_a_id is null or team_b_id is null or team_a_id = team_b_id then
      raise exception 'Each match needs two different teams';
    end if;
    if team_a_score < 0 or team_b_score < 0 then
      raise exception 'Match scores cannot be negative';
    end if;

    insert into public.event_matches (
      event_id, match_number, team_a_id, team_b_id,
      team_a_score, team_b_score, created_by
    ) values (
      target_event_id, match_number, team_a_id, team_b_id,
      team_a_score, team_b_score, (select auth.uid())
    ) returning id into saved_match_id;

    for scorer_data in select value from jsonb_array_elements(coalesce(match_data -> 'scorers', '[]'::jsonb))
    loop
      profile_id := nullif(btrim(scorer_data ->> 'profile_id'), '')::uuid;
      guest_player_id := nullif(btrim(scorer_data ->> 'guest_player_id'), '')::uuid;
      scorer_name := btrim(scorer_data ->> 'scorer_name');

      if (profile_id is not null)::integer + (guest_player_id is not null)::integer <> 1 then
        raise exception 'Each scorer must reference one member or guest';
      end if;
      if scorer_name is null or char_length(scorer_name) = 0 then
        raise exception 'Scorer name is required';
      end if;

      insert into public.event_match_scorers (
        event_id, match_id, team_id, profile_id, guest_player_id, scorer_name, goals
      ) values (
        target_event_id,
        saved_match_id,
        nullif(btrim(scorer_data ->> 'team_id'), '')::uuid,
        profile_id,
        guest_player_id,
        scorer_name,
        greatest(coalesce(nullif(btrim(scorer_data ->> 'goals'), '')::integer, 1), 1)
      );
    end loop;

    if coalesce((select sum(goals) from public.event_match_scorers where match_id = saved_match_id and team_id = team_a_id), 0) > team_a_score
      or coalesce((select sum(goals) from public.event_match_scorers where match_id = saved_match_id and team_id = team_b_id), 0) > team_b_score then
      raise exception 'Scorer goals cannot exceed the match score';
    end if;
  end loop;
end;
$$;

revoke all on function public.save_event_match_history(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_event_match_history(uuid, jsonb) to authenticated;
