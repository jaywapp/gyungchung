-- Synthetic data only; never run this fixture against a project database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create role fixture_untrusted bypassrls;
create role supabase_auth_admin;
create schema auth;
create schema private;
grant usage on schema public, auth, private to anon, authenticated, service_role, fixture_untrusted, supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table auth.users (
  id uuid primary key, email text, phone text, raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}'
);
create type public.account_role as enum ('member', 'manager', 'admin');
create type public.officer_title as enum ('president', 'vice_president', 'treasurer');
create type public.member_status as enum ('active', 'inactive', 'pending');
create type public.member_fee_plan as enum ('monthly', 'per_event');
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null, phone text, email text,
  role public.account_role not null default 'member',
  officer_title public.officer_title,
  fee_plan public.member_fee_plan default 'monthly',
  status public.member_status not null default 'pending',
  is_system_admin boolean not null default false,
  is_test_account boolean not null default false,
  must_change_password boolean not null default false,
  updated_at timestamptz default now(),
  constraint profiles_base_role_check check (role in ('member', 'manager')),
  constraint profiles_manager_officer_title_check check (
    (role = 'manager' and officer_title is not null)
    or (role <> 'manager' and officer_title is null)
  ),
  constraint profiles_member_fee_plan_check check (
    (role = 'member' and fee_plan is not null)
    or (role <> 'member' and fee_plan is null)
  )
);
create table public.officer_permissions (
  officer_title public.officer_title, permission text,
  primary key (officer_title, permission)
);
insert into public.officer_permissions values
  ('president', 'members.manage'), ('treasurer', 'fees.manage');
insert into auth.users(id, email, phone)
select ('51000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  'fixture-' || number || '@example.invalid', '+82100000000' || number
from unnest(array[1,2,3,4,6,8]) as number;
insert into public.profiles(id, auth_user_id, name, phone, role, officer_title, fee_plan, status, is_system_admin)
values
  ('51010000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Member Manager Fixture', '+821000000001', 'manager', 'president', null, 'active', false),
  ('51010000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', 'Member Fixture', '+821000000002', 'member', null, 'monthly', 'active', false),
  ('51010000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000003', 'Admin Fixture A', '+821000000003', 'member', null, 'monthly', 'active', true),
  ('51010000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000004', 'Admin Fixture B', '+821000000004', 'member', null, 'monthly', 'active', true),
  ('51010000-0000-0000-0000-000000000005', null, 'Unlinked Admin Fixture', '+821000000005', 'member', null, 'monthly', 'active', true),
  ('51010000-0000-0000-0000-000000000006', '51000000-0000-0000-0000-000000000006', 'Inactive Manager Fixture', '+821000000006', 'manager', 'president', null, 'inactive', false),
  ('51010000-0000-0000-0000-000000000007', null, 'Unlinked Member Fixture', '+821000000007', 'member', null, 'monthly', 'active', false),
  ('51010000-0000-0000-0000-000000000008', '51000000-0000-0000-0000-000000000008', 'Fee Manager Fixture', '+821000000008', 'manager', 'treasurer', null, 'active', false);
alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to authenticated, service_role, fixture_untrusted;
grant select on public.officer_permissions to authenticated;
grant select, insert, update, delete on auth.users to service_role;
grant select, insert, update, delete on auth.users to supabase_auth_admin;
