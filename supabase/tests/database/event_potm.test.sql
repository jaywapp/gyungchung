begin;
select no_plan();

-- Pure boundary checks do not depend on test execution speed or wall-clock mocks.
select ok(not private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-04 09:59:59.999999+09'),
  'default two-hour event has not ended one microsecond before opening');
select ok(private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-04 10:00+09'),
  'default voting opens exactly at scheduled end');
select ok(private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-07 09:59:59.999999+09'),
  'voting remains open immediately before 72 hours');
select ok(not private.event_mom_voting_is_open('2026-10-04 08:00+09',null,3,'2026-10-07 10:00+09'),
  'voting closes exactly at 72 hours');
select ok(not private.event_mom_voting_is_open('2026-10-04 08:00+09','2026-10-04 11:00+09',1,'2026-10-04 10:59:59+09'),
  'explicit end replaces the default end');
select ok(private.event_mom_voting_is_open('2026-10-04 08:00+09','2026-10-04 11:00+09',1,'2026-10-04 11:00+09'),
  'explicit end opens the window');
select ok(not private.event_mom_voting_is_open('2026-10-04 08:00+09','2026-10-04 11:00+09',1,'2026-10-05 11:00+09'),
  'custom one-day duration is exactly 24 hours');
set local timezone = 'America/New_York';
select ok(private.event_mom_voting_is_open('2026-03-07 10:00-05','2026-03-07 12:00-05',1,'2026-03-08 12:59:59-04'),
  'DST does not shorten a voting day to 23 hours');
select ok(not private.event_mom_voting_is_open('2026-03-07 10:00-05','2026-03-07 12:00-05',1,'2026-03-08 13:00-04'),
  'DST boundary still closes after exactly 24 hours');
set local timezone = 'UTC';
select ok(not private.event_mom_voting_is_open(null,null,3,now()), 'unknown start fails closed');

