begin read only;
set local statement_timeout = '15s';

do $$ begin
  perform set_config('verification.expected_count',
    (select count(*)::text from public.profiles where status = 'active' and not is_test_account), true);
  perform set_config('request.jwt.claim.sub',
    (select auth_user_id::text from public.profiles where is_test_account and auth_user_id is not null limit 1), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

set local role authenticated;
do $$ begin
  if private.current_profile_id() is null then raise exception 'Missing linked test account'; end if;
  if (select count(*) from public.get_member_directory()) <> current_setting('verification.expected_count')::bigint
    then raise exception 'Normal directory result changed'; end if;
  if exists(select 1 from public.get_member_directory() where id = private.current_profile_id())
    then raise exception 'Hidden test account exposed'; end if;
  if has_function_privilege('anon', 'public.get_member_directory()', 'EXECUTE')
    then raise exception 'Anonymous execute granted'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  if exists(select 1 from public.get_member_directory()) then raise exception 'Unlinked directory access'; end if;
end $$;

select true as normal_directory_unchanged, true as hidden_test_excluded,
  true as anonymous_execute_denied, true as unlinked_directory_denied;
rollback;
