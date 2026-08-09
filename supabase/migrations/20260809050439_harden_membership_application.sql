drop policy if exists "Applicants read own application" on public.membership_applications;
drop policy if exists "Member managers read applications" on public.membership_applications;

create policy "Applicants and managers read applications"
on public.membership_applications
for select
to authenticated
using (
  member_id = (select auth.uid())
  or (select private.has_permission('members.manage'))
);

create policy "Pending members create own application"
on public.membership_applications
for insert
to authenticated
with check (
  member_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'pending'
  )
);

create policy "Pending members update own application"
on public.membership_applications
for update
to authenticated
using (
  member_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'pending'
  )
)
with check (
  member_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'pending'
  )
);

grant insert, update on public.membership_applications to authenticated;

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
