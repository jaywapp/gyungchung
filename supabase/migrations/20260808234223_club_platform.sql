create type public.officer_role as enum ('member', 'president', 'vice_president', 'treasurer');
create type public.member_status as enum ('active', 'inactive', 'pending');
create type public.fee_status as enum ('paid', 'unpaid', 'exempt');
create type public.attendance_status as enum ('going', 'not_going', 'undecided');
create type public.feedback_status as enum ('received', 'reviewing', 'resolved', 'closed');
create type public.participation_kind as enum ('election', 'poll', 'survey');
create type public.participation_status as enum ('draft', 'open', 'closed', 'archived');
create type public.question_type as enum ('single_choice', 'multiple_choice', 'short_text', 'long_text', 'rating', 'yes_no');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  email text,
  phone text,
  role public.officer_role not null default 'member',
  position text,
  jersey_number integer check (jersey_number between 0 and 99),
  joined_at date not null default current_date,
  status public.member_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_permissions (
  role public.officer_role not null,
  permission text not null check (permission in (
    'roles.manage', 'members.manage', 'fees.manage', 'notices.manage',
    'events.manage', 'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage'
  )),
  primary key (role, permission)
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  is_pinned boolean not null default false,
  author_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null default '주말 정기 풋살' check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  venue text not null check (char_length(venue) between 1 and 120),
  address text,
  note text check (note is null or char_length(note) <= 2000),
  capacity integer check (capacity is null or capacity > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fees (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  amount integer not null check (amount >= 0),
  status public.fee_status not null default 'unpaid',
  paid_at timestamptz,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id, month)
);

create table public.attendance (
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  status public.attendance_status not null default 'undecided',
  updated_at timestamptz not null default now(),
  primary key(event_id, member_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('operation', 'system', 'facility', 'finance', 'safety', 'other')),
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 5 and 5000),
  is_anonymous boolean not null default false,
  status public.feedback_status not null default 'received',
  officer_response text check (officer_response is null or char_length(officer_response) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.participation_forms (
  id uuid primary key default gen_random_uuid(),
  kind public.participation_kind not null,
  title text not null check (char_length(title) between 2 and 160),
  description text check (description is null or char_length(description) <= 5000),
  status public.participation_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  secret_ballot boolean not null default false,
  show_results boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (kind = 'election' or secret_ballot = false)
);

create table public.participation_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.participation_forms(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 500),
  type public.question_type not null,
  is_required boolean not null default true,
  position integer not null default 0 check (position >= 0),
  min_value integer,
  max_value integer,
  unique(form_id, position),
  check (min_value is null or max_value is null or max_value >= min_value)
);

create table public.participation_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.participation_questions(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  candidate_profile_id uuid references public.profiles(id) on delete set null,
  position integer not null default 0 check (position >= 0),
  unique(question_id, position)
);

create table public.participation_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.participation_forms(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique(form_id, participant_id)
);

create table public.participation_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.participation_submissions(id) on delete cascade,
  question_id uuid not null references public.participation_questions(id) on delete cascade,
  answer jsonb not null,
  created_at timestamptz not null default now(),
  unique(submission_id, question_id),
  check (jsonb_typeof(answer) in ('string', 'number', 'boolean', 'array'))
);

create index notices_pinned_created_idx on public.notices (is_pinned desc, created_at desc);
create index notices_author_id_idx on public.notices (author_id);
create index events_starts_at_idx on public.events (starts_at);
create index events_created_by_idx on public.events (created_by);
create index fees_member_month_idx on public.fees (member_id, month desc);
create index attendance_member_idx on public.attendance (member_id);
create index feedback_author_created_idx on public.feedback (author_id, created_at desc);
create index feedback_status_created_idx on public.feedback (status, created_at desc);
create index forms_kind_status_dates_idx on public.participation_forms (kind, status, starts_at, ends_at);
create index forms_created_by_idx on public.participation_forms (created_by);
create index questions_form_position_idx on public.participation_questions (form_id, position);
create index options_question_position_idx on public.participation_options (question_id, position);
create index options_candidate_profile_idx on public.participation_options (candidate_profile_id);
create index submissions_participant_idx on public.participation_submissions (participant_id, submitted_at desc);
create index answers_question_idx on public.participation_answers (question_id);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_permission(requested_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.profiles p
    join public.role_permissions rp on rp.role = p.role
    where p.id = (select auth.uid()) and p.status = 'active' and rp.permission = requested_permission
  );
$$;
revoke all on function private.has_permission(text) from public, anon, authenticated, service_role;
grant execute on function private.has_permission(text) to authenticated;

