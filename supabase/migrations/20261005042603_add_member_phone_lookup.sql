-- Resolve only the selected member's phone after checking the current actor.
-- Contact availability does not depend on the target's Auth provisioning state.
create function private.get_member_phone(p_member_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  owner_auth_id uuid := (select auth.uid());
  member_phone text;
begin
  if owner_auth_id is null or not exists (
    select 1 from public.profiles as actor
    where actor.auth_user_id = owner_auth_id
      and actor.status = 'active'::public.member_status
      and not actor.must_change_password
      and not actor.is_test_account
  ) then
    raise exception 'Member contact access is not available' using errcode = '42501';
  end if;

  select target.phone into member_phone
  from public.profiles as target
  where target.id = p_member_id
    and target.status = 'active'::public.member_status
    and not target.is_test_account
    and nullif(pg_catalog.btrim(target.phone), '') is not null;

  return member_phone;
end;
$$;
revoke all on function private.get_member_phone(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.get_member_phone(uuid) to authenticated;

create function public.get_member_phone(p_member_id uuid)
returns text
language sql stable security invoker set search_path = ''
as $$
  select private.get_member_phone(p_member_id);
$$;
revoke all on function public.get_member_phone(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_member_phone(uuid) to authenticated;

notify pgrst, 'reload schema';
