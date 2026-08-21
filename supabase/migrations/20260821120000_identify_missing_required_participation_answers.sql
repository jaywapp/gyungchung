create or replace function public.submit_participation(target_form_id uuid, submitted_answers jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  new_submission_id uuid;
  current_member_id uuid := (select private.current_profile_id());
  missing_question_id uuid;
begin
  if current_member_id is null or not (select private.form_is_open(target_form_id)) then raise exception 'Form is not open for this member'; end if;
  if jsonb_typeof(submitted_answers) is distinct from 'array' then raise exception 'Answers must be an array'; end if;

  select q.id into missing_question_id
  from public.participation_questions q
  where q.form_id = target_form_id
    and q.is_required
    and not exists (
      select 1
      from jsonb_array_elements(submitted_answers) item
      where item ->> 'question_id' = q.id::text
        and case q.type
          when 'multiple_choice' then
            case
              when jsonb_typeof(item -> 'answer') = 'array' then jsonb_array_length(item -> 'answer') > 0
              else false
            end
          when 'short_text' then jsonb_typeof(item -> 'answer') = 'string' and length(btrim(item ->> 'answer')) > 0
          when 'long_text' then jsonb_typeof(item -> 'answer') = 'string' and length(btrim(item ->> 'answer')) > 0
          when 'rating' then
            jsonb_typeof(item -> 'answer') = 'number'
            and (item ->> 'answer')::numeric between coalesce(q.min_value, 1) and coalesce(q.max_value, 5)
          else jsonb_typeof(item -> 'answer') = 'string' and length(item ->> 'answer') > 0
        end
    )
  order by q.position
  limit 1;

  if missing_question_id is not null then raise exception 'Required answer is missing for question %', missing_question_id; end if;

  insert into public.participation_submissions (form_id, participant_id)
  values (target_form_id, current_member_id) returning id into new_submission_id;
  insert into public.participation_answers (submission_id, question_id, answer)
  select new_submission_id, (item ->> 'question_id')::uuid, item -> 'answer'
  from jsonb_array_elements(submitted_answers) item;
  return new_submission_id;
end;
$$;
