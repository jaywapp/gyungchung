begin;

create table public.event_match_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid not null,
  team_id uuid not null,
  profile_id uuid references public.profiles(id) on delete restrict,
  guest_player_id uuid references public.guest_players(id) on delete restrict,
  player_name text not null check (char_length(btrim(player_name)) between 1 and 50),
  created_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (match_id, event_id) references public.event_matches(id, event_id) on delete cascade,
  foreign key (team_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  check ((profile_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);

create index event_match_players_match_team_idx
on public.event_match_players (match_id, team_id);

create index event_match_players_event_idx
on public.event_match_players (event_id, match_id);

create unique index event_match_players_profile_idx
on public.event_match_players (match_id, profile_id)
where profile_id is not null;

create unique index event_match_players_guest_idx
on public.event_match_players (match_id, guest_player_id)
where guest_player_id is not null;

alter table public.event_match_players enable row level security;

create policy "Match players are public"
on public.event_match_players for select to anon, authenticated using (true);
create policy "Event managers create match players"
on public.event_match_players for insert to authenticated
with check ((select private.has_permission('events.manage')));
create policy "Event managers update match players"
on public.event_match_players for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));
create policy "Event managers delete match players"
on public.event_match_players for delete to authenticated
using ((select private.has_permission('events.manage')));

grant select on public.event_match_players to anon, authenticated, service_role;
grant insert, update, delete on public.event_match_players to authenticated, service_role;

create or replace function public.validate_event_match_player()
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
    raise exception 'Player team is not part of the selected match';
  end if;

  if not exists (
    select 1
    from public.event_team_members as member
    where member.event_id = new.event_id
      and (
        (new.profile_id is not null and member.profile_id = new.profile_id)
        or (new.guest_player_id is not null and member.guest_player_id = new.guest_player_id)
      )
  ) then
    raise exception 'Player is not part of the event roster';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_event_match_player() from public, anon, authenticated;
grant execute on function public.validate_event_match_player() to authenticated, service_role;

create trigger validate_event_match_player_before_write
before insert or update on public.event_match_players
for each row execute function public.validate_event_match_player();

insert into public.event_match_players (
  event_id, match_id, team_id, profile_id, guest_player_id, player_name
)
select
  event_match.event_id,
  event_match.id,
  member.event_team_id,
  member.profile_id,
  member.guest_player_id,
  member.participant_name
from public.event_matches as event_match
join public.event_team_members as member
  on member.event_id = event_match.event_id
 and (member.event_team_id = event_match.team_a_id or member.event_team_id = event_match.team_b_id);

create or replace function public.validate_event_match_scorer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.event_match_players as player
    where player.event_id = new.event_id
      and player.match_id = new.match_id
      and player.team_id = new.team_id
      and (
        (new.profile_id is not null and player.profile_id = new.profile_id)
        or (new.guest_player_id is not null and player.guest_player_id = new.guest_player_id)
      )
  ) then
    raise exception 'Scorer is not in the selected match lineup';
  end if;

  return new;
end;
$$;

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
  lineup_data jsonb;
  scorer_data jsonb;
  saved_match_id uuid;
  match_number integer;
  team_a_id uuid;
  team_b_id uuid;
  team_a_score integer;
  team_b_score integer;
  lineup_team_id uuid;
  profile_id uuid;
  guest_player_id uuid;
  player_name text;
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

    if match_data ? 'lineups' then
      if jsonb_typeof(match_data -> 'lineups') <> 'array' then
        raise exception 'Invalid match lineup request';
      end if;

      for lineup_data in select value from jsonb_array_elements(match_data -> 'lineups')
      loop
        lineup_team_id := nullif(btrim(lineup_data ->> 'team_id'), '')::uuid;
        profile_id := nullif(btrim(lineup_data ->> 'profile_id'), '')::uuid;
        guest_player_id := nullif(btrim(lineup_data ->> 'guest_player_id'), '')::uuid;
        player_name := btrim(lineup_data ->> 'player_name');

        if (profile_id is not null)::integer + (guest_player_id is not null)::integer <> 1 then
          raise exception 'Each match player must reference one member or guest';
        end if;
        if player_name is null or char_length(player_name) = 0 then
          raise exception 'Match player name is required';
        end if;

        insert into public.event_match_players (
          event_id, match_id, team_id, profile_id, guest_player_id, player_name
        ) values (
          target_event_id, saved_match_id, lineup_team_id,
          profile_id, guest_player_id, player_name
        );
      end loop;
    else
      insert into public.event_match_players (
        event_id, match_id, team_id, profile_id, guest_player_id, player_name
      )
      select
        target_event_id, saved_match_id, member.event_team_id,
        member.profile_id, member.guest_player_id, member.participant_name
      from public.event_team_members as member
      where member.event_id = target_event_id
        and (member.event_team_id = team_a_id or member.event_team_id = team_b_id);
    end if;

    if not exists (select 1 from public.event_match_players where match_id = saved_match_id and team_id = team_a_id)
      or not exists (select 1 from public.event_match_players where match_id = saved_match_id and team_id = team_b_id) then
      raise exception 'Each match team needs at least one player';
    end if;

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

commit;
