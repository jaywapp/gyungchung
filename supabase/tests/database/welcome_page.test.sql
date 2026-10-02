begin;
select no_plan();

-- These identities exist only inside this rolled-back test transaction.
insert into public.profiles (id, name, phone, role, officer_title, fee_plan, status, is_system_admin)
values
  ('89810000-0000-0000-0000-000000000001', 'Welcome President', '010-8980-0001', 'manager', 'president', 'monthly', 'active', false),
  ('89810000-0000-0000-0000-000000000002', 'Welcome Member', '010-8980-0002', 'member', null, 'monthly', 'active', false),
  ('89810000-0000-0000-0000-000000000003', 'Welcome Delegate', '010-8980-0003', 'manager', 'vice_president', 'monthly', 'active', false),
  ('89810000-0000-0000-0000-000000000004', 'Welcome Inactive', '010-8980-0004', 'manager', 'president', 'monthly', 'inactive', false),
  ('89810000-0000-0000-0000-000000000005', 'Welcome Unlinked', '010-8980-0005', 'manager', 'president', 'monthly', 'active', false),
  ('89810000-0000-0000-0000-000000000006', 'Welcome Admin', '010-8980-0006', 'member', null, 'monthly', 'active', true),
  ('89810000-0000-0000-0000-000000000007', 'Welcome Pending', '010-8980-0007', 'manager', 'president', 'monthly', 'pending', false);
insert into auth.users (id, instance_id, aud, role, phone, raw_app_meta_data, raw_user_meta_data)
select ('89800000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '+82108980000' || n::text, '{}'::jsonb,
  jsonb_build_object('member_id', '89810000-0000-0000-0000-' || lpad(n::text, 12, '0'))
from generate_series(1, 7) as fixture(n);
update public.profiles set auth_user_id = null where id = '89810000-0000-0000-0000-000000000005';

-- Isolation is essential for the singleton and its expected_revision=0 case.
delete from public.welcome_page_publications;
delete from public.welcome_page_drafts;
create function pg_temp.welcome_content() returns jsonb language sql immutable as $$
  select '{"schemaVersion":1,"title":"Welcome","introduction":"Club introduction","accountSteps":[{"title":"Account","body":"Contact the club"}],"officers":[{"id":"officer1","name":"Public Name","role":"Public Role","bio":"Public biography"}],"android":{"enabled":true,"installSteps":[{"title":"Install","body":"Open the APK"}]},"ios":{"status":"preparing","message":"Coming soon","url":""}}'::jsonb;
$$;
create temporary table welcome_invalid_payloads (label text, content jsonb);
insert into welcome_invalid_payloads values
  ('SQL NULL', null),
  ('JSON null', 'null'::jsonb),
  ('scalar root', '1'::jsonb),
  ('missing required key', pg_temp.welcome_content() - 'title'),
  ('private root field', pg_temp.welcome_content() || '{"privateNotes":"hidden"}'::jsonb),
  ('obsolete rules field', pg_temp.welcome_content() || '{"rules":{}}'::jsonb),
  ('private nested member ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,memberId}', '"private-member"')),
  ('unknown Android version field', jsonb_set(pg_temp.welcome_content(), '{android,versionCode}', '99')),
  ('unknown step field', jsonb_set(pg_temp.welcome_content(), '{accountSteps,0,phone}', '"private-phone"')),
  ('string schema version', jsonb_set(pg_temp.welcome_content(), '{schemaVersion}', '"1"')),
  ('wrong title type', jsonb_set(pg_temp.welcome_content(), '{title}', 'false')),
  ('wrong visibility type', jsonb_set(pg_temp.welcome_content(), '{android,enabled}', '"true"')),
  ('wrong steps type', jsonb_set(pg_temp.welcome_content(), '{accountSteps}', '{}')),
  ('wrong officer collection type', jsonb_set(pg_temp.welcome_content(), '{officers}', '{}')),
  ('wrong officer type', jsonb_set(pg_temp.welcome_content(), '{officers,0}', '"person"')),
  ('invalid ID syntax', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', '"1-invalid"')),
  ('duplicate officer ID', jsonb_set(pg_temp.welcome_content(), '{officers}', (pg_temp.welcome_content() -> 'officers') || (pg_temp.welcome_content() -> 'officers'))),
  ('line break in officer ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', to_jsonb('officer1' || chr(10)))),
  ('reserved account guide ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', '"account-guide"')),
  ('reserved staff ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', '"staff"')),
  ('reserved download ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', '"download"')),
  ('reserved welcome prefix', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', '"welcome-main"')),
  ('overlong ID', jsonb_set(pg_temp.welcome_content(), '{officers,0,id}', to_jsonb(repeat('x',65)))),
  ('overlong title', jsonb_set(pg_temp.welcome_content(), '{title}', to_jsonb(repeat('x',161)))),
  ('UTF-16 title boundary', jsonb_set(pg_temp.welcome_content(), '{title}', to_jsonb(repeat(chr(128512),81)))),
  ('overlong introduction', jsonb_set(pg_temp.welcome_content(), '{introduction}', to_jsonb(repeat('x',1001)))),
  ('overlong step title', jsonb_set(pg_temp.welcome_content(), '{accountSteps,0,title}', to_jsonb(repeat('x',161)))),
  ('overlong step body', jsonb_set(pg_temp.welcome_content(), '{android,installSteps,0,body}', to_jsonb(repeat('x',2001)))),
  ('overlong public name', jsonb_set(pg_temp.welcome_content(), '{officers,0,name}', to_jsonb(repeat('x',101)))),
  ('overlong public role', jsonb_set(pg_temp.welcome_content(), '{officers,0,role}', to_jsonb(repeat('x',101)))),
  ('overlong biography', jsonb_set(pg_temp.welcome_content(), '{officers,0,bio}', to_jsonb(repeat('x',2001)))),
  ('unsupported iOS state', jsonb_set(pg_temp.welcome_content(), '{ios,status}', '"unknown"')),
  ('overlong iOS message', jsonb_set(pg_temp.welcome_content(), '{ios,message}', to_jsonb(repeat('x',1001)))),
  ('overlong iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', to_jsonb('https://apps.apple.com/' || repeat('x',2001)))),
  ('HTTP iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"http://apps.apple.com/app/id123"')),
  ('lookalike Apple host', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://apps.apple.com.evil.test/app/id123"')),
  ('credentials in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://user:pass@apps.apple.com/app/id123"')),
  ('port in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://apps.apple.com:443/app/id123"')),
  ('missing iOS path', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://testflight.apple.com/"')),
  ('backslash in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', to_jsonb(E'https://apps.apple.com/\\evil'::text))),
  ('whitespace in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://apps.apple.com/app/id 123"')),
  ('control in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', to_jsonb(E'https://apps.apple.com/app/id\t123'::text))),
  ('final line break in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', to_jsonb('https://apps.apple.com/app/id123' || chr(10)))),
  ('raw Unicode in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', to_jsonb('https://apps.apple.com/app/' || chr(44032)))),
  ('non URI punctuation in iOS URL', jsonb_set(pg_temp.welcome_content(), '{ios,url}', '"https://apps.apple.com/app/<id123>"'));
