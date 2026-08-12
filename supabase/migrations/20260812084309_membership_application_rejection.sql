alter table public.membership_applications
add column review_status text not null default 'pending'
  check (review_status in ('pending', 'rejected')),
add column rejection_reason text,
add column reviewed_at timestamptz,
add constraint membership_application_rejection_state_check check (
  (review_status = 'pending' and rejection_reason is null and reviewed_at is null)
  or (
    review_status = 'rejected'
    and char_length(pg_catalog.btrim(rejection_reason)) between 2 and 500
    and reviewed_at is not null
  )
);

drop policy if exists "Pending members create own application" on public.membership_applications;
drop policy if exists "Pending members update own application" on public.membership_applications;

create policy "Member managers update applications"
on public.membership_applications
for update
to authenticated
using ((select private.has_permission('members.manage')))
with check ((select private.has_permission('members.manage')));

revoke insert, update on public.membership_applications from authenticated;
grant update on public.membership_applications to authenticated;

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
    review_status = 'pending',
    rejection_reason = null,
    reviewed_at = null,
    submitted_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.submit_membership_application(text, text, date, text, text)
from public;
grant execute on function public.submit_membership_application(text, text, date, text, text)
to authenticated;

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
          and review_status = 'pending'
      )
    )
  then
    raise exception 'Verified email and a pending membership application are required before approval';
  end if;
  return new;
end;
$$;
