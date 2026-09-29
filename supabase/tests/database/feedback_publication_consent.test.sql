begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_column('public', 'feedback', 'github_publication_consented_at', 'feedback records explicit GitHub consent');
select has_column('public', 'feedback', 'github_publication_status', 'feedback records GitHub publication status');
select has_column('public', 'feedback', 'github_publication_error', 'feedback records a safe publication error');
select has_column('public', 'feedback', 'github_publication_attempted_at', 'feedback records publication attempts');

create temporary table feedback_publication_cases (
  id integer generated always as identity primary key,
  category text not null,
  is_anonymous boolean not null,
  publish_to_github boolean not null,
  github_publication_consented_at timestamptz,
  github_issue_number integer,
  github_issue_url text,
  github_issue_state text,
  github_issue_closed_at timestamptz,
  github_publication_status text not null default 'not_requested',
  github_publication_error text,
  github_publication_attempted_at timestamptz
);

create trigger route_feedback_publication_before_insert
before insert on feedback_publication_cases
for each row execute function public.route_feedback_publication();

insert into feedback_publication_cases (
  category,
  is_anonymous,
  publish_to_github,
  github_publication_consented_at,
  github_issue_number,
  github_issue_url,
  github_publication_status
)
values
  ('system', true, true, now(), 98, 'https://github.com/jaywapp/gyungchung/issues/98', 'published'),
  ('system', false, true, now(), 98, 'https://github.com/jaywapp/gyungchung/issues/98', 'published'),
  ('system', true, true, null, 98, 'https://github.com/jaywapp/gyungchung/issues/98', 'published'),
  ('operation', true, true, now(), 98, 'https://github.com/jaywapp/gyungchung/issues/98', 'published'),
  ('operation', false, true, now(), 98, 'https://github.com/jaywapp/gyungchung/issues/98', 'published');

select results_eq(
  $$
    select
      category,
      is_anonymous,
      publish_to_github,
      github_publication_consented_at is not null,
      github_issue_url is null,
      github_publication_status
    from feedback_publication_cases
    order by id
  $$,
  $$
    values
      ('system'::text, true, true, true, true, 'pending'::text),
      ('system'::text, false, true, true, true, 'pending'::text),
      ('system'::text, true, false, false, true, 'not_requested'::text),
      ('operation'::text, true, false, false, true, 'not_requested'::text),
      ('operation'::text, false, false, false, true, 'not_requested'::text)
  $$,
  'anonymous and identified system feedback require consent while general feedback remains internal'
);

select * from finish();

rollback;
