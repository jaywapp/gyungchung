insert into public.role_permissions (role, permission)
values ('manager', 'members.manage')
on conflict (role, permission) do nothing;

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

  if tg_op in ('UPDATE', 'DELETE')
    and old.role = 'manager'::public.account_role
    and old.permission = 'members.manage'
  then
    raise exception 'Managers must retain membership approval access';
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
