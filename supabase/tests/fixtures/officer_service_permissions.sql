-- Synthetic records and production-compatible constraints for isolated tests.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
grant usage on schema public, auth, private to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create type public.account_role as enum ('member', 'manager', 'admin');
create type public.officer_title as enum ('president', 'vice_president', 'treasurer');
create type public.member_status as enum ('active', 'inactive', 'pending');
create type public.attendance_status as enum ('going', 'not_going', 'undecided');
create type public.attendance_check_in_status as enum ('present', 'late', 'absent');
create table public.profiles (
  id uuid primary key, auth_user_id uuid unique, name text not null, phone text,
  role public.account_role, officer_title public.officer_title,
  status public.member_status, position text,
  is_system_admin boolean not null default false,
  is_test_account boolean not null default false
);
create table public.officer_permissions (
  officer_title public.officer_title not null, permission text not null,
  primary key (officer_title, permission),
  constraint officer_permissions_permission_check check (permission in (
    'officers.manage', 'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
    'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage'
  ))
);
insert into public.officer_permissions (officer_title, permission) values
  ('president', 'officers.manage'), ('president', 'members.manage'),
  ('president', 'fees.manage'), ('president', 'notices.manage'),
  ('president', 'events.manage'), ('president', 'feedback.manage'),
  ('president', 'elections.manage'), ('president', 'polls.manage'),
  ('president', 'surveys.manage'), ('president', 'welcome.manage'),
  ('vice_president', 'members.manage'), ('vice_president', 'events.manage'),
  ('treasurer', 'fees.manage');
create table public.events (
  id uuid primary key, team_mode text not null default 'random'
);
create table public.attendance (
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  status public.attendance_status not null default 'undecided',
  check_in_status public.attendance_check_in_status,
  checked_in_at timestamptz, checked_in_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create table public.guest_players (id uuid primary key);
create table public.event_guest_players (
  event_id uuid not null references public.events(id) on delete cascade,
  guest_player_id uuid not null references public.guest_players(id) on delete restrict,
  guest_name text not null, guest_position text,
  primary key (event_id, guest_player_id)
);
create table public.event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  team_number integer not null check (team_number between 1 and 4),
  team_name text not null check (char_length(team_name) between 1 and 30),
  generation_mode text not null check (generation_mode in ('random', 'balanced')),
  created_by uuid references public.profiles(id) on delete set null,
  unique (event_id, team_number), unique (id, event_id)
);
create table public.event_team_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  event_team_id uuid not null,
  profile_id uuid references public.profiles(id) on delete restrict,
  guest_player_id uuid references public.guest_players(id) on delete restrict,
  participant_name text not null check (char_length(participant_name) between 1 and 50),
  participant_position text check (participant_position is null or participant_position in ('GK', 'DF', 'MF', 'FW', 'ANY')),
  foreign key (event_team_id, event_id) references public.event_teams(id, event_id) on delete cascade,
  check ((profile_id is not null)::integer + (guest_player_id is not null)::integer = 1)
);
create unique index event_team_members_profile_idx
on public.event_team_members (event_id, profile_id) where profile_id is not null;
create unique index event_team_members_guest_idx
on public.event_team_members (event_id, guest_player_id) where guest_player_id is not null;
create table public.fees (
  member_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount >= 0)
);
alter table public.profiles enable row level security;
alter table public.officer_permissions enable row level security;
alter table public.events enable row level security;
alter table public.attendance enable row level security;
alter table public.event_guest_players enable row level security;
alter table public.event_teams enable row level security;
alter table public.event_team_members enable row level security;
alter table public.fees enable row level security;
grant select, insert, update, delete on public.profiles, public.events, public.attendance,
  public.event_guest_players, public.event_teams, public.event_team_members, public.fees to authenticated;
grant select on public.officer_permissions to authenticated;
grant all on public.profiles, public.events, public.attendance, public.event_guest_players,
  public.event_teams, public.event_team_members, public.fees to service_role;
insert into public.profiles (id, auth_user_id, name, phone, role, officer_title, status, position, is_system_admin, is_test_account)
select
  ('51010000-0000-0000-0000-' || lpad(fixture.number::text, 12, '0'))::uuid,
  ('51000000-0000-0000-0000-' || lpad(fixture.number::text, 12, '0'))::uuid,
  fixture.name, 'private-fixture-contact-' || fixture.number,
  fixture.role::public.account_role, fixture.title::public.officer_title,
  fixture.status::public.member_status, fixture.position, fixture.system_admin, fixture.test_account
from (values
  (1, 'President Fixture', 'manager', 'president', 'active', 'MF', false, false),
  (2, 'Vice President Fixture', 'manager', 'vice_president', 'active', 'DF', false, false),
  (3, 'Treasurer Fixture', 'manager', 'treasurer', 'active', 'MF', false, false),
  (4, 'System Admin Fixture', 'member', null, 'active', 'ANY', true, false),
  (5, 'Ordinary Member Fixture', 'member', null, 'active', 'FW', false, false),
  (6, 'Inactive Officer Fixture', 'manager', 'vice_president', 'inactive', 'DF', false, false),
  (7, 'Pending Officer Fixture', 'manager', 'vice_president', 'pending', 'DF', false, false),
  (8, 'Hidden Officer Fixture', 'manager', 'vice_president', 'active', 'MF', false, true),
  (9, 'Target Member Fixture', 'member', null, 'active', 'FW', false, false),
  (10, 'Second Target Fixture', 'member', null, 'active', 'GK', false, false),
  (11, 'Hidden Target Fixture', 'member', null, 'active', 'ANY', false, true),
  (12, 'Inactive Target Fixture', 'member', null, 'inactive', 'DF', false, false),
  (13, 'Inactive Admin Fixture', 'member', null, 'inactive', 'ANY', true, false),
  (14, 'Pending Admin Fixture', 'member', null, 'pending', 'ANY', true, false)
) as fixture(number, name, role, title, status, position, system_admin, test_account);
insert into public.events (id) values ('52000000-0000-0000-0000-000000000001');
insert into public.guest_players values ('53000000-0000-0000-0000-000000000001');
insert into public.event_guest_players values (
  '52000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001', 'Guest Fixture', 'DF'
);
