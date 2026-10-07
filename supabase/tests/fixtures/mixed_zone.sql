-- Synthetic records only; the verifier refuses a populated non-synthetic DB.
insert into public.events(id,title,starts_at,venue)
values
  ('51020000-0000-0000-0000-000000000001','Mixed-zone fixture open',clock_timestamp()-interval '3 hours','Synthetic'),
  ('51020000-0000-0000-0000-000000000002','Mixed-zone fixture future',clock_timestamp()+interval '2 hours','Synthetic'),
  ('51020000-0000-0000-0000-000000000003','Mixed-zone fixture closed',clock_timestamp()-interval '8 days','Synthetic');
alter table public.attendance disable trigger user;
insert into public.attendance(event_id,member_id,status,check_in_status,checked_in_at)
select event.id, profile.id,'going'::public.attendance_status,
  case when profile.id='51010000-0000-0000-0000-000000000003' then null
    when profile.id='51010000-0000-0000-0000-000000000002' then 'late'::public.attendance_check_in_status
    else 'present'::public.attendance_check_in_status end,
  clock_timestamp()
from public.events as event cross join public.profiles as profile
where profile.id<>'51010000-0000-0000-0000-000000000008';
insert into public.attendance(event_id,member_id,status)
select id,'51010000-0000-0000-0000-000000000008','going' from public.events;
alter table public.attendance enable trigger user;