create or replace function private.can_manage_form(form_kind public.participation_kind)
returns boolean language sql stable security definer set search_path = '' as $$
  select case form_kind
    when 'election' then (select private.has_permission('elections.manage'))
    when 'poll' then (select private.has_permission('polls.manage'))
    when 'survey' then (select private.has_permission('surveys.manage'))
  end;
$$;
revoke all on function private.can_manage_form(public.participation_kind) from public, anon, authenticated, service_role;
grant execute on function private.can_manage_form(public.participation_kind) to authenticated;

create or replace function private.form_is_open(target_form_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participation_forms f
    where f.id = target_form_id and f.status = 'open'
      and (f.starts_at is null or f.starts_at <= now())
      and (f.ends_at is null or f.ends_at > now())
  ) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;
revoke all on function private.form_is_open(uuid) from public, anon, authenticated, service_role;
grant execute on function private.form_is_open(uuid) to authenticated;

create or replace function private.is_own_submission(target_submission_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participation_submissions s
    where s.id = target_submission_id and s.participant_id = (select auth.uid())
  );
$$;
revoke all on function private.is_own_submission(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_own_submission(uuid) to authenticated;

create or replace function public.validate_participation_answer()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  question_record record;
  submission_form_id uuid;
  option_count integer;
begin
  select q.type, q.form_id, q.min_value, q.max_value into question_record
  from public.participation_questions q where q.id = new.question_id;
  select s.form_id into submission_form_id from public.participation_submissions s where s.id = new.submission_id;
  if question_record.form_id is null or submission_form_id is distinct from question_record.form_id then
    raise exception 'Question does not belong to this form';
  end if;
  if question_record.type in ('single_choice', 'yes_no') then
    if jsonb_typeof(new.answer) <> 'string' then raise exception 'Single choice answer must be an option id'; end if;
    select count(*) into option_count from public.participation_options o
      where o.question_id = new.question_id and o.id::text = trim(both '"' from new.answer::text);
    if option_count <> 1 then raise exception 'Invalid option'; end if;
  elsif question_record.type = 'multiple_choice' then
    if jsonb_typeof(new.answer) <> 'array' or jsonb_array_length(new.answer) = 0 then raise exception 'Multiple choice answer must be a non-empty array'; end if;
    select count(*) into option_count from jsonb_array_elements_text(new.answer) selected
      where not exists (select 1 from public.participation_options o where o.question_id = new.question_id and o.id::text = selected);
    if option_count > 0 then raise exception 'Invalid option'; end if;
  elsif question_record.type = 'rating' then
    if jsonb_typeof(new.answer) <> 'number' or (new.answer #>> '{}')::integer < coalesce(question_record.min_value, 1) or (new.answer #>> '{}')::integer > coalesce(question_record.max_value, 5) then
      raise exception 'Rating is outside the allowed range';
    end if;
  elsif question_record.type in ('short_text', 'long_text') then
    if jsonb_typeof(new.answer) <> 'string' or char_length(new.answer #>> '{}') > (case when question_record.type = 'short_text' then 500 else 5000 end) then
      raise exception 'Text answer is invalid';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.validate_participation_answer() from public, anon, authenticated;
create trigger validate_participation_answer_before_write before insert or update on public.participation_answers for each row execute function public.validate_participation_answer();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, '새 회원'), '@', 1)), new.email);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.notices enable row level security;
alter table public.events enable row level security;
alter table public.fees enable row level security;
alter table public.attendance enable row level security;
alter table public.feedback enable row level security;
alter table public.participation_forms enable row level security;
alter table public.participation_questions enable row level security;
alter table public.participation_options enable row level security;
alter table public.participation_submissions enable row level security;
alter table public.participation_answers enable row level security;

create policy "Active profiles are visible" on public.profiles for select to anon, authenticated using (status = 'active' or id = (select auth.uid()) or (select private.has_permission('members.manage')));
create policy "Member managers update profiles" on public.profiles for update to authenticated using ((select private.has_permission('members.manage'))) with check ((select private.has_permission('members.manage')));
create policy "Member managers delete profiles" on public.profiles for delete to authenticated using ((select private.has_permission('members.manage')));

create policy "Authenticated members read permissions" on public.role_permissions for select to authenticated using (true);
create policy "Presidents insert permissions" on public.role_permissions for insert to authenticated with check ((select private.has_permission('roles.manage')));
create policy "Presidents update permissions" on public.role_permissions for update to authenticated using ((select private.has_permission('roles.manage'))) with check ((select private.has_permission('roles.manage')));
create policy "Presidents delete permissions" on public.role_permissions for delete to authenticated using ((select private.has_permission('roles.manage')));

create policy "Notices are public" on public.notices for select to anon, authenticated using (true);
create policy "Notice managers insert" on public.notices for insert to authenticated with check ((select private.has_permission('notices.manage')));
create policy "Notice managers update" on public.notices for update to authenticated using ((select private.has_permission('notices.manage'))) with check ((select private.has_permission('notices.manage')));
create policy "Notice managers delete" on public.notices for delete to authenticated using ((select private.has_permission('notices.manage')));

