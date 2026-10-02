-- Web delivery remains disabled until its independent activation is recorded.
create table private.web_push_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 activated_at timestamptz, check(not enabled or activated_at is not null)
);
insert into private.web_push_runtime default values;
create table private.web_push_installations (
 id uuid primary key, proof_hash text not null, revocation_hash text not null, revocation_expires_at timestamptz not null,
 auth_user_id uuid references auth.users(id) on delete cascade, profile_id uuid references public.profiles(id) on delete cascade,
 transition_epoch bigint not null check(transition_epoch between 0 and 9007199254740991),
 binding_revision bigint not null default 1 check(binding_revision between 1 and 9007199254740991),
 tombstoned boolean not null default false, endpoint text not null, subscription jsonb not null,
 permission_state text not null check(permission_state in ('granted','denied','undetermined')),
 enabled boolean not null default false, last_seen_at timestamptz not null default now(), last_test_at timestamptz
);
create index web_push_installations_owner_idx on private.web_push_installations(auth_user_id);
create unique index web_push_installations_live_endpoint_idx on private.web_push_installations(endpoint) where enabled and not tombstoned;
create table private.web_push_installation_reservations (
 installation_id uuid not null, revocation_hash text not null, proof_hash text not null,
 auth_user_id uuid not null references auth.users(id) on delete cascade,
 transition_epoch bigint not null, binding_revision bigint not null,
 reserved_at timestamptz not null default now(), expires_at timestamptz not null, revoked boolean not null default false,
 primary key(installation_id,revocation_hash)
);
create index web_push_reservations_owner_idx on private.web_push_installation_reservations(auth_user_id,expires_at);
create index web_push_reservations_expiry_idx on private.web_push_installation_reservations(expires_at);
create table private.web_push_reservation_rate_limits (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 window_started_at timestamptz not null, requests integer not null check(requests between 1 and 5)
);
create table private.web_notification_event_expansions (
 event_id uuid primary key references private.notification_events(id) on delete cascade, expanded_at timestamptz not null default now()
);
create table private.web_notification_deliveries (
 id uuid primary key default gen_random_uuid(), event_id uuid references private.notification_events(id) on delete cascade,
 installation_id uuid not null references private.web_push_installations(id) on delete cascade, auth_user_id uuid not null,
 binding_revision bigint not null, transition_epoch bigint not null,
 status text not null default 'pending' check(status in ('pending','claimed','sending','accepted','skipped','failed','unknown')),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz, subscription_hash text,
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 next_attempt_at timestamptz not null default now(), error_code text, unique(event_id,installation_id)
);
create index web_notification_deliveries_pending_idx on private.web_notification_deliveries(next_attempt_at) where status in ('pending','claimed');
alter table private.web_push_runtime enable row level security;
alter table private.web_push_installations enable row level security;
alter table private.web_push_installation_reservations enable row level security;
alter table private.web_push_reservation_rate_limits enable row level security;
alter table private.web_notification_event_expansions enable row level security;
alter table private.web_notification_deliveries enable row level security;
revoke all on private.web_push_runtime,private.web_push_installations,private.web_push_installation_reservations,
 private.web_push_reservation_rate_limits,private.web_notification_event_expansions,private.web_notification_deliveries from public,anon,authenticated;

