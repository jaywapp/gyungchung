-- Synthetic event subsystem for isolated PGlite. The verifier installs the
-- actual legacy vote schema/policies/functions and then the actual migration.
create type public.attendance_status as enum ('going', 'not_going', 'undecided');
create type public.attendance_check_in_status as enum ('present', 'late', 'absent');
create table public.events (
  id uuid primary key default gen_random_uuid(), title text not null default 'Fixture',
  starts_at timestamptz not null, venue text not null default 'Fixture venue',
  address text, note text, capacity integer, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.attendance (
  event_id uuid references public.events(id) on delete cascade,
  member_id uuid references public.profiles(id) on delete cascade,
  status public.attendance_status not null default 'undecided',
  checked_in_at timestamptz, checked_in_by uuid references public.profiles(id),
  check_in_status public.attendance_check_in_status, updated_at timestamptz not null default now(),
  primary key(event_id, member_id)
);
alter table public.events enable row level security;
alter table public.attendance enable row level security;
grant select on public.events to anon, authenticated;
grant insert,update,delete on public.events to authenticated,service_role;
grant select,insert,update,delete on public.attendance to authenticated;
insert into public.officer_permissions values ('president','events.manage');
insert into public.events(id,title,starts_at,venue)
select ('53000000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  'POTM Fixture ' || number,
  clock_timestamp() - case number when 1 then interval '5 days' when 2 then interval '4 hours'
    when 3 then interval '1 hour' else interval '1 day' end,
  'Synthetic venue'
from generate_series(1,4) as number;
insert into public.attendance(event_id,member_id,status,check_in_status,checked_in_at)
select event.id, profile.id, 'going', 'present', clock_timestamp() - interval '6 days'
from public.events as event cross join public.profiles as profile;
