create or replace function public.save_attendance_batch(
  target_event_id uuid,
  target_changes jsonb
)
returns table (
  result_index integer,
  result_member_id uuid,
  succeeded boolean,
  error_message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  change_data jsonb;
  change_index integer := 0;
  target_response_status public.attendance_status;
  target_check_in_status public.attendance_check_in_status;
  seen_member_ids uuid[] := array[]::uuid[];
begin
  if not (select private.has_permission('events.manage')) then
    raise exception 'Only event managers can save attendance';
  end if;
  if target_event_id is null or not exists (select 1 from public.events where id = target_event_id) then
    raise exception 'Event not found';
  end if;
  if target_changes is null or jsonb_typeof(target_changes) <> 'array' then
    raise exception 'Attendance changes must be an array';
  end if;
  if jsonb_array_length(target_changes) > 500 then
    raise exception 'Attendance changes cannot exceed 500 rows';
  end if;

  for change_data in select value from jsonb_array_elements(target_changes) loop
    change_index := change_index + 1;
    result_index := change_index;
    result_member_id := null;
    succeeded := false;
    error_message := null;

    begin
      result_member_id := nullif(change_data ->> 'member_id', '')::uuid;
      if result_member_id is null then
        raise exception 'Member id is required';
      end if;
      if result_member_id = any(seen_member_ids) then
        raise exception 'Duplicate member in attendance changes';
      end if;
      seen_member_ids := array_append(seen_member_ids, result_member_id);
      if not exists (
        select 1 from public.profiles
        where id = result_member_id and status = 'active'::public.member_status
      ) then
        raise exception 'Active member not found';
      end if;

      target_response_status := coalesce(nullif(change_data ->> 'response_status', ''), 'undecided')::public.attendance_status;
      if not (change_data ? 'check_in_status') then
        raise exception 'Check-in status is required';
      end if;
      target_check_in_status := case
        when jsonb_typeof(change_data -> 'check_in_status') = 'null' then null
        else (change_data ->> 'check_in_status')::public.attendance_check_in_status
      end;

      if target_check_in_status is null then
        update public.attendance
        set check_in_status = null,
            checked_in_at = null,
            checked_in_by = null
        where event_id = target_event_id and member_id = result_member_id;
      else
        insert into public.attendance (event_id, member_id, status, check_in_status)
        values (target_event_id, result_member_id, target_response_status, target_check_in_status)
        on conflict (event_id, member_id) do update
        set check_in_status = excluded.check_in_status;
      end if;

      succeeded := true;
    exception when others then
      succeeded := false;
      error_message := sqlerrm;
    end;

    return next;
  end loop;
end;
$$;

revoke all on function public.save_attendance_batch(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_batch(uuid, jsonb)
to authenticated;
