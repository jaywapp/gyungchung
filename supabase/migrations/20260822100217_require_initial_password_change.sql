alter table public.profiles
add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Requires the linked member to replace an administrator-issued initial password before using the clubhouse.';

-- Existing linked accounts receive the one-time upgrade as well. The password
-- hash cannot be inspected through the application, so this favors a single
-- safe reset over leaving an unknown subset on the shared initial credential.
update public.profiles
set must_change_password = true,
    updated_at = now()
where auth_user_id is not null;

create or replace function private.protect_password_change_requirement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Password change requirements can only be updated by the authentication service'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_password_change_requirement() from public;

create trigger protect_password_change_requirement
before update of must_change_password on public.profiles
for each row execute function private.protect_password_change_requirement();
