alter table public.feedback
  add column publish_to_github boolean not null default false,
  add column github_issue_number integer,
  add column github_issue_url text;

alter table public.feedback
  add constraint feedback_github_issue_number_positive
    check (github_issue_number is null or github_issue_number > 0),
  add constraint feedback_github_issue_pair
    check ((github_issue_number is null) = (github_issue_url is null)),
  add constraint feedback_github_issue_url
    check (
      github_issue_url is null
      or github_issue_url ~ '^https://github\.com/jaywapp/gyungchung/issues/[1-9][0-9]*$'
    ),
  add constraint feedback_github_publish_required
    check (github_issue_url is null or publish_to_github);

create unique index feedback_github_issue_number_unique
  on public.feedback (github_issue_number)
  where github_issue_number is not null;
