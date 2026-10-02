-- Extend the existing publication contract without modifying any saved content.
create or replace function private.validate_welcome_content(page_content jsonb, publishing boolean default false)
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
  if page_content #>> '{ios,status}' not in ('pwa', 'preparing', 'testflight', 'released', 'hidden') then
    raise exception 'Invalid iOS distribution status' using errcode = '22023';
  end if;
  perform private.welcome_assert_text(page_content #> '{ios,message}', 1000);
  perform private.welcome_assert_text(page_content #> '{ios,url}', 2000);
  if page_content #>> '{ios,status}' = 'pwa' and page_content #>> '{ios,url}' <> '' then
    raise exception 'Home screen apps must not specify a distribution URL' using errcode = '22023';
  end if;
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
