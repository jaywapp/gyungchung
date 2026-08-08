create type public.member_role as enum ('admin', 'member');
create type public.member_status as enum ('active', 'inactive');
create type public.fee_status as enum ('paid', 'unpaid', 'exempt');
create type public.attendance_status as enum ('going', 'not_going', 'undecided');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role public.member_role not null default 'member',
  position text,
  jersey_number integer check (jersey_number between 0 and 99),
  joined_at date not null default current_date,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notices (id uuid primary key default gen_random_uuid(), title text not null, body text not null, is_pinned boolean not null default false, author_id uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.events (id uuid primary key default gen_random_uuid(), title text not null default '주말 정기 풋살', starts_at timestamptz not null, venue text not null, address text, note text, capacity integer check (capacity is null or capacity > 0), created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.fees (id uuid primary key default gen_random_uuid(), member_id uuid not null references public.profiles(id) on delete cascade, month date not null, amount integer not null check (amount >= 0), status public.fee_status not null default 'unpaid', paid_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(member_id, month));
create table public.attendance (event_id uuid not null references public.events(id) on delete cascade, member_id uuid not null references public.profiles(id) on delete cascade, status public.attendance_status not null default 'undecided', updated_at timestamptz not null default now(), primary key(event_id, member_id));

alter table public.profiles enable row level security;
alter table public.notices enable row level security;
alter table public.events enable row level security;
alter table public.fees enable row level security;
alter table public.attendance enable row level security;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select (select auth.uid()) is not null and exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and status = 'active') $$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;
create policy "Active profiles are public" on public.profiles for select to anon, authenticated using (status = 'active' or id = (select auth.uid()));
create policy "Admins manage profiles" on public.profiles for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Notices are public" on public.notices for select to anon, authenticated using (true);
create policy "Admins manage notices" on public.notices for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Events are public" on public.events for select to anon, authenticated using (true);
create policy "Admins manage events" on public.events for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Members read own fees" on public.fees for select to authenticated using (member_id = (select auth.uid()) or (select private.is_admin()));
create policy "Admins manage fees" on public.fees for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Authenticated members read attendance" on public.attendance for select to authenticated using (true);
create policy "Members manage own attendance" on public.attendance for insert to authenticated with check (member_id = (select auth.uid()));
create policy "Members update own attendance" on public.attendance for update to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy "Admins manage attendance" on public.attendance for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.notices, public.events to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.notices, public.events, public.fees, public.attendance to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.profiles (id, name, email) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, '새 회원'), '@', 1)), new.email); return new; end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

insert into public.notices (title, body, is_pinned) values ('경충FC 클럽하우스가 열렸습니다', '회원 정보와 회비, 공지, 주말 풋살 일정을 이제 한곳에서 확인할 수 있습니다.', true);
insert into public.events (title, starts_at, venue, address, note, capacity) values ('주말 정기 풋살', date_trunc('week', now()) + interval '5 days 9 hours', '구장 확정 후 안내', '서울', '흰색·검정색 유니폼을 모두 챙겨주세요.', 18);