insert into welcome_invalid_payloads
select 'too many account steps', jsonb_set(pg_temp.welcome_content(), '{accountSteps}', jsonb_agg(jsonb_build_object('title','','body','')))
from generate_series(1,11);
insert into welcome_invalid_payloads
select 'too many install steps', jsonb_set(pg_temp.welcome_content(), '{android,installSteps}', jsonb_agg(jsonb_build_object('title','','body','')))
from generate_series(1,11);
insert into welcome_invalid_payloads
select 'too many officers', jsonb_set(pg_temp.welcome_content(), '{officers}', jsonb_agg(jsonb_build_object('id','o'||n::text,'name','','role','','bio','')))
from generate_series(1,31) as series(n);
-- Escaped control text can exceed the total byte limit without exceeding any
-- per-field text length or collection count limit.
insert into welcome_invalid_payloads
select 'oversized total JSON', jsonb_set(jsonb_set(jsonb_set(pg_temp.welcome_content(), '{officers}',
  (select jsonb_agg(jsonb_build_object('id','o'||n::text,'name','Name','role','Role','bio',repeat(chr(1),2000))) from generate_series(1,30) as series(n))),
  '{accountSteps}', (select jsonb_agg(jsonb_build_object('title','Step','body',repeat(chr(1),2000))) from generate_series(1,10))),
  '{android,installSteps}', (select jsonb_agg(jsonb_build_object('title','Step','body',repeat(chr(1),2000))) from generate_series(1,10)));
