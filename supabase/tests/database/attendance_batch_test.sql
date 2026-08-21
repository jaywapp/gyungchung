begin;

select plan(6);

create or replace function private.has_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_permission = 'events.manage';
$$;

insert into public.profiles (id, name, phone, role, fee_plan, status)
values
  ('85000000-0000-0000-0000-000000000001', 'Batch One', '010-8500-0001', 'member', 'monthly', 'active'),
  ('85000000-0000-0000-0000-000000000002', 'Batch Two', '010-8500-0002', 'member', 'monthly', 'active'),
  ('85000000-0000-0000-0000-000000000003', 'Batch Three', '010-8500-0003', 'member', 'monthly', 'active');

insert into public.events (id, title, starts_at, venue)
values ('85000000-0000-0000-0000-000000000010', 'Attendance batch regression', now(), 'Test venue');

insert into public.attendance (event_id, member_id, status, check_in_status)
values ('85000000-0000-0000-0000-000000000010', '85000000-0000-0000-0000-000000000001', 'going', 'absent');

create function pg_temp.reject_second_attendance()
returns trigger
language plpgsql
as $$
begin
  if new.member_id = '85000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'Injected attendance failure';
  end if;
  return new;
end;
$$;

create trigger reject_second_attendance_before_write
before insert or update on public.attendance
for each row execute function pg_temp.reject_second_attendance();

create temporary table first_attempt as
select * from public.save_attendance_batch(
  '85000000-0000-0000-0000-000000000010',
  '[
    {"member_id":"85000000-0000-0000-0000-000000000001","response_status":"undecided","check_in_status":"present"},
    {"member_id":"85000000-0000-0000-0000-000000000002","response_status":"undecided","check_in_status":"late"},
    {"member_id":"85000000-0000-0000-0000-000000000003","response_status":"undecided","check_in_status":"absent"}
  ]'::jsonb
);

select is(
  (select count(*) from first_attempt where succeeded),
  2::bigint,
  'saves successful rows when one row fails'
);

select is(
  (select count(*) from first_attempt where not succeeded),
  1::bigint,
  'returns one row-level failure'
);

select ok(
  exists (
    select 1 from public.attendance
    where event_id = '85000000-0000-0000-0000-000000000010'
      and member_id = '85000000-0000-0000-0000-000000000001'
      and status = 'going'
      and check_in_status = 'present'
  ),
  'preserves the existing attendance response while updating check-in'
);

select ok(
  not exists (
    select 1 from public.attendance
    where event_id = '85000000-0000-0000-0000-000000000010'
      and member_id = '85000000-0000-0000-0000-000000000002'
  ),
  'rolls back the failed row without losing successful rows'
);

drop trigger reject_second_attendance_before_write on public.attendance;

create temporary table retry_attempt as
select * from public.save_attendance_batch(
  '85000000-0000-0000-0000-000000000010',
  '[{"member_id":"85000000-0000-0000-0000-000000000002","response_status":"undecided","check_in_status":"late"}]'::jsonb
);

select is(
  (select count(*) from retry_attempt where succeeded),
  1::bigint,
  'retries the failed row successfully'
);

create temporary table idempotent_attempt as
select * from public.save_attendance_batch(
  '85000000-0000-0000-0000-000000000010',
  '[{"member_id":"85000000-0000-0000-0000-000000000001","response_status":"going","check_in_status":"present"}]'::jsonb
);

select is(
  (select count(*) from public.attendance where event_id = '85000000-0000-0000-0000-000000000010'),
  3::bigint,
  'keeps repeated saves idempotent'
);

select * from finish();

rollback;
