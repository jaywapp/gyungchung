alter table public.profiles
add column is_system_admin boolean not null default false;

drop trigger protect_account_roles_before_write on public.profiles;

update public.profiles
set
  role = 'member'::public.account_role,
  officer_title = null,
  fee_plan = 'monthly'::public.member_fee_plan,
  is_system_admin = true
where role = 'admin'::public.account_role;

drop index if exists public.profiles_single_admin_idx;

alter table public.profiles
add constraint profiles_base_role_check
check (role in ('member'::public.account_role, 'manager'::public.account_role));

create or replace function private.has_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'::public.member_status
      and (
        profile.is_system_admin
        or (
          profile.role = 'manager'::public.account_role
          and exists (
            select 1
            from public.officer_permissions as officer_permission
            where officer_permission.officer_title = profile.officer_title
              and officer_permission.permission = requested_permission
          )
        )
      )
  );
$$;

revoke all on function private.has_permission(text)
from public, anon, authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated;

create or replace function public.protect_account_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system_admin and not exists (
      select 1
      from public.profiles as profile
      where profile.id <> old.id
        and profile.is_system_admin
        and profile.status = 'active'::public.member_status
    ) then
      raise exception 'At least one active system administrator is required';
    end if;
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

  if old.is_system_admin
    and not new.is_system_admin
    and not exists (
      select 1
      from public.profiles as profile
      where profile.id <> old.id
        and profile.is_system_admin
        and profile.status = 'active'::public.member_status
    )
  then
    raise exception 'At least one active system administrator is required';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_account_roles()
from public, anon, authenticated;

create trigger protect_account_roles_before_write
before update or delete on public.profiles
for each row execute function public.protect_account_roles();

drop function public.get_member_directory();

create function public.get_member_directory()
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
  order by profile.name;
$$;

revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated;

create or replace function public.apply_standard_fee_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member_role public.account_role;
  member_plan public.member_fee_plan;
begin
  select profile.role, profile.fee_plan
  into member_role, member_plan
  from public.profiles as profile
  where profile.id = new.member_id;

  if member_role = 'manager'::public.account_role then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Officers use the monthly officer fee';
    end if;
    new.amount := 15000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'monthly'::public.member_fee_plan
  then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Monthly members use the monthly fee';
    end if;
    new.amount := 30000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'per_event'::public.member_fee_plan
  then
    if new.fee_type <> 'participation'::public.fee_type then
      raise exception 'Per-event members use participation fees';
    end if;
    new.amount := 10000;
  else
    raise exception 'The member fee policy is not configured';
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_standard_fee_amount()
from public, anon, authenticated;
