create or replace function private.capture_attendance_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; kind text; current_count integer;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 if new.status='going' then kind:='attendance_added';
 elsif tg_op='UPDATE' then if old.status='going' and new.status='not_going' then kind:='attendance_declined'; end if; end if;
 if kind is null then return new; end if;
 select * into e from public.events where id=new.event_id;
 if e.starts_at<=now() then return new; end if;
 select count(*)::integer into current_count from public.attendance where event_id=new.event_id and status='going';
 perform private.emit_notification(kind,'attendance','event',e.id,new.member_id,
  jsonb_build_object('title',e.title,'starts_at',e.starts_at,'venue',e.venue,'before_status',case when tg_op='UPDATE' then old.status::text else null end,'after_status',new.status,
   'member_name',(select name from public.profiles where id=new.member_id),'going_count',current_count),e.starts_at);
 return new;
end; $$;

create or replace function private.capture_feedback_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare old_response text; new_response text; response_changed boolean;
begin
 old_response:=nullif(trim(old.officer_response),'');
 new_response:=nullif(trim(new.officer_response),'');
 response_changed:=new_response is distinct from old_response;
 if new.status is distinct from old.status or response_changed then
  perform private.emit_notification('feedback_updated','feedback','feedback',new.id,new.author_id,
   jsonb_build_object('title',new.title,'before_status',old.status,'after_status',new.status,
    'status_changed',new.status is distinct from old.status,'has_response',new_response is not null,
    'response_changed',response_changed,'response_change',case when not response_changed then null when old_response is null then 'added' when new_response is null then 'removed' else 'edited' end,
    'response_summary',case when response_changed and new_response is not null then left(regexp_replace(new_response,'[[:space:]]+',' ','g'),100) else null end),now()+interval '7 days');
 end if;
 return new;
end; $$;

create or replace function private.notification_recipient_eligible(n private.notification_events,p public.profiles) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare audience text; officer boolean; e public.events%rowtype; f public.participation_forms%rowtype;
begin
 if p.status<>'active' or p.auth_user_id is null or p.must_change_password or p.is_test_account or n.expires_at<=now() then return false; end if;
 if not exists(select 1 from public.notification_preferences pref where pref.auth_user_id=p.auth_user_id and pref.enabled and coalesce((to_jsonb(pref)->>(n.category||'_enabled'))::boolean,false)) then return false; end if;
 officer:=p.is_system_admin or (p.role='manager' and p.officer_title is not null);
 if n.source_type='event' and n.kind<>'event_cancelled' then
  select * into e from public.events where id=n.source_id;
  if not found then return false; end if;
 end if;
 if n.category='attendance' then
  if e.starts_at<=now() or n.subject_profile_id=p.id then return false; end if;
  select attendance_audience into audience from private.notification_policy;
  return audience='all_active' or officer or (audience='officers_and_attendees' and exists(select 1 from public.attendance where event_id=e.id and member_id=p.id and status='going'));
 elsif n.kind='event_reminder' then
  return e.starts_at>now() and e.starts_at=(n.snapshot->>'starts_at')::timestamptz and exists(select 1 from public.attendance where event_id=e.id and member_id=p.id and status='going');
 elsif n.kind='rsvp_reminder' then
  return e.starts_at>now() and e.starts_at=(n.snapshot->>'deadline')::timestamptz and not exists(select 1 from public.attendance where event_id=e.id and member_id=p.id and status<>'undecided');
 elsif n.kind='participation_reminder' then
  select * into f from public.participation_forms where id=n.source_id;
  return found and f.status='open' and f.ends_at>now() and f.ends_at=(n.snapshot->>'deadline')::timestamptz and (f.starts_at is null or f.starts_at<=now()) and not exists(select 1 from public.participation_submissions where form_id=f.id and participant_id=p.id);
 elsif n.kind='feedback_updated' then
  return n.subject_profile_id=p.id and exists(select 1 from public.feedback where id=n.source_id and author_id=p.id);
 elsif n.kind='notice_created' then return exists(select 1 from public.notices where id=n.source_id);
 end if;
 return true;
end; $$;
