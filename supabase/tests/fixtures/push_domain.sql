-- Minimal domain contract for isolated PostgreSQL execution, never an operational database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
create table auth.users(id uuid primary key);
create type public.member_status as enum('active','inactive','pending');
create type public.attendance_status as enum('going','not_going','undecided');
create type public.attendance_check_in_status as enum('present','late','absent');
create table public.profiles(
 id uuid primary key default gen_random_uuid(),auth_user_id uuid unique references auth.users(id),
 name text not null,phone text,status public.member_status not null default 'active',role text not null default 'member',
 officer_title text,is_system_admin boolean not null default false,is_test_account boolean not null default false,
 must_change_password boolean not null default false
);
create table public.officer_permissions(officer_title text,permission text,primary key(officer_title,permission));
insert into public.officer_permissions values('president','events.manage'),('president','members.manage'),('president','notices.manage');
create function private.current_profile_id() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p where p.auth_user_id=(select auth.uid());
$$;
create function private.has_permission(requested_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(select 1 from public.profiles p where p.auth_user_id=(select auth.uid()) and p.status='active'
 and (p.is_system_admin or (p.role='manager' and exists(select 1 from public.officer_permissions op where op.officer_title=p.officer_title and op.permission=requested_permission))));
$$;
create function private.is_active_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where auth_user_id=(select auth.uid()) and status='active');
$$;
create table public.events(id uuid primary key default gen_random_uuid(),title text not null,starts_at timestamptz not null,
 venue text not null,address text,note text,capacity integer,is_competitive boolean default false,team_mode text,weekly_date date);
create table private.weekly_schedule_exclusions(event_date date primary key,cancelled_at timestamptz default now());
create table public.attendance(event_id uuid references public.events(id) on delete cascade,member_id uuid references public.profiles(id) on delete cascade,
 status public.attendance_status not null default 'undecided',check_in_status public.attendance_check_in_status,
 checked_in_at timestamptz,checked_in_by uuid references public.profiles(id),updated_at timestamptz default now(),primary key(event_id,member_id));
create table public.notices(id uuid primary key default gen_random_uuid(),title text not null,body text not null,is_pinned boolean default false,author_id uuid,created_at timestamptz default now());
create table public.feedback(id uuid primary key default gen_random_uuid(),title text not null,author_id uuid references public.profiles(id),status text not null default 'received',officer_response text);
create table public.participation_forms(id uuid primary key default gen_random_uuid(),title text not null,kind text not null,status text not null,starts_at timestamptz,ends_at timestamptz);
create table public.participation_submissions(id uuid primary key default gen_random_uuid(),form_id uuid references public.participation_forms(id),participant_id uuid references public.profiles(id));
create table public.fees(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,
 member_id uuid references public.profiles(id),month date,status text,fee_type text);
create table public.event_guest_fees(event_id uuid references public.events(id) on delete cascade,status text);
create table public.event_matches(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade);
create table public.event_teams(id uuid primary key default gen_random_uuid(),event_id uuid references public.events(id) on delete cascade,score integer);
create table public.event_team_members(event_id uuid references public.events(id) on delete cascade,goals integer default 0,rating numeric);
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.attendance enable row level security;
alter table public.notices enable row level security;
alter table public.feedback enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(auth_user_id=(select auth.uid()) or (select private.has_permission('members.manage')));
create policy profiles_update on public.profiles for update to authenticated using(auth_user_id=(select auth.uid())) with check(auth_user_id=(select auth.uid()));
create policy events_read on public.events for select to anon,authenticated using(true);
create policy events_write on public.events for all to authenticated using((select private.has_permission('events.manage'))) with check((select private.has_permission('events.manage')));
create policy attendance_read on public.attendance for select to authenticated using(true);
create policy attendance_insert on public.attendance for insert to authenticated with check((member_id=(select private.current_profile_id()) and (select private.is_active_member())) or (select private.has_permission('events.manage')));
create policy attendance_update on public.attendance for update to authenticated using(member_id=(select private.current_profile_id()) or (select private.has_permission('events.manage'))) with check(member_id=(select private.current_profile_id()) or (select private.has_permission('events.manage')));
create policy notices_read on public.notices for select to anon,authenticated using(true);
create policy notices_write on public.notices for all to authenticated using((select private.has_permission('notices.manage'))) with check((select private.has_permission('notices.manage')));
create policy feedback_read on public.feedback for select to authenticated using(author_id=(select private.current_profile_id()) or (select private.has_permission('feedback.manage')));
grant usage on schema auth,private,public to anon,authenticated,service_role;
grant select on public.events,public.notices to anon;
grant select,insert,update,delete on public.events,public.notices,public.attendance to authenticated;
grant select,update on public.profiles to authenticated;
grant select on public.feedback to authenticated;