insert into welcome_invalid_payloads
select 'UTF8 byte limit with multibyte text', jsonb_set(jsonb_set(jsonb_set(pg_temp.welcome_content(), '{officers}',
  (select jsonb_agg(jsonb_build_object('id','o'||n::text,'name',repeat(chr(44032),100),'role',repeat(chr(44032),100),'bio',repeat(chr(1),2000))) from generate_series(1,30) as series(n))),
  '{accountSteps}', (select jsonb_agg(jsonb_build_object('title',repeat(chr(44032),160),'body',repeat(chr(44032),2000))) from generate_series(1,10))),
  '{android,installSteps}', (select jsonb_agg(jsonb_build_object('title',repeat(chr(44032),160),'body',repeat(chr(44032),2000))) from generate_series(1,10)));
grant select on welcome_invalid_payloads to authenticated;

create function pg_temp.welcome_try_publish(content jsonb, expected_revision bigint) returns void language plpgsql as $$
begin
  perform public.save_welcome_page_draft(content, expected_revision);
  perform public.publish_welcome_page(expected_revision + 1);
end;
$$;
create temporary table welcome_incomplete_publications (label text, content jsonb);
insert into welcome_incomplete_publications values
  ('blank introduction', jsonb_set(pg_temp.welcome_content(), '{introduction}', '" "')),
  ('blank account step title', jsonb_set(pg_temp.welcome_content(), '{accountSteps,0,title}', '""')),
  ('blank installation body', jsonb_set(pg_temp.welcome_content(), '{android,installSteps,0,body}', '""')),
  ('Unicode whitespace step body', jsonb_set(pg_temp.welcome_content(), '{accountSteps,0,body}', to_jsonb(chr(65279) || chr(160)))),
  ('blank public officer name', jsonb_set(pg_temp.welcome_content(), '{officers,0,name}', '""')),
  ('blank public officer role', jsonb_set(pg_temp.welcome_content(), '{officers,0,role}', '""')),
  ('active TestFlight without URL', jsonb_set(pg_temp.welcome_content(), '{ios,status}', '"testflight"')),
  ('released App Store without URL', jsonb_set(pg_temp.welcome_content(), '{ios,status}', '"released"'));
grant select on welcome_incomplete_publications to authenticated;

select ok(not exists (select 1 from public.welcome_page_publications), 'migration does not publish example content');
select ok(not exists (select 1 from public.welcome_page_drafts), 'migration does not seed an example draft');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema='public' and table_name='welcome_page_publications'),
  array['id','content','revision','published_at'], 'publication exposes only public fields');
select ok(exists (select 1 from public.officer_permissions where officer_title='president' and permission='welcome.manage')
  and not exists (select 1 from public.officer_permissions where officer_title <> 'president' and permission='welcome.manage'),
  'only the president starts with the welcome officer permission');
select ok(exists (select 1 from public.role_permissions where role='admin' and permission='welcome.manage'),
  'system admin catalog contains welcome permission');
select ok(not has_table_privilege('anon','public.welcome_page_drafts','SELECT'), 'anon cannot select drafts');
select ok(not has_table_privilege('authenticated','public.welcome_page_drafts','INSERT,UPDATE,DELETE'), 'authenticated has no draft write grants');
select ok(not has_table_privilege('authenticated','public.welcome_page_publications','INSERT,UPDATE,DELETE'), 'authenticated has no publication write grants');
select ok(not has_table_privilege('anon','public.welcome_page_publications','INSERT,UPDATE,DELETE'), 'anon has no publication write grants');
select ok(not has_function_privilege('anon','public.save_welcome_page_draft(jsonb,bigint)','EXECUTE'), 'anon cannot invoke save');
select ok(not has_function_privilege('anon','public.publish_welcome_page(bigint)','EXECUTE'), 'anon cannot invoke publish');
select ok(not (select prosecdef from pg_proc where oid='public.save_welcome_page_draft(jsonb,bigint)'::regprocedure), 'public save wrapper runs as invoker');
select ok(not (select prosecdef from pg_proc where oid='public.publish_welcome_page(bigint)'::regprocedure), 'public publish wrapper runs as invoker');
select ok(not has_function_privilege('authenticated','private.validate_welcome_content(jsonb,boolean)','EXECUTE'), 'validators are not exposed as RPC capabilities');

