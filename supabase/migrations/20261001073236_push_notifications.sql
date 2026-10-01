-- Rollout is disabled and restricted to explicitly allowlisted test accounts.
create table public.notification_preferences (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 attendance_enabled boolean not null default true, schedule_enabled boolean not null default true,
 notices_enabled boolean not null default true, event_reminders_enabled boolean not null default true,
 rsvp_reminders_enabled boolean not null default true, participation_enabled boolean not null default true,
 feedback_enabled boolean not null default true, updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon,authenticated;
grant select on public.notification_preferences to authenticated;
create policy "Members read own notification preferences" on public.notification_preferences
 for select to authenticated using(auth_user_id=(select auth.uid()));

create table private.notification_policy (
 singleton boolean primary key default true check(singleton),
 attendance_audience text not null default 'officers_and_attendees' check(attendance_audience in ('officers_and_attendees','officers','all_active')),
 event_reminder_hour integer not null default 18 check(event_reminder_hour between 0 and 23),
 rsvp_reminder_hours integer not null default 24 check(rsvp_reminder_hours between 1 and 168),
 participation_reminder_hours integer not null default 24 check(participation_reminder_hours between 1 and 168)
);
insert into private.notification_policy default values;
create table private.notification_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, test_auth_user_ids uuid[] not null default '{}',
 allowed_project_id uuid, disabled_categories text[] not null default '{}'
);
insert into private.notification_runtime default values;
create table private.push_installations (
 id uuid primary key, proof_hash text not null, revocation_hash text not null,
 revocation_expires_at timestamptz not null, auth_user_id uuid references auth.users(id) on delete cascade,
 profile_id uuid references public.profiles(id) on delete cascade,
 transition_epoch bigint not null check(transition_epoch>=0), binding_revision bigint not null default 1 check(binding_revision>0),
 tombstoned boolean not null default false, expo_token text not null,
 platform text not null check(platform in ('android','ios')),
 permission_state text not null check(permission_state in ('granted','denied','undetermined')),
 project_id uuid not null, enabled boolean not null default false, last_seen_at timestamptz not null default now()
);
create index push_installations_owner_idx on private.push_installations(auth_user_id);
create unique index push_installations_live_token_idx on private.push_installations(expo_token) where enabled and not tombstoned;
create table private.notification_events (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('attendance_added','attendance_declined','schedule_changed','notice_created','event_cancelled','event_reminder','rsvp_reminder','participation_reminder','feedback_updated')),
 category text not null check(category in ('attendance','schedule','notices','event_reminders','rsvp_reminders','participation','feedback')),
 source_type text not null check(source_type in ('event','notice','participation_form','feedback')),
 source_id uuid not null, actor_auth_user_id uuid, actor_profile_id uuid, subject_profile_id uuid,
 snapshot jsonb not null default '{}', dedupe_key text unique,
 created_at timestamptz not null default now(), expires_at timestamptz not null, expanded_at timestamptz
);
create index notification_events_pending_idx on private.notification_events(created_at) where expanded_at is null;
create table private.notification_deliveries (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references private.notification_events(id) on delete cascade,
 installation_id uuid not null references private.push_installations(id) on delete cascade, auth_user_id uuid not null,
 binding_revision bigint not null, transition_epoch bigint not null,
 status text not null default 'pending' check(status in ('pending','claimed','sending','ticket','delivered','skipped','failed','unknown')),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), ticket_id text, ticket_at timestamptz, token_hash text, receipt_checked_at timestamptz, error_code text,
 unique(event_id,installation_id)
);
create index notification_deliveries_pending_idx on private.notification_deliveries(next_attempt_at) where status in ('pending','claimed');
create index notification_deliveries_receipt_idx on private.notification_deliveries(next_attempt_at) where status='ticket';
create table private.rsvp_reminder_requests (
 event_id uuid primary key references public.events(id) on delete cascade, requested_at timestamptz not null, actor_profile_id uuid not null
);
alter table private.notification_policy enable row level security;
alter table private.notification_runtime enable row level security;
alter table private.push_installations enable row level security;
alter table private.notification_events enable row level security;
alter table private.notification_deliveries enable row level security;
alter table private.rsvp_reminder_requests enable row level security;
revoke all on private.notification_policy,private.notification_runtime,private.push_installations,
 private.notification_events,private.notification_deliveries,private.rsvp_reminder_requests from public,anon,authenticated;

