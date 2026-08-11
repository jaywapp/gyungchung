create type public.officer_title as enum ('president', 'vice_president', 'treasurer');

alter table public.profiles
add column officer_title public.officer_title;

alter table public.profiles
add constraint profiles_manager_officer_title_check
check (
  (role = 'manager'::public.account_role and officer_title is not null)
  or (role <> 'manager'::public.account_role and officer_title is null)
);

drop trigger if exists protect_account_role_permissions_before_write on public.role_permissions;
drop function if exists public.protect_account_role_permissions();

alter table public.role_permissions
drop constraint role_permissions_permission_check;

alter table public.role_permissions
add constraint role_permissions_permission_check
check (permission in (
  'roles.manage', 'officers.manage', 'members.manage', 'fees.manage',
  'notices.manage', 'events.manage', 'feedback.manage', 'elections.manage',
  'polls.manage', 'surveys.manage'
));

delete from public.role_permissions
where role = 'manager'::public.account_role;

insert into public.role_permissions (role, permission)
values ('admin', 'officers.manage')
on conflict (role, permission) do nothing;

create or replace function public.protect_account_role_permissions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Account role permissions are fixed; configure officer permissions instead';
end;
$$;

revoke execute on function public.protect_account_role_permissions()
from public, anon, authenticated;

create trigger protect_account_role_permissions_before_write
before insert or update or delete on public.role_permissions
for each row execute function public.protect_account_role_permissions();

create table public.officer_permissions (
  officer_title public.officer_title not null,
  permission text not null check (permission in (
    'officers.manage',
    'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
    'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage'
  )),
  primary key (officer_title, permission)
);

alter table public.officer_permissions enable row level security;

grant select, insert, update, delete on public.officer_permissions to authenticated;

insert into public.officer_permissions (officer_title, permission) values
  ('president', 'officers.manage'),
  ('president', 'members.manage'),
  ('president', 'fees.manage'),
  ('president', 'notices.manage'),
  ('president', 'events.manage'),
  ('president', 'feedback.manage'),
  ('president', 'elections.manage'),
  ('president', 'polls.manage'),
  ('president', 'surveys.manage'),
  ('vice_president', 'members.manage'),
  ('vice_president', 'events.manage'),
  ('treasurer', 'fees.manage');

create or replace function private.has_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'::public.member_status
      and (
        (
          profile.role = 'admin'::public.account_role
          and exists (
            select 1
            from public.role_permissions as role_permission
            where role_permission.role = profile.role
              and role_permission.permission = requested_permission
          )
        )
        or (
          profile.role = 'manager'::public.account_role
          and exists (
            select 1
            from public.officer_permissions as officer_permission
            where officer_permission.officer_title = profile.officer_title
              and officer_permission.permission = requested_permission
          )
        )
      )
  );
$$;

revoke all on function private.has_permission(text)
from public, anon, authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated;

create policy "Active members read officer permissions"
on public.officer_permissions for select to authenticated
using ((select private.is_active_member()));

create or replace function private.can_manage_officer_permission(target_title public.officer_title)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.has_permission('roles.manage'))
    or (
      target_title <> 'president'::public.officer_title
      and exists (
        select 1
        from public.profiles as profile
        join public.officer_permissions as officer_permission
          on officer_permission.officer_title = profile.officer_title
        where profile.id = (select auth.uid())
          and profile.status = 'active'::public.member_status
          and profile.role = 'manager'::public.account_role
          and profile.officer_title = 'president'::public.officer_title
          and officer_permission.permission = 'officers.manage'
      )
    );
$$;

revoke all on function private.can_manage_officer_permission(public.officer_title)
from public, anon, authenticated, service_role;
grant execute on function private.can_manage_officer_permission(public.officer_title) to authenticated;

create policy "Authorized officers insert officer permissions"
on public.officer_permissions for insert to authenticated
with check ((select private.can_manage_officer_permission(officer_title)));

create policy "Authorized officers update officer permissions"
on public.officer_permissions for update to authenticated
using ((select private.can_manage_officer_permission(officer_title)))
with check ((select private.can_manage_officer_permission(officer_title)));

create policy "Authorized officers delete officer permissions"
on public.officer_permissions for delete to authenticated
using ((select private.can_manage_officer_permission(officer_title)));

create or replace function public.protect_officer_permissions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
    and old.officer_title = 'president'::public.officer_title
    and old.permission = 'officers.manage'
  then
    raise exception 'The president must retain officer delegation access';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.permission = 'roles.manage'
  then
    raise exception 'Only the admin can manage account roles';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.permission = 'officers.manage'
    and new.officer_title <> 'president'::public.officer_title
  then
    raise exception 'Only the president can delegate officer permissions';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.protect_officer_permissions()
from public, anon, authenticated;

create trigger protect_officer_permissions_before_write
before insert or update or delete on public.officer_permissions
for each row execute function public.protect_officer_permissions();

create or replace function public.protect_account_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin'::public.account_role then
      raise exception 'The admin account cannot be deleted';
    end if;
    return old;
  end if;

  if (
    new.role is distinct from old.role
    or new.officer_title is distinct from old.officer_title
  ) and not (select private.has_permission('roles.manage'))
  then
    raise exception 'Only the admin can change account roles or officer titles';
  end if;

  if old.role = 'admin'::public.account_role
    and not (select private.has_permission('roles.manage'))
  then
    raise exception 'Only the admin can update the admin profile';
  end if;

  if old.role = 'admin'::public.account_role
    and (
      new.role is distinct from 'admin'::public.account_role
      or new.status is distinct from 'active'::public.member_status
      or new.officer_title is not null
    )
  then
    raise exception 'The admin account must remain active and separate from officer titles';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_account_roles()
