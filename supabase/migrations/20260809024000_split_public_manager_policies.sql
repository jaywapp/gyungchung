drop policy if exists "Active profiles are visible" on public.profiles;
create policy "Active and own profiles are visible"
on public.profiles for select to anon, authenticated
using (status = 'active' or id = (select auth.uid()));
create policy "Member managers read all profiles"
on public.profiles for select to authenticated
using ((select private.has_permission('members.manage')));

drop policy if exists "Published forms are visible" on public.participation_forms;
create policy "Published forms are visible"
on public.participation_forms for select to anon, authenticated
using (status in ('open', 'closed'));
create policy "Form managers read all forms"
on public.participation_forms for select to authenticated
using ((select private.can_manage_form(kind)));

drop policy if exists "Published questions are visible" on public.participation_questions;
create policy "Published questions are visible"
on public.participation_questions for select to anon, authenticated
using (exists (
  select 1 from public.participation_forms f
  where f.id = form_id and f.status in ('open', 'closed')
));
create policy "Question managers read all questions"
on public.participation_questions for select to authenticated
using (exists (
  select 1 from public.participation_forms f
  where f.id = form_id and (select private.can_manage_form(f.kind))
));

drop policy if exists "Published options are visible" on public.participation_options;
create policy "Published options are visible"
on public.participation_options for select to anon, authenticated
using (exists (
  select 1
  from public.participation_questions q
  join public.participation_forms f on f.id = q.form_id
  where q.id = question_id and f.status in ('open', 'closed')
));
create policy "Option managers read all options"
on public.participation_options for select to authenticated
using (exists (
  select 1
  from public.participation_questions q
  join public.participation_forms f on f.id = q.form_id
  where q.id = question_id and (select private.can_manage_form(f.kind))
));
