-- Store only a voluntarily shared solar month/day; never copy application DOBs.
create table private.member_birthdays (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  birthday_month smallint,
  birthday_day smallint,
  revision bigint not null check (revision > 0),
  constraint member_birthdays_valid_date check (
    (birthday_month is null and birthday_day is null)
    or (
      birthday_month is not null and birthday_day is not null
      and birthday_month between 1 and 12
      and birthday_day between 1 and case
        when birthday_month = 2 then 29
        when birthday_month in (4, 6, 9, 11) then 30
        else 31 end
    )
  )
);
alter table private.member_birthdays enable row level security;
revoke all on table private.member_birthdays from public, anon, authenticated, service_role;

create function private.set_my_birthday(p_month integer, p_day integer, p_expected_revision bigint)
returns table (birthday_month smallint, birthday_day smallint, birthday_revision bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  owner_auth_id uuid := (select auth.uid());
  member_profile public.profiles%rowtype;
  current_revision bigint;
begin
  if owner_auth_id is null then
    raise exception 'Birthday access is not available' using errcode = '42501';
  end if;

  -- Serialize first registration, edits, and clears with profile eligibility
  -- and authentication-link changes. A birthday row may not exist yet.
  select profile.* into member_profile
  from public.profiles as profile
  where profile.auth_user_id = owner_auth_id
  for update;

  if not found or member_profile.status <> 'active'::public.member_status
    or member_profile.must_change_password or member_profile.is_test_account then
    raise exception 'Birthday access is not available' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid birthday revision' using errcode = '22023';
  end if;
  if (p_month is null) <> (p_day is null)
    or (p_month is not null and (
      p_month not between 1 and 12
      or p_day not between 1 and case
        when p_month = 2 then 29
        when p_month in (4, 6, 9, 11) then 30
        else 31 end
    )) then
    raise exception 'Invalid birthday month and day' using errcode = '22023';
  end if;

  select coalesce((
    select birthday.revision from private.member_birthdays as birthday
    where birthday.profile_id = member_profile.id
  ), 0) into current_revision;

  if current_revision <> p_expected_revision then
    raise exception 'The birthday changed. Refresh and try again' using errcode = '40001';
  end if;

  -- Keep a revision-only tombstone after clearing so old tabs cannot recreate
  -- deleted data with an obsolete unregistered revision (the ABA case).
  return query
  insert into private.member_birthdays as birthday (
    profile_id, birthday_month, birthday_day, revision
  ) values (member_profile.id, p_month::smallint, p_day::smallint, current_revision + 1)
  on conflict (profile_id) do update
  set birthday_month = excluded.birthday_month,
      birthday_day = excluded.birthday_day,
      revision = excluded.revision
  returning birthday.birthday_month, birthday.birthday_day, birthday.revision;
end;
$$;
revoke all on function private.set_my_birthday(integer, integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function private.set_my_birthday(integer, integer, bigint) to authenticated;

create function public.set_my_birthday(p_month integer, p_day integer, p_expected_revision bigint)
returns table (birthday_month smallint, birthday_day smallint, birthday_revision bigint)
language sql security invoker set search_path = ''
as $$
  select * from private.set_my_birthday(p_month, p_day, p_expected_revision);
$$;
revoke all on function public.set_my_birthday(integer, integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.set_my_birthday(integer, integer, bigint) to authenticated;

-- Preserve the established roster contract; only the new birthday projection
-- requires stricter actor/target eligibility. Return-type changes need recreation.
drop function public.get_member_directory();
create function public.get_member_directory()
returns table (
  id uuid, name text, role public.account_role, officer_title public.officer_title,
  is_system_admin boolean, "position" text, jersey_number integer, joined_at date,
  status public.member_status, fee_plan public.member_fee_plan, avatar_path text,
  birthday_month smallint, birthday_day smallint, birthday_revision bigint
)
language sql stable security definer set search_path = ''
as $$
  with birthday_viewer as (
    select viewer.id from public.profiles as viewer
    where viewer.auth_user_id = (select auth.uid())
      and viewer.status = 'active'::public.member_status
      and not viewer.must_change_password
      and not viewer.is_test_account
  )
  select profile.id, profile.name, profile.role, profile.officer_title,
    profile.is_system_admin, profile.position, profile.jersey_number, profile.joined_at,
    profile.status,
    case when (select private.has_permission('fees.manage'))
        or profile.id = (select private.current_profile_id())
      then profile.fee_plan else null end,
    profile.avatar_path,
    birthday.birthday_month, birthday.birthday_day,
    case when profile.id = (select viewer.id from birthday_viewer as viewer)
      then coalesce(birthday.revision, 0) else null end
  from public.profiles as profile
  left join private.member_birthdays as birthday
    on birthday.profile_id = profile.id
    and profile.auth_user_id is not null
    and not profile.must_change_password
    and exists (select 1 from birthday_viewer)
  where (select auth.uid()) is not null
    and (select private.current_profile_id()) is not null
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
  order by profile.name;
$$;
revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated, service_role;

notify pgrst, 'reload schema';
