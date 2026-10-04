-- Synthetic authorization data for an isolated PostgreSQL regression run.
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
create type public.member_fee_plan as enum ('monthly', 'per_event');
create type public.fee_type as enum ('monthly', 'participation');
create type public.fee_status as enum ('unpaid', 'paid', 'exempt');
create table public.profiles (
  id uuid primary key, auth_user_id uuid unique, name text not null, phone text,
  role public.account_role, officer_title public.officer_title,
  fee_plan public.member_fee_plan, status public.member_status,
  is_system_admin boolean not null default false,
  is_test_account boolean not null default false,
  position text, jersey_number integer, joined_at date default '2026-01-01'
);
create table public.officer_permissions (
  officer_title public.officer_title, permission text,
  primary key (officer_title, permission)
);
insert into public.officer_permissions values
  ('treasurer', 'fees.manage'), ('president', 'fees.manage'), ('president', 'members.manage');
create table public.events (id uuid primary key, starts_at timestamptz);
insert into public.events values
  ('42000000-0000-0000-0000-000000000001', '2026-09-06T08:00:00+09:00'),
  ('42000000-0000-0000-0000-000000000002', '2026-09-13T08:00:00+09:00');
create table public.fees (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id),
  month date not null check (month = date_trunc('month', month::timestamptz)::date),
  amount integer not null check (amount >= 0),
  status public.fee_status not null default 'unpaid', paid_at timestamptz,
  fee_type public.fee_type not null default 'monthly',
  event_id uuid references public.events(id), created_at timestamptz default now(),
  constraint fees_type_event_check check (
    (fee_type = 'monthly' and event_id is null) or
    (fee_type = 'participation' and event_id is not null)
  )
);
create unique index fees_monthly_member_month_idx on public.fees(member_id, month)
  where fee_type = 'monthly';
create unique index fees_participation_member_event_idx on public.fees(member_id, event_id)
  where fee_type = 'participation';
alter table public.profiles enable row level security;
alter table public.fees enable row level security;
grant select, insert, update, delete on public.profiles, public.fees to authenticated;
grant select on public.events, public.officer_permissions to authenticated;
grant all on public.profiles, public.fees, public.events to service_role;
insert into public.profiles(id, auth_user_id, name, phone, role, officer_title, fee_plan, status, is_test_account)
values
  ('41010000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Treasurer Fixture', 'fixture-contact-1', 'manager', 'treasurer', null, 'active', false),
  ('41010000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000002', 'President Fixture', 'fixture-contact-2', 'manager', 'president', null, 'active', false),
  ('41010000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-000000000003', 'Monthly Fixture', 'fixture-contact-3', 'member', null, 'monthly', 'active', false),
  ('41010000-0000-0000-0000-000000000004', '41000000-0000-0000-0000-000000000004', 'Per Event Fixture', 'fixture-contact-4', 'member', null, 'per_event', 'active', false),
  ('41010000-0000-0000-0000-000000000005', '41000000-0000-0000-0000-000000000005', 'Ordinary Fixture', 'fixture-contact-5', 'member', null, 'monthly', 'active', false),
  ('41010000-0000-0000-0000-000000000006', '41000000-0000-0000-0000-000000000006', 'Hidden Fixture', 'fixture-contact-6', 'member', null, 'monthly', 'active', true),
  ('41010000-0000-0000-0000-000000000007', '41000000-0000-0000-0000-000000000007', 'Inactive Treasurer Fixture', 'fixture-contact-7', 'manager', 'treasurer', null, 'inactive', false),
  ('41010000-0000-0000-0000-000000000008', '41000000-0000-0000-0000-000000000008', 'Pending Treasurer Fixture', 'fixture-contact-8', 'manager', 'treasurer', null, 'pending', false),
  ('41010000-0000-0000-0000-000000000009', '41000000-0000-0000-0000-000000000009', 'Inactive Member Fixture', 'fixture-contact-9', 'member', null, 'monthly', 'inactive', false);
