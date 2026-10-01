import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PUSH_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const read = filename => readFile(path.join(root, filename), "utf8");
async function value(sql, args = []) { const result = await db.query(sql, args); return result.rows[0]?.value; }
function equal(actual, expected, description) { assert.deepEqual(actual, expected, description); checks++; }
async function rejected(action, pattern, description) { await assert.rejects(action, pattern, description); checks++; }
async function actor(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [id ?? "", role]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role,exp:Math.floor(Date.now()/1000)+3600})]);
  await db.exec("set role " + role);
}
async function owner(sql, args = []) { await db.exec("reset role"); return db.query(sql, args); }
const uuid = n => "b0000000-0000-0000-0000-" + String(n).padStart(12, "0");
const auth = [uuid(1),uuid(2),uuid(3),uuid(4),uuid(5),uuid(6)];
const profiles = [uuid(101),uuid(102),uuid(103),uuid(104),uuid(105),uuid(106)];
const event = uuid(201);
const install = uuid(301);
const project = uuid(401);
const proof = "a".repeat(64);
const revokeA = "b".repeat(64);
const revokeB = "c".repeat(64);
async function reserve(epoch, revision, revocation = revokeA, installation = install, installationProof = proof) {
  return value("select public.reserve_push_installation($1,$2,$3,$4,$5) value",[installation,installationProof,revocation,epoch,revision]);
}
async function register(epoch, revision, revocation = revokeA, token = "ExpoPushToken[test-old]", permission = "granted", installation = install) {
  await reserve(epoch,revision,revocation,installation);
  return value("select public.register_push_installation($1,$2,$3,$4,$5,$6,'android',$7,$8) value", [installation,proof,revocation,epoch,revision,token,permission,project]);
}
async function enabled(id = install) { return (await owner("select enabled value from private.push_installations where id=$1", [id])).rows[0]?.value; }
async function countEvents(kind) { return (await owner("select count(*)::integer value from private.notification_events where ($1::text is null or kind=$1)", [kind ?? null])).rows[0].value; }
async function claim() { await actor(null,"service_role"); return value("select public.claim_notification_deliveries(100) value"); }
async function prepare(c) { return value("select public.prepare_notification_delivery($1,$2) value", [c.id,c.lease_token]); }
async function finish(c,outcome,ticket = null,code = null) { return value("select public.finish_notification_delivery($1,$2,$3,$4,$5) value", [c.id,c.lease_token,outcome,ticket,code]); }
try {
  await db.exec(await read("supabase/tests/fixtures/push_domain.sql"));
  const protectSource = await read("supabase/migrations/20260816143000_add_attendance_check_in_status.sql");
  await db.exec(protectSource.match(/create or replace function public.protect_attendance_check_in\(\)[\s\S]*?\$\$;/)[0]);
  await db.exec("create trigger protect_attendance_check_in_before_write before insert or update on public.attendance for each row execute function public.protect_attendance_check_in()");
  const passwordSource = await read("supabase/migrations/20260822100217_require_initial_password_change.sql");
  await db.exec(passwordSource.slice(passwordSource.indexOf("create or replace function private.protect_password_change_requirement")));
  await db.exec(await read("supabase/migrations/20260821121500_save_attendance_batch.sql"));
  await db.exec(await read("supabase/migrations/20261001114159_push_notifications.sql"));
  await db.exec(await read("supabase/migrations/20261001231341_push_production_rollout.sql"));
  equal((await owner("select delivery_mode value from private.notification_runtime")).rows[0].value,"test","migration preserves the restricted rollout mode");
  equal((await owner("select enabled value from private.notification_runtime")).rows[0].value,false,"migration does not enable delivery");
  for (let index = 0; index < auth.length; index++) {
    await db.query("insert into auth.users(id) values($1)", [auth[index]]);
    await db.query("insert into public.profiles(id,auth_user_id,name,role,officer_title,status,must_change_password,is_test_account) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [profiles[index],auth[index],"Fixture "+index,index===1?"manager":"member",index===1?"president":null,index===3?"inactive":"active",index===4,index===5]);
  }
  await db.query("insert into public.events(id,title,starts_at,venue) values($1,'Fixture event',now()+interval '7 days','Fixture venue')", [event]);
  await actor(auth[0]);
  equal(await value("select private.current_profile_id() value"),profiles[0],"auth UUID and profile UUID differ");
  const settings = await value("select public.get_notification_settings() value");
  equal(settings.preferences.enabled,false,"master defaults off");
  equal(settings.preferences.feedback_enabled,true,"category defaults on");
  equal(settings.can_manage_policy,false,"ordinary members cannot manage policy");
  await rejected(()=>value("select public.save_notification_policy('{\"attendance_audience\":\"all_active\"}') value"),/permission required/,"policy requires actual event management permission");
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  await value("select public.save_notification_preferences('{\"notices_enabled\":false}') value");
  equal(await value("select count(*)::integer value from public.notification_preferences"),1,"RLS only exposes the caller preference");
  equal((await db.query("update public.profiles set must_change_password=false where id=$1 returning id",[profiles[4]])).rows.length,0,"RLS blocks updates of another password gate");
  await rejected(()=>db.query("update public.profiles set must_change_password=true where id=$1",[profiles[0]]),/Password change requirements/,"protected password flag cannot be changed by its owner");
  equal((await register(0,0)).binding_revision,1,"first registration gets binding revision");
  equal((await register(0,1)).binding_revision,1,"same epoch token refresh keeps binding revision");
  const early = await register(0,1,revokeA,"ExpoPushToken[test-old]");
  await actor(null,"anon");
  equal((await value("select public.revoke_push_installation($1,0,1,$2) value",[install,revokeA])).revoked,true,"proof revocation survives a lost first registration response");
  await actor(auth[0]);
  equal((await register(0,early.binding_revision)).stale,true,"late old registration cannot revive logout");
  equal((await register(1,1)).stale,true,"tombstoned epoch cannot revive");
  equal((await register(2,1,revokeB)).binding_revision,2,"new epoch creates a new binding");
  await actor(null,"anon");
  equal((await value("select public.revoke_push_installation($1,1,3,$2) value",[install,revokeA])).revoked,false,"old proof cannot revoke a new binding");
  await actor(auth[2]);
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  equal((await register(3,2,"d".repeat(64))).binding_revision,3,"account switch binds to verified new owner");
  await actor(auth[0]);
  equal((await register(2,2,revokeB)).stale,true,"delayed old owner cannot rebind newer owner");
  await actor(auth[2]);
  await value("select public.save_notification_preferences('{\"enabled\":false}') value");
  equal(await enabled(),false,"master off disables every current installation");
  await actor(auth[0]);
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  await register(4,3,"e".repeat(64));
  await actor(auth[1]);
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  await register(0,0,revokeA,"ExpoPushToken[test-officer]","granted",uuid(302));
  for (const deniedIndex of [3,4]) {
    await actor(auth[deniedIndex]);
    await rejected(()=>value("select public.get_notification_settings() value"),/Active member/,"inactive or password-gated settings rejected");
  }
  await actor(auth[0]);
  await db.query("insert into public.attendance(event_id,member_id,status) values($1,$2,'going')",[event,profiles[0]]);
  equal(await countEvents("attendance_added"),1,"first going emits attendance addition");
  const captured = (await owner("select actor_auth_user_id,actor_profile_id,subject_profile_id from private.notification_events where kind='attendance_added'")).rows[0];
  equal(captured,{actor_auth_user_id:auth[0],actor_profile_id:profiles[0],subject_profile_id:profiles[0]},"actor is mapped independently from RSVP subject");
  await actor(auth[1]);
  await db.query("update public.attendance set status='going',check_in_status='present' where event_id=$1 and member_id=$2",[event,profiles[0]]);
  equal(await countEvents("attendance_added"),1,"check-in-only and no-op RSVP do not emit");
  await db.query("update public.attendance set status='not_going' where event_id=$1 and member_id=$2",[event,profiles[0]]);
  equal(await countEvents("attendance_declined"),1,"going to not-going emits");
  const delegated = (await owner("select actor_profile_id,subject_profile_id from private.notification_events where kind='attendance_declined'")).rows[0];
  equal(delegated,{actor_profile_id:profiles[1],subject_profile_id:profiles[0]},"administrator actor is not the RSVP subject");
  await actor(auth[1]);
  await db.query("insert into public.attendance(event_id,member_id,status) values($1,$2,'not_going')",[event,profiles[2]]);
  equal(await countEvents("attendance_declined"),1,"first negative response is not cancellation");
  const beforeRollback = await countEvents();
  await actor(auth[1]);
  await db.exec("begin");
  await db.query("update public.attendance set status='going' where event_id=$1 and member_id=$2",[event,profiles[2]]);
  await db.exec("rollback");
  equal(await countEvents(),beforeRollback,"business rollback also removes its notification");
  await actor(auth[1]);
  await db.query("update public.events set starts_at=starts_at+interval '1 day' where id=$1",[event]);
  await db.query("update public.events set starts_at=starts_at+interval '30 minutes' where id=$1",[event]);
  await db.query("update public.events set address='Changed address' where id=$1",[event]);
  await db.query("update public.events set note='No push',venue=venue where id=$1",[event]);
  equal(await countEvents("schedule_changed"),3,"date, time and address changes emit; note/no-op do not");
  const notice = uuid(501);
  await db.query("insert into public.notices(id,title,body) values($1,'Notice fixture','Notice body')",[notice]);
  await db.query("update public.notices set is_pinned=true where id=$1",[notice]);
  equal(await countEvents("notice_created"),1,"only notice insert emits");
  await actor(auth[1]);
  const preview = await value("select public.get_rsvp_reminder_preview($1) value",[event]);
  equal(preview.eligible_count,1,"reminder preview excludes responders and inactive/password/test members");
  await value("select public.request_rsvp_reminder($1) value",[event]);
  await rejected(()=>value("select public.request_rsvp_reminder($1) value",[event]),/rate limit/,"per-event reminder cooldown rejects repeated requests");
  await actor(auth[0]);
  await rejected(()=>value("select public.request_rsvp_reminder($1) value",[event]),/permission required/,"ordinary member cannot manually remind");
  equal(await claim(),[],"database worker runtime defaults disabled");
  await owner("update private.notification_runtime set enabled=true,allowed_project_id=$1",[project]);
  equal(await claim(),[],"empty test allowlist still blocks delivery");
  await owner("update private.notification_runtime set test_auth_user_ids=$1::uuid[]",[auth.slice(0,3)]);
  await owner("delete from private.notification_deliveries"); await owner("delete from private.notification_events");
  await actor(auth[0]);
  await db.query("update public.attendance set status='going' where event_id=$1 and member_id=$2",[event,profiles[0]]);
  const firstClaims = await claim();
  equal(firstClaims.length,2,"default attendance audience is officers plus currently going members");
  const first = firstClaims[0];
  const prepared = await prepare(first);
  equal(prepared.data.recipient_user_id!==undefined,true,"payload binds its recipient account");
  await owner("update public.notification_preferences set attendance_enabled=false where auth_user_id=$1",[prepared.data.recipient_user_id]);
  await actor(null,"service_role");
  equal(await value("select public.validate_notification_delivery($1,$2) value",[first.id,first.lease_token]),false,"category disabled after claim is rechecked before dispatch");
  const second = firstClaims[1];
  const secondPrepared = await prepare(second);
  await owner("update private.push_installations set expo_token='ExpoPushToken[test-refreshed]' where id=$1",[secondPrepared.data.installation_id]);
  await actor(null,"service_role");
  await finish(second,"ticket","old-token-ticket");
  await owner("update private.notification_deliveries set next_attempt_at=now() where id=$1",[second.id]);
  await actor(null,"service_role");
  const receipt = (await value("select public.claim_notification_receipts(100) value"))[0];
  await value("select public.finish_notification_receipt($1,$2,'failed','DeviceNotRegistered') value",[receipt.id,receipt.lease_token]);
  equal(await enabled(secondPrepared.data.installation_id),true,"old token receipt cannot disable refreshed token");
  await actor(auth[1]);
  await rejected(()=>value("select public.cancel_event($1) value",[event]),/기록/,"check-in record prevents destructive cancellation");
  const cancellationEvent = uuid(202);
  await owner("insert into public.events(id,title,starts_at,venue,weekly_date) values($1,'Cancellation fixture',now()+interval '2 days','Venue',(now()+interval '2 days')::date)",[cancellationEvent]);
  await owner("insert into public.fees(event_id,member_id,status,fee_type) values($1,$2,'paid','participation')",[cancellationEvent,profiles[0]]);
  await actor(auth[1]);
  await rejected(()=>value("select public.cancel_event($1) value",[cancellationEvent]),/참여비/,"paid event fee is preserved");
  equal((await owner("select count(*)::integer value from private.weekly_schedule_exclusions")).rows[0].value,0,"protected cancellation rolls back exclusions");
  await owner("delete from public.fees where event_id=$1",[cancellationEvent]);
  await actor(auth[1]);
  await db.exec("begin");
  await value("select public.cancel_event($1) value",[cancellationEvent]);
  await db.exec("rollback");
  equal((await owner("select count(*)::integer value from public.events where id=$1",[cancellationEvent])).rows[0].value,1,"cancellation rollback restores original event");
  equal(await countEvents("event_cancelled"),0,"cancellation rollback removes snapshot");
  await actor(auth[1]);
  const cancelled = await value("select public.cancel_event($1) value",[cancellationEvent]);
  equal(cancelled.cancelled,true,"explicit cancellation succeeds for unrecorded upcoming event");
  equal(await countEvents("event_cancelled"),1,"snapshot survives source deletion");
  const ordinaryDelete = uuid(203);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Ordinary deletion',now()+interval '2 days','Venue')",[ordinaryDelete]);
  await actor(auth[1]);
  await db.query("delete from public.events where id=$1",[ordinaryDelete]);
  equal(await countEvents("event_cancelled"),1,"ordinary deletion never masquerades as explicit cancellation");
  await actor(auth[0]);
  await rejected(()=>value("select public.claim_notification_deliveries(100) value"),/permission denied/,"ordinary users cannot invoke delivery worker");
  await rejected(()=>db.query("select * from private.push_installations"),/permission denied/,"ordinary users cannot read tokens");

  // Newly due reminders are created once and recipients are checked against current source state.
  const tomorrow = uuid(601);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Tomorrow fixture',((now() at time zone 'Asia/Seoul')::date+1+time '08:00') at time zone 'Asia/Seoul','Venue')",[tomorrow]);
  await owner("update private.notification_policy set event_reminder_hour=extract(hour from now() at time zone 'Asia/Seoul')::integer");
  await actor(auth[0]);
  await db.query("insert into public.attendance(event_id,member_id,status) values($1,$2,'going')",[tomorrow,profiles[0]]);
  await claim();
  equal(await countEvents("event_reminder"),1,"day-before reminder uses the configured Seoul calendar hour");
  await claim();
  equal(await countEvents("event_reminder"),1,"scheduled reminder source/date is deduplicated");
  const rsvpDue = uuid(602);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'RSVP due',now()+interval '24 hours'-interval '1 minute','Venue')",[rsvpDue]);
  await claim();
  equal((await owner("select count(*)::integer value from private.notification_events where kind='rsvp_reminder' and source_id=$1",[rsvpDue])).rows[0].value,1,"automatic RSVP reminder uses starts_at as the deadline");
  await owner("insert into public.attendance(event_id,member_id,status) values($1,$2,'not_going')",[rsvpDue,profiles[0]]);
  equal((await owner("select private.notification_recipient_eligible(n,p) value from private.notification_events n cross join public.profiles p where n.kind='rsvp_reminder' and n.source_id=$1 and p.id=$2",[rsvpDue,profiles[0]])).rows[0].value,false,"a response after enqueue removes the RSVP recipient");
  const form = uuid(603);
  await owner("insert into public.participation_forms(id,title,kind,status,ends_at) values($1,'Closing survey','survey','open',now()+interval '24 hours'-interval '1 minute')",[form]);
  await claim();
  equal((await owner("select count(*)::integer value from private.notification_events where kind='participation_reminder' and source_id=$1",[form])).rows[0].value,1,"open participation deadline creates a reminder");
  equal((await owner("select private.notification_recipient_eligible(n,p) value from private.notification_events n cross join public.profiles p where n.source_id=$1 and p.id=$2",[form,profiles[0]])).rows[0].value,true,"unsubmitted member qualifies for participation reminder");
  await owner("insert into public.participation_submissions(form_id,participant_id) values($1,$2)",[form,profiles[0]]);
  equal((await owner("select private.notification_recipient_eligible(n,p) value from private.notification_events n cross join public.profiles p where n.source_id=$1 and p.id=$2",[form,profiles[0]])).rows[0].value,false,"submission after enqueue removes the reminder recipient");
  const feedback = uuid(604);
  await owner("insert into public.feedback(id,title,author_id) values($1,'My private feedback',$2)",[feedback,profiles[0]]);
  await owner("update public.feedback set officer_response='A response' where id=$1",[feedback]);
  equal(await countEvents("feedback_updated"),1,"officer response emits an author-targeted event");
  equal((await owner("select private.notification_recipient_eligible(n,p) value from private.notification_events n cross join public.profiles p where n.kind='feedback_updated' and p.id=$1",[profiles[1]])).rows[0].value,false,"another officer never receives the author's feedback notification");
  await owner("update public.feedback set status='resolved' where id=$1",[feedback]);
  equal(await countEvents("feedback_updated"),2,"feedback processing status emits");
  await owner("update public.feedback set status=status where id=$1",[feedback]);
  equal(await countEvents("feedback_updated"),2,"feedback no-op does not emit");
  // Existing partial-success RPC rolls back its failing row and the row's outbox.
  const batchEvent = uuid(605);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Batch fixture',now()+interval '5 days','Venue')",[batchEvent]);
  await owner("create function private.fail_batch_fixture() returns trigger language plpgsql as $$ begin if new.member_id='"+profiles[2]+"'::uuid then raise exception 'Injected batch failure'; end if; return new; end; $$");
  await owner("create trigger zz_fail_batch_fixture after insert or update on public.attendance for each row execute function private.fail_batch_fixture()");
  await actor(auth[1]);
  const batch = (await db.query("select * from public.save_attendance_batch($1,$2::jsonb)",[batchEvent,JSON.stringify([
    {member_id:profiles[0],response_status:"going",check_in_status:"present"},
    {member_id:profiles[2],response_status:"going",check_in_status:"late"},
  ])])).rows;
  equal(batch.map(row=>row.succeeded),[true,false],"attendance batch retains successful rows: " + batch.map(row=>row.error_message).join(" / "));
  equal((await owner("select count(*)::integer value from private.notification_events where source_id=$1",[batchEvent])).rows[0].value,1,"failed row's after-trigger event is rolled back");
  await owner("drop trigger zz_fail_batch_fixture on public.attendance");
  // The record guard ignores unrelated monthly fees.
  const monthlySafe = uuid(606);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Monthly fee unaffected',now()+interval '5 days','Venue')",[monthlySafe]);
  await owner("insert into public.fees(member_id,status,fee_type) values($1,'paid','monthly')",[profiles[0]]);
  await actor(auth[1]);
  equal((await value("select public.cancel_event($1) value",[monthlySafe])).cancelled,true,"unrelated paid monthly fees do not block event cancellation");
  const recorded = uuid(607);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Recorded match',now()+interval '5 days','Venue')",[recorded]);
  await owner("insert into public.event_matches(event_id) values($1)",[recorded]);
  await actor(auth[1]);
  await rejected(()=>value("select public.cancel_event($1) value",[recorded]),/기록/,"match history is protected from cascade cancellation");
  const past = uuid(608);
  await owner("insert into public.events(id,title,starts_at,venue) values($1,'Past fixture',now()-interval '1 day','Venue')",[past]);
  await actor(auth[1]);
  await rejected(()=>value("select public.cancel_event($1) value",[past]),/Upcoming event/,"past event cancellation is rejected");


  const neverRegistered = uuid(609);
  await actor(auth[0]);
  await reserve(0,0,revokeA,neverRegistered);
  await actor(null,"anon");
  const revokeBeforeRegister = await value("select public.revoke_push_installation($1,0,1,$2) value",[neverRegistered,revokeA]);
  equal(revokeBeforeRegister,{installation_id:neverRegistered,transition_epoch:1,binding_revision:0,enabled:false,revoked:true,terminal:true},"first revocation is proof-ready and typed before registration arrives");
  await actor(auth[0]);
  equal((await value("select public.register_push_installation($1,$2,$3,0,0,$4,'android','granted',$5) value",[neverRegistered,proof,revokeA,"ExpoPushToken[late-first]",project])).stale,true,"late first register is blocked by its authenticated revoked reservation");
  equal((await owner("select count(*)::integer value from private.push_installations where id=$1",[neverRegistered])).rows[0].value,0,"late first register creates no enabled binding");
  equal((await register(2,0,revokeB,"ExpoPushToken[new-first]","granted",neverRegistered)).enabled,true,"an unrelated/new proof is not blocked by a guessed installation UUID tombstone");
  await actor(null,"anon");
  const mismatch = await value("select public.revoke_push_installation($1,1,3,$2) value",[neverRegistered,revokeA]);
  equal([mismatch.transition_epoch,mismatch.binding_revision,mismatch.revoked,mismatch.terminal],[3,1,false,true],"invalid proof has safe terminal numeric fields");
  await owner("update private.push_installations set revocation_expires_at=now()-interval '1 minute' where id=$1",[neverRegistered]);
  await actor(null,"anon");
  const expired = await value("select public.revoke_push_installation($1,1,3,$2) value",[neverRegistered,revokeB]);
  equal([expired.transition_epoch,expired.binding_revision,expired.revoked,expired.terminal],[3,1,false,true],"expired proof returns typed terminal fields without revoking another binding");
  // Real dispatch snapshot recheck also catches token refresh between prepare and send.
  await owner("delete from private.notification_deliveries");
  await owner("delete from private.notification_events");
  await owner("update private.notification_runtime set disabled_categories=ARRAY['event_reminders','rsvp_reminders','participation']");
  await actor(auth[1]);
  await db.query("update public.events set starts_at=starts_at+interval '1 hour' where id=$1",[event]);
  const tokenClaims = await claim();
  const tokenPrepared = await prepare(tokenClaims[0]);
  await owner("update private.push_installations set expo_token='ExpoPushToken[between-prepare-send]' where id=$1",[tokenPrepared.data.installation_id]);
  await actor(null,"service_role");
  equal(await value("select public.validate_notification_delivery($1,$2) value",[tokenClaims[0].id,tokenClaims[0].lease_token]),false,"token changed after prepare prevents sending its old snapshot");
  const blockedPrepared = await prepare(tokenClaims[1]);
  await owner("update private.push_installations set permission_state='denied' where id=$1",[blockedPrepared.data.installation_id]);
  await actor(null,"service_role");
  equal(await value("select public.validate_notification_delivery($1,$2) value",[tokenClaims[1].id,tokenClaims[1].lease_token]),false,"OS permission revoked after prepare prevents dispatch");
  await owner("update private.notification_deliveries set status='sending',lease_until=now()-interval '1 minute' where id=$1",[tokenClaims[0].id]);
  await claim();
  equal((await owner("select status value from private.notification_deliveries where id=$1",[tokenClaims[0].id])).rows[0].value,"unknown","expired in-flight lease is never automatically replayed");

  await actor(null,"anon");
  await rejected(()=>value("select public.revoke_push_installation($1,$2::bigint,3,$3) value",[neverRegistered,"9007199254740992",revokeA]),/Invalid revocation/,"revocation rejects revisions outside JavaScript safe integer range");
  await owner("update private.notification_deliveries set status='ticket',ticket_id='expired-test-ticket',ticket_at=now()-interval '25 hours',next_attempt_at=now()-interval '1 minute',lease_until=null where id=$1",[tokenClaims[0].id]);
  await actor(null,"service_role");
  await value("select public.claim_notification_receipts(100) value");
  equal((await owner("select status value from private.notification_deliveries where id=$1",[tokenClaims[0].id])).rows[0].value,"unknown","receipts beyond provider retention finish without replaying the message");
  // Anonymous requests cannot allocate storage, and all new bindings require an awaited authenticated reservation.
  const beforeAnonymous = (await owner("select count(*)::integer value from private.push_installation_reservations")).rows[0].value;
  await actor(null,"anon");
  for (let index=0;index<30;index++) {
    const result = await value("select public.revoke_push_installation($1,0,1,$2) value",[uuid(800+index),revokeA]);
    assert.equal(result.terminal,true);
    assert.equal(result.revoked,false);
  }
  equal((await owner("select count(*)::integer value from private.push_installation_reservations")).rows[0].value,beforeAnonymous,"unknown anonymous proofs allocate no rows");
  await actor(null,"anon");
  await rejected(()=>reserve(0,0,revokeA,uuid(840)),/permission denied/,"anonymous clients cannot reserve installations");
  await actor(auth[2]);
  await rejected(()=>value("select public.register_push_installation($1,$2,$3,0,0,$4,'android','granted',$5) value",[uuid(841),proof,revokeA,"ExpoPushToken[unreserved]",project]),/reservation required/,"new registration cannot bypass the reservation boundary");
  await owner("delete from private.push_reservation_rate_limits where auth_user_id=$1",[auth[2]]);
  await actor(auth[2]);
  const lostReservation = uuid(842);
  const reservation = await reserve(0,0,revokeA,lostReservation);
  equal([reservation.reserved,reservation.stale,reservation.transition_epoch,reservation.binding_revision],[true,false,0,0],"authenticated reservation has a typed matching response");
  equal((await owner("select count(*)::integer value from private.push_installations where id=$1",[lostReservation])).rows[0].value,0,"lost reservation response cannot activate a push installation");
  await actor(auth[1]);
  await rejected(()=>reserve(0,0,revokeB,lostReservation,"f".repeat(64)),/Invalid installation proof/,"a different proof cannot steal a known reservation UUID");
  await actor(null,"anon");
  equal((await value("select public.revoke_push_installation($1,0,1,$2) value",[lostReservation,revokeA])).revoked,true,"logout revokes its authenticated pending reservation");
  await actor(auth[2]);
  equal((await value("select public.register_push_installation($1,$2,$3,0,0,$4,'android','granted',$5) value",[lostReservation,proof,revokeA,"ExpoPushToken[lost-reserve]",project])).stale,true,"late full registration is rejected after reservation logout");
  // New reservations are bounded per owner; idempotent retries bypass both quota counters.
  for(let index=0;index<4;index++) await reserve(0,0,revokeA,uuid(850+index));
  await rejected(()=>reserve(0,0,revokeA,uuid(854)),/Too many new installation reservations/,"a sixth new reservation within the owner's minute is rejected");
  equal((await reserve(0,0,revokeA,uuid(850))).reserved,true,"same reservation retries work after minute quota is full");
  equal((await owner("select requests value from private.push_reservation_rate_limits where auth_user_id=$1",[auth[2]])).rows[0].value,5,"idempotent retries do not consume new-request quota");
  for(let index=4;index<19;index++) {
    if(index%5===4) await owner("update private.push_reservation_rate_limits set window_started_at=now()-interval '2 minutes' where auth_user_id=$1",[auth[2]]);
    await actor(auth[2]);
    await reserve(0,0,revokeA,uuid(850+index));
  }
  await owner("update private.push_reservation_rate_limits set window_started_at=now()-interval '2 minutes' where auth_user_id=$1",[auth[2]]);
  await actor(auth[2]);
  await rejected(()=>reserve(0,0,revokeA,uuid(870)),/Too many pending/,"twenty unfinished reservations bound retained rows per owner");
  await actor(null,"anon");
  equal((await value("select public.revoke_push_installation($1,1,1,$2) value",[uuid(302),revokeA])).revoked,true,"valid installed-device revocation remains available despite full reservation quota");
  await owner("update private.push_installation_reservations set expires_at=now()-interval '1 minute' where installation_id=$1",[uuid(850)]);
  await actor(auth[2]);
  equal((await reserve(0,0,revokeA,uuid(870))).reserved,true,"expired reservations are cleaned before checking owner quota");
  equal((await owner("select count(*)::integer value from private.push_installation_reservations where installation_id=$1",[uuid(850)])).rows[0].value,0,"expiry cleanup actually removes the expired capability");
  // A verified JWT exp beyond the default retention extends the tombstone, while malformed claims use 30 days.
  await owner("delete from private.push_installation_reservations where auth_user_id=$1",[auth[2]]);
  await owner("delete from private.push_reservation_rate_limits where auth_user_id=$1",[auth[2]]);
  await actor(auth[2]);
  const extendedExp = Math.floor(Date.now()/1000)+40*86400;
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({exp:extendedExp})]);
  const longReservation = await reserve(0,0,revokeA,uuid(880));
  equal(new Date(longReservation.expires_at).getTime()>=extendedExp*1000+15*60000,true,"retention covers verified JWT expiry plus clock skew");
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({exp:"malformed"})]);
  const fallbackReservation = await reserve(0,0,revokeA,uuid(881));
  equal(Math.abs(new Date(fallbackReservation.expires_at).getTime()-Date.now()-30*86400000)<60000,true,"malformed JWT expiry uses conservative thirty-day retention");
  await actor(auth[2]);
  await register(0,0,revokeA,"ExpoPushToken[completed-reservation]","granted",uuid(881));
  equal((await owner("select count(*)::integer value from private.push_installation_reservations where installation_id=$1",[uuid(881)])).rows[0].value,0,"completed registration removes its pending reservations");
  await actor(auth[2]);
  equal((await value("select public.register_push_installation($1,$2,$3,0,1,$4,'android','granted',$5) value",[uuid(881),proof,revokeA,"ExpoPushToken[stable-no-reserve]",project])).binding_revision,1,"stable token refresh works without a reservation after completion cleanup");
  equal((await reserve(1,1,revokeB,uuid(881))).reserved,true,"a new binding reserves while an older installed binding still exists");
  await actor(null,"anon");
  equal((await value("select public.revoke_push_installation($1,1,2,$2) value",[uuid(881),revokeB])).revoked,true,"pending new binding can be revoked despite the previous installed proof");
  await actor(auth[2]);
  equal((await value("select public.register_push_installation($1,$2,$3,1,1,$4,'android','granted',$5) value",[uuid(881),proof,revokeB,"ExpoPushToken[late-new-binding]",project])).stale,true,"revoked new binding cannot arrive late and replace the older installation");
  // Production drops only the test allowlist. Existing domain, preference and binding checks remain authoritative.
  await owner("delete from private.notification_events");
  await owner("update private.push_installations set enabled=true,tombstoned=false,permission_state='granted',last_seen_at=now(),revocation_expires_at=now()+interval '30 days',project_id=$1",[project]);
  await owner("insert into public.notification_preferences(auth_user_id,enabled) select id,true from auth.users on conflict(auth_user_id) do update set enabled=true,notices_enabled=true,schedule_enabled=true");
  await rejected(()=>owner("update private.notification_runtime set delivery_mode='production',production_activated_at=null"),/production_activation_required/,"production requires an explicit activation cutoff");
  await owner("update private.notification_runtime set enabled=true,allowed_project_id=$1,test_auth_user_ids='{}',disabled_categories='{}',delivery_mode='test'",[project]);
  equal(await claim(),[],"an empty test allowlist cannot dispatch");
  await owner("update private.notification_runtime set delivery_mode='production',production_activated_at=now()-interval '1 minute'");
  await actor(auth[1]);
  await db.query("update public.events set venue='Production fixture venue' where id=$1",[event]);
  const productionClaims = await claim();
  equal(productionClaims.length>0,true,"production dispatch works without a test allowlist");
  const productionPrepared = await prepare(productionClaims[0]);
  equal(Boolean(productionPrepared?.to),true,"an opted-in production installation prepares normally");
  await owner("update public.notification_preferences set enabled=false where auth_user_id=$1",[productionPrepared.data.recipient_user_id]);
  await actor(null,"service_role");
  equal(await value("select public.validate_notification_delivery($1,$2) value",[productionClaims[0].id,productionClaims[0].lease_token]),false,"production opt-out still blocks a prepared send");
  await owner("update public.notification_preferences set enabled=true where auth_user_id=$1",[productionPrepared.data.recipient_user_id]);
  await owner("update private.notification_runtime set production_activated_at=now()+interval '1 minute'");
  await actor(null,"service_role");
  equal(await value("select public.validate_notification_delivery($1,$2) value",[productionClaims[0].id,productionClaims[0].lease_token]),false,"activation cutoff also blocks an already prepared historical delivery");
  await owner("update private.notification_deliveries set status='ticket',ticket_id='production-ticket',ticket_at=now(),next_attempt_at=now()-interval '1 minute',lease_until=null where id=$1",[productionClaims[0].id]);
  await owner("update public.notification_preferences set enabled=false where auth_user_id=$1",[productionPrepared.data.recipient_user_id]);
  await actor(null,"service_role");
  equal((await value("select public.claim_notification_receipts(100) value")).some(c=>c.id===productionClaims[0].id),true,"production receipts complete accepted tickets even after opt-out and before cutoff");
  await owner("delete from private.notification_events");
  await actor(auth[1]);
  await db.query("update public.events set venue='Historical fixture venue' where id=$1",[event]);
  equal(await claim(),[],"historical outbox events do not expand after activation");
  equal((await owner("select count(*)::integer value from private.notification_deliveries")).rows[0].value,0,"historical cutoff allocates no delivery rows");
  // A newly registered member is eligible without editing the allowlist; project and account status remain gates.
  await owner("delete from private.notification_events");
  await owner("update private.notification_runtime set production_activated_at=now()-interval '1 minute',disabled_categories=ARRAY['event_reminders','rsvp_reminders','participation']");
  await owner("delete from private.push_reservation_rate_limits where auth_user_id=$1",[auth[2]]);
  await actor(auth[2]);
  await register(0,0,revokeA,"ExpoPushToken[production-new-member]","granted",uuid(890));
  await actor(auth[1]);
  await db.query("update public.events set venue='New-member fixture venue' where id=$1",[event]);
  const newMemberClaims = await claim();
  equal((await owner("select exists(select 1 from private.notification_deliveries where installation_id=$1) value",[uuid(890)])).rows[0].value,true,"new production member registration needs no allowlist update");
  equal(newMemberClaims.length>0,true,"production event creates eligible deliveries");
  await owner("update private.push_installations set project_id=$1 where id=$2",[uuid(999),uuid(890)]);
  await actor(null,"service_role");
  const installationClaim = (await owner("select id,lease_token from private.notification_deliveries where installation_id=$1",[uuid(890)])).rows[0];
  await actor(null,"service_role");
  equal(await prepare(installationClaim),null,"production project mismatch still blocks prepare");
  await owner("update private.push_installations set project_id=$1 where id=$2",[project,uuid(890)]);
  await owner("delete from private.notification_events");
  await owner("update public.profiles set status='inactive' where id=$1",[profiles[2]]);
  await actor(auth[1]);
  await db.query("update public.events set venue='Inactive-member fixture venue' where id=$1",[event]);
  await claim();
  equal((await owner("select exists(select 1 from private.notification_deliveries where installation_id=$1) value",[uuid(890)])).rows[0].value,false,"inactive members remain excluded in production");
  await owner("update public.profiles set status='active' where id=$1",[profiles[2]]);
  // Scheduler catch-up is bounded by its due time, including rows created by the first production poll.
  await owner("delete from private.notification_events");
  await owner("update private.notification_runtime set production_activated_at=now(),disabled_categories='{}'");
  await owner("update private.notification_policy set event_reminder_hour=extract(hour from now() at time zone 'Asia/Seoul')::integer");
  await owner("update public.events set starts_at=now()+interval '23 hours'");
  await owner("insert into public.participation_forms(id,title,kind,status,ends_at) values($1,'Production form','survey','open',now()+interval '23 hours')",[uuid(891)]);
  await owner("delete from private.notification_events");
  await owner("select private.enqueue_scheduled_notifications()");
  equal(await countEvents("event_reminder"),0,"first production poll does not catch up an event reminder due before activation");
  equal(await countEvents("rsvp_reminder"),0,"first production poll does not catch up an RSVP reminder due before activation");
  equal(await countEvents("participation_reminder"),0,"first production poll does not catch up a form reminder due before activation");
  await owner("update private.notification_runtime set production_activated_at=now()-interval '2 hours'");
  await owner("select private.enqueue_scheduled_notifications()");
  equal((await countEvents("rsvp_reminder"))>0,true,"scheduled RSVP reminders due after activation still enqueue");
  equal((await owner("select count(*)::integer value from private.notification_events where kind='participation_reminder' and source_id=$1",[uuid(891)])).rows[0].value,1,"scheduled form reminders due after activation still enqueue");
  await actor(null,"anon");
  await rejected(()=>value("select public.claim_notification_deliveries(100) value"),/permission denied/,"production claims remain inaccessible to anonymous clients");
  await actor(auth[1]);
  await rejected(()=>value("select public.claim_notification_receipts(100) value"),/permission denied/,"production receipts remain inaccessible to members");
  console.log("PASS " + checks + " PostgreSQL assertions; " + await owner("select version()").then(r=>r.rows[0].version));
} catch (error) { console.error("FAIL after " + checks + " assertions: " + error.message); process.exitCode = 1; } finally { await db.close(); }
