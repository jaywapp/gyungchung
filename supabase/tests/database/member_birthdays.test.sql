begin;
select no_plan();

-- Synthetic members only. Each test transaction rolls back all fixture data.
insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data)
select ('87000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb
from generate_series(1, 10) as number;

insert into public.profiles (
  id, auth_user_id, name, phone, role, fee_plan, status,
  must_change_password, is_test_account, is_system_admin
)
select ('87010000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 8 then null
    else ('87000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid end,
  'Birthday Fixture ' || number, '010-8700-' || lpad(number::text, 4, '0'),
  'member'::public.account_role, 'monthly'::public.member_fee_plan,
  case when number = 3 then 'inactive'::public.member_status
    when number = 6 then 'pending'::public.member_status
    else 'active'::public.member_status end,
  number = 4, number = 5, number = 10
from generate_series(1, 10) as number where number <> 9;

insert into private.member_birthdays (profile_id, birthday_month, birthday_day, revision)
select ('87010000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid, 2, 29, 1
from unnest(array[2,3,4,5,6,8]) as number;

select ok((select relrowsecurity from pg_class where oid = 'private.member_birthdays'::regclass),
  'birthday table has RLS');
select is((select count(*) from pg_policies where schemaname = 'private' and tablename = 'member_birthdays'),
  0::bigint, 'birthday table has default-deny client policies');
select ok(not has_table_privilege('anon', 'private.member_birthdays', 'select,insert,update,delete'),
  'anon has no direct birthday table privileges');
select ok(not has_table_privilege('authenticated', 'private.member_birthdays', 'select,insert,update,delete'),
  'authenticated has no direct birthday table privileges');
select ok(not has_table_privilege('service_role', 'private.member_birthdays', 'select,insert,update,delete'),
  'service role does not receive birthday table grants');
select ok(not has_function_privilege('anon', 'public.set_my_birthday(integer,integer,bigint)', 'execute'),
  'anon cannot execute birthday setter');
select ok(not has_function_privilege('anon', 'private.set_my_birthday(integer,integer,bigint)', 'execute'),
  'anon cannot execute guarded helper');
select ok(has_function_privilege('authenticated', 'public.set_my_birthday(integer,integer,bigint)', 'execute'),
  'authenticated can call the guarded birthday operation');
select ok(not has_function_privilege('service_role', 'public.set_my_birthday(integer,integer,bigint)', 'execute'),
  'service role has no birthday setter grant');
select ok(not has_function_privilege('anon', 'public.get_member_directory()', 'execute'),
  'directory remains unavailable to anon');
select ok(has_function_privilege('service_role', 'public.get_member_directory()', 'execute'),
  'existing service role directory ACL is preserved');

select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is((select birthday_revision from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000001'), 0::bigint,
  'unregistered own birthday starts at revision zero');
select is((select birthday_month from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000002'), 2::smallint,
  'eligible members see another eligible birthday');
select is((select birthday_revision from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000002'), null::bigint,
  'another member revision is private');
select is((select fee_plan from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000001'), 'monthly'::public.member_fee_plan,
  'directory still returns own fee plan');
select is((select fee_plan from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000002'), null::public.member_fee_plan,
  'directory still hides another fee plan');
select is((select count(*) from public.get_member_directory()
  where id in ('87010000-0000-0000-0000-000000000003', '87010000-0000-0000-0000-000000000005',
    '87010000-0000-0000-0000-000000000006')), 0::bigint,
  'inactive hidden and pending targets remain absent');
select is((select birthday_month from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000004'), null::smallint,
  'initial-password target birthday stays hidden');
select is((select birthday_month from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000008'), null::smallint,
  'unlinked target birthday stays hidden');

select results_eq('select * from public.set_my_birthday(2,29,0)',
  'values (2::smallint,29::smallint,1::bigint)', 'register a leap-day birthday without a year');
select throws_ok('select * from public.set_my_birthday(1,1,0)', '40001', null,
  'stale first registration cannot overwrite current data');
select results_eq('select * from public.set_my_birthday(12,31,1)',
  'values (12::smallint,31::smallint,2::bigint)', 'edit uses the current revision');
select results_eq('select * from public.set_my_birthday(null,null,2)',
  'values (null::smallint,null::smallint,3::bigint)', 'clear removes date and increments revision');
select is((select birthday_revision from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000001'), 3::bigint,
  'cleared revision remains available to its owner');
select throws_ok('select * from public.set_my_birthday(2,29,0)', '40001', null,
  'clear tombstone prevents an obsolete unregistered tab from restoring data');
select results_eq('select * from private.set_my_birthday(2,29,3)',
  'values (2::smallint,29::smallint,4::bigint)', 'private helper applies the same guarded save');
select throws_ok('select * from public.set_my_birthday(null,null,1)', '40001', null,
  'same birthday after ABA does not permit a stale clear');
select throws_ok('select * from public.set_my_birthday(2,30,4)', '22023', null,
  'February 30 is invalid');
select throws_ok('select * from public.set_my_birthday(4,31,4)', '22023', null,
  'April 31 is invalid');
select throws_ok('select * from public.set_my_birthday(13,1,4)', '22023', null,
  'month outside range is invalid');
select throws_ok('select * from public.set_my_birthday(1,0,4)', '22023', null,
  'day outside range is invalid');
select throws_ok('select * from public.set_my_birthday(null,1,4)', '22023', null,
  'partially null date is invalid');
select throws_ok('select * from public.set_my_birthday(1,null,4)', '22023', null,
  'partially null date in reverse is invalid');
select throws_ok('select * from public.set_my_birthday(1,1,null)', '22023', null,
  'missing expected revision is invalid');
select throws_ok('select * from public.set_my_birthday(1,1,-1)', '22023', null,
  'negative expected revision is invalid');
select throws_ok('select * from private.member_birthdays', '42501', null,
  'clients cannot bypass the birthday projection');
select throws_ok($$update private.member_birthdays set birthday_day=1
  where profile_id='87010000-0000-0000-0000-000000000002'$$, '42501', null,
  'clients cannot directly update another member birthday');

select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.get_member_directory()
  where id = '87010000-0000-0000-0000-000000000001'), 1::bigint,
  'inactive caller retains established roster read contract');
select is((select count(*) from public.get_member_directory()
  where birthday_month is not null or birthday_day is not null or birthday_revision is not null), 0::bigint,
  'inactive caller sees no birthdays');
select throws_ok('select * from public.set_my_birthday(1,1,1)', '42501', null,
  'inactive caller cannot save birthday');

select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000004', true);
select is((select count(*) from public.get_member_directory()
  where birthday_month is not null or birthday_revision is not null), 0::bigint,
  'initial-password caller sees no birthdays');
select throws_ok('select * from public.set_my_birthday(null,null,1)', '42501', null,
  'initial-password caller cannot clear birthday');

select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000005', true);
select is((select count(*) from public.get_member_directory()
  where birthday_month is not null or birthday_revision is not null), 0::bigint,
  'hidden caller sees no birthdays');
select throws_ok('select * from private.set_my_birthday(1,1,1)', '42501', null,
  'hidden caller cannot bypass wrapper to save');

select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000006', true);
select throws_ok('select * from public.set_my_birthday(1,1,1)', '42501', null,
  'pending caller cannot save');
select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000009', true);
select is((select count(*) from public.get_member_directory()), 0::bigint,
  'unlinked identity sees no roster');
select throws_ok('select * from public.set_my_birthday(1,1,0)', '42501', null,
  'unlinked identity cannot save');
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select throws_ok('select * from private.set_my_birthday(1,1,0)', '42501', null,
  'missing identity does not authorize a definer helper');

select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000010', true);
select results_eq('select * from public.set_my_birthday(10,5,0)',
  'values (10::smallint,5::smallint,1::bigint)', 'system administrator can edit their own birthday');
select throws_ok($$delete from private.member_birthdays
  where profile_id='87010000-0000-0000-0000-000000000002'$$, '42501', null,
  'system administrator has no direct birthday deletion privilege');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
update public.profiles set must_change_password = true
where id = '87010000-0000-0000-0000-000000000001';
select pg_catalog.set_config('request.jwt.claim.sub', '87000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok('select * from public.set_my_birthday(1,1,4)', '42501', null,
  'eligibility is rechecked after an account transition');
select is((select count(*) from public.get_member_directory()
  where birthday_month is not null or birthday_revision is not null), 0::bigint,
  'account transition removes birthday read access without refreshing JWT claims');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok('select * from public.set_my_birthday(1,1,0)', '42501', null,
  'anonymous birthday RPC is denied');
select throws_ok('select * from public.get_member_directory()', '42501', null,
  'anonymous directory RPC remains denied');

reset role;
select * from finish();
rollback;
