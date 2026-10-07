-- Only the new service receives a default grant. Preserve earlier exclusions.
alter table public.officer_permissions drop constraint officer_permissions_permission_check;
alter table public.officer_permissions add constraint officer_permissions_permission_check
check (permission in (
  'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
  'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage',
  'welcome.manage', 'ratings.manage'
));

insert into public.officer_permissions (officer_title, permission)
values ('president', 'ratings.manage'), ('vice_president', 'ratings.manage'),
  ('treasurer', 'ratings.manage')
on conflict (officer_title, permission) do nothing;

-- Overall scores never enter the public match-rating or directory tables.
create table private.member_overalls (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  pace smallint not null check (pace between 1 and 100),
  shooting smallint not null check (shooting between 1 and 100),
  passing smallint not null check (passing between 1 and 100),
  dribbling smallint not null check (dribbling between 1 and 100),
  defending smallint not null check (defending between 1 and 100),
  physical smallint not null check (physical between 1 and 100),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null,
  updated_by uuid references public.profiles(id) on delete set null
);
alter table private.member_overalls enable row level security;
revoke all on table private.member_overalls from public, anon, authenticated, service_role;

create function private.get_member_overalls(p_member_ids uuid[])
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles as actor
    where actor.auth_user_id = (select auth.uid())
      and actor.status = 'active'::public.member_status
      and not actor.must_change_password
      and (
        actor.is_system_admin
        or (actor.role = 'manager'::public.account_role and exists (
          select 1 from public.officer_permissions as permission
          where permission.officer_title = actor.officer_title
            and permission.permission = 'ratings.manage'
        ))
      )
  ) then
    raise exception 'Member overall management access is required' using errcode = '42501';
  end if;
  if p_member_ids is null or pg_catalog.cardinality(p_member_ids) > 300
    or exists (select 1 from pg_catalog.unnest(p_member_ids) as requested(id) where requested.id is null) then
    raise exception 'Request at most 300 non-null member ids' using errcode = '22023';
  end if;

  return query
  select overall.member_id, overall.pace, overall.shooting, overall.passing,
    overall.dribbling, overall.defending, overall.physical, overall.revision, overall.updated_at
  from private.member_overalls as overall
  join public.profiles as target on target.id = overall.member_id
  where overall.member_id = any(p_member_ids)
    and target.status = 'active'::public.member_status and not target.is_test_account
  order by overall.member_id;
end;
$$;

create function private.set_member_overall(
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
      raise exception 'Overall scores must be integers between 1 and 100' using errcode = '22023';
    end if;
    if score.value::numeric < 1 or score.value::numeric > 100
      or pg_catalog.trunc(score.value::numeric) <> score.value::numeric then
      raise exception 'Overall scores must be integers between 1 and 100' using errcode = '22023';
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

create function public.get_member_overalls(p_member_ids uuid[])
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_member_overalls(p_member_ids); $$;

create function public.set_member_overall(
  p_member_id uuid, p_scores jsonb, p_expected_revision bigint
)
returns table (
  member_id uuid, pace smallint, shooting smallint, passing smallint,
  dribbling smallint, defending smallint, physical smallint,
  revision bigint, updated_at timestamptz
)
language sql volatile security invoker set search_path = ''
as $$ select * from private.set_member_overall(p_member_id, p_scores, p_expected_revision); $$;

revoke all on function private.get_member_overalls(uuid[]),
  private.set_member_overall(uuid, jsonb, bigint), public.get_member_overalls(uuid[]),
  public.set_member_overall(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
grant execute on function private.get_member_overalls(uuid[]),
  private.set_member_overall(uuid, jsonb, bigint), public.get_member_overalls(uuid[]),
  public.set_member_overall(uuid, jsonb, bigint) to authenticated;

-- Extend only the existing batch validation whitelist. Keep its atomic CAS contract.
create or replace function public.apply_officer_permission_batch(permission_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  change_count integer;
  change_record record;
  actual_enabled boolean;
  affected_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to change officer permissions';
  end if;

  if pg_catalog.jsonb_typeof(permission_changes) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'Permission changes must be a JSON array';
  end if;

  change_count := pg_catalog.jsonb_array_length(permission_changes);
  if change_count < 1 or change_count > 100 then
    raise exception using
      errcode = '22023',
      message = 'Permission batches must contain between 1 and 100 changes';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    where pg_catalog.jsonb_typeof(requested.change) is distinct from 'object'
      or requested.change ->> 'officer_title' is null
      or requested.change ->> 'officer_title' not in ('president', 'vice_president', 'treasurer')
      or requested.change ->> 'permission' is null
      or requested.change ->> 'permission' not in (
        'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
        'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage', 'ratings.manage'
      )
      or pg_catalog.jsonb_typeof(requested.change -> 'enabled') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(requested.change -> 'expected_enabled') is distinct from 'boolean'
      or (
        pg_catalog.jsonb_typeof(requested.change -> 'enabled') = 'boolean'
        and pg_catalog.jsonb_typeof(requested.change -> 'expected_enabled') = 'boolean'
        and (requested.change ->> 'enabled')::boolean
          is not distinct from (requested.change ->> 'expected_enabled')::boolean
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Permission batch contains an invalid change';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    group by requested.change ->> 'officer_title', requested.change ->> 'permission'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'Permission batch contains duplicate changes';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    where not private.can_manage_officer_permission(
      (requested.change ->> 'officer_title')::public.officer_title
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Officer permission management access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('gyungchung_officer_permission_batch')
  );

  for change_record in
    select
      (requested.change ->> 'officer_title')::public.officer_title as officer_title,
      requested.change ->> 'permission' as permission,
      (requested.change ->> 'enabled')::boolean as enabled,
      (requested.change ->> 'expected_enabled')::boolean as expected_enabled
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    order by requested.change ->> 'officer_title', requested.change ->> 'permission'
  loop
    select exists (
      select 1
      from public.officer_permissions as officer_permission
      where officer_permission.officer_title = change_record.officer_title
        and officer_permission.permission = change_record.permission
    )
    into actual_enabled;

    if actual_enabled is distinct from change_record.expected_enabled then
      raise exception using
        errcode = '40001',
        message = 'Officer permissions changed while this batch was pending';
    end if;

    if change_record.enabled then
      insert into public.officer_permissions (officer_title, permission)
      values (change_record.officer_title, change_record.permission);
    else
      delete from public.officer_permissions as officer_permission
      where officer_permission.officer_title = change_record.officer_title
        and officer_permission.permission = change_record.permission;
    end if;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = '40001',
        message = 'Officer permissions changed while this batch was being applied';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'applied_count', change_count
  );
end;
$$;

revoke all on function public.apply_officer_permission_batch(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.apply_officer_permission_batch(jsonb)
to authenticated;

notify pgrst, 'reload schema';
