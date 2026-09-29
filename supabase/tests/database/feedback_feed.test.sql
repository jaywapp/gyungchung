begin;

select plan(9);

insert into public.profiles (id, name, phone, role, fee_plan, status)
values
  ('89110000-0000-0000-0000-000000000001', 'Feedback Member', '010-8910-0001', 'member', 'monthly', 'active'),
  ('89110000-0000-0000-0000-000000000002', 'Inactive Feedback Member', '010-8910-0002', 'member', 'monthly', 'inactive');

insert into auth.users (id, instance_id, aud, role, phone, raw_app_meta_data, raw_user_meta_data)
values
  ('89100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+821089100001', '{}'::jsonb, '{"member_id":"89110000-0000-0000-0000-000000000001"}'::jsonb),
  ('89100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+821089100002', '{}'::jsonb, '{"member_id":"89110000-0000-0000-0000-000000000002"}'::jsonb);

insert into public.feedback (id, author_id, category, title, body, share_with_members)
values
  ('89120000-0000-0000-0000-000000000001', '89110000-0000-0000-0000-000000000001', 'system', 'Shared report', 'Visible to active members', true),
  ('89120000-0000-0000-0000-000000000002', '89110000-0000-0000-0000-000000000001', 'system', 'Private report', 'Visible only to its author', false);

select has_column('public', 'feedback', 'share_with_members', 'feedback records member sharing choice');
select has_table('public', 'feedback_feed', 'a separate member feed exists');
select is((select count(*) from public.feedback_feed where feedback_id::text like '8912%'), 1::bigint,
  'only explicitly shared reports reach the feed');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'feedback_feed' and column_name = 'author_id'
), 'the member feed has no author identifier');
select ok(not has_table_privilege('anon', 'public.feedback_feed', 'SELECT'),
  'signed-out visitors have no feed grant');

select pg_catalog.set_config('request.jwt.claim.sub', '89100000-0000-0000-0000-000000000002', true);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*) from public.feedback_feed where feedback_id::text like '8912%'), 0::bigint,
  'inactive members cannot read the shared feed');

select pg_catalog.set_config('request.jwt.claim.sub', '89100000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.feedback_feed where feedback_id::text like '8912%'), 1::bigint,
  'active members can read the shared feed');

reset role;
update public.feedback
set status = 'resolved', officer_response = 'Completed'
where id = '89120000-0000-0000-0000-000000000001';
select is((select status::text || ':' || officer_response from public.feedback_feed
  where feedback_id = '89120000-0000-0000-0000-000000000001'), 'resolved:Completed',
  'status and manager answer stay in sync');

update public.feedback
set publish_to_github = true,
    github_publication_consented_at = now(),
    github_publication_status = 'published',
    github_issue_number = 999999,
    github_issue_url = 'https://github.com/jaywapp/gyungchung/issues/999999',
    github_issue_state = 'open'
where id = '89120000-0000-0000-0000-000000000001';
select is((select github_issue_number::text || ':' || github_issue_state
  from public.feedback_feed
  where feedback_id = '89120000-0000-0000-0000-000000000001'), '999999:open',
  'GitHub issue metadata stays in sync with the member feed');

select * from finish();
rollback;
