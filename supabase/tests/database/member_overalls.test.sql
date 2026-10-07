begin;
select no_plan();

-- Dedicated synthetic users only. These assertions roll back all writes.
insert into auth.users(id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data)
select ('89000000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb,'{}'::jsonb
from generate_series(1,12) as number;
insert into public.profiles(id,auth_user_id,name,phone,role,officer_title,fee_plan,status,
  must_change_password,is_test_account,is_system_admin)
select ('89010000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  case when number=12 then null else ('89000000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid end,
  'Overall Test ' || number,'+82108900' || lpad(number::text,4,'0'),
  case when number in (1,2,3,6,7,8,9) then 'manager'::public.account_role else 'member'::public.account_role end,
  case when number=1 then 'president'::public.officer_title
    when number=3 then 'treasurer'::public.officer_title
    when number in (2,6,7,8,9) then 'vice_president'::public.officer_title else null end,
  case when number in (1,2,3,6,7,8,9) then null else 'monthly'::public.member_fee_plan end,
  case when number=6 then 'inactive'::public.member_status
    when number=7 then 'pending'::public.member_status else 'active'::public.member_status end,
  number=8,number in (9,11),number=4
from generate_series(1,12) as number;

-- Tests do not depend on service exclusions in the deployment under test.
insert into public.officer_permissions(officer_title,permission)
values ('president','ratings.manage'),('vice_president','ratings.manage'),('treasurer','ratings.manage')
on conflict do nothing;

select ok((select relrowsecurity from pg_class where oid='private.member_overalls'::regclass),
  'overall table enables RLS');
select is((select count(*) from pg_policies where schemaname='private' and tablename='member_overalls'),0::bigint,
  'overall table default denies all direct access');
select is((select pg_get_constraintdef(oid) from pg_constraint
  where conrelid='private.member_overalls'::regclass and conname='member_overalls_' || axis || '_check'),
  'CHECK (((' || axis || ' >= 0) AND (' || axis || ' <= 100)))',axis || ' table check accepts zero')
from unnest(array['pace','shooting','passing','dribbling','defending','physical']) as axis;
select ok(not has_table_privilege(role_name,'private.member_overalls','select,insert,update,delete'),
  role_name || ' has no direct table privilege')
from unnest(array['anon','authenticated','service_role']) as role_name;
select ok(has_function_privilege('authenticated',signature,'execute'),signature || ' is callable by authenticated')
from unnest(array['public.get_member_overalls(uuid[])','public.set_member_overall(uuid,jsonb,bigint)',
  'private.get_member_overalls(uuid[])','private.set_member_overall(uuid,jsonb,bigint)']) as signature;
select ok(not has_function_privilege(role_name,signature,'execute'),role_name || ' cannot call ' || signature)
from unnest(array['anon','service_role']) as role_name
cross join unnest(array['public.get_member_overalls(uuid[])','public.set_member_overall(uuid,jsonb,bigint)',
  'private.get_member_overalls(uuid[])','private.set_member_overall(uuid,jsonb,bigint)']) as signature;
select is((select prosecdef from pg_proc where oid='public.set_member_overall(uuid,jsonb,bigint)'::regprocedure),false,
  'public write wrapper is invoker');
select is((select prosecdef from pg_proc where oid='private.set_member_overall(uuid,jsonb,bigint)'::regprocedure),true,
  'private write helper supplies guarded definer boundary');
select is((select proconfig from pg_proc where oid=signature::regprocedure),array['search_path=""'],
  signature || ' fixes the search path')
from unnest(array['public.get_member_overalls(uuid[])','public.set_member_overall(uuid,jsonb,bigint)',
  'private.get_member_overalls(uuid[])','private.set_member_overall(uuid,jsonb,bigint)']) as signature;

select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000005',true);
set local role authenticated;
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,
  'ordinary member is denied even with an empty request');
select throws_ok($$select * from private.get_member_overalls(array['89010000-0000-0000-0000-000000000005']::uuid[])$$,
  '42501',null,'ordinary member cannot bypass public wrapper');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":50,"shooting":50,"passing":50,"dribbling":50,"defending":50,"physical":50}',0)$$,
  '42501',null,'ordinary member cannot assign own scores');