insert into auth.users(id,instance_id,aud,role,raw_app_meta_data,raw_user_meta_data)
select ('54000000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','{}'::jsonb,'{}'::jsonb
from generate_series(1,10) as number;
insert into public.profiles(id,auth_user_id,name,phone,role,fee_plan,status,must_change_password,is_system_admin)
select ('54010000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  ('54000000-0000-0000-0000-' || lpad(number::text,12,'0'))::uuid,
  'POTM Fixture ' || number,'+82105400' || lpad(number::text,4,'0'),
  'member'::public.account_role,'monthly'::public.member_fee_plan,
  case when number=6 then 'inactive'::public.member_status when number=8 then 'pending'::public.member_status
    else 'active'::public.member_status end,number=7,number=10
from generate_series(1,10) as number where number<>9;
insert into public.events(id,title,starts_at,venue)
values ('54020000-0000-0000-0000-000000000001','Open POTM fixture',clock_timestamp()-interval '4 hours','Synthetic venue'),
  ('54020000-0000-0000-0000-000000000002','Waiting POTM fixture',clock_timestamp()-interval '1 hour','Synthetic venue'),
  ('54020000-0000-0000-0000-000000000003','Completed POTM fixture',clock_timestamp()-interval '4 hours','Synthetic venue');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000010',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
insert into public.attendance(event_id,member_id,status,check_in_status,checked_in_at)
select event.id,profile.id,'going','present',clock_timestamp()-interval '5 hours'
from public.events as event cross join public.profiles as profile
where event.id::text like '54020000-%' and profile.id::text like '54010000-%';

select is((select mom_voting_days from public.events where id='54020000-0000-0000-0000-000000000001'),3,
  'new events default to three voting days');
select throws_ok($$update public.events set mom_voting_days=0 where id='54020000-0000-0000-0000-000000000001'$$,
  '23514',null,'zero-day window rejected');
select throws_ok($$update public.events set mom_voting_days=31 where id='54020000-0000-0000-0000-000000000001'$$,
  '23514',null,'window above 30 days rejected');
select throws_ok($$update public.events set ends_at=starts_at where id='54020000-0000-0000-0000-000000000001'$$,
  '23514',null,'end must be after start');
select ok(has_table_privilege('authenticated','public.event_mom_votes','insert')
  and has_table_privilege('authenticated','public.event_mom_votes','update')
  and has_table_privilege('authenticated','public.event_mom_votes','delete'),
  'previously installed clients retain direct CRUD privileges');
select ok(not has_function_privilege('authenticated','private.validate_event_mom_vote()','execute'),
  'clients cannot directly execute the definer trigger');
select ok(not has_function_privilege('anon','private.current_mom_voter_id()','execute'),
  'anonymous users cannot execute actor lookup');
select ok(not has_table_privilege('anon','public.event_mom_votes','truncate')
  and not has_table_privilege('authenticated','public.event_mom_votes','truncate'),
  'legacy grants cannot bypass RLS through TRUNCATE');
select ok(not has_table_privilege('authenticated','public.event_mom_votes','references')
  and not has_table_privilege('authenticated','public.event_mom_votes','trigger'),
  'clients have no schema-level privileges over votes');

-- Seed accepted votes while open, then close through the normal event fields.
set local role authenticated;
select throws_ok('truncate public.event_mom_votes','42501',null,'direct TRUNCATE remains denied');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000001',true);
insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
values('54020000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000003');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000002',true);
insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
values('54020000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000002','54010000-0000-0000-0000-000000000004');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000003',true);
insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
values('54020000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000004');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000004',true);
insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
values('54020000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000004','54010000-0000-0000-0000-000000000003');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000005',true);
insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
values('54020000-0000-0000-0000-000000000003','54010000-0000-0000-0000-000000000005','54010000-0000-0000-0000-000000000004');
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
update public.profiles set is_test_account=true where id='54010000-0000-0000-0000-000000000005';
update public.events set starts_at=clock_timestamp()-interval '5 days',ends_at=clock_timestamp()-interval '4 days'
where id='54020000-0000-0000-0000-000000000003';

select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select results_eq($$select candidate_profile_id,vote_count,mom_rank from public.get_event_mom_results()
  where event_id='54020000-0000-0000-0000-000000000003' order by candidate_profile_id$$,
  $$values ('54010000-0000-0000-0000-000000000003'::uuid,2::bigint,1::bigint),
    ('54010000-0000-0000-0000-000000000004'::uuid,2::bigint,1::bigint)$$,
  'hidden voter is excluded before ranking and tied winners share first place');
select is((select first_place_count from public.get_mom_leaderboard()
  where member_id='54010000-0000-0000-0000-000000000003'),1::bigint,'closed event awards cumulative first place');
select is((select count(*) from public.get_event_mom_results()
  where event_id='54020000-0000-0000-0000-000000000001'),0::bigint,'unvoted event has no result rows');
select lives_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000002')$$,
  'eligible checked-in member can vote after event end');
select is((select first_place_count from public.get_mom_leaderboard()
  where member_id='54010000-0000-0000-0000-000000000002'),0::bigint,'open event does not award provisional first place');
select lives_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000003')
  on conflict(event_id,voter_id) do update set candidate_profile_id=excluded.candidate_profile_id$$,
  'legacy upsert can change the selected player inside the window');
select throws_ok($$update public.event_mom_votes set event_id='54020000-0000-0000-0000-000000000002'
  where event_id='54020000-0000-0000-0000-000000000001'$$,'42501',null,'vote cannot move to a different event');
select throws_ok($$update public.event_mom_votes set voter_id='54010000-0000-0000-0000-000000000002'
  where event_id='54020000-0000-0000-0000-000000000001'$$,'42501',null,'vote cannot transfer to another voter');
select throws_ok($$update public.event_mom_votes set candidate_profile_id='54010000-0000-0000-0000-000000000001'
  where event_id='54020000-0000-0000-0000-000000000001'$$,'42501',null,'self vote remains forbidden');