-- Allow only the public browser push services, never user-selected network hosts.
create function private.web_push_subscription_valid(s jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(s)='object' and jsonb_typeof(s->'endpoint')='string'
 and char_length(s->>'endpoint') between 1 and 2048
 and (s->>'endpoint') ~ '^https://(web\.push\.apple\.com|[A-Za-z0-9-]+\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/[A-Za-z0-9_./~%+=-]+$'
 and (s->>'endpoint') !~* '%(0[0-9a-f]|1[0-9a-f]|7f)'
 and jsonb_typeof(s->'keys')='object' and jsonb_typeof(s->'keys'->'p256dh')='string' and jsonb_typeof(s->'keys'->'auth')='string'
 and (s->'keys'->>'p256dh') ~ '^B[A-Za-z0-9_-]{86}=?$'
 and (s->'keys'->>'auth') ~ '^[A-Za-z0-9_-]{22}(==)?$'
 and case when (s->'keys'->>'p256dh') ~ '^B[A-Za-z0-9_-]{86}=?$' then
  octet_length(decode(rpad(translate(s->'keys'->>'p256dh','-_','+/'),88,'='),'base64'))=65
  and get_byte(decode(rpad(translate(s->'keys'->>'p256dh','-_','+/'),88,'='),'base64'),0)=4 else false end
 and case when (s->'keys'->>'auth') ~ '^[A-Za-z0-9_-]{22}(==)?$' then
  octet_length(decode(rpad(translate(s->'keys'->>'auth','-_','+/'),24,'='),'base64'))=16 else false end
 and (not (s ? 'expirationTime') or s->'expirationTime'='null'::jsonb or jsonb_typeof(s->'expirationTime')='number'),false);
$$;
revoke all on function private.web_push_subscription_valid(jsonb) from public,anon,authenticated;
create function private.cleanup_web_push_installation_reservations() returns void language sql security definer set search_path='' as $$
 delete from private.web_push_installation_reservations where expires_at<=now();
 delete from private.web_push_reservation_rate_limits where window_started_at<now()-interval '1 day';
$$;
revoke all on function private.cleanup_web_push_installation_reservations() from public,anon,authenticated;

create function public.reserve_web_push_installation(target_installation_id uuid,target_installation_proof text,target_revocation_proof text,target_transition_epoch bigint,target_binding_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member_id uuid; i private.web_push_installations%rowtype; r private.web_push_installation_reservations%rowtype;
 ph text; rh text; expires timestamptz:=now()+interval '30 days'; claims jsonb; jwt_exp numeric;
begin
 member_id:=private.notification_member_id();
 if target_installation_id is null or target_installation_proof is null or target_installation_proof !~ '^[a-f0-9]{64}$'
 or target_revocation_proof is null or target_revocation_proof !~ '^[a-f0-9]{64}$'
 or target_transition_epoch is null or target_transition_epoch<0 or target_transition_epoch>9007199254740991
 or target_binding_revision is null or target_binding_revision<0 or target_binding_revision>9007199254740991 then raise exception 'Invalid reservation'; end if;
 ph:=encode(sha256(convert_to(target_installation_proof,'UTF8')),'hex'); rh:=encode(sha256(convert_to(target_revocation_proof,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text,54));
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,52));
 perform private.cleanup_web_push_installation_reservations();
 select * into i from private.web_push_installations where id=target_installation_id;
 if found then
  if i.proof_hash<>ph then raise exception 'Invalid installation proof' using errcode='42501'; end if;
  if target_binding_revision<>i.binding_revision or target_transition_epoch<i.transition_epoch
  or (target_transition_epoch=i.transition_epoch and (i.tombstoned or i.auth_user_id is distinct from (select auth.uid()))) then
   return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'reserved',false,'stale',true);
  end if;
  if target_transition_epoch=i.transition_epoch then
   if rh<>i.revocation_hash then raise exception 'Revocation proof must remain stable within a binding' using errcode='42501'; end if;
   return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'reserved',true,'stale',false,'expires_at',i.revocation_expires_at);
  end if;
  if rh=i.revocation_hash then raise exception 'New transition requires a new revocation proof' using errcode='42501'; end if;
 elsif target_binding_revision<>0 then raise exception 'Unknown installation binding'; end if;
 select * into r from private.web_push_installation_reservations where installation_id=target_installation_id order by transition_epoch desc,reserved_at desc limit 1;
 if found then
  if r.proof_hash<>ph then raise exception 'Invalid installation proof' using errcode='42501'; end if;
  if target_transition_epoch<r.transition_epoch or (target_transition_epoch=r.transition_epoch and (r.revoked or r.auth_user_id is distinct from (select auth.uid()))) then
   return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',r.transition_epoch,'binding_revision',r.binding_revision,'reserved',false,'stale',true);
  end if;
  if target_transition_epoch=r.transition_epoch and rh<>r.revocation_hash then raise exception 'Revocation proof must remain stable within a reservation' using errcode='42501'; end if;
  if target_transition_epoch>r.transition_epoch and rh=r.revocation_hash then raise exception 'New transition requires a new revocation proof' using errcode='42501'; end if;
 end if;
 select * into r from private.web_push_installation_reservations where installation_id=target_installation_id and revocation_hash=rh;
 if found then
  if r.auth_user_id is distinct from (select auth.uid()) or r.proof_hash<>ph or r.transition_epoch<>target_transition_epoch or r.binding_revision<>target_binding_revision or r.revoked then raise exception 'Invalid reservation proof' using errcode='42501'; end if;
  return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',r.transition_epoch,'binding_revision',r.binding_revision,'reserved',true,'stale',false,'expires_at',r.expires_at);
 end if;
 if (select count(*) from private.web_push_installation_reservations where auth_user_id=(select auth.uid()))>=20 then raise exception 'Too many pending installation reservations' using errcode='P0001'; end if;
 if exists(select 1 from private.web_push_reservation_rate_limits where auth_user_id=(select auth.uid()) and window_started_at>now()-interval '1 minute' and requests>=5) then raise exception 'Too many new installation reservations' using errcode='P0001'; end if;
 insert into private.web_push_reservation_rate_limits(auth_user_id,window_started_at,requests) values((select auth.uid()),now(),1)
 on conflict(auth_user_id) do update set window_started_at=case when private.web_push_reservation_rate_limits.window_started_at<=now()-interval '1 minute' then now() else private.web_push_reservation_rate_limits.window_started_at end,
 requests=case when private.web_push_reservation_rate_limits.window_started_at<=now()-interval '1 minute' then 1 else private.web_push_reservation_rate_limits.requests+1 end;
 -- Claims come only from PostgREST's verified JWT, never RPC parameters or headers.
 claims:=auth.jwt();
 if jsonb_typeof(claims->'exp')='number' then
  jwt_exp:=(claims->>'exp')::numeric;
  if jwt_exp>extract(epoch from now()) and jwt_exp<=253402300799 then expires:=greatest(expires,to_timestamp(jwt_exp::double precision)+interval '15 minutes'); end if;
 end if;
 insert into private.web_push_installation_reservations(installation_id,revocation_hash,proof_hash,auth_user_id,transition_epoch,binding_revision,expires_at)
 values(target_installation_id,rh,ph,(select auth.uid()),target_transition_epoch,target_binding_revision,expires);
 return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',target_transition_epoch,'binding_revision',target_binding_revision,'reserved',true,'stale',false,'expires_at',expires);
