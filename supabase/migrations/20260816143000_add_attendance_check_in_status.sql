create type public.attendance_check_in_status as enum ('present', 'late', 'absent');

alter table public.attendance
  add column check_in_status public.attendance_check_in_status;

update public.attendance
set check_in_status = 'present'::public.attendance_check_in_status
where checked_in_at is not null;

create index attendance_check_in_status_idx
on public.attendance (event_id, check_in_status)
where check_in_status is not null;

create or replace function public.protect_attendance_check_in()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    (tg_op = 'INSERT' and (
      new.checked_in_at is not null
      or new.checked_in_by is not null
      or new.check_in_status is not null
    ))
    or (tg_op = 'UPDATE' and (
      new.checked_in_at is distinct from old.checked_in_at
      or new.checked_in_by is distinct from old.checked_in_by
      or new.check_in_status is distinct from old.check_in_status
    ))
  ) and not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can change check-in records';
  end if;

  -- Preserve legacy check-in timestamps while normalizing them to present.
  if new.check_in_status is null and new.checked_in_at is not null then
    if tg_op = 'INSERT' then
      new.check_in_status := 'present'::public.attendance_check_in_status;
    elsif old.check_in_status is null then
      new.check_in_status := 'present'::public.attendance_check_in_status;
    end if;
  end if;

  if new.check_in_status is null or new.check_in_status = 'absent'::public.attendance_check_in_status then
    new.checked_in_at := null;
    new.checked_in_by := null;
  else
    if new.checked_in_at is null then
      new.checked_in_at := now();
    end if;
    if tg_op = 'INSERT' then
      new.checked_in_by := (select private.current_profile_id());
    elsif new.check_in_status is distinct from old.check_in_status
      or new.checked_in_at is distinct from old.checked_in_at
      or new.checked_in_by is null then
      new.checked_in_by := (select private.current_profile_id());
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.protect_attendance_check_in()
from public, anon, authenticated;

create or replace function public.validate_event_mom_vote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.voter_id is distinct from (select private.current_profile_id()) then raise exception 'Votes can only be submitted for the signed-in member'; end if;
  if new.voter_id = new.candidate_profile_id then raise exception 'Members cannot vote for themselves'; end if;
  if not exists (select 1 from public.events where id = new.event_id and starts_at < now()) then raise exception 'MOM voting opens after the event starts'; end if;
  if not exists (select 1 from public.attendance where event_id = new.event_id and member_id = new.voter_id and (check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or checked_in_at is not null)) then raise exception 'Only checked-in members can vote'; end if;
  if not exists (select 1 from public.attendance where event_id = new.event_id and member_id = new.candidate_profile_id and (check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or checked_in_at is not null)) then raise exception 'MOM candidates must be checked in'; end if;
  new.voted_at := now();
  return new;
end;
$$;

revoke execute on function public.validate_event_mom_vote()
from public, anon, authenticated;

create or replace function private.get_member_rankings_data()
returns table (member_id uuid, member_name text, attendance_count bigint, paid_fee_count bigint, total_score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.name,
    count(distinct attendance.event_id) filter (where attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or attendance.checked_in_at is not null),
    count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status),
    count(distinct attendance.event_id) filter (where attendance.check_in_status in ('present'::public.attendance_check_in_status, 'late'::public.attendance_check_in_status) or attendance.checked_in_at is not null) * 3 + count(distinct fee.month) filter (where fee.status = 'paid'::public.fee_status)
  from public.profiles as profile
  left join public.attendance as attendance on attendance.member_id = profile.id
  left join public.fees as fee on fee.member_id = profile.id
  where profile.status = 'active'::public.member_status and (select private.is_active_member())
  group by profile.id, profile.name order by 5 desc, 3 desc, 4 desc, profile.name;
$$;

revoke all on function private.get_member_rankings_data()
from public, anon, authenticated;
grant execute on function private.get_member_rankings_data() to authenticated;
