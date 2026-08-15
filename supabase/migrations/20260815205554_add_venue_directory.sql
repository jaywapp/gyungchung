create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  address text not null default '' check (char_length(address) <= 240),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, address)
);

create or replace function public.prepare_venue()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.name := trim(new.name);
  new.address := trim(new.address);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke execute on function public.prepare_venue()
from public, anon, authenticated;

create trigger prepare_venue_before_write
before insert or update on public.venues
for each row execute function public.prepare_venue();

alter table public.venues enable row level security;

create policy "Venues are public"
on public.venues for select to anon, authenticated
using (true);

create policy "Event managers create venues"
on public.venues for insert to authenticated
with check ((select private.has_permission('events.manage')));

create policy "Event managers update venues"
on public.venues for update to authenticated
using ((select private.has_permission('events.manage')))
with check ((select private.has_permission('events.manage')));

create policy "Event managers delete venues"
on public.venues for delete to authenticated
using ((select private.has_permission('events.manage')));

grant select on public.venues to anon, authenticated;
grant select, insert, update, delete on public.venues to service_role;
grant insert, update, delete on public.venues to authenticated;

insert into public.venues (name, address)
select distinct trim(event.venue), trim(coalesce(event.address, ''))
from public.events as event
where trim(event.venue) <> ''
on conflict (name, address) do nothing;

alter table public.events
add column venue_id uuid references public.venues(id) on delete set null;

create index events_venue_idx
on public.events (venue_id)
where venue_id is not null;

update public.events as event
set venue_id = venue.id
from public.venues as venue
where venue.name = trim(event.venue)
  and venue.address = trim(coalesce(event.address, ''));
