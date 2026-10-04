create or replace function public.protect_account_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  trusted_executor boolean := current_user in ('postgres', 'service_role');
  active_system_admin boolean;
  leaves_linked_admin boolean := false;
begin
  -- Nested Auth provisioning/email sync runs as its trusted definer owner.
  -- A missing JWT alone never makes a client write trusted.
  active_system_admin := trusted_executor or exists (
    select 1 from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'active'::public.member_status
      and profile.is_system_admin
  );

  if tg_op = 'INSERT' then
    if (
      new.role is distinct from 'member'::public.account_role
      or new.officer_title is not null
      or new.is_system_admin
      or new.is_test_account
      or new.auth_user_id is not null
    ) and not active_system_admin then
      raise exception 'Only a system administrator can create privileged or linked profiles'
        using errcode = '42501';
    end if;
  else
    if old.is_system_admin and not active_system_admin then
      raise exception 'Only a system administrator can modify or delete system administrator profiles'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and (
      new.role is distinct from old.role
      or new.officer_title is distinct from old.officer_title
      or new.fee_plan is distinct from old.fee_plan
      or new.is_system_admin is distinct from old.is_system_admin
      or new.is_test_account is distinct from old.is_test_account
      or new.auth_user_id is distinct from old.auth_user_id
    ) and not active_system_admin then
      raise exception 'Only a system administrator can change account roles or authentication links'
        using errcode = '42501';
    end if;

    if old.is_system_admin and old.auth_user_id = (select auth.uid()) then
      if tg_op = 'DELETE' then
        raise exception 'System administrators cannot remove their own access'
          using errcode = '42501';
      elsif not new.is_system_admin
        or new.status is distinct from 'active'::public.member_status
        or new.auth_user_id is distinct from old.auth_user_id then
        raise exception 'System administrators cannot remove their own access'
          using errcode = '42501';
      end if;
    end if;

    if old.is_system_admin
      and old.status = 'active'::public.member_status
      and old.auth_user_id is not null then
      if tg_op = 'DELETE' then
        leaves_linked_admin := true;
      else
        leaves_linked_admin := not new.is_system_admin
          or new.status is distinct from 'active'::public.member_status
          or new.auth_user_id is null;
      end if;
    end if;

    if leaves_linked_admin then
      -- Keep the existing ordered row locks for concurrent admin removals.
      perform profile.id
      from public.profiles as profile
      where profile.is_system_admin
        and profile.status = 'active'::public.member_status
        and profile.auth_user_id is not null
      order by profile.id
      for update;

      if not exists (
        select 1 from public.profiles as profile
        where profile.id <> old.id
          and profile.is_system_admin
          and profile.status = 'active'::public.member_status
          and profile.auth_user_id is not null
      ) then
        raise exception 'At least one linked active system administrator is required'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.is_system_admin
    and new.status is distinct from 'active'::public.member_status then
    raise exception 'System administrators must remain active'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_account_roles()
from public, anon, authenticated;

drop trigger protect_account_roles_before_write on public.profiles;
create trigger protect_account_roles_before_write
before insert or update or delete on public.profiles
for each row execute function public.protect_account_roles();

-- Auth Admin creates the user before applying app_metadata. Public signups may
-- create an unlinked Auth identity, but user_metadata never authorizes a link.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioning_marker jsonb := new.raw_app_meta_data -> 'member_provisioning_id';
  provisioning_id text;
  target_member_id uuid;
  normalized_phone text;
begin
  if tg_op = 'UPDATE' then
    -- Metadata maintenance and user-supplied target changes cannot relink an
    -- already provisioned identity using its unchanged server marker.
    if provisioning_marker is not distinct from
      (old.raw_app_meta_data -> 'member_provisioning_id') then
      return new;
    end if;
  end if;

  if provisioning_marker is null then
    return new;
  end if;

  if pg_catalog.jsonb_typeof(provisioning_marker) is distinct from 'string'
    or pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'member_id') is distinct from 'string'
  then
    raise exception 'Invalid member provisioning request' using errcode = '42501';
  end if;

  provisioning_id := new.raw_app_meta_data ->> 'member_provisioning_id';
  if provisioning_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or provisioning_id is distinct from (new.raw_user_meta_data ->> 'member_id')
  then
    raise exception 'Invalid member provisioning request' using errcode = '42501';
  end if;

  target_member_id := provisioning_id::uuid;
  normalized_phone := private.normalize_member_phone(new.phone);
  if normalized_phone is null or exists (
    select 1 from public.profiles where auth_user_id = new.id
  ) then
    raise exception 'Invalid member provisioning request' using errcode = '42501';
  end if;

  begin
    update public.profiles
    set auth_user_id = new.id,
        phone = normalized_phone,
        email = pg_catalog.lower(new.email),
        updated_at = now()
    where id = target_member_id
      and auth_user_id is null
      and phone = normalized_phone;

    if not found then
      raise exception 'Invalid member provisioning request' using errcode = '42501';
    end if;
  exception when unique_violation then
    raise exception 'Invalid member provisioning request' using errcode = '42501';
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- The existing INSERT trigger also supports runtimes that supply app_metadata
-- immediately. This UPDATE trigger handles the current Admin API ordering.
drop trigger if exists link_provisioned_member_after_auth_metadata_update on auth.users;
create trigger link_provisioned_member_after_auth_metadata_update
after update of raw_app_meta_data on auth.users
for each row
when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
execute function public.handle_new_user();