create policy "Events are public" on public.events for select to anon, authenticated using (true);
create policy "Event managers insert" on public.events for insert to authenticated with check ((select private.has_permission('events.manage')));
create policy "Event managers update" on public.events for update to authenticated using ((select private.has_permission('events.manage'))) with check ((select private.has_permission('events.manage')));
create policy "Event managers delete" on public.events for delete to authenticated using ((select private.has_permission('events.manage')));

create policy "Members read own fees" on public.fees for select to authenticated using (member_id = (select auth.uid()) or (select private.has_permission('fees.manage')));
create policy "Fee managers insert" on public.fees for insert to authenticated with check ((select private.has_permission('fees.manage')));
create policy "Fee managers update" on public.fees for update to authenticated using ((select private.has_permission('fees.manage'))) with check ((select private.has_permission('fees.manage')));
create policy "Fee managers delete" on public.fees for delete to authenticated using ((select private.has_permission('fees.manage')));

create policy "Members read attendance" on public.attendance for select to authenticated using (true);
create policy "Members insert own attendance" on public.attendance for insert to authenticated with check (member_id = (select auth.uid()));
create policy "Members update own attendance" on public.attendance for update to authenticated using (member_id = (select auth.uid()) or (select private.has_permission('events.manage'))) with check (member_id = (select auth.uid()) or (select private.has_permission('events.manage')));
create policy "Event managers delete attendance" on public.attendance for delete to authenticated using ((select private.has_permission('events.manage')));

create policy "Members create feedback" on public.feedback for insert to authenticated with check (author_id = (select auth.uid()));
create policy "Authors and managers read feedback" on public.feedback for select to authenticated using (author_id = (select auth.uid()) or (select private.has_permission('feedback.manage')));
create policy "Feedback managers update" on public.feedback for update to authenticated using ((select private.has_permission('feedback.manage'))) with check ((select private.has_permission('feedback.manage')));
create policy "Feedback managers delete" on public.feedback for delete to authenticated using ((select private.has_permission('feedback.manage')));

create policy "Published forms are visible" on public.participation_forms for select to anon, authenticated using (status in ('open', 'closed') or (select private.can_manage_form(kind)));
create policy "Form managers insert" on public.participation_forms for insert to authenticated with check ((select private.can_manage_form(kind)));
create policy "Form managers update" on public.participation_forms for update to authenticated using ((select private.can_manage_form(kind))) with check ((select private.can_manage_form(kind)));
create policy "Form managers delete" on public.participation_forms for delete to authenticated using ((select private.can_manage_form(kind)));

create policy "Published questions are visible" on public.participation_questions for select to anon, authenticated using (exists (select 1 from public.participation_forms f where f.id = form_id));
create policy "Question managers insert" on public.participation_questions for insert to authenticated with check (exists (select 1 from public.participation_forms f where f.id = form_id and (select private.can_manage_form(f.kind))));
create policy "Question managers update" on public.participation_questions for update to authenticated using (exists (select 1 from public.participation_forms f where f.id = form_id and (select private.can_manage_form(f.kind)))) with check (exists (select 1 from public.participation_forms f where f.id = form_id and (select private.can_manage_form(f.kind))));
create policy "Question managers delete" on public.participation_questions for delete to authenticated using (exists (select 1 from public.participation_forms f where f.id = form_id and (select private.can_manage_form(f.kind))));

create policy "Published options are visible" on public.participation_options for select to anon, authenticated using (exists (select 1 from public.participation_questions q join public.participation_forms f on f.id = q.form_id where q.id = question_id));
create policy "Option managers insert" on public.participation_options for insert to authenticated with check (exists (select 1 from public.participation_questions q join public.participation_forms f on f.id = q.form_id where q.id = question_id and (select private.can_manage_form(f.kind))));
create policy "Option managers update" on public.participation_options for update to authenticated using (exists (select 1 from public.participation_questions q join public.participation_forms f on f.id = q.form_id where q.id = question_id and (select private.can_manage_form(f.kind)))) with check (exists (select 1 from public.participation_questions q join public.participation_forms f on f.id = q.form_id where q.id = question_id and (select private.can_manage_form(f.kind))));
create policy "Option managers delete" on public.participation_options for delete to authenticated using (exists (select 1 from public.participation_questions q join public.participation_forms f on f.id = q.form_id where q.id = question_id and (select private.can_manage_form(f.kind))));

