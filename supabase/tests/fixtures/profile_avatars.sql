-- Synthetic Storage metadata only; never run against a project database.
create role supabase_storage_admin;
create schema storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, fixture_untrusted;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner_id text, metadata jsonb, unique(bucket_id, name)
);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
-- Match the deployed catalog: table privileges exist; RLS supplies access.
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to fixture_untrusted;
alter table public.profiles add column position text default 'MF',
  add column jersey_number integer, add column joined_at date default current_date;
insert into auth.users(id) values
  ('51000000-0000-0000-0000-000000000009'),
  ('51000000-0000-0000-0000-000000000010'),
  ('51000000-0000-0000-0000-000000000011'),
  ('51000000-0000-0000-0000-000000000012');
insert into public.profiles(id,auth_user_id,name,phone,status,must_change_password,is_test_account) values
  ('51010000-0000-0000-0000-000000000009','51000000-0000-0000-0000-000000000009','Password Change Fixture','+821000000009','active',true,false),
  ('51010000-0000-0000-0000-000000000010','51000000-0000-0000-0000-000000000010','Hidden Fixture','+821000000010','active',false,true),
  ('51010000-0000-0000-0000-000000000011','51000000-0000-0000-0000-000000000011','Pending Fixture','+821000000011','pending',false,false);