select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select revision from public.save_welcome_page_draft(pg_temp.welcome_content(),0)),1::bigint, 'president creates singleton draft');
select is((select updated_by from public.welcome_page_drafts),'89800000-0000-0000-0000-000000000001'::uuid, 'save audits the authenticated identity');
select is((select count(*) from public.welcome_page_publications),0::bigint, 'saving never creates a publication');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),0)','40001',null,'a second creator cannot overwrite the first draft');
select throws_ok(format('select * from public.save_welcome_page_draft(%L::jsonb,1)',content),'22023',null,label || ' is rejected')
from welcome_invalid_payloads order by label;
select is((select revision from public.welcome_page_drafts),1::bigint, 'invalid saves leave revision unchanged');
select throws_ok(format('select pg_temp.welcome_try_publish(%L::jsonb,1)',content),'22023',null,label || ' cannot publish')
from welcome_incomplete_publications order by label;
select is((select revision from public.welcome_page_drafts),1::bigint, 'failed compound save and publish roll back the save');
select is((select count(*) from public.welcome_page_publications),0::bigint, 'failed compound publication leaves no public row');
-- Positive boundary cases must also survive server validation. Each successful
-- save is rolled back so they do not disturb the main revision sequence.
create function pg_temp.welcome_validate_save(content jsonb, expected_revision bigint) returns void language plpgsql as $$
begin
  begin
    perform public.save_welcome_page_draft(content, expected_revision);
    raise exception 'Rollback valid save fixture' using errcode = 'P0002';
  exception when no_data_found then null;
  end;
end;
$$;
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{title}',to_jsonb(repeat(chr(128512),80))),1)$sql$,'UTF-16 title exactly 160 units is accepted');
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{ios,url}','"https://testflight.apple.com/join/ABC123"'),1)$sql$,'official TestFlight distribution URL is accepted');
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{ios,url}','"https://apps.apple.com/kr/app/id123456"'),1)$sql$,'official App Store distribution URL is accepted');
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{ios,url}','"https://apps.apple.com/app/../id123"'),1)$sql$,'official ASCII iOS paths permit dot segments under the shared URI contract');
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{ios,url}','"https://apps.apple.com/app/id123?campaign=club#download"'),1)$sql$,'official ASCII iOS query and fragment are accepted');
select lives_ok($sql$select pg_temp.welcome_validate_save(jsonb_set(pg_temp.welcome_content(),'{ios,url}','"https://apps.apple.com/app/%EA%B0%80"'),1)$sql$,'percent encoded Unicode path is accepted');
select is((select revision from public.welcome_page_drafts),1::bigint,'positive validation fixtures preserve the draft revision');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),null)','22023',null,'null expected revision is rejected');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),-1)','22023',null,'negative expected revision is rejected');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),9007199254740991)','22023',null,'revision cannot overflow JavaScript safe integers');
select throws_ok('select * from public.publish_welcome_page(0)','22023',null,'publication requires a positive expected revision');
select lives_ok($sql$select * from public.save_welcome_page_draft(jsonb_set(pg_temp.welcome_content(),'{title}','""'),1)$sql$, 'incomplete text may be saved as a draft');
select throws_ok('select * from public.publish_welcome_page(2)','22023',null,'incomplete draft cannot publish');
select is((select count(*) from public.welcome_page_publications),0::bigint, 'failed initial publication remains absent');
select is((select published_revision from public.welcome_page_drafts),null::bigint, 'failed publication does not mark draft published');
select lives_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),2)', 'complete content saves');
select is((select revision from public.publish_welcome_page(3)),3::bigint, 'publish returns the saved revision');
select is((select published_revision from public.welcome_page_drafts),3::bigint, 'publish atomically marks the draft');
select is((select content from public.welcome_page_publications),pg_temp.welcome_content(), 'publication contains only the saved public JSON');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),2)','40001',null,'stale save fails');
select throws_ok('select * from public.publish_welcome_page(2)','40001',null,'stale publish fails');
select is((select revision from public.welcome_page_publications),3::bigint,'conflicts preserve the published revision');
reset role;
create temporary table welcome_published_timestamp as select published_at from public.welcome_page_publications;
grant select on welcome_published_timestamp to authenticated;
set local role authenticated;
select lives_ok('select * from public.publish_welcome_page(3)','retrying a publish is idempotent');
select is((select published_at from public.welcome_page_publications),(select published_at from welcome_published_timestamp),'publish retry preserves publication time');
select lives_ok($sql$select * from public.save_welcome_page_draft(jsonb_set(pg_temp.welcome_content(),'{title}','"Changed draft"'),3)$sql$,'saved edits remain unpublished');
select is((select content ->> 'title' from public.welcome_page_publications),'Welcome','saved edits do not change published content');
select lives_ok('select * from public.publish_welcome_page(4)','new revision publishes');
select is((select content ->> 'title' from public.welcome_page_publications),'Changed draft','publishing updates public content');
select lives_ok($sql$select * from public.save_welcome_page_draft(jsonb_set(pg_temp.welcome_content(),'{officers,0,name}','""'),4)$sql$,'empty officer name is allowed in a draft');
select throws_ok('select * from public.publish_welcome_page(5)','22023',null,'entered officer requires a name at publication');
select is((select revision from public.welcome_page_publications),4::bigint,'failed publication preserves previous content');
select is((select published_revision from public.welcome_page_drafts),4::bigint,'failed publication preserves previous publication marker');
select throws_ok('insert into public.welcome_page_drafts(id,content,revision) values(true,pg_temp.welcome_content(),99)','42501',null,'president cannot bypass save RPC');
select throws_ok('update public.welcome_page_publications set content=pg_temp.welcome_content()','42501',null,'president cannot bypass publish RPC');
select throws_ok('delete from public.welcome_page_drafts','42501',null,'president cannot delete draft directly');