create policy "Members read own submission receipts" on public.participation_submissions for select to authenticated using (participant_id = (select auth.uid()) or exists (select 1 from public.participation_forms f where f.id = form_id and not f.secret_ballot and (select private.can_manage_form(f.kind))));
create policy "Members submit once to open forms" on public.participation_submissions for insert to authenticated with check (participant_id = (select auth.uid()) and (select private.form_is_open(form_id)));
create policy "Form managers delete submissions" on public.participation_submissions for delete to authenticated using (exists (select 1 from public.participation_forms f where f.id = form_id and (select private.can_manage_form(f.kind))));

create policy "Members and managers read answers" on public.participation_answers for select to authenticated using ((select private.is_own_submission(submission_id)) or exists (select 1 from public.participation_submissions s join public.participation_forms f on f.id = s.form_id where s.id = submission_id and (select private.can_manage_form(f.kind))));
create policy "Members answer own open submission" on public.participation_answers for insert to authenticated with check ((select private.is_own_submission(submission_id)) and exists (select 1 from public.participation_submissions s where s.id = submission_id and (select private.form_is_open(s.form_id))));
create policy "Members update own open answers" on public.participation_answers for update to authenticated using ((select private.is_own_submission(submission_id))) with check ((select private.is_own_submission(submission_id)) and exists (select 1 from public.participation_submissions s where s.id = submission_id and (select private.form_is_open(s.form_id))));
create policy "Form managers delete answers" on public.participation_answers for delete to authenticated using (exists (select 1 from public.participation_submissions s join public.participation_forms f on f.id = s.form_id where s.id = submission_id and (select private.can_manage_form(f.kind))));

alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.notices, public.events, public.participation_forms, public.participation_questions, public.participation_options to anon, authenticated;
grant select on public.role_permissions, public.fees, public.attendance, public.feedback, public.participation_submissions, public.participation_answers to authenticated;
grant insert, update, delete on public.profiles, public.role_permissions, public.notices, public.events, public.fees, public.attendance, public.feedback, public.participation_forms, public.participation_questions, public.participation_options, public.participation_submissions, public.participation_answers to authenticated;

insert into public.role_permissions (role, permission) values
  ('president', 'roles.manage'), ('president', 'members.manage'), ('president', 'fees.manage'),
  ('president', 'notices.manage'), ('president', 'events.manage'), ('president', 'feedback.manage'),
  ('president', 'elections.manage'), ('president', 'polls.manage'), ('president', 'surveys.manage'),
  ('vice_president', 'members.manage'), ('vice_president', 'notices.manage'), ('vice_president', 'events.manage'),
  ('vice_president', 'feedback.manage'), ('vice_president', 'elections.manage'), ('vice_president', 'polls.manage'),
  ('vice_president', 'surveys.manage'),
  ('treasurer', 'members.manage'), ('treasurer', 'fees.manage'), ('treasurer', 'feedback.manage');

insert into public.notices (title, body, is_pinned) values
  ('경충FC 클럽하우스가 열렸습니다', '회원, 회비, 공지, 주말 풋살 일정과 팀의 의사결정까지 이제 한곳에서 확인하고 참여할 수 있습니다.', true);
insert into public.events (title, starts_at, venue, address, note, capacity) values
  ('주말 정기 풋살', date_trunc('week', now()) + interval '5 days 9 hours', '구장 확정 후 안내', '서울', '흰색·검정색 유니폼을 모두 챙겨주세요.', 18);
insert into public.participation_forms (kind, title, description, status, starts_at, ends_at, show_results) values
  ('poll', '다음 달 정기 풋살 시작 시간', '가장 많은 회원이 참여할 수 있는 시간을 함께 결정합니다.', 'open', now(), now() + interval '14 days', true),
  ('survey', '경충FC 운영 만족도 조사', '더 나은 팀 운영을 위해 솔직한 의견을 들려주세요.', 'open', now(), now() + interval '30 days', false),
  ('election', '2027 회장단 선거', '후보 등록과 선거 일정은 추후 공지됩니다.', 'draft', null, null, true);

with target as (select id from public.participation_forms where kind = 'poll' limit 1),
question as (
  insert into public.participation_questions (form_id, prompt, type, position)
  select id, '선호하는 시작 시간은 언제인가요?', 'single_choice', 0 from target returning id
)
insert into public.participation_options (question_id, label, position)
select question.id, option.label, option.position from question cross join (values ('오후 4시', 0), ('오후 6시', 1), ('오후 8시', 2)) as option(label, position);

with target as (select id from public.participation_forms where kind = 'survey' limit 1)
insert into public.participation_questions (form_id, prompt, type, position, min_value, max_value)
select id, '현재 팀 운영에 얼마나 만족하시나요?', 'rating'::public.question_type, 0, 1, 5 from target
union all
select id, '경충FC에 바라는 점을 자유롭게 적어주세요.', 'long_text'::public.question_type, 1, null, null from target;
