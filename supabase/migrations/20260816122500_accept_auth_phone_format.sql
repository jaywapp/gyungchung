-- GoTrue stores E.164 phone numbers without the leading plus sign.
create or replace function private.normalize_member_phone(raw_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_phone is null or pg_catalog.btrim(raw_phone) = '' then null
    when pg_catalog.regexp_replace(raw_phone, '[^0-9+]', '', 'g') ~ '^\+82[0-9]{9,10}$'
      then pg_catalog.regexp_replace(raw_phone, '[^0-9+]', '', 'g')
    when pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g') ~ '^82[0-9]{9,10}$'
      then '+' || pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g')
    when pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$'
      then '+82' || pg_catalog.substr(pg_catalog.regexp_replace(raw_phone, '[^0-9]', '', 'g'), 2)
    else null
  end;
$$;

revoke execute on function private.normalize_member_phone(text) from public, anon, authenticated;
