create or replace function private.participation_form_has_responses(target_form_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participation_forms f
    join public.participation_submissions s on s.form_id = f.id
    where f.id = target_form_id
      and (select private.can_manage_form(f.kind))
  );
$$;

revoke all on function private.participation_form_has_responses(uuid) from public, anon, authenticated, service_role;
grant execute on function private.participation_form_has_responses(uuid) to authenticated;

create or replace function public.participation_form_has_responses(target_form_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  target_kind public.participation_kind;
begin
  select f.kind into target_kind
  from public.participation_forms f
  where f.id = target_form_id;

  if target_kind is null or not (select private.can_manage_form(target_kind)) then
    raise exception 'Participation form management permission is required';
  end if;

  return (select private.participation_form_has_responses(target_form_id));
end;
$$;

revoke execute on function public.participation_form_has_responses(uuid) from public, anon, authenticated, service_role;
grant execute on function public.participation_form_has_responses(uuid) to authenticated;

create or replace function public.protect_answered_participation_question()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_form_id uuid;
begin
  affected_form_id := case when tg_op = 'DELETE' then old.form_id else new.form_id end;
  if not (select private.participation_form_has_responses(affected_form_id)) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then raise exception 'Answered questions cannot be deleted'; end if;
  if tg_op = 'INSERT' and new.is_required then raise exception 'New questions on an answered form must be optional'; end if;
  if tg_op = 'UPDATE' then
    if new.form_id is distinct from old.form_id then raise exception 'Answered questions cannot move to another form'; end if;
    if new.type is distinct from old.type then raise exception 'Answered question type cannot be changed'; end if;
    if not old.is_required and new.is_required then raise exception 'Answered optional question cannot become required'; end if;
    if old.type = 'rating' and (coalesce(new.min_value, 1) is distinct from coalesce(old.min_value, 1) or coalesce(new.max_value, 5) is distinct from coalesce(old.max_value, 5)) then raise exception 'Answered rating range cannot be changed'; end if;
    if new.prompt is distinct from old.prompt and coalesce(current_setting('app.acknowledge_participation_response_impact', true), 'false') <> 'true' then
      raise exception 'Answered question prompt change needs confirmation';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke execute on function public.protect_answered_participation_question() from public, anon, authenticated, service_role;
create trigger protect_answered_participation_question_before_write
before insert or update or delete on public.participation_questions
for each row execute function public.protect_answered_participation_question();

create or replace function public.protect_answered_participation_option()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_question_id uuid;
  affected_form_id uuid;
begin
  affected_question_id := case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  select q.form_id into affected_form_id from public.participation_questions q where q.id = affected_question_id;
  if affected_form_id is null or not (select private.participation_form_has_responses(affected_form_id)) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then raise exception 'Answered option cannot be deleted'; end if;
  if tg_op = 'UPDATE' then
    if new.question_id is distinct from old.question_id then raise exception 'Answered options cannot move to another question'; end if;
    if new.label is distinct from old.label then raise exception 'Answered option label cannot be changed'; end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke execute on function public.protect_answered_participation_option() from public, anon, authenticated, service_role;
create trigger protect_answered_participation_option_before_write
before update or delete on public.participation_options
for each row execute function public.protect_answered_participation_option();

create or replace function public.protect_answered_participation_form_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select private.participation_form_has_responses(old.id)) then
    raise exception 'Answered participation forms cannot be deleted';
  end if;
  return old;
end;
$$;

revoke execute on function public.protect_answered_participation_form_delete() from public, anon, authenticated, service_role;
create trigger protect_answered_participation_form_before_delete
before delete on public.participation_forms
for each row execute function public.protect_answered_participation_form_delete();