create table private.push_revocation_tombstones (
 installation_id uuid not null, revocation_hash text not null, transition_epoch bigint not null,
 expires_at timestamptz not null default now()+interval '30 days', primary key(installation_id,revocation_hash)
);
create index push_revocation_tombstones_expiry_idx on private.push_revocation_tombstones(expires_at);
alter table private.push_revocation_tombstones enable row level security;
revoke all on private.push_revocation_tombstones from public,anon,authenticated;
create function private.notification_member_id() returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 select id into result from public.profiles where auth_user_id=(select auth.uid()) and status='active' and not must_change_password;
 if result is null then raise exception 'Active member with completed password change required' using errcode='42501'; end if;
 return result;
end; $$;
revoke all on function private.notification_member_id() from public,anon,authenticated;
create function public.get_notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare preferences jsonb; policy jsonb;
begin
 perform private.notification_member_id();
 select to_jsonb(p)-'auth_user_id'-'updated_at' into preferences from public.notification_preferences p where auth_user_id=(select auth.uid());
 preferences:=coalesce(preferences,'{"enabled":false,"attendance_enabled":true,"schedule_enabled":true,"notices_enabled":true,"event_reminders_enabled":true,"rsvp_reminders_enabled":true,"participation_enabled":true,"feedback_enabled":true}'::jsonb);
 select to_jsonb(p)-'singleton' into policy from private.notification_policy p;
 return jsonb_build_object('preferences',preferences,'policy',policy,'can_manage_policy',private.has_permission('events.manage'),'can_send_rsvp_reminder',private.has_permission('events.manage'));
end; $$;
create function public.save_notification_preferences(target_preferences jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 perform private.notification_member_id();
 if target_preferences is null or jsonb_typeof(target_preferences)<>'object' or exists(
  select 1 from jsonb_each(target_preferences) kv where kv.key not in ('enabled','attendance_enabled','schedule_enabled','notices_enabled','event_reminders_enabled','rsvp_reminders_enabled','participation_enabled','feedback_enabled') or jsonb_typeof(kv.value)<>'boolean'
 ) then raise exception 'Invalid notification preferences'; end if;
 perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text,1));
 m:=(public.get_notification_settings()->'preferences')||target_preferences;
 insert into public.notification_preferences(auth_user_id,enabled,attendance_enabled,schedule_enabled,notices_enabled,event_reminders_enabled,rsvp_reminders_enabled,participation_enabled,feedback_enabled)
 values((select auth.uid()),(m->>'enabled')::boolean,(m->>'attendance_enabled')::boolean,(m->>'schedule_enabled')::boolean,(m->>'notices_enabled')::boolean,(m->>'event_reminders_enabled')::boolean,(m->>'rsvp_reminders_enabled')::boolean,(m->>'participation_enabled')::boolean,(m->>'feedback_enabled')::boolean)
 on conflict(auth_user_id) do update set enabled=excluded.enabled,attendance_enabled=excluded.attendance_enabled,schedule_enabled=excluded.schedule_enabled,notices_enabled=excluded.notices_enabled,
 event_reminders_enabled=excluded.event_reminders_enabled,rsvp_reminders_enabled=excluded.rsvp_reminders_enabled,participation_enabled=excluded.participation_enabled,feedback_enabled=excluded.feedback_enabled,updated_at=now();
 if not (m->>'enabled')::boolean then update private.push_installations set enabled=false where auth_user_id=(select auth.uid()); end if;
 return public.get_notification_settings();