select throws_ok('select * from private.member_overalls','42501',null,'ordinary direct table read denied');
select throws_ok('update private.member_overalls set pace=100','42501',null,'ordinary direct table write denied');

select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000001',true);
select is((select count(*) from public.get_member_overalls(array[]::uuid[])),0::bigint,'empty authorized request returns no rows');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.set_member_overall(
  '89010000-0000-0000-0000-000000000005','{"pace":1,"shooting":100,"passing":40,"dribbling":60,"defending":80,"physical":90}',0)$$,
  'values (1::smallint,100::smallint,40::smallint,60::smallint,80::smallint,90::smallint,1::bigint)',
  'first save preserves six scores and returns revision one');
select is((select count(*) from public.get_member_overalls(array['89010000-0000-0000-0000-000000000005',
  '89010000-0000-0000-0000-000000000005','89010000-0000-0000-0000-000000000012']::uuid[])),1::bigint,
  'read deduplicates ids and leaves unrated member absent');
select results_eq($$select pace,revision from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":70,"shooting":70,"passing":70,"dribbling":70,"defending":70,"physical":70}',1)$$,
  'values (70::smallint,2::bigint)','matching revision updates scores');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":90,"shooting":90,"passing":90,"dribbling":90,"defending":90,"physical":90}',1)$$,
  '40001',null,'stale revision cannot overwrite');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":90,"shooting":90,"passing":90,"dribbling":90,"defending":90,"physical":90}',0)$$,
  '40001',null,'expected zero cannot overwrite');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000012',
  '{"pace":90,"shooting":90,"passing":90,"dribbling":90,"defending":90,"physical":90}',1)$$,
  '40001',null,'missing row requires expected zero');
select is((select revision from public.set_member_overall('89010000-0000-0000-0000-000000000012',
  '{"pace":0,"shooting":0,"passing":0,"dribbling":0,"defending":0,"physical":0}',0)),1::bigint,
  'unprovisioned active target can be rated with all-zero scores');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.get_member_overalls(
  array['89010000-0000-0000-0000-000000000012']::uuid[])$$,
  'values (0::smallint,0::smallint,0::smallint,0::smallint,0::smallint,0::smallint,1::bigint)',
  'all-zero score row is returned with its revision');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.set_member_overall(
  '89010000-0000-0000-0000-000000000012','{"pace":0,"shooting":100,"passing":0,"dribbling":20,"defending":0,"physical":100}',1)$$,
  'values (0::smallint,100::smallint,0::smallint,20::smallint,0::smallint,100::smallint,2::bigint)',
  'mixed zero and positive scores update exactly');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.get_member_overalls(
  array['89010000-0000-0000-0000-000000000012']::uuid[])$$,
  'values (0::smallint,100::smallint,0::smallint,20::smallint,0::smallint,100::smallint,2::bigint)',
  'mixed zero and positive scores round-trip');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.set_member_overall(
  '89010000-0000-0000-0000-000000000012','{"pace":100,"shooting":100,"passing":100,"dribbling":100,"defending":100,"physical":100}',2)$$,
  'values (100::smallint,100::smallint,100::smallint,100::smallint,100::smallint,100::smallint,3::bigint)',
  'all-maximum scores update exactly');
select results_eq($$select pace,shooting,passing,dribbling,defending,physical,revision from public.get_member_overalls(
  array['89010000-0000-0000-0000-000000000012']::uuid[])$$,
  'values (100::smallint,100::smallint,100::smallint,100::smallint,100::smallint,100::smallint,3::bigint)',
  'all-maximum scores round-trip');
select throws_ok(format('select * from public.set_member_overall(%L,%L::jsonb,2)',
  '89010000-0000-0000-0000-000000000005',
  jsonb_set('{"pace":50,"shooting":50,"passing":50,"dribbling":50,"defending":50,"physical":50}',array[key],value)::text),
  '22023',null,'invalid ' || key || '=' || value::text)
