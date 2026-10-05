-- Post-deployment smoke: metadata and read-only RPCs only. No member values.
begin transaction read only;
select current_setting('server_version') as server_version;
select procedure.oid::regprocedure::text as signature,
  pg_get_function_result(procedure.oid) as returns,
  procedure.prosecdef as security_definer, procedure.proconfig as settings,
  procedure.proacl::text as acl
from pg_proc as procedure
where procedure.oid in (
  'public.get_member_directory()'::regprocedure,
  'public.set_my_birthday(integer,integer,bigint)'::regprocedure,
  'private.set_my_birthday(integer,integer,bigint)'::regprocedure,
  'public.get_member_phone(uuid)'::regprocedure,
  'private.get_member_phone(uuid)'::regprocedure,
  'public.get_event_mom_results()'::regprocedure,
  'public.get_mom_leaderboard()'::regprocedure
) order by signature;
select relname,relrowsecurity from pg_class
where oid in ('private.member_birthdays'::regclass,'public.events'::regclass,'public.event_mom_votes'::regclass);
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='event_mom_votes'
  and grantee in ('anon','authenticated','service_role') order by grantee,privilege_type;
select policyname,cmd,roles,qual,with_check from pg_policies
where schemaname='public' and tablename='event_mom_votes' order by policyname;

do $$
begin
  if exists(select 1 from auth.users where id='ffffffff-ffff-4fff-8fff-fffffffffff0')
    or exists(select 1 from public.profiles where auth_user_id='ffffffff-ffff-4fff-8fff-fffffffffff0') then
    raise exception 'Synthetic smoke identity unexpectedly exists; choose a different unused UUID';
  end if;
  if has_table_privilege('anon','private.member_birthdays','select')
    or has_table_privilege('authenticated','private.member_birthdays','select')
    or has_table_privilege('authenticated','public.event_mom_votes','truncate')
    or has_table_privilege('anon','public.event_mom_votes','truncate') then
    raise exception 'Unexpected direct data privilege';
  end if;
  if not private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-04 10:00+09')
    or private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-07 10:00+09') then
    raise exception 'POTM exact time boundaries differ';
  end if;
end;
$$;

set local request.jwt.claim.sub='';
set local role anon;
do $$
begin
  begin
    perform public.get_member_directory();
    raise exception 'Anonymous directory access unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_member_phone(null::uuid);
    raise exception 'Anonymous phone access unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_event_mom_results();
    raise exception 'Anonymous POTM access unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local request.jwt.claim.sub='ffffffff-ffff-4fff-8fff-fffffffffff0';
set local role authenticated;
do $$
begin
  if exists(select 1 from public.get_member_directory())
    or exists(select 1 from public.get_event_mom_results())
    or exists(select 1 from public.get_mom_leaderboard())
    or exists(select 1 from public.event_mom_votes)
    or private.current_mom_voter_id() is not null then
    raise exception 'Unlinked identity unexpectedly read member data';
  end if;
  begin
    perform public.get_member_phone(null::uuid);
    raise exception 'Unlinked phone access unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'batch release read-only smoke passed' as result;
rollback;
