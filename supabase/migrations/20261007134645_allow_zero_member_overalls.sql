-- Expand only the score lower bound. Preserve saved data and all authority boundaries.
alter table private.member_overalls
  drop constraint member_overalls_pace_check,
  add constraint member_overalls_pace_check check (pace between 0 and 100),
  drop constraint member_overalls_shooting_check,
  add constraint member_overalls_shooting_check check (shooting between 0 and 100),
  drop constraint member_overalls_passing_check,
  add constraint member_overalls_passing_check check (passing between 0 and 100),
  drop constraint member_overalls_dribbling_check,
  add constraint member_overalls_dribbling_check check (dribbling between 0 and 100),
  drop constraint member_overalls_defending_check,
  add constraint member_overalls_defending_check check (defending between 0 and 100),
  drop constraint member_overalls_physical_check,
  add constraint member_overalls_physical_check check (physical between 0 and 100);

-- CREATE OR REPLACE preserves the existing function identity and execution ACL.
create or replace function private.set_member_overall(
  p_member_id uuid, p_scores jsonb, p_expected_revision bigint
)
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  score record;
  saved private.member_overalls%rowtype;
  saved_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Member overall management access is required' using errcode = '42501';
  end if;

  -- SHARE also conflicts with non-key updates, unlike KEY SHARE. NOWAIT avoids
  -- reverse-order profile deletion/cascade deadlocks and forces a fresh retry.
  begin
    perform profile.id from public.profiles as profile
    where profile.auth_user_id = (select auth.uid()) or profile.id = p_member_id
    order by profile.id for share nowait;
    select * into actor_profile from public.profiles as profile
    where profile.auth_user_id = (select auth.uid());
    if actor_profile.id is null or actor_profile.status <> 'active'::public.member_status
      or actor_profile.must_change_password then
      raise exception 'Member overall management access is required' using errcode = '42501';
    end if;
    if not actor_profile.is_system_admin then
      if actor_profile.role <> 'manager'::public.account_role or actor_profile.officer_title is null then
        raise exception 'Member overall management access is required' using errcode = '42501';
      end if;
      perform permission.officer_title from public.officer_permissions as permission
      where permission.officer_title = actor_profile.officer_title
        and permission.permission = 'ratings.manage' for share nowait;
      if not found then
        raise exception 'Member overall management access is required' using errcode = '42501';
      end if;
    end if;
  exception when lock_not_available then
    raise exception 'Member or management access changed; reload before saving' using errcode = '40001';
  end;

  if p_member_id is null or p_expected_revision is null or p_expected_revision < 0
    or pg_catalog.jsonb_typeof(p_scores) is distinct from 'object' then
    raise exception 'Member, six scores and a nonnegative revision are required' using errcode = '22023';
  end if;
  if not (p_scores ?& array['pace','shooting','passing','dribbling','defending','physical'])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_scores)) <> 6 then
    raise exception 'Provide exactly the six overall scores' using errcode = '22023';
  end if;
  for score in select * from pg_catalog.jsonb_each(p_scores) loop
    if pg_catalog.jsonb_typeof(score.value) is distinct from 'number' then
      raise exception 'Overall scores must be integers between 0 and 100' using errcode = '22023';
    end if;
    if score.value::numeric < 0 or score.value::numeric > 100
      or pg_catalog.trunc(score.value::numeric) <> score.value::numeric then
      raise exception 'Overall scores must be integers between 0 and 100' using errcode = '22023';
    end if;
  end loop;

  select * into target_profile from public.profiles as profile where profile.id = p_member_id;
  if target_profile.id is null or target_profile.status <> 'active'::public.member_status
    or target_profile.is_test_account then
    raise exception 'Active visible member is required' using errcode = '22023';
  end if;
  saved_at := pg_catalog.clock_timestamp();
  if p_expected_revision = 0 then
    insert into private.member_overalls as overall (
      member_id, pace, shooting, passing, dribbling, defending, physical,
      revision, created_at, created_by, updated_at, updated_by
    ) values (
      p_member_id, (p_scores ->> 'pace')::numeric::smallint,
      (p_scores ->> 'shooting')::numeric::smallint, (p_scores ->> 'passing')::numeric::smallint,
      (p_scores ->> 'dribbling')::numeric::smallint, (p_scores ->> 'defending')::numeric::smallint,
      (p_scores ->> 'physical')::numeric::smallint,
      1, saved_at, actor_profile.id, saved_at, actor_profile.id
    ) on conflict on constraint member_overalls_pkey do nothing
    returning overall.* into saved;
  else
    update private.member_overalls as overall
    set pace = (p_scores ->> 'pace')::numeric::smallint,
      shooting = (p_scores ->> 'shooting')::numeric::smallint,
      passing = (p_scores ->> 'passing')::numeric::smallint,
      dribbling = (p_scores ->> 'dribbling')::numeric::smallint,
      defending = (p_scores ->> 'defending')::numeric::smallint,
      physical = (p_scores ->> 'physical')::numeric::smallint,
      revision = overall.revision + 1, updated_at = saved_at, updated_by = actor_profile.id
    where overall.member_id = p_member_id and overall.revision = p_expected_revision
    returning overall.* into saved;
  end if;
  if saved.member_id is null then
    raise exception 'Member overall changed; reload before saving' using errcode = '40001';
  end if;
  return query select saved.member_id, saved.pace, saved.shooting, saved.passing,
    saved.dribbling, saved.defending, saved.physical, saved.revision, saved.updated_at;
end;
$$;

notify pgrst, 'reload schema';
