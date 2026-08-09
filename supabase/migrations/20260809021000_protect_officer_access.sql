create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first_member boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gyungchung_first_member'));
  select not exists (select 1 from public.profiles) into is_first_member;

  insert into public.profiles (id, name, email, role, status)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, '새 회원'), '@', 1)
    ),
    new.email,
    case when is_first_member then 'president'::public.officer_role else 'member'::public.officer_role end,
    case when is_first_member then 'active'::public.member_status else 'pending'::public.member_status end
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.protect_last_role_manager()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.permission = 'roles.manage'
    and (tg_op = 'DELETE' or new.permission <> 'roles.manage')
    and not exists (
      select 1 from public.role_permissions
      where permission = 'roles.manage' and role <> old.role
    )
  then
    raise exception 'At least one officer role must retain roles.manage';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.protect_last_role_manager() from public, anon, authenticated;
drop trigger if exists protect_last_role_manager_before_delete on public.role_permissions;
create trigger protect_last_role_manager_before_delete
before delete or update on public.role_permissions
for each row execute function public.protect_last_role_manager();