select throws_ok($$update public.event_mom_votes set candidate_profile_id='54010000-0000-0000-0000-000000000005'
  where event_id='54020000-0000-0000-0000-000000000001'$$,'42501',null,'hidden candidate cannot be selected directly');
select throws_ok($$update public.event_mom_votes set candidate_profile_id='54010000-0000-0000-0000-000000000006'
  where event_id='54020000-0000-0000-0000-000000000001'$$,'42501',null,'inactive candidate cannot be selected directly');
select lives_ok($$delete from public.event_mom_votes where event_id='54020000-0000-0000-0000-000000000001'$$,
  'own vote can be withdrawn while voting is open');
select throws_ok($$delete from public.event_mom_votes where event_id='54020000-0000-0000-0000-000000000003'$$,
  '42501',null,'closed vote cannot be withdrawn by direct DELETE');
select throws_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000002','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000002')$$,
  '42501',null,'event start alone does not open POTM voting');

select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000005',true);
select is((select count(*) from public.event_mom_votes),0::bigint,'hidden actor cannot read even their own historical vote');
select is((select count(*) from public.get_event_mom_results()),0::bigint,'hidden actor cannot read results');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000006',true);
select throws_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000006','54010000-0000-0000-0000-000000000002')$$,
  '42501',null,'inactive voter rejected');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000007',true);
select is((select count(*) from public.get_event_mom_results()),0::bigint,'initial-password actor cannot read results');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000008',true);
select is((select count(*) from public.get_mom_leaderboard()),0::bigint,'pending actor cannot read cumulative awards');
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000009',true);
select throws_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000002')$$,
  '42501',null,'unlinked actor cannot forge another voter identity');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
update public.profiles set must_change_password=true where id='54010000-0000-0000-0000-000000000010';
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000010',true);
set local role authenticated;
select throws_ok($$update public.events set mom_voting_days=5 where id='54020000-0000-0000-0000-000000000001'$$,
  '42501',null,'initial-password administrator cannot extend voting');
select throws_ok($$update public.events set starts_at=starts_at+interval '1 hour' where id='54020000-0000-0000-0000-000000000001'$$,
  '42501',null,'initial-password administrator cannot move the derived voting period');
select throws_ok($$insert into public.events(title,starts_at,venue) values('Denied',clock_timestamp(),'Synthetic venue')$$,
  '42501',null,'initial-password administrator cannot create a voting period');
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
update public.profiles set must_change_password=false,is_test_account=true where id='54010000-0000-0000-0000-000000000010';
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000010',true);
set local role authenticated;
select throws_ok($$update public.events set ends_at=starts_at+interval '3 hours' where id='54020000-0000-0000-0000-000000000001'$$,
  '42501',null,'hidden administrator cannot move voting end');
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
update public.profiles set is_test_account=false where id='54010000-0000-0000-0000-000000000010';
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000010',true);
set local role authenticated;
select lives_ok($$delete from public.events where id='54020000-0000-0000-0000-000000000003'$$,
  'authorized event deletion may cascade closed votes');
select is((select count(*) from public.get_event_mom_results()
  where event_id='54020000-0000-0000-0000-000000000003'),0::bigint,'deleted event results are removed');

reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
-- This runs only in the later batch. The transaction began before the deadline;
-- clock_timestamp must still reject a write after the deadline has passed.
update public.events set starts_at=clock_timestamp()-interval '26 hours',
  ends_at=clock_timestamp()-interval '24 hours'+interval '50 milliseconds',mom_voting_days=1
where id='54020000-0000-0000-0000-000000000001';
select pg_sleep(0.1);
select pg_catalog.set_config('request.jwt.claim.sub','54000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id)
  values('54020000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000001','54010000-0000-0000-0000-000000000002')$$,
  '42501',null,'transaction-start time cannot keep an expired voting window open');
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','',true);
set local role anon;
select throws_ok('select * from public.get_event_mom_results()','42501',null,'anonymous result RPC stays denied');
select throws_ok('select * from public.event_mom_votes','42501',null,'anonymous vote table stays denied');
reset role;
select * from finish();
rollback;
