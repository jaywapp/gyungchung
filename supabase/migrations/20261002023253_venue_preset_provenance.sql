alter table public.venues
  add column city text check (city is null or char_length(trim(city)) between 1 and 80),
  add column preset_key text unique check (preset_key is null or preset_key ~ '^[a-z][a-z0-9-]{1,119}$'),
  add column source_urls text[] not null default '{}'
    check (cardinality(source_urls) <= 12 and array_position(source_urls, null) is null and array_position(source_urls, '') is null),
  add column source_checked_at date,
  add column latitude double precision,
  add column longitude double precision,
  add constraint venues_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
  ),
  add constraint venues_preset_provenance_check check (
    preset_key is null or (city is not null and cardinality(source_urls) > 0 and source_checked_at is not null)
  );

comment on column public.venues.preset_key is 'Stable import identity; manual venues may leave it null.';
comment on column public.venues.source_checked_at is 'Date public source data was checked; not an on-site operating-status confirmation.';
