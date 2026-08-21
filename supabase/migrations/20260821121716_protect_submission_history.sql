drop policy if exists "Members and managers read answers" on public.participation_answers;

create policy "Members and managers read non-secret answers"
on public.participation_answers for select to authenticated
using (
  exists (
    select 1
    from public.participation_submissions s
    join public.participation_forms f on f.id = s.form_id
    where s.id = participation_answers.submission_id
      and not f.secret_ballot
      and (
        s.participant_id = (select private.current_profile_id())
        or (select private.can_manage_form(f.kind))
      )
  )
);
