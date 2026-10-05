import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Run only after verify-event-potm has replayed its synthetic fixture into this
// disposable local database. Deliberately accept no remote connection URL.
const modulePath = process.env.POTM_PG_MODULE;
assert.ok(modulePath, "POTM_PG_MODULE must point to an isolated pg package");
const { default: pg } = await import(pathToFileURL(modulePath).href);
const config = { host: "127.0.0.1", port: 55437, user: "postgres", database: "potm_batch_synthetic" };
const clients = Array.from({ length: 3 }, () => new pg.Client(config));
const [admin, first, second] = clients;
const member = (n) => "51010000-0000-0000-0000-" + String(n).padStart(12, "0");
const auth = (n) => "51000000-0000-0000-0000-" + String(n).padStart(12, "0");
const event = (n) => "53000000-0000-0000-0000-" + String(n).padStart(12, "0");
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const settle = (promise) => promise.then((result) => ({ result }), (error) => ({ error }));
async function begin(client, actor = null) {
  await client.query("reset role; begin; set local statement_timeout='5s'; set local request.jwt.claim.sub=''");
  if (actor !== null) {
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [auth(actor)]);
    await client.query("set local role authenticated");
  }
}
async function end() {
  await Promise.all([first.query("rollback; reset role"), second.query("rollback; reset role")]);
}
async function rejects(client, sql, values, code, label) {
  const outcome = await settle(client.query(sql, values));
  equal(outcome.error?.code, code, label);
}
async function waitForLock(client) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const { rows } = await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [client.processID]);
    if (rows[0]?.wait_event_type === "Lock") { checks++; return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The second independent connection did not wait on a PostgreSQL lock");
}
async function fixture(n) {
  await admin.query("insert into public.events(id,title,starts_at,venue) values($1,'Concurrent synthetic event',clock_timestamp()-interval '4 hours','Fixture')", [event(n)]);
  await admin.query("insert into public.attendance(event_id,member_id,status,check_in_status,checked_in_at) select $1,id,'going','present',clock_timestamp()-interval '3 hours' from public.profiles", [event(n)]);
}
const insert = "insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id) values($1,$2,$3)";
const update = "update public.event_mom_votes set candidate_profile_id=$3 where event_id=$1 and voter_id=$2";

try {
  await Promise.all(clients.map((client) => client.connect()));
  const { rows: identity } = await admin.query("select current_database() as db, host(inet_server_addr()) as host, version() as version");
  equal(identity[0].db, config.database, "synthetic database identity");
  equal(identity[0].host, "127.0.0.1", "loopback database identity");
  equal((await admin.query("select count(*)::integer as count from public.profiles where id::text like '51010000-%'")).rows[0].count, 11, "expected synthetic fixture only");
  equal((await admin.query("select count(*)::integer as count from public.profiles")).rows[0].count, 11, "database contains no other profiles");
  await admin.query("delete from public.events where id=any($1::uuid[])", [[101,102,103,104,105,106].map(event)]);
  await admin.query("delete from private.member_birthdays where profile_id=$1", [member(2)]);

  await fixture(101);
  await begin(first);
  await first.query("update public.events set mom_voting_days=4 where id=$1", [event(101)]);
  await begin(second, 2);
  await rejects(second, insert, [event(101),member(2),member(3)], "40001", "event edit lock rejects concurrent vote without waiting");
  await end();

  await fixture(102);
  await begin(first, 2);
  await first.query(insert, [event(102),member(2),member(3)]);
  await begin(second);
  const edit = settle(second.query("update public.events set mom_voting_days=4 where id=$1", [event(102)]));
  await waitForLock(second);
  await first.query("commit");
  equal((await edit).error, undefined, "event edit proceeds after the vote transaction commits");
  await second.query("commit");
  await end();

  // Reproduce the dangerous reverse order: vote row -> event, while a parent
  // DELETE already holds the event and waits to cascade into the vote row.
  await fixture(103);
  await begin(first, 2);
  await first.query(insert, [event(103),member(2),member(3)]);
  await first.query("commit");
  await end();
  await admin.query("update public.events set starts_at=clock_timestamp()-interval '5 days' where id=$1", [event(103)]);
  await begin(first, 2);
  await first.query("select voter_id from public.event_mom_votes where event_id=$1 for update", [event(103)]);
  await begin(second, 3);
  const cascade = settle(second.query("delete from public.events where id=$1", [event(103)]));
  await waitForLock(second);
  await rejects(first, update, [event(103),member(2),member(4)], "40001", "NOWAIT avoids vote/event parent-cascade deadlock");
  await first.query("rollback");
  equal((await cascade).error, undefined, "authorized closed parent cascade completes after conflicting vote aborts");
  await second.query("commit");
  equal((await admin.query("select count(*)::integer as count from public.event_mom_votes where event_id=$1", [event(103)])).rows[0].count, 0, "closed parent deletion removes its votes");
  await end();

  for (const [n, target, assignment, restore, label] of [
    [104, 7, "status='inactive'", "status='active'", "candidate deactivation"],
    [105, 2, "must_change_password=true", "must_change_password=false", "actor password reset"],
  ]) {
    await fixture(n);
    await begin(first);
    await first.query("update public.profiles set "+assignment+" where id=$1", [member(target)]);
    await begin(second, 2);
    const candidate = target === 2 ? 3 : target;
    await rejects(second, insert, [event(n),member(2),member(candidate)], "40001", label+" lock conflicts with vote");
    await second.query("rollback");
    await first.query("commit");
    await begin(second, 2);
    await rejects(second, insert, [event(n),member(2),member(candidate)], "42501", label+" is rechecked on retry");
    await end();
    await admin.query("update public.profiles set "+restore+" where id=$1", [member(target)]);
  }

  await fixture(106);
  await begin(first);
  await first.query("update public.attendance set check_in_status='absent' where event_id=$1 and member_id=$2", [event(106),member(3)]);
  await begin(second, 2);
  await rejects(second, insert, [event(106),member(2),member(3)], "40001", "candidate attendance edit lock conflicts with vote");
  await second.query("rollback");
  await first.query("commit");
  await begin(second, 2);
  await rejects(second, insert, [event(106),member(2),member(3)], "42501", "committed absent check-in is rechecked on retry");
  await end();

  await begin(first, 2);
  await first.query("select * from public.set_my_birthday(2,29,0)");
  await begin(second, 2);
  const birthday = settle(second.query("select * from public.set_my_birthday(3,1,0)"));
  await waitForLock(second);
  await first.query("commit");
  equal((await birthday).error?.code, "40001", "concurrent birthday registration rechecks revision after the profile lock");
  await end();
  equal((await admin.query("select birthday_month,birthday_day,revision::integer from private.member_birthdays where profile_id=$1", [member(2)])).rows,
    [{ birthday_month:2,birthday_day:29,revision:1 }], "concurrent stale registration cannot overwrite first registration");

  await begin(first);
  await first.query("update public.profiles set must_change_password=true where id=$1", [member(2)]);
  await begin(second, 2);
  const resetBirthday = settle(second.query("select * from public.set_my_birthday(3,1,1)"));
  await waitForLock(second);
  await first.query("commit");
  equal((await resetBirthday).error?.code, "42501", "birthday eligibility is rechecked after a concurrent password reset");
  await end();
  await admin.query("update public.profiles set must_change_password=false where id=$1", [member(2)]);
  console.log(JSON.stringify({ passed:true, checks, engine:identity[0].version, scope:"three independent loopback PostgreSQL connections; synthetic fixtures only" }));
} finally {
  await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
  await Promise.allSettled(clients.map((client) => client.end()));
}
