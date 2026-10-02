-- Welcome content is deliberately independent of the private member roster.
alter table public.role_permissions drop constraint role_permissions_permission_check;
alter table public.role_permissions add constraint role_permissions_permission_check
check (permission in (
  'roles.manage', 'officers.manage', 'members.manage', 'fees.manage',
  'notices.manage', 'events.manage', 'feedback.manage', 'elections.manage',
  'polls.manage', 'surveys.manage', 'welcome.manage'
));

alter table public.officer_permissions drop constraint officer_permissions_permission_check;
alter table public.officer_permissions add constraint officer_permissions_permission_check
check (permission in (
  'officers.manage', 'members.manage', 'fees.manage', 'notices.manage',
  'events.manage', 'feedback.manage', 'elections.manage', 'polls.manage',
  'surveys.manage', 'welcome.manage'
));

-- This fixed account-role catalog has a write-blocking trigger, including for
-- migration owners. Disable only that trigger for the additive catalog entry.
alter table public.role_permissions disable trigger protect_account_role_permissions_before_write;
insert into public.role_permissions (role, permission) values ('admin', 'welcome.manage')
on conflict (role, permission) do nothing;
alter table public.role_permissions enable trigger protect_account_role_permissions_before_write;
insert into public.officer_permissions (officer_title, permission) values ('president', 'welcome.manage')
on conflict (officer_title, permission) do nothing;

create table public.welcome_page_drafts (
  id boolean primary key default true check (id),
  content jsonb not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  published_revision bigint check (published_revision between 1 and revision),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table public.welcome_page_publications (
  id boolean primary key default true check (id),
  content jsonb not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  published_at timestamptz not null default now()
);
alter table public.welcome_page_drafts enable row level security;
alter table public.welcome_page_publications enable row level security;
revoke all on public.welcome_page_drafts, public.welcome_page_publications
from public, anon, authenticated, service_role;
grant select on public.welcome_page_drafts to authenticated;
grant select on public.welcome_page_publications to anon, authenticated;
create policy "Welcome managers read drafts" on public.welcome_page_drafts
for select to authenticated using ((select private.has_permission('welcome.manage')));
create policy "Anyone reads welcome publications" on public.welcome_page_publications
for select to anon, authenticated using (true);

-- JavaScript counts UTF-16 code units, rather than PostgreSQL Unicode characters.
create function private.welcome_text_length(value text)
returns bigint language sql immutable strict set search_path = '' as $$
  select pg_catalog.char_length(value)::bigint + pg_catalog.count(*)
  from pg_catalog.regexp_split_to_table(value, '') as characters(character)
  where pg_catalog.ascii(characters.character) > 65535;
$$;
create function private.welcome_text_present(value text)
returns boolean language sql immutable strict set search_path = '' as $$
  select pg_catalog.btrim(value, E' \t\n\r\v\f' || pg_catalog.chr(160) ||
    pg_catalog.chr(5760) || pg_catalog.chr(8192) || pg_catalog.chr(8193) ||
    pg_catalog.chr(8194) || pg_catalog.chr(8195) || pg_catalog.chr(8196) ||
    pg_catalog.chr(8197) || pg_catalog.chr(8198) || pg_catalog.chr(8199) ||
    pg_catalog.chr(8200) || pg_catalog.chr(8201) || pg_catalog.chr(8202) ||
    pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239) ||
    pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279)) <> '';
$$;
create function private.welcome_assert_object(value jsonb, allowed_keys text[])
returns void language plpgsql immutable set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'object' then
    raise exception 'Welcome content must contain correctly shaped objects' using errcode = '22023';
  end if;
  if not value ?& allowed_keys or exists (
    select 1 from pg_catalog.jsonb_object_keys(value) as supplied(key)
    where not supplied.key = any(allowed_keys)
  ) then
    raise exception 'Welcome content contains missing or unsupported fields' using errcode = '22023';
  end if;