-- Public reads remain available independently of membership and login state.
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((select revision from public.welcome_page_publications),4::bigint,'anon can read the publication');
select throws_ok('select * from public.welcome_page_drafts','42501',null,'anon cannot read draft');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','42501',null,'anon save is denied');
select throws_ok('select * from public.publish_welcome_page(5)','42501',null,'anon publish is denied');
select throws_ok('delete from public.welcome_page_publications','42501',null,'anon cannot delete publication');
set local role authenticated;
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000002',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'ordinary member cannot read draft');
select is((select revision from public.welcome_page_publications),4::bigint,'ordinary member can read publication');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','42501',null,'ordinary member save denied');
select throws_ok('select * from public.publish_welcome_page(5)','42501',null,'ordinary member publish denied');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'officer without delegation cannot read draft');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','42501',null,'officer without delegation save denied');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000004',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'inactive officer cannot read draft');
select is((select revision from public.welcome_page_publications),4::bigint,'inactive officer can read publication');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','42501',null,'inactive officer save denied');
select throws_ok('select * from public.publish_welcome_page(5)','42501',null,'inactive officer publish denied');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000005',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'unlinked identity cannot read draft');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','42501',null,'unlinked identity save denied');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000007',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'pending officer cannot read draft');
select throws_ok('select * from public.publish_welcome_page(5)','42501',null,'pending officer publish denied');

-- The existing batch RPC can delegate and revoke the new permission.
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000001',true);
select lives_ok($sql$select public.apply_officer_permission_batch('[{"officer_title":"vice_president","permission":"welcome.manage","enabled":true,"expected_enabled":false}]')$sql$,'president delegates welcome permission');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.welcome_page_drafts),1::bigint,'delegated officer can read draft');
select lives_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),5)','delegated officer saves');
select lives_ok('select * from public.publish_welcome_page(6)','delegated officer publishes');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000001',true);
select lives_ok($sql$select public.apply_officer_permission_batch('[{"officer_title":"vice_president","permission":"welcome.manage","enabled":false,"expected_enabled":true}]')$sql$,'president revokes welcome permission');
select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000003',true);
select is((select count(*) from public.welcome_page_drafts),0::bigint,'revocation immediately removes draft visibility');
select throws_ok('select * from public.save_welcome_page_draft(pg_temp.welcome_content(),6)','42501',null,'revoked officer save denied');
select throws_ok('select * from public.publish_welcome_page(6)','42501',null,'revoked officer publish denied');

select set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000006',true);
select is((select count(*) from public.welcome_page_drafts),1::bigint,'active system admin can read draft');
select lives_ok($sql$select * from public.save_welcome_page_draft(jsonb_set(pg_temp.welcome_content(),'{officers}','[]'),6)$sql$,'zero officers can be saved');
select lives_ok('select * from public.publish_welcome_page(7)','preparation state can publish without example people');
select is((select count(*) from public.welcome_page_publications),1::bigint,'publication remains a singleton');
reset role;
select is((select role::text || ':' || officer_title::text from public.profiles where id='89810000-0000-0000-0000-000000000001'),
  'manager:president','public introduction editing never changes account roles');
select throws_ok('insert into public.welcome_page_drafts(id,content,revision) values(false,pg_temp.welcome_content(),1)','23514',null,'singleton ID must be true');
select throws_ok('insert into public.role_permissions(role,permission) values(''member'',''welcome.manage'')','P0001',null,'fixed role catalog trigger remains enabled');

select * from finish();
rollback;
