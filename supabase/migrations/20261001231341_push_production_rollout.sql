-- Installing this migration keeps delivery disabled and in its existing test mode.
alter table private.notification_runtime
 add column delivery_mode text not null default 'test' check (delivery_mode in ('test','production')),
 add column production_activated_at timestamptz,
 add constraint production_activation_required check (delivery_mode<>'production' or production_activated_at is not null);

create or replace function private.enqueue_scheduled_notifications() returns void language plpgsql security definer set search_path='' as $$
declare p private.notification_policy%rowtype; e public.events%rowtype; f public.participation_forms%rowtype; scheduled_at timestamptz; activation timestamptz;
begin
 select * into p from private.notification_policy;
 select production_activated_at into activation from private.notification_runtime where delivery_mode='production';
 for e in select * from public.events where starts_at>now() and starts_at<now()+interval '8 days' loop
  scheduled_at:=(((e.starts_at at time zone 'Asia/Seoul')::date-1)::timestamp+make_interval(hours=>p.event_reminder_hour)) at time zone 'Asia/Seoul';
  if now()>=scheduled_at and now()<scheduled_at+interval '6 hours' and (activation is null or scheduled_at>=activation) then
   perform private.emit_notification('event_reminder','event_reminders','event',e.id,null,jsonb_build_object('title',e.title,'starts_at',e.starts_at,'venue',e.venue),e.starts_at,'event-reminder:'||e.id||':'||e.starts_at);
  end if;
  scheduled_at:=e.starts_at-make_interval(hours=>p.rsvp_reminder_hours);
  if now()>=scheduled_at and now()<scheduled_at+interval '6 hours' and (activation is null or scheduled_at>=activation) then
   perform private.emit_notification('rsvp_reminder','rsvp_reminders','event',e.id,null,jsonb_build_object('title',e.title,'deadline',e.starts_at,'manual',false),e.starts_at,'rsvp-reminder:'||e.id||':'||e.starts_at);
  end if;
 end loop;
 for f in select * from public.participation_forms where status='open' and ends_at>now() and (starts_at is null or starts_at<=now()) and ends_at<=now()+make_interval(hours=>p.participation_reminder_hours) loop
  scheduled_at:=f.ends_at-make_interval(hours=>p.participation_reminder_hours);
  if now()>=scheduled_at and now()<scheduled_at+interval '6 hours' and (activation is null or scheduled_at>=activation) then
   perform private.emit_notification('participation_reminder','participation','participation_form',f.id,null,jsonb_build_object('title',f.title,'deadline',f.ends_at,'form_kind',f.kind),f.ends_at,'participation-reminder:'||f.id||':'||f.ends_at);
  end if;
 end loop;
end; $$;

create or replace function private.notification_delivery_eligible(d private.notification_deliveries) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.push_installations i join public.profiles p on p.id=i.profile_id
 join private.notification_events n on n.id=d.event_id cross join private.notification_runtime r
 where i.id=d.installation_id and i.auth_user_id=d.auth_user_id and p.auth_user_id=d.auth_user_id
 and i.binding_revision=d.binding_revision and i.transition_epoch=d.transition_epoch and i.enabled and not i.tombstoned
 and i.permission_state='granted' and i.last_seen_at>now()-interval '30 days' and i.revocation_expires_at>now()
 and r.enabled and ((r.delivery_mode='test' and d.auth_user_id=any(r.test_auth_user_ids)) or (r.delivery_mode='production' and r.production_activated_at is not null and n.created_at>=r.production_activated_at))
 and i.project_id=r.allowed_project_id and not(n.category=any(r.disabled_categories))
 and private.notification_recipient_eligible(n,p));
$$;

create or replace function public.claim_notification_deliveries(target_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.notification_events%rowtype; result jsonb;
begin
 perform private.cleanup_push_installation_reservations();
 if not exists(select 1 from private.notification_runtime where enabled and allowed_project_id is not null and ((delivery_mode='test' and cardinality(test_auth_user_ids)>0) or (delivery_mode='production' and production_activated_at is not null))) then return '[]'; end if;
 perform private.enqueue_scheduled_notifications();
 update private.notification_deliveries set status='unknown',error_code='lease_expired_after_send' where status='sending' and lease_until<=now();
 for n in select * from private.notification_events where expanded_at is null order by created_at limit 100 for update skip locked loop
  insert into private.notification_deliveries(event_id,installation_id,auth_user_id,binding_revision,transition_epoch)
  select n.id,i.id,i.auth_user_id,i.binding_revision,i.transition_epoch from private.push_installations i
   join public.profiles p on p.id=i.profile_id cross join private.notification_runtime r
  where i.enabled and not i.tombstoned and i.permission_state='granted' and i.auth_user_id=p.auth_user_id
   and ((r.delivery_mode='test' and i.auth_user_id=any(r.test_auth_user_ids)) or (r.delivery_mode='production' and r.production_activated_at is not null and n.created_at>=r.production_activated_at)) and i.project_id=r.allowed_project_id and not(n.category=any(r.disabled_categories))
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

create or replace function public.claim_notification_receipts(target_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.notification_runtime where enabled and allowed_project_id is not null and ((delivery_mode='test' and cardinality(test_auth_user_ids)>0) or (delivery_mode='production' and production_activated_at is not null))) then return '[]'; end if;
 update private.notification_deliveries set status='unknown',error_code='receipt_expired' where status='ticket' and ticket_at<=now()-interval '24 hours';
 with candidates as(select id from private.notification_deliveries where status='ticket' and next_attempt_at<=now()
 and exists(select 1 from private.notification_runtime r where r.delivery_mode='production' or auth_user_id=any(r.test_auth_user_ids)) and (lease_until is null or lease_until<=now()) order by next_attempt_at limit least(greatest(target_limit,1),100) for update skip locked),
 claimed as(update private.notification_deliveries d set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidates c where d.id=c.id returning d.id,d.lease_token,d.ticket_id)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end; $$;