from public, anon, authenticated;

drop function public.get_member_directory();

create function public.get_member_directory()
returns table (
  id uuid,
  name text,
  role public.account_role,
  officer_title public.officer_title,
  "position" text,
  jersey_number integer,
  joined_at date,
  status public.member_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.name,
    profile.role,
    profile.officer_title,
    profile.position,
    profile.jersey_number,
    profile.joined_at,
    profile.status
  from public.profiles as profile
  where auth.uid() is not null
    and profile.status = 'active'::public.member_status
  order by profile.name;
$$;

revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated;

create type public.member_fee_plan as enum ('monthly', 'per_event');
create type public.fee_type as enum ('monthly', 'participation');

alter table public.profiles
add column fee_plan public.member_fee_plan default 'monthly'::public.member_fee_plan;

drop trigger protect_account_roles_before_write on public.profiles;

update public.profiles
set fee_plan = case
  when role = 'member'::public.account_role then 'monthly'::public.member_fee_plan
  else null
end;

create trigger protect_account_roles_before_write
before update or delete on public.profiles
for each row execute function public.protect_account_roles();

alter table public.profiles
add constraint profiles_member_fee_plan_check
check (
  (role = 'member'::public.account_role and fee_plan is not null)
  or (role <> 'member'::public.account_role and fee_plan is null)
);

alter table public.guest_players
add column fee_amount integer not null default 10000
check (fee_amount >= 0);

create table public.event_guest_fees (
  event_id uuid not null references public.events(id) on delete cascade,
  guest_player_id uuid not null references public.guest_players(id) on delete restrict,
  amount integer not null default 10000 check (amount >= 0),
  status public.fee_status not null default 'unpaid'::public.fee_status,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, guest_player_id),
  foreign key (event_id, guest_player_id)
    references public.event_guest_players(event_id, guest_player_id)
    on delete cascade
);

alter table public.event_guest_fees enable row level security;

grant select, insert, update, delete on public.event_guest_fees to authenticated;

create policy "Fee managers read guest fees"
on public.event_guest_fees for select to authenticated
using ((select private.has_permission('fees.manage')));

create policy "Fee managers insert guest fees"
on public.event_guest_fees for insert to authenticated
with check ((select private.has_permission('fees.manage')));

create policy "Fee managers update guest fees"
on public.event_guest_fees for update to authenticated
using ((select private.has_permission('fees.manage')))
with check ((select private.has_permission('fees.manage')));

create policy "Fee managers delete guest fees"
on public.event_guest_fees for delete to authenticated
using ((select private.has_permission('fees.manage')));

create or replace function public.create_event_guest_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_guest_fees (event_id, guest_player_id, amount)
  select new.event_id, new.guest_player_id, guest.fee_amount
  from public.guest_players as guest
  where guest.id = new.guest_player_id
  on conflict (event_id, guest_player_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_event_guest_fee()
from public, anon, authenticated;

create trigger create_event_guest_fee_after_insert
after insert on public.event_guest_players
for each row execute function public.create_event_guest_fee();

insert into public.event_guest_fees (event_id, guest_player_id, amount)
select scheduled_guest.event_id, scheduled_guest.guest_player_id, guest.fee_amount
from public.event_guest_players as scheduled_guest
join public.guest_players as guest on guest.id = scheduled_guest.guest_player_id
on conflict (event_id, guest_player_id) do nothing;

alter table public.fees
drop constraint fees_member_id_month_key;

alter table public.fees
add column fee_type public.fee_type not null default 'monthly'::public.fee_type,
add column event_id uuid references public.events(id) on delete cascade;

alter table public.fees
add constraint fees_type_event_check
check (
  (fee_type = 'monthly'::public.fee_type and event_id is null)
  or (fee_type = 'participation'::public.fee_type and event_id is not null)
);

create unique index fees_monthly_member_month_idx
on public.fees (member_id, month)
where fee_type = 'monthly'::public.fee_type;

create unique index fees_participation_member_event_idx
on public.fees (member_id, event_id)
where fee_type = 'participation'::public.fee_type;

create index fees_event_id_idx
on public.fees (event_id)
where event_id is not null;

create or replace function public.apply_standard_fee_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member_role public.account_role;
  member_plan public.member_fee_plan;
begin
  select profile.role, profile.fee_plan
  into member_role, member_plan
  from public.profiles as profile
  where profile.id = new.member_id;

  if member_role = 'manager'::public.account_role then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Officers use the monthly officer fee';
    end if;
    new.amount := 15000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'monthly'::public.member_fee_plan
  then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Monthly members use the monthly fee';
    end if;
    new.amount := 30000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'per_event'::public.member_fee_plan
  then
    if new.fee_type <> 'participation'::public.fee_type then
      raise exception 'Per-event members use participation fees';
    end if;
    new.amount := 10000;
  elsif member_role = 'admin'::public.account_role then
    new.amount := 0;
    new.status := 'exempt'::public.fee_status;
  else
    raise exception 'The member fee policy is not configured';
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_standard_fee_amount()
from public, anon, authenticated;

create trigger apply_standard_fee_amount_before_write
before insert or update of member_id, fee_type, amount on public.fees
for each row execute function public.apply_standard_fee_amount();