create or replace function public.save_participation_form(
  target_form_id uuid,
  form_payload jsonb,
  questions_payload jsonb,
  acknowledge_response_impact boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_form_id uuid := target_form_id;
  saved_kind public.participation_kind;
  requested_kind public.participation_kind;
  has_responses boolean := false;
  question_item jsonb;
  option_item jsonb;
  saved_question_id uuid;
  saved_option_id uuid;
  existing_question public.participation_questions%rowtype;
  existing_option public.participation_options%rowtype;
  question_position integer := 0;
  option_position integer;
  question_offset integer;
  option_offset integer;
  question_type_text text;
  question_min integer;
  question_max integer;
begin
  perform pg_catalog.set_config('app.acknowledge_participation_response_impact', case when acknowledge_response_impact then 'true' else 'false' end, true);
  if jsonb_typeof(form_payload) is distinct from 'object'
    or jsonb_typeof(questions_payload) is distinct from 'array'
    or jsonb_array_length(questions_payload) < 1
    or jsonb_array_length(questions_payload) > 50 then
    raise exception 'A participation form needs between 1 and 50 questions';
  end if;

  requested_kind := (form_payload ->> 'kind')::public.participation_kind;

  if target_form_id is null then
    if not (select private.can_manage_form(requested_kind)) then
      raise exception 'Participation form management permission is required';
    end if;

    insert into public.participation_forms (
      kind, title, description, status, starts_at, ends_at,
      secret_ballot, show_results, created_by
    ) values (
      requested_kind,
      trim(form_payload ->> 'title'),
      nullif(trim(form_payload ->> 'description'), ''),
      (form_payload ->> 'status')::public.participation_status,
      nullif(form_payload ->> 'starts_at', '')::timestamptz,
      nullif(form_payload ->> 'ends_at', '')::timestamptz,
      coalesce((form_payload ->> 'secret_ballot')::boolean, false),
      coalesce((form_payload ->> 'show_results')::boolean, true),
      (select private.current_profile_id())
    ) returning id, kind into saved_form_id, saved_kind;
  else
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_form_id::text, 0));

    select f.kind into saved_kind
    from public.participation_forms f
    where f.id = target_form_id
    for update;

    if saved_kind is null or not (select private.can_manage_form(saved_kind)) then
      raise exception 'Participation form management permission is required';
    end if;
    if requested_kind is distinct from saved_kind then
      raise exception 'Participation form kind cannot be changed';
    end if;

    has_responses := (select private.participation_form_has_responses(target_form_id));

    update public.participation_forms set
      title = trim(form_payload ->> 'title'),
      description = nullif(trim(form_payload ->> 'description'), ''),
      status = (form_payload ->> 'status')::public.participation_status,
      starts_at = nullif(form_payload ->> 'starts_at', '')::timestamptz,
      ends_at = nullif(form_payload ->> 'ends_at', '')::timestamptz,
      secret_ballot = coalesce((form_payload ->> 'secret_ballot')::boolean, false),
      show_results = coalesce((form_payload ->> 'show_results')::boolean, true),
      updated_at = now()
    where id = target_form_id;
  end if;

  for question_item in select value from jsonb_array_elements(questions_payload) loop
    question_type_text := question_item ->> 'type';
    if question_type_text not in ('single_choice', 'multiple_choice', 'yes_no', 'short_text', 'long_text', 'rating') then
      raise exception 'Unsupported participation question type';
    end if;
    if coalesce(char_length(trim(question_item ->> 'prompt')), 0) not between 1 and 500 then
      raise exception 'Question prompt must contain between 1 and 500 characters';
    end if;
    if jsonb_typeof(question_item -> 'options') is distinct from 'array' then
      raise exception 'Question options must be an array';
    end if;

    if question_type_text in ('single_choice', 'multiple_choice', 'yes_no') then
      if jsonb_array_length(question_item -> 'options') < 2
        or (question_type_text = 'yes_no' and jsonb_array_length(question_item -> 'options') <> 2)
        or exists (
          select 1 from jsonb_array_elements(question_item -> 'options') item
          where char_length(trim(item ->> 'label')) not between 1 and 200
        )
        or exists (
          select 1 from jsonb_array_elements(question_item -> 'options') item
          group by trim(item ->> 'label') having count(*) > 1
        ) then
        raise exception 'Choice questions need valid and unique options';
      end if;
    elsif jsonb_array_length(question_item -> 'options') <> 0 then
      raise exception 'Only choice questions can have options';
    end if;

    question_min := case when question_type_text = 'rating' then (question_item ->> 'min_value')::integer else null end;
    question_max := case when question_type_text = 'rating' then (question_item ->> 'max_value')::integer else null end;
    if question_type_text = 'rating' and (question_min < 0 or question_max > 10 or question_min >= question_max) then
      raise exception 'Rating range must be between 0 and 10';
    end if;

    if nullif(question_item ->> 'id', '') is not null then
      saved_question_id := (question_item ->> 'id')::uuid;
      select q.* into existing_question
      from public.participation_questions q
      where q.id = saved_question_id and q.form_id = saved_form_id;
      if not found then raise exception 'Question does not belong to this form'; end if;

      if has_responses then
        if existing_question.type::text <> question_type_text then raise exception 'Answered question type cannot be changed'; end if;
        if not existing_question.is_required and coalesce((question_item ->> 'is_required')::boolean, true) then raise exception 'Answered optional question cannot become required'; end if;
        if existing_question.type = 'rating' and (coalesce(existing_question.min_value, 1) is distinct from question_min or coalesce(existing_question.max_value, 5) is distinct from question_max) then raise exception 'Answered rating range cannot be changed'; end if;
        if existing_question.prompt is distinct from trim(question_item ->> 'prompt') and not acknowledge_response_impact then raise exception 'Answered question prompt change needs confirmation'; end if;

        for existing_option in
          select o.* from public.participation_options o where o.question_id = saved_question_id
        loop
          select item.value into option_item
          from jsonb_array_elements(question_item -> 'options') item(value)
          where item.value ->> 'id' = existing_option.id::text;
          if not found then raise exception 'Answered option cannot be deleted'; end if;
          if existing_option.label is distinct from trim(option_item ->> 'label') then raise exception 'Answered option label cannot be changed'; end if;
        end loop;
      end if;
    elsif has_responses and coalesce((question_item ->> 'is_required')::boolean, true) then
      raise exception 'New questions on an answered form must be optional';
    end if;
  end loop;

  if has_responses and exists (
    select 1 from public.participation_questions q
    where q.form_id = saved_form_id
      and not exists (
        select 1 from jsonb_array_elements(questions_payload) item
        where item ->> 'id' = q.id::text
      )
  ) then
    raise exception 'Answered questions cannot be deleted';
  end if;

  select coalesce(max(q.position), 0) + jsonb_array_length(questions_payload) + 1 into question_offset
  from public.participation_questions q where q.form_id = saved_form_id;
  update public.participation_questions set position = position + question_offset where form_id = saved_form_id;

  question_position := 0;
  for question_item in select value from jsonb_array_elements(questions_payload) loop
    question_type_text := question_item ->> 'type';
    question_min := case when question_type_text = 'rating' then (question_item ->> 'min_value')::integer else null end;
    question_max := case when question_type_text = 'rating' then (question_item ->> 'max_value')::integer else null end;

    if nullif(question_item ->> 'id', '') is null then
      insert into public.participation_questions (form_id, prompt, type, is_required, position, min_value, max_value)
      values (saved_form_id, trim(question_item ->> 'prompt'), question_type_text::public.question_type, coalesce((question_item ->> 'is_required')::boolean, true), question_position, question_min, question_max)
      returning id into saved_question_id;
    else
      saved_question_id := (question_item ->> 'id')::uuid;
      update public.participation_questions set
        prompt = trim(question_item ->> 'prompt'),
        type = question_type_text::public.question_type,
        is_required = coalesce((question_item ->> 'is_required')::boolean, true),
        position = question_position,
        min_value = question_min,
        max_value = question_max
      where id = saved_question_id and form_id = saved_form_id;
      if not found then raise exception 'Question does not belong to this form'; end if;
    end if;

    select coalesce(max(o.position), 0) + jsonb_array_length(question_item -> 'options') + 1 into option_offset
    from public.participation_options o where o.question_id = saved_question_id;
    update public.participation_options set position = position + option_offset where question_id = saved_question_id;

    option_position := 0;
    for option_item in select value from jsonb_array_elements(question_item -> 'options') loop
      if nullif(option_item ->> 'id', '') is null then
        insert into public.participation_options (question_id, label, position)
        values (saved_question_id, trim(option_item ->> 'label'), option_position);
      else
        saved_option_id := (option_item ->> 'id')::uuid;
        update public.participation_options set label = trim(option_item ->> 'label'), position = option_position
        where id = saved_option_id and question_id = saved_question_id;
        if not found then raise exception 'Option does not belong to this question'; end if;
      end if;
      option_position := option_position + 1;
    end loop;

    delete from public.participation_options o
    where o.question_id = saved_question_id
      and not exists (
        select 1 from jsonb_array_elements(question_item -> 'options') item
        where item ->> 'id' = o.id::text
      );
    question_position := question_position + 1;
  end loop;

  delete from public.participation_questions q
  where q.form_id = saved_form_id
    and not exists (
      select 1 from jsonb_array_elements(questions_payload) item
      where item ->> 'id' = q.id::text
    );

  return saved_form_id;
end;
$$;

revoke execute on function public.save_participation_form(uuid, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_participation_form(uuid, jsonb, jsonb, boolean) to authenticated;

create or replace function public.submit_participation(target_form_id uuid, submitted_answers jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_submission_id uuid;
  current_member_id uuid := (select private.current_profile_id());
  missing_question_id uuid;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_form_id::text, 0));
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

revoke execute on function public.submit_participation(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_participation(uuid, jsonb) to authenticated;
