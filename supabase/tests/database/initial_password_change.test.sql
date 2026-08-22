begin;

select plan(5);

select has_column(
  'public',
  'profiles',
  'must_change_password',
  'profiles track whether an administrator-issued password must be replaced'
);

select is(
  has_schema_privilege('service_role', 'private', 'USAGE'),
  true,
  'the service role can resolve explicitly granted private trigger helpers'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '87000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'password-admin@example.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (
  id, auth_user_id, name, email, phone, role, fee_plan,
  is_system_admin, must_change_password, status
)
values (
  '87010000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000001',
  'Password Admin', 'password-admin@example.test', '+821087000001',
  'member', 'monthly', true, true, 'active'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '87000000-0000-0000-0000-000000000001',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$
    update public.profiles
    set must_change_password = false
    where id = '87010000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'Password change requirements can only be updated by the authentication service',
  'an authenticated administrator cannot bypass the forced password change'
);

reset role;
select is(
  (
    select must_change_password
    from public.profiles
    where id = '87010000-0000-0000-0000-000000000001'
  ),
  true,
  'the requirement remains set after a rejected direct update'
);

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select lives_ok(
  $$
    update public.profiles
    set must_change_password = false
    where id = '87010000-0000-0000-0000-000000000001'
  $$,
  'the authentication service can clear the requirement after changing the password'
);

select * from finish();

rollback;
