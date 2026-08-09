create table public.membership_applications (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 50),
  phone text not null check (phone ~ '^01[016789][0-9]{7,8}$'),
  birth_date date not null check (birth_date >= date '1900-01-01'),
  residence text not null check (char_length(residence) between 2 and 100),
  preferred_position text not null check (preferred_position in ('GK', 'DF', 'MF', 'FW', 'ANY')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.membership_applications enable row level security;

create policy "Applicants read own application"
on public.membership_applications
for select
to authenticated
using (member_id = (select auth.uid()));

create policy "Member managers read applications"
on public.membership_applications
for select
to authenticated
using ((select private.has_permission('members.manage')));

grant select on public.membership_applications to authenticated;

create or replace function public.submit_membership_application(
  applicant_name text,
  applicant_phone text,
  applicant_birth_date date,
  applicant_residence text,
  applicant_preferred_position text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_phone text := pg_catalog.regexp_replace(applicant_phone, '[^0-9]', '', 'g');
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
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
  if not exists (
    select 1 from public.profiles
    where id = current_user_id and status = 'pending'
  ) then
    raise exception 'Only pending members can submit an application';
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

  update public.profiles
  set
    name = pg_catalog.btrim(applicant_name),
    position = applicant_preferred_position,
    updated_at = now()
  where id = current_user_id;
end;
$$;

revoke all on function public.submit_membership_application(text, text, date, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.submit_membership_application(text, text, date, text, text)
to authenticated;

create or replace function public.require_membership_application_for_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'pending'
    and new.status = 'active'
    and not exists (
      select 1 from public.membership_applications
      where member_id = new.id
    )
  then
    raise exception 'Membership application must be submitted before approval';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_membership_application_for_approval()
from public, anon, authenticated;

create trigger require_membership_application_before_approval
before update of status on public.profiles
for each row execute function public.require_membership_application_for_approval();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role, status)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, '가입 신청자'), '@', 1)
    ),
    new.email,
    'member'::public.officer_role,
    'pending'::public.member_status
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
