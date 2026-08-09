drop trigger if exists protect_last_role_manager_before_delete on public.role_permissions;
drop function if exists public.protect_last_role_manager();

-- Vice-president and treasurer permissions both become manager permissions.
-- Remove only rows that would become duplicate primary keys during the type change.
delete from public.role_permissions as treasurer_permission
where treasurer_permission.role = 'treasurer'::public.officer_role
  and exists (
    select 1
    from public.role_permissions as vice_president_permission
    where vice_president_permission.role = 'vice_president'::public.officer_role
      and vice_president_permission.permission = treasurer_permission.permission
  );

create type public.account_role as enum ('member', 'manager', 'admin');

alter table public.profiles alter column role drop default;
alter table public.profiles
  alter column role type public.account_role
  using (
    case role::text
      when 'president' then 'admin'
      when 'vice_president' then 'manager'
      when 'treasurer' then 'manager'
      else 'member'
    end
  )::public.account_role;
alter table public.profiles alter column role set default 'member'::public.account_role;

alter table public.role_permissions
  alter column role type public.account_role
  using (
    case role::text
      when 'president' then 'admin'
      when 'vice_president' then 'manager'
      when 'treasurer' then 'manager'
      else 'member'
    end
  )::public.account_role;

drop type public.officer_role;

insert into public.role_permissions (role, permission) values
  ('admin', 'roles.manage'),
  ('admin', 'members.manage'),
  ('admin', 'fees.manage'),
  ('admin', 'notices.manage'),
  ('admin', 'events.manage'),
  ('admin', 'feedback.manage'),
  ('admin', 'elections.manage'),
  ('admin', 'polls.manage'),
  ('admin', 'surveys.manage'),
  ('manager', 'members.manage'),
  ('manager', 'fees.manage'),
  ('manager', 'notices.manage'),
  ('manager', 'events.manage'),
  ('manager', 'feedback.manage'),
  ('manager', 'elections.manage'),
  ('manager', 'polls.manage'),
  ('manager', 'surveys.manage')
on conflict (role, permission) do nothing;

create unique index profiles_single_admin_idx
on public.profiles (role)
where role = 'admin'::public.account_role;

create or replace function public.protect_account_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin'::public.account_role then
      raise exception 'The admin account cannot be deleted';
    end if;
    return old;
  end if;

  if new.role is distinct from old.role
    and not (select private.has_permission('roles.manage'))
  then
    raise exception 'Only the admin can change account roles';
  end if;

  if old.role = 'admin'::public.account_role
    and not (select private.has_permission('roles.manage'))
  then
    raise exception 'Only the admin can update the admin profile';
  end if;

  if old.role = 'admin'::public.account_role
    and (
      new.role is distinct from 'admin'::public.account_role
      or new.status is distinct from 'active'::public.member_status
    )
  then
    raise exception 'The admin account must remain active';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_account_roles()
from public, anon, authenticated;

create trigger protect_account_roles_before_write
before update or delete on public.profiles
for each row execute function public.protect_account_roles();

create or replace function public.protect_account_role_permissions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'admin'::public.account_role then
    raise exception 'Admin permissions are fixed';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (
    new.role <> 'manager'::public.account_role
    or new.permission = 'roles.manage'
  )
  then
    raise exception 'Only manager operational permissions can be changed';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.protect_account_role_permissions()
from public, anon, authenticated;

create trigger protect_account_role_permissions_before_write
before insert or update or delete on public.role_permissions
for each row execute function public.protect_account_role_permissions();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role, status)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, '가입 신청자'), '@', 1)
    ),
    new.email,
    'member'::public.account_role,
    'pending'::public.member_status
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
