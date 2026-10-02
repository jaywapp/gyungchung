import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PGlite } = await import(process.env.PUSH_PGLITE_MODULE ? pathToFileURL(process.env.PUSH_PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const read = file => readFile(path.join(root, file), "utf8");
async function value(sql, args = []) { return (await db.query(sql, args)).rows[0]?.value; }
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function rejected(action, pattern, label) { await assert.rejects(action, pattern, label); checks++; }
async function actor(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)",
    [id ?? "", role, JSON.stringify({ sub: id, role, exp: Math.floor(Date.now() / 1000) + 3600 })]);
  await db.exec("set role " + role);
}
async function owner(sql, args = []) { await db.exec("reset role"); return value(sql, args); }
const uuid = n => "e0000000-0000-0000-0000-" + String(n).padStart(12, "0");
const users = [uuid(1), uuid(2), uuid(3), uuid(4)];
const profiles = [uuid(101), uuid(102), uuid(103), uuid(104)];
const install = uuid(201);
const proof = "a".repeat(64);
const revokeA = "b".repeat(64);
const revokeB = "c".repeat(64);
const subscription = endpoint => ({ endpoint: endpoint ?? "https://web.push.apple.com/Qfixture", keys: {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url"),
}, expirationTime: null });
async function reserve(epoch, revision, revoke = revokeA, id = install) {
  return value("select public.reserve_web_push_installation($1,$2,$3,$4,$5) value", [id, proof, revoke, epoch, revision]);
}
async function register(epoch, revision, revoke = revokeA, sub = subscription(), id = install, permission = "granted") {
  await reserve(epoch, revision, revoke, id);
  return value("select public.register_web_push_installation($1,$2,$3,$4,$5,$6,$7) value", [id, proof, revoke, epoch, revision, sub, permission]);
}
async function claim() { await actor(null, "service_role"); return value("select public.claim_web_notification_deliveries(100) value"); }
async function prepare(c) { return value("select public.prepare_web_notification_delivery($1,$2) value", [c.id, c.lease_token]); }
async function validate(c) { return value("select public.validate_web_notification_delivery($1,$2) value", [c.id, c.lease_token]); }
async function finish(c, outcome, code = null) { return value("select public.finish_web_notification_delivery($1,$2,$3,$4) value", [c.id, c.lease_token, outcome, code]); }
async function status(c) { return owner("select status value from private.web_notification_deliveries where id=$1", [c.id]); }
async function enabled() { return owner("select enabled value from private.web_push_installations where id=$1", [install]); }
async function testRequest() { await actor(users[0]); return value("select public.request_web_push_test($1,$2) value", [install, proof]); }
async function readyTest() {
  await owner("update private.web_push_installations set last_test_at=null");
  await testRequest();
  const rows = await claim();
  assert.equal(rows.length, 1);
  return rows[0];
}
try {
  await db.exec(await read("supabase/tests/fixtures/push_domain.sql"));
  await db.exec(await read("supabase/migrations/20261001114159_push_notifications.sql"));
  await db.exec(await read("supabase/migrations/20261001231341_push_production_rollout.sql"));
  await db.exec(await read("supabase/migrations/20261002003438_push_feedback_message_snapshots.sql"));
  const nativeBefore = await value("select pg_get_functiondef('public.claim_notification_deliveries(integer)'::regprocedure) value");
  const settingsBefore = await value("select pg_get_functiondef('public.save_notification_preferences(jsonb)'::regprocedure) value");
  await db.exec(await read("supabase/migrations/20261002122614_web_push_notifications.sql"));
  equal(await value("select pg_get_functiondef('public.claim_notification_deliveries(integer)'::regprocedure) value"), nativeBefore, "native queue RPC is untouched");
  equal(await value("select pg_get_functiondef('public.save_notification_preferences(jsonb)'::regprocedure) value"), settingsBefore, "settings RPC contract and implementation are unchanged");
  equal(await value("select enabled value from private.web_push_runtime"), false, "migration cannot enable delivery");
  for (let n = 0; n < users.length; n++) {
    await db.query("insert into auth.users(id) values($1)", [users[n]]);
    await db.query("insert into public.profiles(id,auth_user_id,name,status,must_change_password) values($1,$2,'Web fixture',$3,$4)", [profiles[n], users[n], n === 2 ? "inactive" : "active", n === 3]);
  }
  await actor(null, "anon");
  await rejected(() => value("select public.claim_web_notification_deliveries() value"), /permission denied/, "anon cannot claim deliveries");
  await rejected(() => reserve(0, 0), /permission denied/, "anon cannot reserve");
  await rejected(() => value("select * from private.web_push_installations"), /permission denied/, "private subscriptions never expose browser keys");
  for (const u of [users[2], users[3]]) {
    await actor(u);
    await rejected(() => reserve(0, 0), /Active member/, "inactive and forced-password members cannot bind");
  }
  await actor(users[0]);
  await rejected(() => value("select public.register_web_push_installation($1,$2,$3,0,0,$4,'granted') value", [install, proof, revokeA, subscription()]), /reservation required/, "registration requires durable reservation");
  await reserve(0, 0);
  await actor(null, "anon");
  equal((await value("select public.revoke_web_push_installation($1,0,1,$2) value", [install, revokeA])).revoked, true, "pending reservation can be revoked before late registration");
  await actor(users[0]);
  equal((await register(0, 0)).stale, true, "revoked reservation rejects late first registration");
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  equal((await register(2, 0, revokeB)).binding_revision, 1, "new epoch can bind after pending revocation");
  equal((await register(2, 1, revokeB)).binding_revision, 1, "subscription refresh preserves binding revision");
  await actor(null, "anon");
  equal((await value("select public.revoke_web_push_installation($1,0,3,$2) value", [install, revokeB])).revoked, true, "lost response revision zero safely revokes current binding");
  await actor(users[0]);
  equal((await register(2, 1, revokeB)).stale, true, "tombstone prevents delayed revival");
  equal((await register(4, 1, "d".repeat(64))).binding_revision, 2, "new proof rebinds new epoch");
  await actor(users[1]);
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  equal((await register(5, 2, "e".repeat(64))).binding_revision, 3, "verified new account becomes installation owner");
  await actor(users[0]);
  equal((await register(4, 2, "d".repeat(64))).stale, true, "old account cannot revive an obsolete binding");
  await actor(null, "anon");
  equal((await value("select public.revoke_web_push_installation($1,2,6,$2) value", [install, "d".repeat(64)])).revoked, false, "obsolete revocation proof cannot revoke new owner");
  await actor(users[0]);
  await owner("delete from private.web_push_reservation_rate_limits");
  await actor(users[0]);
  await register(6, 3, "f".repeat(64));
  for (const endpoint of ["https://127.0.0.1/push", "https://web.push.apple.com.evil.test/x", "https://user@web.push.apple.com/x", "https://web.push.apple.com:443/x", "https://web.push.apple.com/x?redirect=x", "https://web.push.apple.com/%0a"]) {
    await rejected(() => register(6, 4, "f".repeat(64), subscription(endpoint)), /Invalid installation/, "SSRF endpoint is rejected");
  }
  await rejected(() => register(6, 4, "f".repeat(64), { ...subscription(), keys: { ...subscription().keys, auth: "x" } }), /Invalid installation/, "invalid auth byte length rejected");
  await rejected(() => value("select public.claim_web_notification_deliveries() value"), /permission denied/, "member cannot operate worker RPC");
  equal(await claim(), [], "runtime OFF cannot expand or dispatch");
  await rejected(testRequest, /not available/, "self test cannot queue while runtime disabled");
  await owner("update private.web_push_runtime set enabled=true,activated_at=now()-interval '1 second'");
  await owner("update private.notification_runtime set test_auth_user_ids=array[$1]::uuid[]", [users[0]]);
  const beforeNative = await owner("select count(*)::integer value from private.notification_deliveries");
  const test = await testRequest();
  equal(test.queued, true, "self test queues only the current installation");
  await rejected(testRequest, /wait before testing/, "self tests are throttled");
  let c = (await claim())[0];
  let p = await prepare(c);
  equal(p.data.recipient_user_id, users[0], "payload binds authenticated recipient");
  equal(p.data.kind, "web_push_test", "test payload has explicit safe kind");
  equal(await validate(c), true, "current eligible binding validates");
  await actor(users[0]);
  await value("select public.save_notification_preferences('{\"enabled\":false}') value");
  await actor(null, "service_role");
  equal(await validate(c), false, "settings OFF after prepare prevents send");
  equal(await status(c), "skipped", "revoked eligibility terminates queued send");
  equal(await enabled(), false, "master OFF trigger disables web installation");
  await actor(users[0]);
  await value("select public.save_notification_preferences('{\"enabled\":true}') value");
  await register(6, 4, "f".repeat(64));
  c = await readyTest();
  p = await prepare(c);
  await actor(users[0]);
  await register(6, 4, "f".repeat(64), subscription("https://web.push.apple.com/refreshed"));
  await actor(null, "service_role");
  equal(await finish(c, "failed", "subscription_expired"), true, "provider expiry can finish old submission");
  equal(await enabled(), true, "old endpoint failure cannot disable refreshed subscription");
  c = await readyTest();
  await prepare(c);
  equal(await validate(c), true, "refreshed subscription prepares current fingerprint");
  equal(await finish(c, "accepted"), true, "provider acceptance completes delivery");
  equal(await finish(c, "failed", "subscription_expired"), false, "duplicate finish cannot alter terminal delivery");
  equal(await status(c), "accepted", "accepted means provider acceptance, not device receipt");
  c = await readyTest();
  await prepare(c);
  await owner("update private.web_notification_deliveries set lease_until=now()-interval '1 second' where id=$1", [c.id]);
  await claim();
  equal(await status(c), "unknown", "lost response does not cause duplicate send");
  equal(await owner("select count(*)::integer value from private.notification_deliveries"), beforeNative, "web self tests never enter native queue");
  await owner("insert into public.notices(id,title,body) values($1,'Shared notice','Fixture')", [uuid(501)]);
  await owner("update private.notification_events set expanded_at=now() where source_id=$1", [uuid(501)]);
  const rows = await claim();
  equal(rows.length, 1, "web independently expands Android-expanded event");
  c = rows[0];
  p = await prepare(c);
  equal(p.data.kind, "notice_created", "web consumes existing business outbox");
  await actor(users[0]);
  await value("select public.save_notification_preferences('{\"notices_enabled\":false}') value");
  await actor(null, "service_role");
  equal(await validate(c), false, "category OFF after prepare stops web delivery");
  equal(await owner("select count(*)::integer value from private.web_notification_event_expansions"), 1, "independent expansion records exactly once");
  await actor(users[0]);
  await value("select public.save_notification_preferences('{\"notices_enabled\":true}') value");
  c = await readyTest();
  await prepare(c);
  await actor(null, "anon");
  await value("select public.revoke_web_push_installation($1,4,7,$2) value", [install, "f".repeat(64)]);
  await actor(null, "service_role");
  equal(await validate(c), false, "logout after preparation stops submission");
  await owner("delete from private.web_push_reservation_rate_limits");
  await actor(users[0]);
  await register(8, 4, "1".repeat(64));
  c = await readyTest();
  await prepare(c);
  await owner("update public.profiles set status='inactive' where id=$1", [profiles[0]]);
  await actor(null, "service_role");
  equal(await validate(c), false, "member suspension after prepare stops send");
  await owner("update public.profiles set status='active' where id=$1", [profiles[0]]);
  c = await readyTest();
  await prepare(c);
  await owner("update private.web_push_runtime set enabled=false");
  await actor(null, "service_role");
  equal(await validate(c), false, "runtime emergency OFF stops prepared sends");
  await owner("update private.web_push_runtime set enabled=true");
  c = await readyTest();
  await prepare(c);
  await actor(null, "service_role");
  equal(await finish(c, "retry", "provider_unavailable"), true, "known provider rejection can be retried safely");
  equal(await status(c), "pending", "safe rejection schedules pending retry");
  await owner("update private.web_notification_deliveries set attempts=4,next_attempt_at=now()-interval '1 second' where id=$1", [c.id]);
  c = (await claim())[0];
  await prepare(c);
  equal(await finish(c, "retry", "provider_unavailable"), true, "fifth rejection completes bounded retry");
  equal(await status(c), "failed", "retry count is bounded");
  c = await readyTest();
  await prepare(c);
  equal(await finish(c, "failed", "subscription_expired"), true, "matching expired endpoint can be disabled");
  equal(await enabled(), false, "provider expiry disables only current matching subscription");
  await actor(users[0]);
  await register(8, 5, "1".repeat(64));
  await owner("update private.notification_runtime set test_auth_user_ids='{}'");
  await rejected(testRequest, /not available/, "test rollout requires explicitly allowlisted owner");
  await owner("update private.notification_runtime set test_auth_user_ids=array[$1]::uuid[]", [users[0]]);
  await owner("delete from private.web_push_reservation_rate_limits");
  await actor(users[0]);
  for (let n = 0; n < 5; n++) await reserve(0, 0, revokeA, uuid(600 + n));
  equal((await reserve(0, 0, revokeA, uuid(600))).reserved, true, "idempotent reservation does not consume quota");
  await rejected(() => reserve(0, 0, revokeA, uuid(605)), /Too many new/, "new reservations are bounded per minute");
  await owner("update private.web_push_installation_reservations set expires_at=now()-interval '1 second' where installation_id=$1", [uuid(600)]);
  await actor(users[0]);
  await rejected(() => value("select public.register_web_push_installation($1,$2,$3,0,0,$4,'granted') value", [uuid(600), proof, revokeA, subscription()]), /reservation required/, "expired reservation cannot register without renewed verified auth");
  await owner("insert into public.notices(id,title,body) values($1,'Old notice','Fixture')", [uuid(502)]);
  await owner("update private.notification_events set created_at=now()-interval '1 day' where source_id=$1", [uuid(502)]);
  equal(await claim(), [], "activation cutoff prevents replaying historical business events");
  console.log("Web push database checks passed: " + checks);
} finally { await db.close(); }
