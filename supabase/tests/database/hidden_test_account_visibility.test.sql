begin;

select plan(5);

select has_column(
  'public',
  'profiles',
  'is_test_account',
  'profiles identify accounts that must stay outside the member roster'
);

insert into public.profiles (id, name, phone, role, fee_plan, is_test_account, status)
values
  ('86000000-0000-0000-0000-000000000001', 'Visible Test Member', '010-8600-0001', 'member', 'monthly', false, 'active'),
  ('86000000-0000-0000-0000-000000000002', 'Hidden Test Account', '010-8600-0002', 'member', 'monthly', true, 'active');

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '86000000-0000-0000-0000-000000000001',
  true
);

select results_eq(
  $$
    select name
    from public.get_member_directory()
    where id in (
      '86000000-0000-0000-0000-000000000001'::uuid,
      '86000000-0000-0000-0000-000000000002'::uuid
    )
    order by name
  $$,
  $$values ('Visible Test Member'::text)$$,
  'the member directory excludes test accounts'
);

select is(
  (select count(*) from private.get_member_rankings_data() where member_id = '86000000-0000-0000-0000-000000000002'::uuid),
  0::bigint,
  'test accounts are excluded from activity rankings'
);

select is(
  (select count(*) from private.get_mom_leaderboard_data() where member_id = '86000000-0000-0000-0000-000000000002'::uuid),
  0::bigint,
  'test accounts are excluded from the MOM leaderboard'
);

select is(
  (select count(*) from public.profiles where is_test_account),
  1::bigint,
  'test account rows remain stored for authentication'
);

select * from finish();

rollback;