end; $$;
revoke all on function public.reserve_web_push_installation(uuid,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_web_push_installation(uuid,text,text,bigint,bigint) to authenticated;
create function public.register_web_push_installation(target_installation_id uuid,target_installation_proof text,target_revocation_proof text,target_transition_epoch bigint,target_binding_revision bigint,target_subscription jsonb,target_permission_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member_id uuid; i private.web_push_installations%rowtype; active boolean; ph text; rh text; r private.web_push_installation_reservations%rowtype; subscription_endpoint text;
begin
 member_id:=private.notification_member_id();
 if target_installation_id is null or target_installation_proof is null or target_installation_proof !~ '^[a-f0-9]{64}$' or target_revocation_proof is null or target_revocation_proof !~ '^[a-f0-9]{64}$'
 or target_transition_epoch is null or target_transition_epoch<0 or target_transition_epoch>9007199254740991 or target_binding_revision is null or target_binding_revision<0 or target_binding_revision>9007199254740991
 or target_permission_state is null or target_permission_state not in ('granted','denied','undetermined')
 or not private.web_push_subscription_valid(target_subscription)
 then raise exception 'Invalid installation'; end if;
 ph:=encode(sha256(convert_to(target_installation_proof,'UTF8')),'hex'); rh:=encode(sha256(convert_to(target_revocation_proof,'UTF8')),'hex');
 subscription_endpoint:=target_subscription->>'endpoint';
 perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text,1));
 perform pg_advisory_xact_lock(hashtextextended(subscription_endpoint,53));
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,52));
 select * into i from private.web_push_installations where id=target_installation_id for update;
 if found then
  if i.proof_hash<>ph then raise exception 'Invalid installation proof' using errcode='42501'; end if;
  if target_transition_epoch<i.transition_epoch or (target_transition_epoch=i.transition_epoch and (i.tombstoned or i.auth_user_id is distinct from (select auth.uid()))) or target_binding_revision<>i.binding_revision then
   return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'enabled',false,'stale',true);
  end if;
  if target_transition_epoch>i.transition_epoch and rh=i.revocation_hash then raise exception 'New transition requires a new revocation proof' using errcode='42501'; end if;
  if target_transition_epoch=i.transition_epoch and rh<>i.revocation_hash then raise exception 'Revocation proof must remain stable within a binding' using errcode='42501'; end if;
 elsif target_binding_revision<>0 then raise exception 'Unknown installation binding'; end if;
 select * into r from private.web_push_installation_reservations where installation_id=target_installation_id and expires_at>now() order by transition_epoch desc,reserved_at desc limit 1;
 if found then
  if r.proof_hash<>ph then raise exception 'Invalid installation proof' using errcode='42501'; end if;
  if target_transition_epoch<r.transition_epoch or (target_transition_epoch=r.transition_epoch and (r.revoked or r.auth_user_id is distinct from (select auth.uid()))) then
   return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',r.transition_epoch,'binding_revision',r.binding_revision,'enabled',false,'stale',true);
  end if;
 end if;
 if i.id is null or target_transition_epoch>i.transition_epoch then
  select * into r from private.web_push_installation_reservations where installation_id=target_installation_id and revocation_hash=rh;
  if not found or r.expires_at<=now() or r.auth_user_id is distinct from (select auth.uid()) or r.proof_hash<>ph or r.binding_revision<>target_binding_revision then raise exception 'Installation reservation required' using errcode='42501'; end if;
  if r.revoked or r.transition_epoch<>target_transition_epoch then
   return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',r.transition_epoch,'binding_revision',r.binding_revision,'enabled',false,'stale',true);
  end if;
 end if;
 active:=target_permission_state='granted' and coalesce((select enabled from public.notification_preferences where auth_user_id=(select auth.uid())),false);

 update private.web_push_installations set enabled=false where endpoint=target_subscription->>'endpoint' and id<>target_installation_id;
 insert into private.web_push_installations(id,proof_hash,revocation_hash,revocation_expires_at,auth_user_id,profile_id,transition_epoch,binding_revision,endpoint,subscription,permission_state,enabled)
 values(target_installation_id,ph,rh,now()+interval '30 days',(select auth.uid()),member_id,target_transition_epoch,1,subscription_endpoint,target_subscription,target_permission_state,active)
 on conflict(id) do update set revocation_hash=excluded.revocation_hash,revocation_expires_at=excluded.revocation_expires_at,auth_user_id=excluded.auth_user_id,profile_id=excluded.profile_id,transition_epoch=excluded.transition_epoch,
 binding_revision=case when private.web_push_installations.transition_epoch=excluded.transition_epoch and private.web_push_installations.auth_user_id=excluded.auth_user_id then private.web_push_installations.binding_revision else private.web_push_installations.binding_revision+1 end,
 tombstoned=false,endpoint=excluded.endpoint,subscription=excluded.subscription,permission_state=excluded.permission_state,enabled=excluded.enabled,last_seen_at=now()
 returning * into i;
 delete from private.web_push_installation_reservations where installation_id=i.id and transition_epoch<=i.transition_epoch;
 return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'revocation_expires_at',i.revocation_expires_at,'enabled',i.enabled,'stale',false);