end;
$$;
create function private.welcome_assert_text(value jsonb, max_length integer, required boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'string' then
    raise exception 'Welcome text must be a string' using errcode = '22023';
  end if;
  if private.welcome_text_length(value #>> '{}') > max_length
    or (required and not private.welcome_text_present(value #>> '{}')) then
    raise exception 'Welcome text is too long or missing required content' using errcode = '22023';
  end if;
end;
$$;
create function private.welcome_assert_array(value jsonb, max_length integer)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(value) is distinct from 'array' then
    raise exception 'Welcome collections must be arrays' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(value) > max_length then
    raise exception 'Welcome collection exceeds its limit' using errcode = '22023';
  end if;
end;
$$;
create function private.welcome_json_bytes(value jsonb)
returns bigint language plpgsql immutable strict set search_path = '' as $$
declare size bigint; element record;
begin
  if pg_catalog.jsonb_typeof(value) = 'object' then
    size := 2;
    for element in select * from pg_catalog.jsonb_each(value) loop
      size := size + pg_catalog.octet_length(pg_catalog.to_jsonb(element.key)::text)
        + 1 + private.welcome_json_bytes(element.value) + 1;
    end loop;
    if size > 2 then size := size - 1; end if;
    return size;
  elsif pg_catalog.jsonb_typeof(value) = 'array' then
    size := 2;
    for element in select * from pg_catalog.jsonb_array_elements(value) loop
      size := size + private.welcome_json_bytes(element.value) + 1;
    end loop;
    if size > 2 then size := size - 1; end if;
    return size;
  end if;
  return pg_catalog.octet_length(value::text);
end;
$$;
create function private.welcome_approved_ios_url(value text)
returns boolean language sql immutable strict set search_path = '' as $$
  select value ~ '^https://(apps\.apple\.com|testflight\.apple\.com)/[A-Za-z0-9_~!$&()*+,;=:@%.-][A-Za-z0-9/_~!$&()*+,;=:@%.-]*([?][A-Za-z0-9/_~!$&()*+,;=:@%?.-]*)?(#[A-Za-z0-9/_~!$&()*+,;=:@%?.-]*)?$'
    and value !~ '[[:cntrl:]]';
$$;
create function private.validate_welcome_content(page_content jsonb, publishing boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
declare
  step jsonb; officer jsonb; entry_id text; seen_ids text[] := '{}';
begin
  perform private.welcome_assert_object(page_content, array[
    'schemaVersion', 'title', 'introduction', 'accountSteps', 'officers', 'android', 'ios'
  ]);
  if pg_catalog.octet_length(page_content::text) > 1000000 then
    raise exception 'Welcome content exceeds 500000 UTF-8 bytes' using errcode = '22023';
  end if;
  if page_content -> 'schemaVersion' is distinct from '1'::jsonb then
    raise exception 'Unsupported welcome content version' using errcode = '22023';
  end if;
  perform private.welcome_assert_text(page_content -> 'title', 160, publishing);
  perform private.welcome_assert_text(page_content -> 'introduction', 1000, publishing);
  perform private.welcome_assert_array(page_content -> 'accountSteps', 10);
  perform private.welcome_assert_object(page_content -> 'android', array['enabled', 'installSteps']);
  if pg_catalog.jsonb_typeof(page_content #> '{android,enabled}') is distinct from 'boolean' then
    raise exception 'Android visibility must be boolean' using errcode = '22023';
  end if;
  perform private.welcome_assert_array(page_content #> '{android,installSteps}', 10);
  for step in
    select value from pg_catalog.jsonb_array_elements(page_content -> 'accountSteps')
    union all select value from pg_catalog.jsonb_array_elements(page_content #> '{android,installSteps}')
  loop
    perform private.welcome_assert_object(step, array['title', 'body']);
    perform private.welcome_assert_text(step -> 'title', 160, publishing);
    perform private.welcome_assert_text(step -> 'body', 2000, publishing);
  end loop;
  perform private.welcome_assert_array(page_content -> 'officers', 30);
  for officer in select value from pg_catalog.jsonb_array_elements(page_content -> 'officers') loop
    perform private.welcome_assert_object(officer, array['id', 'name', 'role', 'bio']);
    perform private.welcome_assert_text(officer -> 'id', 64);
    entry_id := officer ->> 'id';
    if entry_id !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' or entry_id = any(seen_ids)
      or entry_id in ('staff', 'download', 'account-guide') or entry_id like 'welcome-%' then
      raise exception 'Welcome item IDs must be valid and globally unique' using errcode = '22023';
    end if;
    seen_ids := pg_catalog.array_append(seen_ids, entry_id);
    perform private.welcome_assert_text(officer -> 'name', 100, publishing);
    perform private.welcome_assert_text(officer -> 'role', 100, publishing);
    perform private.welcome_assert_text(officer -> 'bio', 2000);
  end loop;
  perform private.welcome_assert_object(page_content -> 'ios', array['status', 'message', 'url']);
  perform private.welcome_assert_text(page_content #> '{ios,status}', 10);
  if page_content #>> '{ios,status}' not in ('preparing', 'testflight', 'released', 'hidden') then
    raise exception 'Invalid iOS distribution status' using errcode = '22023';
  end if;
  perform private.welcome_assert_text(page_content #> '{ios,message}', 1000);
  perform private.welcome_assert_text(page_content #> '{ios,url}', 2000);
  if (page_content #>> '{ios,url}' <> ''
      or (publishing and page_content #>> '{ios,status}' in ('testflight', 'released')))
    and not private.welcome_approved_ios_url(page_content #>> '{ios,url}') then
    raise exception 'An official Apple HTTPS distribution URL is required' using errcode = '22023';
  end if;
  -- The schema has already been checked before recursively measuring the JSON.
  if private.welcome_json_bytes(page_content) > 500000 then
    raise exception 'Welcome content exceeds 500000 UTF-8 bytes' using errcode = '22023';
  end if;
end;
$$;

create function private.save_welcome_page_draft(page_content jsonb, expected_revision bigint)
returns setof public.welcome_page_drafts
language plpgsql volatile security definer set search_path = '' as $$
declare current_revision bigint;
begin
  if (select auth.uid()) is null or not private.has_permission('welcome.manage') then
    raise exception 'Welcome management permission is required' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0 or expected_revision >= 9007199254740991 then
    raise exception 'Invalid expected welcome revision' using errcode = '22023';
  end if;
  perform private.validate_welcome_content(page_content, false);
  -- A shared advisory lock also protects creation of the initially absent row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gyungchung_welcome_page'));
  if not private.has_permission('welcome.manage') then
    raise exception 'Welcome management permission is required' using errcode = '42501';
  end if;
  select draft.revision into current_revision from public.welcome_page_drafts as draft where draft.id for update;
  if coalesce(current_revision, 0) <> expected_revision then
    raise exception 'Welcome draft changed while editing' using errcode = '40001';
  end if;
  insert into public.welcome_page_drafts (id, content, revision, updated_at, updated_by)
  values (true, page_content, expected_revision + 1, pg_catalog.clock_timestamp(), (select auth.uid()))
  on conflict (id) do update set content = excluded.content, revision = excluded.revision,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return query select draft.* from public.welcome_page_drafts as draft where draft.id;
end;
$$;
create function private.publish_welcome_page(expected_revision bigint)
returns setof public.welcome_page_publications
language plpgsql volatile security definer set search_path = '' as $$
declare draft public.welcome_page_drafts;
begin
  if (select auth.uid()) is null or not private.has_permission('welcome.manage') then
    raise exception 'Welcome management permission is required' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 1 or expected_revision > 9007199254740991 then
    raise exception 'Invalid expected welcome revision' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('gyungchung_welcome_page'));
  if not private.has_permission('welcome.manage') then
    raise exception 'Welcome management permission is required' using errcode = '42501';
  end if;
  select saved.* into draft from public.welcome_page_drafts as saved where saved.id for update;
  if not found or draft.revision <> expected_revision then
    raise exception 'Welcome draft changed before publication' using errcode = '40001';
  end if;
  perform private.validate_welcome_content(draft.content, true);
  -- Retrying a successful publish preserves its original publication timestamp.
  if draft.published_revision is distinct from draft.revision then
    insert into public.welcome_page_publications (id, content, revision, published_at)
    values (true, draft.content, draft.revision, pg_catalog.clock_timestamp())
    on conflict (id) do update set content = excluded.content, revision = excluded.revision,
      published_at = excluded.published_at;
    update public.welcome_page_drafts set published_revision = draft.revision where id;
  end if;
  return query select publication.* from public.welcome_page_publications as publication where publication.id;
end;
$$;
create function public.save_welcome_page_draft(page_content jsonb, expected_revision bigint)
returns setof public.welcome_page_drafts
language sql volatile security invoker set search_path = '' as $$
  select * from private.save_welcome_page_draft(page_content, expected_revision);
$$;
create function public.publish_welcome_page(expected_revision bigint)
returns setof public.welcome_page_publications
language sql volatile security invoker set search_path = '' as $$
  select * from private.publish_welcome_page(expected_revision);
$$;

revoke all on function private.welcome_text_length(text), private.welcome_text_present(text),
  private.welcome_assert_object(jsonb, text[]), private.welcome_assert_text(jsonb, integer, boolean),
  private.welcome_assert_array(jsonb, integer),
  private.welcome_json_bytes(jsonb), private.welcome_approved_ios_url(text),
  private.validate_welcome_content(jsonb, boolean), private.save_welcome_page_draft(jsonb, bigint),
  private.publish_welcome_page(bigint), public.save_welcome_page_draft(jsonb, bigint),
  public.publish_welcome_page(bigint) from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.save_welcome_page_draft(jsonb, bigint),
  private.publish_welcome_page(bigint), public.save_welcome_page_draft(jsonb, bigint),
  public.publish_welcome_page(bigint) to authenticated;

-- Preserve the existing transactional delegation contract and add one allowed permission.
create or replace function public.apply_officer_permission_batch(permission_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  change_count integer;
  change_record record;
  actual_enabled boolean;
  affected_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to change officer permissions';
  end if;

  if pg_catalog.jsonb_typeof(permission_changes) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'Permission changes must be a JSON array';
  end if;

  change_count := pg_catalog.jsonb_array_length(permission_changes);
  if change_count < 1 or change_count > 100 then
    raise exception using
      errcode = '22023',
      message = 'Permission batches must contain between 1 and 100 changes';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    where pg_catalog.jsonb_typeof(requested.change) is distinct from 'object'
      or requested.change ->> 'officer_title' is null
      or requested.change ->> 'officer_title' not in ('president', 'vice_president', 'treasurer')
      or requested.change ->> 'permission' is null
      or requested.change ->> 'permission' not in (
        'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
        'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage'
      )
      or pg_catalog.jsonb_typeof(requested.change -> 'enabled') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(requested.change -> 'expected_enabled') is distinct from 'boolean'
      or (
        pg_catalog.jsonb_typeof(requested.change -> 'enabled') = 'boolean'
        and pg_catalog.jsonb_typeof(requested.change -> 'expected_enabled') = 'boolean'
        and (requested.change ->> 'enabled')::boolean
          is not distinct from (requested.change ->> 'expected_enabled')::boolean
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Permission batch contains an invalid change';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    group by requested.change ->> 'officer_title', requested.change ->> 'permission'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'Permission batch contains duplicate changes';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    where not private.can_manage_officer_permission(
      (requested.change ->> 'officer_title')::public.officer_title
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Officer permission management access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('gyungchung_officer_permission_batch')
  );

  for change_record in
    select
      (requested.change ->> 'officer_title')::public.officer_title as officer_title,
      requested.change ->> 'permission' as permission,
      (requested.change ->> 'enabled')::boolean as enabled,
      (requested.change ->> 'expected_enabled')::boolean as expected_enabled
    from pg_catalog.jsonb_array_elements(permission_changes) as requested(change)
    order by requested.change ->> 'officer_title', requested.change ->> 'permission'
  loop
    select exists (
      select 1
      from public.officer_permissions as officer_permission
      where officer_permission.officer_title = change_record.officer_title
        and officer_permission.permission = change_record.permission
    )
    into actual_enabled;

    if actual_enabled is distinct from change_record.expected_enabled then
      raise exception using
        errcode = '40001',
        message = 'Officer permissions changed while this batch was pending';
    end if;

    if change_record.enabled then
      insert into public.officer_permissions (officer_title, permission)
      values (change_record.officer_title, change_record.permission);
    else
      delete from public.officer_permissions as officer_permission
      where officer_permission.officer_title = change_record.officer_title
        and officer_permission.permission = change_record.permission;
    end if;

    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = '40001',
        message = 'Officer permissions changed while this batch was being applied';
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'applied_count', change_count
  );
end;
$$;

revoke all on function public.apply_officer_permission_batch(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.apply_officer_permission_batch(jsonb)
to authenticated;
