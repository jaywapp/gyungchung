begin;
select plan(14);

select has_function(
  'public',
  'apply_officer_permission_batch',
  array['jsonb'],
  'permission batch RPC exists'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_officer_permission_batch(jsonb)',
    'execute'
  ),
  'authenticated users can execute the permission batch RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.apply_officer_permission_batch(jsonb)',
    'execute'
  ),
  'anonymous users cannot execute the permission batch RPC'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.officer_permissions',
    'insert'
  ),
  'authenticated users cannot bypass the RPC with direct inserts'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.officer_permissions',
    'delete'
  ),
  'authenticated users cannot bypass the RPC with direct deletes'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '10100000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'permission-admin-1@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '10100000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'permission-admin-2@example.test', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.profiles (
  id, auth_user_id, name, email, phone, role, officer_title, fee_plan,
  is_system_admin, status
)
values
  (
    '10110000-0000-0000-0000-000000000001',
    '10100000-0000-0000-0000-000000000001',
    'Permission Admin One', 'permission-admin-1@example.test', '+821012340001',
    'member', null, 'monthly', true, 'active'
  ),
  (
    '10110000-0000-0000-0000-000000000002',
    '10100000-0000-0000-0000-000000000002',
    'Permission Admin Two', 'permission-admin-2@example.test', '+821012340002',
    'member', null, 'monthly', true, 'active'
  );

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.apply_officer_permission_batch(
      '[
        {"officer_title":"vice_president","permission":"fees.manage","enabled":true,"expected_enabled":false},
        {"officer_title":"treasurer","permission":"notices.manage","enabled":true,"expected_enabled":false}
      ]'::jsonb
    )
  $$,
  'a valid permission batch applies successfully'
);
select ok(
  exists (
    select 1 from public.officer_permissions
    where officer_title = 'vice_president' and permission = 'fees.manage'
  ),
  'the first permission change is applied'
);
select ok(
  exists (
    select 1 from public.officer_permissions
    where officer_title = 'treasurer' and permission = 'notices.manage'
  ),
  'the second permission change is applied'
);

select throws_ok(
  $$
    select public.apply_officer_permission_batch(
      '[
        {"officer_title":"president","permission":"surveys.manage","enabled":false,"expected_enabled":true},
        {"officer_title":"treasurer","permission":"fees.manage","enabled":false,"expected_enabled":false}
      ]'::jsonb
    )
  $$,
  '40001',
  'Officer permissions changed while this batch was pending',
  'a stale item rejects the entire batch'
);
select ok(
  exists (
    select 1 from public.officer_permissions
    where officer_title = 'president' and permission = 'surveys.manage'
  ),
  'a change before the stale item is rolled back'
);

select throws_ok(
  $$
    update public.profiles
    set is_system_admin = false
    where id = '10110000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'System administrators cannot remove their own access',
  'a system administrator cannot remove their own access'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10100000-0000-0000-0000-000000000001',
  true
);
select lives_ok(
  $$
    update public.profiles
    set is_system_admin = false
    where id = '10110000-0000-0000-0000-000000000002'
  $$,
  'another administrator can remove access while one active administrator remains'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10100000-0000-0000-0000-000000000002',
  true
);
select throws_ok(
  $$
    delete from public.profiles
    where id = '10110000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'At least one active system administrator is required',
  'the last active system administrator cannot be removed'
);
select ok(
  exists (
    select 1 from public.profiles
    where id = '10110000-0000-0000-0000-000000000001'
      and is_system_admin
      and status = 'active'
  ),
  'the last active administrator remains after the rejected delete'
);

select * from finish();
rollback;
