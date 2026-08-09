create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and status = 'active'
  );
$$;
revoke execute on function private.is_active_member() from public, anon, authenticated;
grant execute on function private.is_active_member() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first_member boolean;
begin
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

drop policy if exists "Members insert own attendance" on public.attendance;
create policy "Active members insert own attendance"
on public.attendance
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and (select private.is_active_member())
);

drop policy if exists "Members create feedback" on public.feedback;
create policy "Active members create feedback"
on public.feedback
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.is_active_member())
);
