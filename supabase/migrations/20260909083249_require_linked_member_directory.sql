create or replace function public.get_member_directory()
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
    and (select private.current_profile_id()) is not null
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
  order by profile.name;
$$;

revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated;
