alter table public.profiles add column avatar_path text;
create index profiles_avatar_path_idx on public.profiles (avatar_path)
where avatar_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 1048576, array['image/jpeg']);

-- Check the linked profile rather than mutable or stale token claims.
create function private.can_use_profile_avatars()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.profiles as profile
    where profile.auth_user_id = (select auth.uid())
      and profile.status = 'active'::public.member_status
      and not profile.must_change_password
  );
$$;

create function private.owns_profile_avatar(object_name text, object_owner_id text)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select (select auth.uid()) is not null
    and object_owner_id = (select auth.uid())::text
    and object_name ~ ('^' || (select auth.uid())::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
$$;

create function private.can_read_profile_avatar(object_name text, object_owner_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (select private.can_use_profile_avatars())
    and (
      private.owns_profile_avatar(object_name, object_owner_id)
      or exists (
        select 1 from public.profiles as profile
        where profile.avatar_path = object_name
          and profile.auth_user_id::text = object_owner_id
          and profile.status = 'active'::public.member_status
          and not profile.is_test_account
      )
    );
$$;

revoke all on function private.can_use_profile_avatars(),
  private.owns_profile_avatar(text, text), private.can_read_profile_avatar(text, text)
from public, anon, authenticated, service_role;
grant execute on function private.can_use_profile_avatars(),
  private.owns_profile_avatar(text, text), private.can_read_profile_avatar(text, text)
to authenticated;

create function private.can_delete_profile_avatar(object_name text, object_owner_id text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  member_profile public.profiles%rowtype;
begin
  if (select auth.uid()) is null
    or private.owns_profile_avatar(object_name, object_owner_id) is not true then
    return false;
  end if;

  -- Serialize cleanup with the RPC, including a lost successful RPC response.
  -- A snapshot-only reference check can race a concurrent photo replacement.
  select profile.* into member_profile from public.profiles as profile
  where profile.auth_user_id = (select auth.uid()) for update;
  if not found or member_profile.status <> 'active'::public.member_status
    or member_profile.must_change_password then
    return false;
  end if;

  return member_profile.avatar_path is distinct from object_name and not exists (
    select 1 from public.profiles as profile where profile.avatar_path = object_name
  );
end;
$$;
revoke all on function private.can_delete_profile_avatar(text, text)
from public, anon, authenticated, service_role;
grant execute on function private.can_delete_profile_avatar(text, text) to authenticated;

-- Storage validates the bucket's MIME/size limits. Its upload permission probe
-- may not yet contain metadata; the RPC checks the completed object again.
create policy "Members upload their own profile avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (select private.can_use_profile_avatars())
  and private.owns_profile_avatar(name, owner_id)
);

create policy "Members read available profile avatars"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and private.can_read_profile_avatar(name, owner_id)
);

create policy "Members delete their own profile avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and private.can_delete_profile_avatar(name, owner_id)
);

-- An invoker trigger sees the guarded helper's trusted execution role. Clients,
-- including system administrators, cannot bypass the avatar RPC with REST.
create function public.protect_profile_avatar()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if (tg_op = 'INSERT' and new.avatar_path is not null)
      or (tg_op = 'UPDATE' and new.avatar_path is distinct from old.avatar_path)
    then
      raise exception 'Profile photos must be changed through the profile avatar operation'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_profile_avatar() from public, anon, authenticated;
create trigger protect_profile_avatar_before_write
before insert or update of avatar_path on public.profiles
for each row execute function public.protect_profile_avatar();

create function private.set_profile_avatar(next_avatar_path text, expected_avatar_path text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  owner_auth_id uuid := (select auth.uid());
  member_profile public.profiles%rowtype;
begin
  if owner_auth_id is null then
    raise exception 'Profile photo access is not available' using errcode = '42501';
  end if;

  select profile.* into member_profile
  from public.profiles as profile
  where profile.auth_user_id = owner_auth_id
  for update;

  if not found or member_profile.status <> 'active'::public.member_status
    or member_profile.must_change_password then
    raise exception 'Profile photo access is not available' using errcode = '42501';
  end if;

  if member_profile.avatar_path is distinct from expected_avatar_path then
    raise exception 'The profile photo changed. Refresh and try again' using errcode = '40001';
  end if;

  if next_avatar_path is not null then
    if not private.owns_profile_avatar(next_avatar_path, owner_auth_id::text) then
      raise exception 'Invalid profile photo' using errcode = '42501';
    end if;

    -- The profile lock serializes this check with the guarded DELETE policy.
    -- Avoid an object lock: Storage may already lock an object before its RLS
    -- check, and taking both locks in reverse order would create a deadlock.
    -- Object mutations always use the SDK, including underlying file removal.
    perform object.id from storage.objects as object
    where object.bucket_id = 'profile-avatars'
      and object.name = next_avatar_path
      and object.owner_id = owner_auth_id::text
      and object.metadata ->> 'mimetype' = 'image/jpeg'
      and case when pg_catalog.jsonb_typeof(object.metadata -> 'size') = 'number'
        then (object.metadata ->> 'size')::numeric between 1 and 1048576
          and (object.metadata ->> 'size')::numeric = pg_catalog.trunc((object.metadata ->> 'size')::numeric)
        else false end;
    if not found then
      raise exception 'Invalid profile photo' using errcode = '42501';
    end if;
  end if;

  update public.profiles set avatar_path = next_avatar_path, updated_at = now()
  where id = member_profile.id;
  return next_avatar_path;
end;
$$;
revoke all on function private.set_profile_avatar(text, text) from public, anon, authenticated, service_role;
grant execute on function private.set_profile_avatar(text, text) to authenticated;

create function public.set_profile_avatar(next_avatar_path text, expected_avatar_path text)
returns text
language sql security invoker set search_path = ''
as $$
  select private.set_profile_avatar(next_avatar_path, expected_avatar_path);
$$;
revoke all on function public.set_profile_avatar(text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_profile_avatar(text, text) to authenticated;

-- PostgreSQL requires recreation when a TABLE return type gains a column.
-- Preserve the roster projection, fee-plan visibility, and explicit ACL.
drop function public.get_member_directory();
create function public.get_member_directory()
returns table (
  id uuid, name text, role public.account_role, officer_title public.officer_title,
  is_system_admin boolean, "position" text, jersey_number integer, joined_at date,
  status public.member_status, fee_plan public.member_fee_plan, avatar_path text
)
language sql stable security definer set search_path = ''
as $$
  select profile.id, profile.name, profile.role, profile.officer_title,
    profile.is_system_admin, profile.position, profile.jersey_number, profile.joined_at,
    profile.status,
    case when (select private.has_permission('fees.manage'))
        or profile.id = (select private.current_profile_id())
      then profile.fee_plan else null end,
    profile.avatar_path
  from public.profiles as profile
  where (select auth.uid()) is not null
    and (select private.current_profile_id()) is not null
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
  order by profile.name;
$$;
revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated, service_role;

notify pgrst, 'reload schema';