from unnest(array['pace','shooting','passing','dribbling','defending','physical']) as key
cross join unnest(array['-1','101','1.5','"50"','null','true']::jsonb[]) as value;
select throws_ok(format('select * from public.set_member_overall(%L,%L::jsonb,2)',
  '89010000-0000-0000-0000-000000000005',
  ('{"pace":50,"shooting":50,"passing":50,"dribbling":50,"defending":50,"physical":50}'::jsonb-key)::text),
  '22023',null,'missing score ' || key)
from unnest(array['pace','shooting','passing','dribbling','defending','physical']) as key;
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":50,"shooting":50,"passing":50,"dribbling":50,"defending":50,"physical":50,"updated_by":"spoof"}',2)$$,
  '22023',null,'spoofed audit input rejected');
select throws_ok('select * from public.get_member_overalls(null)','22023',null,'null read request rejected');
select throws_ok('select * from public.get_member_overalls(array[null]::uuid[])','22023',null,'null member id rejected');
select throws_ok($$select * from public.get_member_overalls(array_fill('89010000-0000-0000-0000-000000000005'::uuid,array[301]))$$,
  '22023',null,'more than 300 ids rejected');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000011',
  '{"pace":50,"shooting":50,"passing":50,"dribbling":50,"defending":50,"physical":50}',0)$$,
  '22023',null,'hidden target cannot be rated');

select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000009',true);
select is((select count(*) from public.get_member_overalls(array['89010000-0000-0000-0000-000000000005']::uuid[])),1::bigint,
  'hidden QA officer retains established operational authority');
select is((select revision from private.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":60,"shooting":60,"passing":60,"dribbling":60,"defending":60,"physical":60}',2)),3::bigint,
  'guarded private helper supports authorized QA officer');
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000004',true);
select is((select count(*) from public.get_member_overalls(array['89010000-0000-0000-0000-000000000005']::uuid[])),1::bigint,
  'system administrator with member role can read');
select is((public.apply_officer_permission_batch('[{"officer_title":"vice_president","permission":"ratings.manage","enabled":false,"expected_enabled":true}]'::jsonb)->>'applied_count')::integer,1,
  'existing permission batch supports excluding ratings service');
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000002',true);
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,
  'excluded officer cannot read after permission transition');
select throws_ok($$select * from public.set_member_overall('89010000-0000-0000-0000-000000000005',
  '{"pace":60,"shooting":60,"passing":60,"dribbling":60,"defending":60,"physical":60}',3)$$,
  '42501',null,'excluded officer cannot save');

reset role;
select is((select created_by from private.member_overalls where member_id='89010000-0000-0000-0000-000000000005'),
  '89010000-0000-0000-0000-000000000001'::uuid,'creator is server-authored');
select is((select updated_by from private.member_overalls where member_id='89010000-0000-0000-0000-000000000005'),
  '89010000-0000-0000-0000-000000000009'::uuid,'last editor is server-authored');
select ok((select updated_at>=created_at from private.member_overalls where member_id='89010000-0000-0000-0000-000000000005'),
  'server authored audit times remain ordered');
update public.profiles set is_test_account=true where id='89010000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.get_member_overalls(array['89010000-0000-0000-0000-000000000005']::uuid[])),0::bigint,
  'latest target visibility hides earlier stored ratings');
reset role;
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000008',true);
set local role authenticated;
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,
  'initial password actor denied');
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000006',true);
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,'inactive actor denied');
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000007',true);
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,'pending actor denied');
select set_config('request.jwt.claim.sub','89000000-0000-0000-0000-000000000012',true);
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,'unlinked actor denied');
reset role;
set local role anon;
select throws_ok('select * from public.get_member_overalls(array[]::uuid[])','42501',null,'anonymous wrapper denied');
reset role;
select * from finish();
rollback;
