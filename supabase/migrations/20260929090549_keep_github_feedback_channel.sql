-- Restore the existing explicit-consent GitHub route. The database remains
-- the canonical record and the member feed is a curated projection of it.
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

alter table public.feedback_feed
  add column github_issue_number integer,
  add column github_issue_url text,
  add column github_issue_state text;

alter table public.feedback_feed
  add constraint feedback_feed_github_issue_pair
    check ((github_issue_number is null) = (github_issue_url is null)),
  add constraint feedback_feed_github_issue_state
    check (github_issue_state is null or github_issue_state in ('open', 'closed'));

create or replace function private.sync_feedback_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.share_with_members then
    insert into public.feedback_feed (
      feedback_id, category, title, body, status, officer_response, created_at,
      github_issue_number, github_issue_url, github_issue_state
    ) values (
      new.id, new.category, new.title, new.body, new.status, new.officer_response, new.created_at,
      new.github_issue_number, new.github_issue_url, new.github_issue_state
    )
    on conflict (feedback_id) do update set
      category = excluded.category,
      title = excluded.title,
      body = excluded.body,
      status = excluded.status,
      officer_response = excluded.officer_response,
      github_issue_number = excluded.github_issue_number,
      github_issue_url = excluded.github_issue_url,
      github_issue_state = excluded.github_issue_state;
  else
    delete from public.feedback_feed where feedback_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function private.sync_feedback_feed()
from public, anon, authenticated;

drop trigger sync_feedback_feed_after_write on public.feedback;
create trigger sync_feedback_feed_after_write
after insert or update of share_with_members, category, title, body, status,
  officer_response, github_issue_number, github_issue_url, github_issue_state
on public.feedback
for each row execute function private.sync_feedback_feed();

update public.feedback_feed as feed
set github_issue_number = feedback.github_issue_number,
    github_issue_url = feedback.github_issue_url,
    github_issue_state = feedback.github_issue_state
from public.feedback as feedback
where feed.feedback_id = feedback.id;
