alter table public.feedback
  add column github_publication_consented_at timestamptz,
  add column github_publication_status text not null default 'not_requested',
  add column github_publication_error text,
  add column github_publication_attempted_at timestamptz;

comment on column public.feedback.publish_to_github is
  'True only when the author explicitly consents to publishing system feedback in the public GitHub repository.';
comment on column public.feedback.github_publication_consented_at is
  'Timestamp recorded when the author explicitly consents to the public GitHub fields shown in the product preview.';

-- Preserve already-public issues, but do not treat legacy automatic routing as
-- consent. Unpublished legacy reports return to internal-only storage.
update public.feedback
set
  publish_to_github = github_issue_url is not null,
  github_publication_status = case
    when github_issue_url is not null then 'published'
    else 'not_requested'
  end,
  github_publication_error = null,
  github_publication_attempted_at = case
    when github_issue_url is not null then created_at
    else null
  end;

-- Keep already-public legacy issues linked even if their old category was not
-- `system`; the insert trigger still limits every new publication to `system`.
alter table public.feedback
  add constraint feedback_github_publication_scope
    check (not publish_to_github or category = 'system' or github_issue_url is not null),
  add constraint feedback_github_consent_required
    check (not publish_to_github or github_publication_consented_at is not null or github_issue_url is not null),
  add constraint feedback_github_consent_scope
    check (github_publication_consented_at is null or (category = 'system' and publish_to_github)),
  add constraint feedback_github_publication_status
    check (github_publication_status in ('not_requested', 'pending', 'published', 'failed')),
  add constraint feedback_github_publication_error_length
    check (github_publication_error is null or char_length(github_publication_error) <= 500),
  add constraint feedback_github_publication_state
    check (
      (github_publication_status = 'not_requested' and not publish_to_github and github_issue_url is null)
      or (github_publication_status in ('pending', 'failed') and publish_to_github and github_publication_consented_at is not null and github_issue_url is null)
      or (github_publication_status = 'published' and publish_to_github and github_issue_url is not null)
    ),
  add constraint feedback_github_publication_error_state
    check ((github_publication_status = 'failed') = (github_publication_error is not null));

create or replace function public.route_feedback_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.github_issue_number := null;
  new.github_issue_url := null;
  new.github_issue_state := null;
  new.github_issue_closed_at := null;
  new.github_publication_error := null;
  new.github_publication_attempted_at := null;

  if new.category = 'system'
    and new.publish_to_github is true
    and new.github_publication_consented_at is not null then
    new.github_publication_status := 'pending';
  else
    new.publish_to_github := false;
    new.github_publication_consented_at := null;
    new.github_publication_status := 'not_requested';
  end if;

  return new;
end;
$$;

revoke execute on function public.route_feedback_publication()
from public, anon, authenticated;
