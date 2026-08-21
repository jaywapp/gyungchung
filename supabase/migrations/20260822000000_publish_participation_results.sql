create or replace function private.aggregate_participation_results(target_form_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_id', q.id,
      'prompt', q.prompt,
      'type', q.type,
      'response_count', (
        select count(*)
        from public.participation_answers a
        join public.participation_submissions s on s.id = a.submission_id
        where s.form_id = target_form_id and a.question_id = q.id
      ),
      'average', case when q.type = 'rating' then (
        select round(avg((a.answer #>> '{}')::numeric), 2)
        from public.participation_answers a
        join public.participation_submissions s on s.id = a.submission_id
        where s.form_id = target_form_id and a.question_id = q.id
      ) else null end,
      'options', case
        when q.type in ('single_choice', 'multiple_choice', 'yes_no') then coalesce((
          select jsonb_agg(jsonb_build_object(
            'option_id', o.id,
            'label', o.label,
            'count', (
              select count(*)
              from public.participation_answers a
              join public.participation_submissions s on s.id = a.submission_id
              where s.form_id = target_form_id
                and a.question_id = q.id
                and (
                  (q.type = 'multiple_choice' and a.answer ? o.id::text)
                  or (q.type <> 'multiple_choice' and a.answer #>> '{}' = o.id::text)
                )
            )
          ) order by o.position)
          from public.participation_options o
          where o.question_id = q.id
        ), '[]'::jsonb)
        when q.type = 'rating' then coalesce((
          select jsonb_agg(jsonb_build_object(
            'option_id', score::text,
            'label', score::text,
            'count', (
              select count(*)
              from public.participation_answers a
              join public.participation_submissions s on s.id = a.submission_id
              where s.form_id = target_form_id
                and a.question_id = q.id
                and (a.answer #>> '{}')::numeric = score
            )
          ) order by score)
          from generate_series(coalesce(q.min_value, 1), coalesce(q.max_value, 5)) score
        ), '[]'::jsonb)
        else '[]'::jsonb
      end
    ) order by q.position
  ), '[]'::jsonb)
  from public.participation_questions q
  where q.form_id = target_form_id;
$$;

revoke all on function private.aggregate_participation_results(uuid) from public, anon, authenticated, service_role;
grant execute on function private.aggregate_participation_results(uuid) to authenticated;

create or replace function public.get_participation_results(target_form_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = (select private.current_profile_id())
      and p.status = 'active'::public.member_status
  ) then
    raise exception 'Active membership is required to view participation results';
  end if;

  if not exists (
    select 1
    from public.participation_forms f
    where f.id = target_form_id
      and f.status = 'closed'::public.participation_status
      and f.show_results
      and (f.ends_at is null or f.ends_at <= now())
  ) then
    raise exception 'Participation results are not public';
  end if;

  return private.aggregate_participation_results(target_form_id);
end;
$$;

revoke all on function public.get_participation_results(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_participation_results(uuid) to authenticated;
