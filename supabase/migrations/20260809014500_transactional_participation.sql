create or replace function public.submit_participation(target_form_id uuid, submitted_answers jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_submission_id uuid;
begin
  if (select auth.uid()) is null or not (select private.form_is_open(target_form_id)) then
    raise exception 'Form is not open for this member';
  end if;

  if jsonb_typeof(submitted_answers) is distinct from 'array' then
    raise exception 'Answers must be an array';
  end if;

  if exists (
    select 1
    from public.participation_questions q
    where q.form_id = target_form_id
      and q.is_required
      and not exists (
        select 1
        from jsonb_array_elements(submitted_answers) item
        where item ->> 'question_id' = q.id::text
      )
  ) then
    raise exception 'Required answer is missing';
  end if;

  insert into public.participation_submissions (form_id, participant_id)
  values (target_form_id, (select auth.uid()))
  returning id into new_submission_id;

  insert into public.participation_answers (submission_id, question_id, answer)
  select new_submission_id, (item ->> 'question_id')::uuid, item -> 'answer'
  from jsonb_array_elements(submitted_answers) item;

  return new_submission_id;
end;
$$;

revoke execute on function public.submit_participation(uuid, jsonb) from public, anon;
grant execute on function public.submit_participation(uuid, jsonb) to authenticated;
