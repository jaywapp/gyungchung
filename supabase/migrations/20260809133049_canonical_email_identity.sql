create unique index if not exists profiles_email_unique_idx
on public.profiles (lower(email))
where email is not null;

create or replace function public.sync_profile_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(new.email), updated_at = now()
  where id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_profile_email_from_auth()
from public, anon, authenticated;

drop trigger if exists sync_profile_email_after_auth_update on auth.users;
create trigger sync_profile_email_after_auth_update
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_email_from_auth();

update public.profiles as profile
set email = lower(auth_user.email), updated_at = now()
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.email is distinct from lower(auth_user.email);

create or replace function public.submit_membership_application(
  applicant_name text,
  applicant_phone text,
  applicant_birth_date date,
  applicant_residence text,
  applicant_preferred_position text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_phone text := pg_catalog.regexp_replace(applicant_phone, '[^0-9]', '', 'g');
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = current_user_id
      and status = 'pending'::public.member_status
      and email is not null
  ) then
    raise exception 'A verified email is required before applying';
  end if;
  if char_length(pg_catalog.btrim(applicant_name)) not between 2 and 50 then
    raise exception 'Name must be between 2 and 50 characters';
  end if;
  if normalized_phone !~ '^01[016789][0-9]{7,8}$' then
    raise exception 'Phone number is invalid';
  end if;
  if applicant_birth_date < date '1900-01-01' or applicant_birth_date >= current_date then
    raise exception 'Birth date is invalid';
  end if;
  if char_length(pg_catalog.btrim(applicant_residence)) not between 2 and 100 then
    raise exception 'Residence must be between 2 and 100 characters';
  end if;
  if applicant_preferred_position not in ('GK', 'DF', 'MF', 'FW', 'ANY') then
    raise exception 'Preferred position is invalid';
  end if;

  insert into public.membership_applications (
    member_id, name, phone, birth_date, residence, preferred_position
  ) values (
    current_user_id,
    pg_catalog.btrim(applicant_name),
    normalized_phone,
    applicant_birth_date,
    pg_catalog.btrim(applicant_residence),
    applicant_preferred_position
  )
  on conflict (member_id) do update set
    name = excluded.name,
    phone = excluded.phone,
    birth_date = excluded.birth_date,
    residence = excluded.residence,
    preferred_position = excluded.preferred_position,
    updated_at = now();
end;
$$;

create or replace function public.require_membership_application_for_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending'::public.member_status
    and new.status = 'active'::public.member_status
    and (
      new.email is null
      or not exists (
        select 1
        from public.membership_applications
        where member_id = new.id
      )
    )
  then
    raise exception 'Verified email and membership application are required before approval';
  end if;
  return new;
end;
$$;
