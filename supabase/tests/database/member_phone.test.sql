begin;
select no_plan();

-- Synthetic fixtures only; no calls or external phone app are involved.
insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data)
select ('86000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb
from generate_series(1, 10) as number;

insert into public.profiles (
  id, auth_user_id, name, phone, role, fee_plan, status,
  must_change_password, is_test_account, is_system_admin
)
select ('86010000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 8 then null
    else ('86000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid end,
  'Phone Fixture ' || number, '+82108600' || lpad(number::text, 4, '0'),
  'member'::public.account_role, 'monthly'::public.member_fee_plan,
  case when number = 3 then 'inactive'::public.member_status
    when number = 6 then 'pending'::public.member_status
    else 'active'::public.member_status end,
  number = 4, number = 5, number = 10
from generate_series(1, 10) as number where number <> 9;

select ok(not has_function_privilege('anon', 'public.get_member_phone(uuid)', 'execute'),
  'anon cannot execute phone wrapper');
select ok(not has_function_privilege('anon', 'private.get_member_phone(uuid)', 'execute'),
  'anon cannot execute private phone helper');
select ok(has_function_privilege('authenticated', 'public.get_member_phone(uuid)', 'execute'),
  'authenticated has wrapper execution privilege');
select ok(has_function_privilege('authenticated', 'private.get_member_phone(uuid)', 'execute'),
  'authenticated has guarded helper execution privilege');
select ok(not has_function_privilege('service_role', 'public.get_member_phone(uuid)', 'execute'),
  'service role receives no new wrapper execution privilege');
select ok(not has_function_privilege('service_role', 'private.get_member_phone(uuid)', 'execute'),
  'service role receives no new helper execution privilege');
select ok((select prosecdef from pg_proc where oid = 'private.get_member_phone(uuid)'::regprocedure),
  'private helper is the authorization definer boundary');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_member_phone(uuid)'::regprocedure),
  'public wrapper remains security invoker');
select is((select provolatile::text from pg_proc where oid = 'private.get_member_phone(uuid)'::regprocedure),
  's', 'helper is a stable read operation');
select is((select provolatile::text from pg_proc where oid = 'public.get_member_phone(uuid)'::regprocedure),
  's', 'wrapper is a stable read operation');
select is((select proconfig from pg_proc where oid = 'private.get_member_phone(uuid)'::regprocedure),
  array['search_path=""'], 'private lookup uses fixed empty search path');
select is((select proconfig from pg_proc where oid = 'public.get_member_phone(uuid)'::regprocedure),
  array['search_path=""'], 'public lookup uses fixed empty search path');
select ok(not has_function_privilege('anon', 'public.get_member_directory()', 'execute'),
  'directory remains unavailable to anon');
select ok(has_function_privilege('service_role', 'public.get_member_directory()', 'execute'),
  'directory service role ACL remains available');
select is((select proargnames from pg_proc where oid = 'public.get_member_directory()'::regprocedure),
  array['id','name','role','officer_title','is_system_admin','position','jersey_number','joined_at',
    'status','fee_plan','avatar_path','birthday_month','birthday_day','birthday_revision'],
  'directory preserves all 14 fields without a bulk phone projection');

select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select is(public.get_member_phone('86010000-0000-0000-0000-000000000001'), '+821086000001',
  'eligible member can read own phone');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000002'), '+821086000002',
  'eligible member can read selected active member phone');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000010'), '+821086000010',
  'active system administrator is an eligible contact target');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000008'), '+821086000008',
  'active unlinked target remains contactable');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000004'), '+821086000004',
  'target password-change requirement does not hide contact information');
select is(private.get_member_phone('86010000-0000-0000-0000-000000000002'), '+821086000002',
  'direct private call uses the same authorized projection');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000003'), null::text,
  'inactive target returns null');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000005'), null::text,
  'hidden target returns null');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000006'), null::text,
  'pending target returns null');
select is(public.get_member_phone('86010000-0000-0000-0000-000000000099'), null::text,
  'nonexistent target returns null');
select is(public.get_member_phone(null), null::text, 'null target returns null');
select is((select count(*) from public.profiles where id = '86010000-0000-0000-0000-000000000002'),
  0::bigint, 'phone lookup does not broaden direct profile RLS');
select is((select fee_plan from public.get_member_directory()
  where id = '86010000-0000-0000-0000-000000000002'), null::public.member_fee_plan,
  'phone lookup leaves fee privacy intact');

select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000003', true);
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'inactive actor cannot read another phone');
select throws_ok($$select private.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'inactive actor cannot bypass wrapper');
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000004', true);
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'initial-password actor cannot read another phone');
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000005', true);
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'hidden actor cannot read another phone');
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000006', true);
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'pending actor cannot read another phone');
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000009', true);
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'unlinked actor cannot read another phone');
select throws_ok('select public.get_member_phone(null)', '42501', null,
  'missing target does not bypass actor authorization');
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select private.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'missing identity cannot read another phone');

select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000010', true);
select is(public.get_member_phone('86010000-0000-0000-0000-000000000002'), '+821086000002',
  'eligible system administrator can read a member contact');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
update public.profiles set must_change_password = true
where id = '86010000-0000-0000-0000-000000000001';
select pg_catalog.set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'next lookup rechecks eligibility without a JWT refresh');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
set local role anon;
select throws_ok($$select public.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon cannot execute phone wrapper');
select throws_ok($$select private.get_member_phone('86010000-0000-0000-0000-000000000002')$$,
  '42501', null, 'anon cannot execute phone helper');

reset role;
select * from finish();
rollback;
