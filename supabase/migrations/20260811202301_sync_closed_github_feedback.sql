alter table public.feedback
  add column github_issue_state text,
  add column github_issue_closed_at timestamptz;

update public.feedback
set github_issue_state = 'open'
where github_issue_number is not null;

alter table public.feedback
  add constraint feedback_github_issue_state
    check (github_issue_state is null or github_issue_state in ('open', 'closed')),
  add constraint feedback_github_issue_closed_at
    check (github_issue_closed_at is null or github_issue_state = 'closed');
