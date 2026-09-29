create extension if not exists pg_cron;

alter table public.events add column weekly_date date;
create unique index events_weekly_date_unique on public.events (weekly_date) where weekly_date is not null;

create table private.weekly_schedule_settings (
  id boolean primary key default true check (id),
  title text not null,
  venue text not null,
  venue_id uuid references public.venues(id) on delete set null,
  address text,
  note text,
  capacity integer,
  is_competitive boolean not null default false
);

insert into private.weekly_schedule_settings (title, venue, venue_id, address, note, capacity, is_competitive)
select '주말 정기 풋살', coalesce(recent.venue, '구장 확정 후 안내'), recent.venue_id,
       recent.address, concat('운동 시간 08:00~10:00', case when recent.note is not null and recent.note <> '' then E'\n' || recent.note else '' end), coalesce(recent.capacity, 18), coalesce(recent.is_competitive, false)
from (select 1) as seed
left join lateral (
  select venue, venue_id, address, note, capacity, is_competitive
  from public.events
  where extract(isodow from starts_at at time zone 'Asia/Seoul') = 7
  order by starts_at desc limit 1
) as recent on true;

create table private.weekly_schedule_exclusions (
  event_date date primary key,
  cancelled_at timestamptz not null default now()
);

create or replace function private.ensure_weekly_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  inserted_count integer;
begin
  with schedule_dates as (
    select ((now() at time zone 'Asia/Seoul')::date
      + ((7 - extract(dow from now() at time zone 'Asia/Seoul')::integer) % 7)
      + (week_number * 7))::date as event_date
    from generate_series(0, 11) as week_number
  ), inserted as (
    insert into public.events (title, starts_at, venue_id, venue, address, note, capacity, is_competitive, weekly_date)
    select settings.title,
      (dates.event_date::timestamp + interval '8 hours') at time zone 'Asia/Seoul',
      settings.venue_id, settings.venue, settings.address, settings.note,
      settings.capacity, settings.is_competitive, dates.event_date
    from schedule_dates as dates
    cross join private.weekly_schedule_settings as settings
    where not exists (select 1 from private.weekly_schedule_exclusions as excluded where excluded.event_date = dates.event_date)
      and not exists (
        select 1 from public.events as existing
        where (existing.starts_at at time zone 'Asia/Seoul')::date = dates.event_date
          and extract(hour from existing.starts_at at time zone 'Asia/Seoul') between 8 and 9
      )
    on conflict (weekly_date) where weekly_date is not null do nothing
    returning id
  )
  select count(*) into inserted_count from inserted;
  return inserted_count;
end;
$$;

revoke all on function private.ensure_weekly_events() from public, anon, authenticated;
select private.ensure_weekly_events();
select cron.schedule('gyungchung-weekly-events', '5 0 * * *', 'select private.ensure_weekly_events()');

create or replace function public.cancel_weekly_event(target_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_date date;
  target_event public.events%rowtype;
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can cancel weekly events';
  end if;
  select * into target_event from public.events where id = target_event_id for update;
  if not found then
    raise exception 'Weekly event not found';
  end if;
  if target_event.weekly_date is null and not (
    target_event.title = '주말 정기 풋살'
    and extract(dow from target_event.starts_at at time zone 'Asia/Seoul') = 0
    and extract(hour from target_event.starts_at at time zone 'Asia/Seoul') = 8
  ) then
    raise exception 'Event is not a weekly schedule';
  end if;
  target_date := coalesce(target_event.weekly_date, (target_event.starts_at at time zone 'Asia/Seoul')::date);
  insert into private.weekly_schedule_exclusions (event_date) values (target_date)
    on conflict (event_date) do nothing;
  delete from public.events where id = target_event_id;
end;
$$;
revoke all on function public.cancel_weekly_event(uuid) from public, anon, authenticated;
grant execute on function public.cancel_weekly_event(uuid) to authenticated;

create table public.event_winning_members (
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index event_winning_members_member_idx on public.event_winning_members (member_id);
alter table public.event_winning_members enable row level security;
create policy "Active members read winners" on public.event_winning_members
  for select to authenticated using ((select private.is_active_member()));
create or replace function public.get_event_winners()
returns table (event_id uuid, member_id uuid)
language sql stable security definer set search_path = '' as $$
  select winner.event_id, winner.member_id
  from public.event_winning_members as winner
  where (select private.is_active_member());
$$;
revoke all on function public.get_event_winners() from public, anon, authenticated;
grant execute on function public.get_event_winners() to authenticated;

create or replace function public.save_event_winners(target_event_id uuid, target_member_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  member_count integer;
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can save winners';
  end if;
  if not exists (select 1 from public.events where id = target_event_id) then
    raise exception 'Event not found';
  end if;
  select count(*) into member_count from unnest(coalesce(target_member_ids, '{}'::uuid[])) as member_id;
  if member_count > 5 or member_count <> (
    select count(distinct member_id) from unnest(coalesce(target_member_ids, '{}'::uuid[])) as member_id
  ) then
    raise exception 'Select up to five unique winners';
  end if;
  if exists (
    select 1 from unnest(coalesce(target_member_ids, '{}'::uuid[])) as selected(member_id)
    left join public.profiles as profile on profile.id = selected.member_id
    where profile.id is null or profile.status <> 'active'::public.member_status or profile.is_test_account
  ) then
    raise exception 'Winners must be active members';
  end if;
  delete from public.event_winning_members where event_id = target_event_id;
  insert into public.event_winning_members (event_id, member_id)
  select target_event_id, selected.member_id
  from unnest(coalesce(target_member_ids, '{}'::uuid[])) as selected(member_id);
end;
$$;
revoke all on function public.save_event_winners(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.save_event_winners(uuid, uuid[]) to authenticated;
