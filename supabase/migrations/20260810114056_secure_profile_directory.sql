drop policy if exists "Active and own profiles are visible" on public.profiles;
drop policy if exists "Member managers read all profiles" on public.profiles;

create policy "Members read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Member managers read all profiles"
on public.profiles for select to authenticated
using ((select private.has_permission('members.manage')));

revoke select on public.profiles from anon;

create or replace function public.get_member_directory()
returns table (
  id uuid,
  name text,
  role public.account_role,
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
    profile.position,
    profile.jersey_number,
    profile.joined_at,
    profile.status
  from public.profiles as profile
  where profile.status = 'active'
  order by profile.name;
$$;

revoke all on function public.get_member_directory() from public;
grant execute on function public.get_member_directory() to anon, authenticated;