end; $$;
create function public.save_notification_policy(target_policy jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 perform private.notification_member_id();
 if not private.has_permission('events.manage') then raise exception 'Event management permission required' using errcode='42501'; end if;
 if target_policy is null or jsonb_typeof(target_policy)<>'object' or exists(select 1 from jsonb_object_keys(target_policy) k where k not in ('attendance_audience','event_reminder_hour','rsvp_reminder_hours','participation_reminder_hours'))
 then raise exception 'Invalid notification policy'; end if;
 select to_jsonb(p)||target_policy into m from private.notification_policy p for update;
 update private.notification_policy set attendance_audience=m->>'attendance_audience',event_reminder_hour=(m->>'event_reminder_hour')::integer,rsvp_reminder_hours=(m->>'rsvp_reminder_hours')::integer,participation_reminder_hours=(m->>'participation_reminder_hours')::integer;
 return public.get_notification_settings();
end; $$;

create function public.register_push_installation(target_installation_id uuid,target_installation_proof text,target_revocation_proof text,target_transition_epoch bigint,target_binding_revision bigint,target_expo_token text,target_platform text,target_permission_state text,target_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member_id uuid; i private.push_installations%rowtype; active boolean; ph text; rh text; revoked_epoch bigint;
begin
 member_id:=private.notification_member_id();
 if target_installation_id is null or target_installation_proof is null or target_installation_proof !~ '^[a-f0-9]{64}$' or target_revocation_proof is null or target_revocation_proof !~ '^[a-f0-9]{64}$'
 or target_transition_epoch is null or target_transition_epoch<0 or target_transition_epoch>9007199254740991 or target_binding_revision is null or target_binding_revision<0 or target_binding_revision>9007199254740991 or target_project_id is null
 or target_expo_token is null or target_expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or char_length(target_expo_token)>256
 or target_platform is null or target_platform not in ('android','ios') or target_permission_state is null or target_permission_state not in ('granted','denied','undetermined')
 then raise exception 'Invalid installation'; end if;
 ph:=encode(sha256(convert_to(target_installation_proof,'UTF8')),'hex'); rh:=encode(sha256(convert_to(target_revocation_proof,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,2));
 perform pg_advisory_xact_lock(hashtextextended(target_expo_token,3));
 delete from private.push_revocation_tombstones where installation_id=target_installation_id and expires_at<=now();
 select transition_epoch into revoked_epoch from private.push_revocation_tombstones
 where installation_id=target_installation_id and revocation_hash=rh and expires_at>now();
 if revoked_epoch is not null and target_transition_epoch<=revoked_epoch then
  return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',revoked_epoch,'binding_revision',target_binding_revision,'enabled',false,'stale',true);
 end if;
 select * into i from private.push_installations where id=target_installation_id for update;
 if found then
  if i.proof_hash<>ph then raise exception 'Invalid installation proof' using errcode='42501'; end if;
  if target_transition_epoch<i.transition_epoch or (target_transition_epoch=i.transition_epoch and (i.tombstoned or i.auth_user_id is distinct from (select auth.uid()))) or target_binding_revision<>i.binding_revision then
   return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'enabled',false,'stale',true);
  end if;
  if target_transition_epoch>i.transition_epoch and rh=i.revocation_hash then raise exception 'New transition requires a new revocation proof' using errcode='42501'; end if;
  if target_transition_epoch=i.transition_epoch and rh<>i.revocation_hash then raise exception 'Revocation proof must remain stable within a binding' using errcode='42501'; end if;
 elsif target_binding_revision<>0 then raise exception 'Unknown installation binding'; end if;
 active:=target_permission_state='granted' and coalesce((select enabled from public.notification_preferences where auth_user_id=(select auth.uid())),false);

 update private.push_installations set enabled=false where expo_token=target_expo_token and id<>target_installation_id;
 insert into private.push_installations(id,proof_hash,revocation_hash,revocation_expires_at,auth_user_id,profile_id,transition_epoch,binding_revision,expo_token,platform,permission_state,project_id,enabled)
 values(target_installation_id,ph,rh,now()+interval '30 days',(select auth.uid()),member_id,target_transition_epoch,1,target_expo_token,target_platform,target_permission_state,target_project_id,active)
 on conflict(id) do update set revocation_hash=excluded.revocation_hash,revocation_expires_at=excluded.revocation_expires_at,auth_user_id=excluded.auth_user_id,profile_id=excluded.profile_id,transition_epoch=excluded.transition_epoch,
 binding_revision=case when private.push_installations.transition_epoch=excluded.transition_epoch and private.push_installations.auth_user_id=excluded.auth_user_id then private.push_installations.binding_revision else private.push_installations.binding_revision+1 end,
 tombstoned=false,expo_token=excluded.expo_token,platform=excluded.platform,permission_state=excluded.permission_state,project_id=excluded.project_id,enabled=excluded.enabled,last_seen_at=now()
 returning * into i;
 return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'revocation_expires_at',i.revocation_expires_at,'enabled',i.enabled,'stale',false);
end; $$;
create function public.revoke_push_installation(target_installation_id uuid,target_binding_revision bigint,target_transition_epoch bigint,target_revocation_proof text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.push_installations%rowtype; revoked boolean:=false; rh text;
begin
 if target_installation_id is null or target_revocation_proof is null or target_revocation_proof !~ '^[a-f0-9]{64}$' or target_transition_epoch is null or target_transition_epoch<0 or target_transition_epoch>9007199254740991 or target_binding_revision is null or target_binding_revision<0 or target_binding_revision>9007199254740991 then raise exception 'Invalid revocation'; end if;
 rh:=encode(sha256(convert_to(target_revocation_proof,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,2));
 select * into i from private.push_installations where id=target_installation_id for update;
 if not found then
  insert into private.push_revocation_tombstones(installation_id,revocation_hash,transition_epoch)
  values(target_installation_id,rh,target_transition_epoch)
  on conflict(installation_id,revocation_hash) do update set transition_epoch=greatest(private.push_revocation_tombstones.transition_epoch,excluded.transition_epoch);
  return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',target_transition_epoch,'binding_revision',target_binding_revision,'revoked',true,'terminal',true,'enabled',false);
 end if;
 if i.revocation_hash<>rh or i.revocation_expires_at<=now() then
  return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',target_transition_epoch,'binding_revision',target_binding_revision,'revoked',false,'terminal',true,'enabled',false);
 end if;
 if (target_binding_revision=0 or target_binding_revision=i.binding_revision) and target_transition_epoch>i.transition_epoch then
  update private.push_installations set enabled=false,tombstoned=true,transition_epoch=target_transition_epoch where id=target_installation_id returning * into i;
  insert into private.push_revocation_tombstones(installation_id,revocation_hash,transition_epoch) values(i.id,rh,i.transition_epoch)
  on conflict(installation_id,revocation_hash) do update set transition_epoch=greatest(private.push_revocation_tombstones.transition_epoch,excluded.transition_epoch);
  revoked:=true;
 elsif i.tombstoned and target_transition_epoch=i.transition_epoch then revoked:=true; end if;
 return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'enabled',false,'revoked',revoked,'terminal',true);
end; $$;
revoke all on function public.get_notification_settings(),public.save_notification_preferences(jsonb),public.save_notification_policy(jsonb),public.register_push_installation(uuid,text,text,bigint,bigint,text,text,text,uuid),public.revoke_push_installation(uuid,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.get_notification_settings(),public.save_notification_preferences(jsonb),public.save_notification_policy(jsonb),public.register_push_installation(uuid,text,text,bigint,bigint,text,text,text,uuid) to authenticated;
grant execute on function public.revoke_push_installation(uuid,bigint,bigint,text) to anon,authenticated;

create function private.emit_notification(target_kind text,target_category text,target_type text,target_source uuid,target_subject uuid,target_snapshot jsonb,target_expires timestamptz,target_dedupe text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare notification_id uuid;
begin
 insert into private.notification_events(kind,category,source_type,source_id,actor_auth_user_id,actor_profile_id,subject_profile_id,snapshot,expires_at,dedupe_key)
 values(target_kind,target_category,target_type,target_source,(select auth.uid()),private.current_profile_id(),target_subject,target_snapshot,target_expires,target_dedupe)
 on conflict(dedupe_key) do nothing returning id into notification_id;
 return notification_id;
end; $$;
revoke all on function private.emit_notification(text,text,text,uuid,uuid,jsonb,timestamptz,text) from public,anon,authenticated;

create function private.capture_attendance_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; kind text;
begin
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 if new.status='going' then kind:='attendance_added';
 elsif tg_op='UPDATE' then if old.status='going' and new.status='not_going' then kind:='attendance_declined'; end if; end if;
 if kind is null then return new; end if;
 select * into e from public.events where id=new.event_id;
 if e.starts_at<=now() then return new; end if;
 perform private.emit_notification(kind,'attendance','event',e.id,new.member_id,
  jsonb_build_object('title',e.title,'starts_at',e.starts_at,'venue',e.venue,'before_status',case when tg_op='UPDATE' then old.status::text else null end,'after_status',new.status,
   'member_name',(select name from public.profiles where id=new.member_id)),e.starts_at);
 return new;
end; $$;
create trigger capture_attendance_notification after insert or update on public.attendance for each row execute function private.capture_attendance_notification();

create function private.capture_schedule_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.starts_at is distinct from old.starts_at or new.venue is distinct from old.venue or new.address is distinct from old.address) and (old.starts_at>now() or new.starts_at>now()) then
  perform private.emit_notification('schedule_changed','schedule','event',new.id,null,
   jsonb_build_object('title',new.title,'before',jsonb_build_object('starts_at',old.starts_at,'venue',old.venue,'address',old.address),
    'after',jsonb_build_object('starts_at',new.starts_at,'venue',new.venue,'address',new.address)),greatest(new.starts_at,now()+interval '2 hours'));
 end if;
 return new;
end; $$;
create trigger capture_schedule_notification after update on public.events for each row execute function private.capture_schedule_notification();

create function private.capture_notice_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.emit_notification('notice_created','notices','notice',new.id,null,jsonb_build_object('title',new.title),now()+interval '7 days');
 return new;
end; $$;
create trigger capture_notice_notification after insert on public.notices for each row execute function private.capture_notice_notification();

create function private.capture_feedback_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status or (nullif(trim(new.officer_response),'') is not null and new.officer_response is distinct from old.officer_response) then
  perform private.emit_notification('feedback_updated','feedback','feedback',new.id,new.author_id,
   jsonb_build_object('title',new.title,'before_status',old.status,'after_status',new.status,'has_response',nullif(trim(new.officer_response),'') is not null),now()+interval '7 days');
 end if;
 return new;
end; $$;
create trigger capture_feedback_notification after update on public.feedback for each row execute function private.capture_feedback_notification();
revoke all on function private.capture_attendance_notification(),private.capture_schedule_notification(),private.capture_notice_notification(),private.capture_feedback_notification() from public,anon,authenticated;

create function public.get_rsvp_reminder_preview(target_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; eligible bigint; next_allowed timestamptz;
begin
 perform private.notification_member_id();
 if not private.has_permission('events.manage') then raise exception 'Event management permission required' using errcode='42501'; end if;
 select * into e from public.events where id=target_event_id;
 if not found or e.starts_at<=now() then raise exception 'Upcoming event required'; end if;
 select count(*) into eligible from public.profiles p where p.status='active' and p.auth_user_id is not null and not p.must_change_password and not p.is_test_account
 and not exists(select 1 from public.attendance a where a.event_id=e.id and a.member_id=p.id and a.status<>'undecided');
 select requested_at+interval '10 minutes' into next_allowed from private.rsvp_reminder_requests where event_id=e.id;
 return jsonb_build_object('eligible_count',eligible,'next_allowed_at',next_allowed);
end; $$;
create function public.request_rsvp_reminder(target_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare preview jsonb; notification_id uuid; e public.events%rowtype;
begin
 perform private.notification_member_id();
 if not private.has_permission('events.manage') then raise exception 'Event management permission required' using errcode='42501'; end if;
 select * into e from public.events where id=target_event_id for update;
 if not found or e.starts_at<=now() then raise exception 'Upcoming event required'; end if;
 preview:=public.get_rsvp_reminder_preview(target_event_id);
 if (preview->>'next_allowed_at')::timestamptz>now() then raise exception 'Reminder rate limit: wait ten minutes' using errcode='P0001'; end if;
 if (preview->>'eligible_count')::bigint=0 then raise exception 'No eligible unanswered members'; end if;
 insert into private.rsvp_reminder_requests(event_id,requested_at,actor_profile_id) values(e.id,now(),private.current_profile_id())
 on conflict(event_id) do update set requested_at=excluded.requested_at,actor_profile_id=excluded.actor_profile_id;
 notification_id:=private.emit_notification('rsvp_reminder','rsvp_reminders','event',e.id,null,jsonb_build_object('title',e.title,'deadline',e.starts_at,'manual',true),e.starts_at);
 return preview||jsonb_build_object('notification_id',notification_id,'next_allowed_at',now()+interval '10 minutes');
end; $$;

create function public.cancel_event(target_event_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; notification_id uuid; recipients uuid[];
begin
 perform private.notification_member_id();
 if not private.has_permission('events.manage') then raise exception 'Event management permission required' using errcode='42501'; end if;
 select * into e from public.events where id=target_event_id for update;
 if not found or e.starts_at<=now() then raise exception 'Upcoming event required'; end if;
 if exists(select 1 from public.fees where event_id=e.id and status in ('paid','exempt'))
 or exists(select 1 from public.event_guest_fees where event_id=e.id and status in ('paid','exempt'))
 or exists(select 1 from public.attendance where event_id=e.id and (check_in_status is not null or checked_in_at is not null))
 or exists(select 1 from public.event_matches where event_id=e.id)
 or exists(select 1 from public.event_teams where event_id=e.id and score is not null)
 or exists(select 1 from public.event_team_members where event_id=e.id and (goals>0 or rating is not null))
 then raise exception '참여비 납부·면제 또는 출석·경기 기록이 있어 취소할 수 없습니다. 운영진에게 기록 확인을 요청해 주세요.'; end if;
 select coalesce(array_agg(member_id),'{}') into recipients from public.attendance where event_id=e.id and status='going';
 notification_id:=private.emit_notification('event_cancelled','schedule','event',e.id,null,
  jsonb_build_object('title',e.title,'starts_at',e.starts_at,'venue',e.venue,'attendee_ids',to_jsonb(recipients)),greatest(e.starts_at,now()+interval '1 day'));
 if e.weekly_date is not null or (e.title='주말 정기 풋살' and extract(dow from e.starts_at at time zone 'Asia/Seoul')=0 and extract(hour from e.starts_at at time zone 'Asia/Seoul')=8) then
  insert into private.weekly_schedule_exclusions(event_date) values(coalesce(e.weekly_date,(e.starts_at at time zone 'Asia/Seoul')::date)) on conflict do nothing;
 end if;
 -- The existing delete contract controls dependent records. Any constraint failure rolls back this event too.
 delete from public.events where id=e.id;
 return jsonb_build_object('notification_id',notification_id,'source_id',e.id,'cancelled',true);
end; $$;
revoke all on function public.get_rsvp_reminder_preview(uuid),public.request_rsvp_reminder(uuid),public.cancel_event(uuid) from public,anon,authenticated;
grant execute on function public.get_rsvp_reminder_preview(uuid),public.request_rsvp_reminder(uuid),public.cancel_event(uuid) to authenticated;

create function private.enqueue_scheduled_notifications() returns void language plpgsql security definer set search_path='' as $$
declare p private.notification_policy%rowtype; e public.events%rowtype; f public.participation_forms%rowtype; scheduled_at timestamptz;
begin
 select * into p from private.notification_policy;
 for e in select * from public.events where starts_at>now() and starts_at<now()+interval '8 days' loop
  scheduled_at:=(((e.starts_at at time zone 'Asia/Seoul')::date-1)::timestamp+make_interval(hours=>p.event_reminder_hour)) at time zone 'Asia/Seoul';
  if now()>=scheduled_at and now()<scheduled_at+interval '6 hours' then
   perform private.emit_notification('event_reminder','event_reminders','event',e.id,null,jsonb_build_object('title',e.title,'starts_at',e.starts_at,'venue',e.venue),e.starts_at,'event-reminder:'||e.id||':'||e.starts_at);
  end if;
  scheduled_at:=e.starts_at-make_interval(hours=>p.rsvp_reminder_hours);
  if now()>=scheduled_at and now()<scheduled_at+interval '6 hours' then
   perform private.emit_notification('rsvp_reminder','rsvp_reminders','event',e.id,null,jsonb_build_object('title',e.title,'deadline',e.starts_at,'manual',false),e.starts_at,'rsvp-reminder:'||e.id||':'||e.starts_at);
  end if;
 end loop;
 for f in select * from public.participation_forms where status='open' and ends_at>now() and (starts_at is null or starts_at<=now()) and ends_at<=now()+make_interval(hours=>p.participation_reminder_hours) loop
  if now()<f.ends_at-make_interval(hours=>p.participation_reminder_hours)+interval '6 hours' then
   perform private.emit_notification('participation_reminder','participation','participation_form',f.id,null,jsonb_build_object('title',f.title,'deadline',f.ends_at,'form_kind',f.kind),f.ends_at,'participation-reminder:'||f.id||':'||f.ends_at);
  end if;
 end loop;
end; $$;

create function private.notification_recipient_eligible(n private.notification_events,p public.profiles) returns boolean
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
  if e.starts_at<=now() then return false; end if;
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

create function private.notification_delivery_eligible(d private.notification_deliveries) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.push_installations i join public.profiles p on p.id=i.profile_id
 join private.notification_events n on n.id=d.event_id cross join private.notification_runtime r
 where i.id=d.installation_id and i.auth_user_id=d.auth_user_id and p.auth_user_id=d.auth_user_id
 and i.binding_revision=d.binding_revision and i.transition_epoch=d.transition_epoch and i.enabled and not i.tombstoned
 and i.permission_state='granted' and i.last_seen_at>now()-interval '30 days' and i.revocation_expires_at>now()
 and r.enabled and cardinality(r.test_auth_user_ids)>0 and d.auth_user_id=any(r.test_auth_user_ids)
 and i.project_id=r.allowed_project_id and not(n.category=any(r.disabled_categories))
 and private.notification_recipient_eligible(n,p));
$$;
revoke all on function private.enqueue_scheduled_notifications(),private.notification_recipient_eligible(private.notification_events,public.profiles),private.notification_delivery_eligible(private.notification_deliveries) from public,anon,authenticated;

create function public.claim_notification_deliveries(target_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.notification_events%rowtype; result jsonb;
begin
 if not exists(select 1 from private.notification_runtime where enabled and cardinality(test_auth_user_ids)>0 and allowed_project_id is not null) then return '[]'; end if;
 perform private.enqueue_scheduled_notifications();
 update private.notification_deliveries set status='unknown',error_code='lease_expired_after_send' where status='sending' and lease_until<=now();
 for n in select * from private.notification_events where expanded_at is null order by created_at limit 100 for update skip locked loop
  insert into private.notification_deliveries(event_id,installation_id,auth_user_id,binding_revision,transition_epoch)
  select n.id,i.id,i.auth_user_id,i.binding_revision,i.transition_epoch from private.push_installations i
   join public.profiles p on p.id=i.profile_id cross join private.notification_runtime r
  where i.enabled and not i.tombstoned and i.permission_state='granted' and i.auth_user_id=p.auth_user_id
   and i.auth_user_id=any(r.test_auth_user_ids) and i.project_id=r.allowed_project_id and not(n.category=any(r.disabled_categories))
   and i.last_seen_at>now()-interval '30 days' and i.revocation_expires_at>now() and private.notification_recipient_eligible(n,p)
  on conflict(event_id,installation_id) do nothing;
  update private.notification_events set expanded_at=now() where id=n.id;
 end loop;
 with candidates as(select id from private.notification_deliveries where (status='pending' or (status='claimed' and lease_until<=now()))
 and next_attempt_at<=now() order by next_attempt_at limit least(greatest(target_limit,1),100) for update skip locked),
 claimed as(update private.notification_deliveries d set status='claimed',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 from candidates c where d.id=c.id returning d.id,d.lease_token)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end; $$;

create function public.prepare_notification_delivery(target_delivery_id uuid,target_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.notification_deliveries%rowtype; n private.notification_events%rowtype; i private.push_installations%rowtype;
begin
 select * into d from private.notification_deliveries where id=target_delivery_id for update;
 if not found or d.status<>'claimed' or d.lease_token is distinct from target_lease_token or d.lease_until<=now() then return null; end if;
 select * into i from private.push_installations where id=d.installation_id for share;
 if not private.notification_delivery_eligible(d) then update private.notification_deliveries set status='skipped',error_code='no_longer_eligible' where id=d.id; return null; end if;
 select * into n from private.notification_events where id=d.event_id;
 update private.notification_deliveries set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',
  token_hash=encode(sha256(convert_to(i.expo_token,'UTF8')),'hex') where id=d.id;
 return jsonb_build_object('delivery_id',d.id,'lease_token',d.lease_token,'to',i.expo_token,'snapshot',n.snapshot,'data',
 jsonb_build_object('version',1,'notification_id',n.id,'kind',n.kind,'category',n.category,'source_type',n.source_type,'source_id',n.source_id,
 'recipient_user_id',d.auth_user_id,'installation_id',i.id,'binding_revision',d.binding_revision,'transition_epoch',d.transition_epoch));
end; $$;
create function public.finish_notification_delivery(target_delivery_id uuid,target_lease_token uuid,target_outcome text,target_ticket_id text default null,target_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare d private.notification_deliveries%rowtype;
begin
 select * into d from private.notification_deliveries where id=target_delivery_id for update;
 if not found or d.lease_token is distinct from target_lease_token or d.status<>'sending' then return false; end if;
 if target_outcome not in ('ticket','retry','failed','unknown') or (target_outcome='ticket' and nullif(target_ticket_id,'') is null) then raise exception 'Invalid delivery outcome'; end if;
 update private.notification_deliveries set status=case when target_outcome='retry' and attempts<5 then 'pending' when target_outcome='retry' then 'failed' else target_outcome end,
 ticket_id=target_ticket_id,ticket_at=case when target_outcome='ticket' then now() else null end,error_code=left(target_error_code,80),
 next_attempt_at=case when target_outcome='ticket' then now()+interval '15 minutes' else now()+make_interval(secs=>least(3600,power(2,attempts)::integer*30)) end,
 lease_until=null where id=d.id;
 if target_error_code='DeviceNotRegistered' then
  update private.push_installations set enabled=false where id=d.installation_id and auth_user_id=d.auth_user_id and binding_revision=d.binding_revision and transition_epoch=d.transition_epoch and encode(sha256(convert_to(expo_token,'UTF8')),'hex')=d.token_hash;
 end if;
 return true;
end; $$;

create function public.claim_notification_receipts(target_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.notification_runtime where enabled and cardinality(test_auth_user_ids)>0) then return '[]'; end if;
 update private.notification_deliveries set status='unknown',error_code='receipt_expired' where status='ticket' and ticket_at<=now()-interval '24 hours';
 with candidates as(select id from private.notification_deliveries where status='ticket' and next_attempt_at<=now()
 and auth_user_id in (select unnest(test_auth_user_ids) from private.notification_runtime) and (lease_until is null or lease_until<=now()) order by next_attempt_at limit least(greatest(target_limit,1),100) for update skip locked),
 claimed as(update private.notification_deliveries d set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidates c where d.id=c.id returning d.id,d.lease_token,d.ticket_id)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end; $$;
create function public.finish_notification_receipt(target_delivery_id uuid,target_lease_token uuid,target_outcome text,target_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare d private.notification_deliveries%rowtype;
begin
 select * into d from private.notification_deliveries where id=target_delivery_id for update;
 if not found or d.status<>'ticket' or d.lease_token is distinct from target_lease_token then return false; end if;
 if target_outcome not in ('delivered','failed','pending') then raise exception 'Invalid receipt outcome'; end if;
 update private.notification_deliveries set status=case when target_outcome='pending' then 'ticket' else target_outcome end,
 next_attempt_at=now()+interval '15 minutes',lease_until=null,receipt_checked_at=now(),error_code=left(target_error_code,80) where id=d.id;
 if target_error_code='DeviceNotRegistered' then
  update private.push_installations set enabled=false where id=d.installation_id and auth_user_id=d.auth_user_id and binding_revision=d.binding_revision and transition_epoch=d.transition_epoch and encode(sha256(convert_to(expo_token,'UTF8')),'hex')=d.token_hash;
 end if;
 return true;
end; $$;
revoke all on function public.claim_notification_deliveries(integer),public.prepare_notification_delivery(uuid,uuid),
 public.finish_notification_delivery(uuid,uuid,text,text,text),public.claim_notification_receipts(integer),public.finish_notification_receipt(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(integer),public.prepare_notification_delivery(uuid,uuid),
 public.finish_notification_delivery(uuid,uuid,text,text,text),public.claim_notification_receipts(integer),public.finish_notification_receipt(uuid,uuid,text,text)
 to service_role;


create function public.validate_notification_delivery(target_delivery_id uuid,target_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.notification_deliveries%rowtype;
begin
 select * into d from private.notification_deliveries where id=target_delivery_id for update;
 if not found or d.status<>'sending' or d.lease_token is distinct from target_lease_token or d.lease_until<=now() then return false; end if;
 if private.notification_delivery_eligible(d) and exists(select 1 from private.push_installations where id=d.installation_id and encode(sha256(convert_to(expo_token,'UTF8')),'hex')=d.token_hash) then return true; end if;
 update private.notification_deliveries set status='skipped',error_code='changed_before_dispatch' where id=d.id;
 return false;
end; $$;
revoke all on function public.validate_notification_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_notification_delivery(uuid,uuid) to service_role;
