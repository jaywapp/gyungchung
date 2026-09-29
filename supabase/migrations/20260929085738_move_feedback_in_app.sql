-- Reports stay private by default. A separate, curated projection is the
-- member-visible board so author IDs and legacy GitHub metadata never leak.
alter table public.feedback
  add column share_with_members boolean not null default false;

create table public.feedback_feed (
  feedback_id uuid primary key references public.feedback(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  status public.feedback_status not null,
  officer_response text,
  created_at timestamptz not null
);

create index feedback_feed_created_idx on public.feedback_feed (created_at desc);

alter table public.feedback_feed enable row level security;
revoke all on table public.feedback_feed from anon, authenticated;
grant select on table public.feedback_feed to authenticated;

create policy "Active members read shared feedback"
on public.feedback_feed for select to authenticated
using ((select private.is_active_member()));

create or replace function private.sync_feedback_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.share_with_members then
    insert into public.feedback_feed (
      feedback_id, category, title, body, status, officer_response, created_at
    ) values (
      new.id, new.category, new.title, new.body, new.status, new.officer_response, new.created_at
    )
    on conflict (feedback_id) do update set
      category = excluded.category,
      title = excluded.title,
      body = excluded.body,
      status = excluded.status,
      officer_response = excluded.officer_response;
  else
    delete from public.feedback_feed where feedback_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function private.sync_feedback_feed()
from public, anon, authenticated;

create trigger sync_feedback_feed_after_write
after insert or update of share_with_members, category, title, body, status, officer_response
on public.feedback
for each row execute function private.sync_feedback_feed();

-- Retire the GitHub Issues channel for every new report. Existing linked
-- records remain available to managers in the private feedback table.
create or replace function public.route_feedback_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.publish_to_github := false;
  new.github_publication_consented_at := null;
  new.github_publication_status := 'not_requested';
  new.github_issue_number := null;
  new.github_issue_url := null;
  new.github_issue_state := null;
  new.github_issue_closed_at := null;
  new.github_publication_error := null;
  new.github_publication_attempted_at := null;
  return new;
end;
$$;

revoke execute on function public.route_feedback_publication()
from public, anon, authenticated;


-- These 17 production rows were already copied to feedback when their Issues
-- were created. Reconcile their workflow state and publish only those records,
-- which the authors explicitly chose to make public on GitHub.
update public.feedback
set
  share_with_members = true,
  status = case when github_issue_state = 'closed' then 'closed'::public.feedback_status else status end
where github_issue_number is not null;

-- The two historical reports with a maintainer reply retain that reply in the
-- in-app record. Other closed Issues had no comment to import.
update public.feedback
set officer_response = coalesce(officer_response, $reply$
운영 배포를 완료했습니다.

- `sync_closed_github_feedback` 마이그레이션 적용
- `feedback.github_issue_state`, `feedback.github_issue_closed_at` 컬럼 확인
- `github-feedback` Edge Function v6 배포 및 ACTIVE 상태 확인

닫힌 GitHub 이슈 상태를 동기화해 제보 목록에서 제외할 수 있는 운영 구성이 반영되었습니다.
$reply$)
where github_issue_number = 31;

update public.feedback
set officer_response = coalesce(officer_response, $reply$
운영 배포를 완료했습니다.

- `separate_system_admin_privilege` 마이그레이션 적용
- 활성 시스템 관리자 1명 및 시스템 권한 10개 확인
- 시스템 관리자 보호 트리거와 권한 분리 상태 확인

시스템 관리 권한이 일반 운영진 직책과 분리되어 운영 DB에 반영되었습니다.
$reply$)
where github_issue_number = 32;
