begin;

select plan(5);

insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data)
values ('89000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb),
  ('89000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, auth_user_id, name, phone, role, fee_plan, status, is_test_account)
values ('89010000-0000-0000-0000-000000000001',
  '89000000-0000-0000-0000-000000000001', 'Directory Fixture', '010-8900-0001', 'member', 'monthly', 'active', false),
  ('89010000-0000-0000-0000-000000000002',
  '89000000-0000-0000-0000-000000000002', 'Inactive Directory Fixture', '010-8900-0002', 'member', 'monthly', 'inactive', false);

select pg_catalog.set_config('request.jwt.claim.sub', '89000000-0000-0000-0000-000000000099', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is((select count(*) from public.get_member_directory()), 0::bigint,
  'an authenticated identity without a linked profile cannot read the directory');

select pg_catalog.set_config('request.jwt.claim.sub', '89000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.get_member_directory()
  where id = '89010000-0000-0000-0000-000000000001'), 1::bigint,
  'a linked member can still read active members');

select pg_catalog.set_config('request.jwt.claim.sub', '89000000-0000-0000-0000-000000000002', true);
select is((select private.current_profile_id()), '89010000-0000-0000-0000-000000000002'::uuid,
  'the change does not redefine which existing profiles are linked');
select is((select count(*) from public.get_member_directory()
  where id = '89010000-0000-0000-0000-000000000002'), 0::bigint,
  'inactive target members remain excluded');
select is((select count(*) from public.get_member_directory()
  where id = '89010000-0000-0000-0000-000000000001'), 1::bigint,
  'linked inactive actors retain the existing directory read contract');

select * from finish();
rollback;