end; $$;
create function public.revoke_web_push_installation(target_installation_id uuid,target_binding_revision bigint,target_transition_epoch bigint,target_revocation_proof text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.web_push_installations%rowtype; r private.web_push_installation_reservations%rowtype; revoked boolean:=false; rh text;
begin
 if target_installation_id is null or target_revocation_proof is null or target_revocation_proof !~ '^[a-f0-9]{64}$' or target_transition_epoch is null or target_transition_epoch<0 or target_transition_epoch>9007199254740991 or target_binding_revision is null or target_binding_revision<0 or target_binding_revision>9007199254740991 then raise exception 'Invalid revocation'; end if;
 rh:=encode(sha256(convert_to(target_revocation_proof,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,52));
 select * into i from private.web_push_installations where id=target_installation_id for update;
 if i.id is not null and i.revocation_hash=rh and i.revocation_expires_at>now() then
  if (target_binding_revision=0 or target_binding_revision=i.binding_revision) and target_transition_epoch>i.transition_epoch then
   update private.web_push_installations set enabled=false,tombstoned=true,transition_epoch=target_transition_epoch where id=target_installation_id returning * into i;
   revoked:=true;
  elsif i.tombstoned and target_transition_epoch=i.transition_epoch then revoked:=true; end if;
  return jsonb_build_object('installation_id',i.id,'transition_epoch',i.transition_epoch,'binding_revision',i.binding_revision,'enabled',false,'revoked',revoked,'terminal',true);
 end if;
 select * into r from private.web_push_installation_reservations where installation_id=target_installation_id and revocation_hash=rh and expires_at>now() for update;
 if found then
  if (target_binding_revision=0 or target_binding_revision=r.binding_revision) and target_transition_epoch>r.transition_epoch then
   update private.web_push_installation_reservations set revoked=true,transition_epoch=target_transition_epoch where installation_id=r.installation_id and revocation_hash=rh returning * into r;
   revoked:=true;
  elsif r.revoked and target_transition_epoch=r.transition_epoch then revoked:=true; end if;
  return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',r.transition_epoch,'binding_revision',r.binding_revision,'enabled',false,'revoked',revoked,'terminal',true);
 end if;
 -- Unknown capabilities never create anonymous rows. The client awaits reservation before dispatching registration.
 return jsonb_build_object('installation_id',target_installation_id,'transition_epoch',target_transition_epoch,'binding_revision',target_binding_revision,'revoked',false,'terminal',true,'enabled',false);
end; $$;
revoke all on function public.register_web_push_installation(uuid,text,text,bigint,bigint,jsonb,text),public.revoke_web_push_installation(uuid,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.register_web_push_installation(uuid,text,text,bigint,bigint,jsonb,text) to authenticated;
grant execute on function public.revoke_web_push_installation(uuid,bigint,bigint,text) to anon,authenticated;

create function private.disable_web_push_on_preference_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not new.enabled then update private.web_push_installations set enabled=false where auth_user_id=new.auth_user_id; end if;
 return new;
end; $$;
revoke all on function private.disable_web_push_on_preference_change() from public,anon,authenticated;
create trigger disable_web_push_on_preference_change after insert or update of enabled on public.notification_preferences
 for each row execute function private.disable_web_push_on_preference_change();

create function private.web_notification_delivery_eligible(d private.web_notification_deliveries) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.web_push_installations i join public.profiles p on p.id=i.profile_id
  join public.notification_preferences prefs on prefs.auth_user_id=i.auth_user_id
  cross join private.web_push_runtime w cross join private.notification_runtime r
  left join private.notification_events n on n.id=d.event_id
  where i.id=d.installation_id and i.auth_user_id=d.auth_user_id and p.auth_user_id=i.auth_user_id
  and i.binding_revision=d.binding_revision and i.transition_epoch=d.transition_epoch
  and i.enabled and not i.tombstoned and i.permission_state='granted'
  and i.last_seen_at>now()-interval '30 days' and i.revocation_expires_at>now() and d.expires_at>now()
  and w.enabled and w.activated_at is not null and prefs.enabled and p.status='active' and not p.must_change_password and not p.is_test_account
  and ((r.delivery_mode='test' and i.auth_user_id=any(r.test_auth_user_ids)) or r.delivery_mode='production')
  and (d.event_id is null or (n.created_at>=w.activated_at
   and (r.delivery_mode<>'production' or n.created_at>=r.production_activated_at)
   and not(n.category=any(r.disabled_categories)) and private.notification_recipient_eligible(n,p))));
$$;
revoke all on function private.web_notification_delivery_eligible(private.web_notification_deliveries) from public,anon,authenticated;

create function public.request_web_push_test(target_installation_id uuid,target_installation_proof text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.web_push_installations%rowtype; d private.web_notification_deliveries%rowtype;
begin
 perform private.notification_member_id();
 if target_installation_id is null or target_installation_proof is null or target_installation_proof !~ '^[a-f0-9]{64}$' then raise exception 'Invalid installation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_installation_id::text,52));
 select * into i from private.web_push_installations where id=target_installation_id for update;
 if i.id is null or i.auth_user_id is distinct from (select auth.uid()) or i.proof_hash<>encode(sha256(convert_to(target_installation_proof,'UTF8')),'hex') then raise exception 'Invalid installation proof' using errcode='42501'; end if;
 d.installation_id:=i.id; d.auth_user_id:=i.auth_user_id; d.binding_revision:=i.binding_revision; d.transition_epoch:=i.transition_epoch; d.expires_at:=now()+interval '5 minutes';
 if not private.web_notification_delivery_eligible(d) then raise exception 'Web push is not available for this installation' using errcode='42501'; end if;
 if i.last_test_at>now()-interval '1 minute' then raise exception 'Please wait before testing again'; end if;
 update private.web_push_installations set last_test_at=now() where id=i.id;
 insert into private.web_notification_deliveries(installation_id,auth_user_id,binding_revision,transition_epoch,expires_at)
 values(i.id,i.auth_user_id,i.binding_revision,i.transition_epoch,d.expires_at) returning * into d;
 return jsonb_build_object('notification_id',d.id,'queued',true);
end; $$;
revoke all on function public.request_web_push_test(uuid,text) from public,anon,authenticated;
grant execute on function public.request_web_push_test(uuid,text) to authenticated;

create function public.claim_web_notification_deliveries(target_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n private.notification_events%rowtype; result jsonb;
begin
 if not exists(select 1 from private.web_push_runtime w cross join private.notification_runtime r
  where w.enabled and w.activated_at is not null and (r.delivery_mode='production' or cardinality(r.test_auth_user_ids)>0)) then return '[]'; end if;
 perform private.enqueue_scheduled_notifications();
 perform private.cleanup_web_push_installation_reservations();
 update private.web_notification_deliveries set status='unknown',error_code='lease_expired_after_send' where status='sending' and lease_until<=now();
 -- Expansion is independent of Android's expanded_at and its Expo delivery rows.
 for n in select e.* from private.notification_events e cross join private.web_push_runtime w
  where e.created_at>=w.activated_at and not exists(select 1 from private.web_notification_event_expansions x where x.event_id=e.id)
  order by e.created_at limit 100 for update of e skip locked loop
  insert into private.web_notification_deliveries(event_id,installation_id,auth_user_id,binding_revision,transition_epoch,expires_at)
  select n.id,i.id,i.auth_user_id,i.binding_revision,i.transition_epoch,n.expires_at from private.web_push_installations i
  join public.profiles p on p.id=i.profile_id cross join private.notification_runtime r
  where i.enabled and not i.tombstoned and i.permission_state='granted' and p.auth_user_id=i.auth_user_id
   and i.last_seen_at>now()-interval '30 days' and i.revocation_expires_at>now()
   and ((r.delivery_mode='test' and i.auth_user_id=any(r.test_auth_user_ids)) or (r.delivery_mode='production' and n.created_at>=r.production_activated_at))
   and not(n.category=any(r.disabled_categories)) and private.notification_recipient_eligible(n,p)
  on conflict(event_id,installation_id) do nothing;
  insert into private.web_notification_event_expansions(event_id) values(n.id) on conflict do nothing;
 end loop;
 with candidates as(select id from private.web_notification_deliveries where (status='pending' or (status='claimed' and lease_until<=now()))
  and next_attempt_at<=now() order by next_attempt_at limit least(greatest(target_limit,1),100) for update skip locked),
 claimed as(update private.web_notification_deliveries d set status='claimed',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
  from candidates c where d.id=c.id returning d.id,d.lease_token)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end; $$;

create function public.prepare_web_notification_delivery(target_delivery_id uuid,target_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.web_notification_deliveries%rowtype; i private.web_push_installations%rowtype; n private.notification_events%rowtype; payload jsonb;
begin
 select * into d from private.web_notification_deliveries where id=target_delivery_id and lease_token=target_lease_token and lease_until>now() and status='claimed' for update;
 if d.id is null then return null; end if;
 if not private.web_notification_delivery_eligible(d) then update private.web_notification_deliveries set status='skipped',error_code='ineligible' where id=d.id; return null; end if;
 select * into i from private.web_push_installations where id=d.installation_id;
 select * into n from private.notification_events where id=d.event_id;
 payload:=jsonb_build_object('version',1,'notification_id',coalesce(n.id,d.id),'kind',coalesce(n.kind,'web_push_test'),
  'category',coalesce(n.category,'test'),'source_type',coalesce(n.source_type,'test'),'source_id',coalesce(n.source_id,d.id),
  'recipient_user_id',d.auth_user_id,'installation_id',d.installation_id,'binding_revision',d.binding_revision,'transition_epoch',d.transition_epoch);
 update private.web_notification_deliveries set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',
  subscription_hash=encode(sha256(convert_to(i.subscription::text,'UTF8')),'hex') where id=d.id;
 return jsonb_build_object('delivery_id',d.id,'lease_token',target_lease_token,'subscription',i.subscription,'expires_at',d.expires_at,'snapshot',coalesce(n.snapshot,'{}'::jsonb),'data',payload);
end; $$;

create function public.validate_web_notification_delivery(target_delivery_id uuid,target_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.web_notification_deliveries%rowtype;
begin
 select * into d from private.web_notification_deliveries where id=target_delivery_id and lease_token=target_lease_token and lease_until>now() and status='sending' for update;
 if d.id is null then return false; end if;
 if private.web_notification_delivery_eligible(d) and exists(select 1 from private.web_push_installations i where i.id=d.installation_id
  and encode(sha256(convert_to(i.subscription::text,'UTF8')),'hex')=d.subscription_hash) then return true; end if;
 update private.web_notification_deliveries set status='skipped',error_code='ineligible_or_subscription_changed' where id=d.id;
 return false;
end; $$;

create function public.finish_web_notification_delivery(target_delivery_id uuid,target_lease_token uuid,target_outcome text,target_error_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare d private.web_notification_deliveries%rowtype;
begin
 if target_outcome is null or target_outcome not in ('accepted','retry','failed','unknown') then raise exception 'Invalid outcome'; end if;
 if target_error_code is not null and (char_length(target_error_code)>80 or target_error_code !~ '^[a-zA-Z0-9_]+$') then raise exception 'Invalid error code'; end if;
 select * into d from private.web_notification_deliveries where id=target_delivery_id and lease_token=target_lease_token and status='sending' and lease_until>now() for update;
 if d.id is null then return false; end if;
 update private.web_notification_deliveries set status=case when target_outcome='retry' then case when attempts<5 then 'pending' else 'failed' end else target_outcome end,
  next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),lease_until=null,error_code=target_error_code where id=d.id;
 if target_error_code='subscription_expired' then
  update private.web_push_installations i set enabled=false where i.id=d.installation_id and i.auth_user_id=d.auth_user_id
   and i.binding_revision=d.binding_revision and i.transition_epoch=d.transition_epoch
   and encode(sha256(convert_to(i.subscription::text,'UTF8')),'hex')=d.subscription_hash;
 end if;
 return true;
end; $$;
revoke all on function public.claim_web_notification_deliveries(integer),public.prepare_web_notification_delivery(uuid,uuid),
 public.validate_web_notification_delivery(uuid,uuid),public.finish_web_notification_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_web_notification_deliveries(integer),public.prepare_web_notification_delivery(uuid,uuid),
 public.validate_web_notification_delivery(uuid,uuid),public.finish_web_notification_delivery(uuid,uuid,text,text) to service_role;
