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
        'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage'
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

-- Officer permission writes must use the transactional RPC above. Keeping
-- SELECT allows the matrix and its optimistic concurrency check to load.
revoke insert, update, delete on public.officer_permissions from authenticated;

create or replace function public.protect_account_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_member_id uuid := (select private.current_profile_id());
  leaves_active_admin boolean;
begin
  if tg_op = 'DELETE' then
    leaves_active_admin := old.is_system_admin
      and old.status = 'active'::public.member_status;
  else
    leaves_active_admin := old.is_system_admin
      and old.status = 'active'::public.member_status
      and (
        not new.is_system_admin
        or new.status is distinct from 'active'::public.member_status
      );
  end if;

  if leaves_active_admin then
    -- Lock every active administrator in a stable order. Concurrent attempts to
    -- remove different administrators will serialize or deadlock one writer,
    -- ensuring that both cannot observe the other as the remaining admin.
    perform profile.id
    from public.profiles as profile
    where profile.is_system_admin
      and profile.status = 'active'::public.member_status
    order by profile.id
    for update;

    if old.id = current_member_id then
      raise exception 'System administrators cannot remove their own access';
    end if;

    if not exists (
      select 1
      from public.profiles as profile
      where profile.id <> old.id
        and profile.is_system_admin
        and profile.status = 'active'::public.member_status
    ) then
      raise exception 'At least one active system administrator is required';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if (
    new.role is distinct from old.role
    or new.officer_title is distinct from old.officer_title
    or new.fee_plan is distinct from old.fee_plan
    or new.is_system_admin is distinct from old.is_system_admin
  ) and not (select private.has_permission('roles.manage'))
  then
    raise exception 'Only a system administrator can change account roles or system access';
  end if;

  if new.is_system_admin
    and new.status is distinct from 'active'::public.member_status
  then
    raise exception 'System administrators must remain active';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_account_roles()
from public, anon, authenticated;
