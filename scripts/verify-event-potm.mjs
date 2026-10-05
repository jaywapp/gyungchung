import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Prepared for the batch gate. This harness never connects to a project DB.
// Independent-connection NOWAIT/cascade races still need a real PostgreSQL run.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PROFILE_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(path.join(root, name), "utf8");
const migrations = await readdir(path.join(root, "supabase/migrations"));
async function migration(suffix) {
  const matches = migrations.filter((name) => name.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return read("supabase/migrations/" + matches[0]);
}
function extractFunction(source, name) {
  const start = source.indexOf("create or replace function " + name + "(");
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}
function extractPolicy(source, name) {
  const start = source.indexOf('create policy "' + name + '"');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(";", start) + 1);
}
const authId = (n) => "51000000-0000-0000-0000-" + String(n).padStart(12, "0");
const memberId = (n) => "51010000-0000-0000-0000-" + String(n).padStart(12, "0");
const eventId = (n) => "53000000-0000-0000-0000-" + String(n).padStart(12, "0");
const quote = (value) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const vote = (event, voter, candidate) => "insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id) values(" + [eventId(event), memberId(voter), memberId(candidate)].map(quote).join(",") + ")";
const ownWhere = (event, voter) => " where event_id=" + quote(eventId(event)) + " and voter_id=" + quote(memberId(voter));
const remove = (event, voter) => "delete from public.event_mom_votes" + ownWhere(event, voter) + " returning voter_id";
const change = (event, voter, candidate) => "update public.event_mom_votes set candidate_profile_id=" + quote(memberId(candidate)) + ownWhere(event, voter) + " returning voter_id";
const updateEvent = (event, assignments) => "update public.events set " + assignments + " where id=" + quote(eventId(event)) + " returning id";
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub=" + quote(number ? authId(number) : "") + "; set role " + role);
}
async function scenario(number, work, setup = "", role = "authenticated") {
  await db.exec("begin; reset role; set request.jwt.claim.sub=''");
  try { if (setup) await db.exec(setup); await actor(number, role); await work(); }
  finally { await db.exec("rollback; reset role; set request.jwt.claim.sub=''"); }
}
async function rejects(sql, code, label) {
  await db.exec("savepoint denied_operation");
  try { await assert.rejects(db.query(sql), (error) => error.code === code, label); checks++; }
  finally { await db.exec("rollback to savepoint denied_operation; release savepoint denied_operation"); }
}
const counts = async (event) => (await db.query("select candidate_profile_id,vote_count::integer,mom_rank::integer from public.get_event_mom_results() where event_id=" + quote(eventId(event)) + " order by candidate_profile_id")).rows;

try {
  await db.exec(await read("supabase/tests/fixtures/profile_permissions.sql"));
  await db.exec(await read("supabase/tests/fixtures/profile_avatars.sql"));
  await db.exec(await read("supabase/tests/fixtures/event_potm.sql"));
  const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
  const base = await read("supabase/migrations/20260808234223_club_platform.sql");
  const hidden = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
  for (const name of ["private.current_profile_id", "private.has_permission", "private.is_active_member", "public.handle_new_user", "public.sync_profile_email_from_auth"])
    await db.exec(extractFunction(accounts, name));
  await db.exec(extractFunction(await read("supabase/migrations/20260816122500_accept_auth_phone_format.sql"), "private.normalize_member_phone"));
  await db.exec(extractFunction(await read("supabase/migrations/20260821135553_atomic_permission_batch.sql"), "public.protect_account_roles"));
  for (const [source, name] of [
    [accounts, "Members read own profile"], [accounts, "Member managers insert profiles"], [hidden, "Member managers read all profiles"],
    [base, "Member managers update profiles"], [base, "Member managers delete profiles"], [base, "Events are public"],
    [base, "Event managers insert"], [base, "Event managers update"], [base, "Event managers delete"], [base, "Members read attendance"],
  ]) await db.exec(extractPolicy(source, name));
  await db.exec(`revoke all on function private.current_profile_id(),private.has_permission(text),private.is_active_member() from public,anon,service_role;
    grant execute on function private.current_profile_id(),private.has_permission(text),private.is_active_member() to authenticated;
    create trigger protect_account_roles_before_write before update or delete on public.profiles for each row execute function public.protect_account_roles();`);
  await db.exec(await migration("_harden_profile_account_boundaries.sql"));
  const fee = await migration("_fix_fee_manager_policy_lookup.sql");
  await db.exec(fee.slice(fee.indexOf("create function public.get_member_directory()"), fee.indexOf("notify pgrst")));
  await db.exec(await migration("_add_profile_avatars.sql"));
  await db.exec(await migration("_add_member_birthdays.sql"));
  await db.exec(await migration("_add_member_phone_lookup.sql"));
  const legacy = await read("supabase/migrations/20260809055058_add_guest_players.sql");
  const tableStart = legacy.indexOf("create table public.event_mom_votes (");
  const triggerStart = legacy.indexOf("create or replace function public.validate_event_mom_vote()", tableStart);
  const resultsStart = legacy.indexOf("create or replace function public.get_event_mom_results()", triggerStart);
  await db.exec(legacy.slice(tableStart, triggerStart));
  // Reproduce legacy production default privileges before the new migration.
  await db.exec("grant truncate,references,trigger on public.event_mom_votes to anon,authenticated,service_role");
  // Model historical votes before guards were upgraded; no writes to live data.
  for (const [voter, candidate] of [[1,3],[2,3],[3,4],[4,2],[6,2],[7,10],[8,10],[9,10],[10,3]])
    await db.exec(vote(1, voter, candidate));
  await db.exec(legacy.slice(triggerStart, resultsStart));
  await db.exec(extractFunction(await read("supabase/migrations/20260816143000_add_attendance_check_in_status.sql"), "public.validate_event_mom_vote"));
  for (const name of ["Checked-in members create MOM vote", "Checked-in members update MOM vote", "Members read own MOM vote", "Members withdraw own MOM vote"]) {
    await db.exec('drop policy "' + name + '" on public.event_mom_votes');
    await db.exec(extractPolicy(accounts, name));
  }
  const ranking = await read("supabase/migrations/20260809060933_harden_ranking_functions.sql");
  for (const name of ["private.get_event_mom_results_data", "public.get_event_mom_results", "private.get_mom_leaderboard_data", "public.get_mom_leaderboard"])
    await db.exec(extractFunction(ranking, name));
  for (const name of ["private.get_event_mom_results_data", "private.get_mom_leaderboard_data"])
    await db.exec(extractFunction(hidden, name));
  await db.exec(`revoke all on function public.get_event_mom_results(),private.get_event_mom_results_data(),public.get_mom_leaderboard(),private.get_mom_leaderboard_data() from public,anon,authenticated,service_role;
    grant execute on function public.get_event_mom_results(),private.get_event_mom_results_data(),public.get_mom_leaderboard(),private.get_mom_leaderboard_data() to authenticated;
    grant execute on function public.get_event_mom_results(),public.get_mom_leaderboard() to service_role;`);
  const oldVotes = (await db.query("select * from public.event_mom_votes order by event_id,voter_id")).rows;
  const serviceVoteGrantsSql = "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='event_mom_votes' and grantee='service_role' order by privilege_type";
  const serviceVoteGrants = (await db.query(serviceVoteGrantsSql)).rows;
  const untouchedSql = `select oid::regprocedure::text as name,pg_get_functiondef(oid) as definition,proacl::text as acl from pg_proc
    where oid in ('public.get_member_directory()'::regprocedure,'public.set_my_birthday(integer,integer,bigint)'::regprocedure,
      'private.set_my_birthday(integer,integer,bigint)'::regprocedure,'public.get_member_phone(uuid)'::regprocedure,
      'private.get_member_phone(uuid)'::regprocedure,'private.has_permission(text)'::regprocedure,
      'public.get_event_mom_results()'::regprocedure,'public.get_mom_leaderboard()'::regprocedure) order by 1`;
  const untouched = (await db.query(untouchedSql)).rows;
  await db.exec(await migration("_add_event_potm_voting_window.sql"));
  equal((await db.query("select * from public.event_mom_votes order by event_id,voter_id")).rows, oldVotes, "migration preserves every historical vote and timestamp");
  equal((await db.query(untouchedSql)).rows, untouched, "birthday/phone/directory/permission definitions and ACL are unchanged");
  equal((await db.query(serviceVoteGrantsSql)).rows, serviceVoteGrants, "trusted service table ACL is unchanged");
  for (const role of ["anon", "authenticated"]) for (const privilege of ["truncate", "references", "trigger"])
    equal(await scalar("select has_table_privilege("+quote(role)+",'public.event_mom_votes',"+quote(privilege)+") as value"),false,role+" cannot "+privilege+" votes outside RLS");
  await scenario(2, async () => {
    await rejects("truncate public.event_mom_votes", "42501", "authenticated cannot bypass row guards with TRUNCATE");
    await rejects("alter table public.event_mom_votes disable trigger validate_event_mom_vote_before_write", "42501", "only the table owner can disable vote guards");
    await rejects("create trigger rejected_client_trigger before update on public.event_mom_votes for each row execute function public.protect_event_mom_window()", "42501", "clients cannot attach table triggers");
  });
  equal(await scalar("select bool_and(ends_at is null and mom_voting_days=3) as value from public.events"), true, "existing events use nullable two-hour default and three voting days");
  for (const operation of ["select", "insert", "update", "delete"])
    equal(await scalar("select has_table_privilege('authenticated','public.event_mom_votes'," + quote(operation) + ") as value"), true, "legacy direct " + operation + " grant remains");
  for (const fn of ["private.validate_event_mom_vote()", "public.protect_event_mom_window()", "private.event_mom_voting_is_open(timestamptz,timestamptz,integer,timestamptz)"])
    for (const role of ["anon", "authenticated", "service_role"])
      equal(await scalar("select has_function_privilege(" + quote(role) + "," + quote(fn) + ",'execute') as value"), false, "no client EXECUTE for internal guard " + fn);

  await scenario(2, async () => {
    await db.exec(vote(2,2,3));
    equal((await db.query(change(2,2,4))).rows.length, 1, "own vote changes inside window");
    await db.exec(vote(2,2,3) + " on conflict(event_id,voter_id) do update set candidate_profile_id=excluded.candidate_profile_id");
    equal((await db.query(remove(2,2))).rows.length, 1, "own vote withdraws inside window");
    for (const event of [1,3]) await rejects(vote(event,2,3) + " on conflict(event_id,voter_id) do update set candidate_profile_id=excluded.candidate_profile_id", "42501", "upsert cannot bypass closed/pending window");
    await rejects(vote(2,2,2), "42501", "self vote denied");
    for (const candidate of [6,10,11]) await rejects(vote(2,2,candidate), "42501", "inactive/hidden/pending candidate denied");
    await db.exec(vote(2,2,7));
    equal((await db.query(change(2,2,9))).rows.length, 1, "initial-password target remains eligible as a checked-in candidate");
    await rejects("update public.event_mom_votes set event_id=" + quote(eventId(4)) + ownWhere(2,2), "42501", "vote cannot move to another event");
    await rejects("update public.event_mom_votes set voter_id=" + quote(memberId(3)) + ownWhere(2,2), "42501", "vote cannot change its owner");
    await rejects(remove(1,2), "42501", "closed own DELETE is guarded");
    equal((await db.query(remove(1,3))).rows.length, 0, "cannot delete another member vote");
  });
  for (const number of [0,6,9,10,11,12]) await scenario(number, async () => {
    await rejects(vote(2,number || 2,3), "42501", "ineligible voter denied: " + number);
    equal((await db.query("select * from public.event_mom_votes")).rows.length, 0, "ineligible voter cannot read votes");
    equal((await db.query("select * from public.get_event_mom_results()")).rows.length, 0, "ineligible actor cannot read results");
    equal((await db.query("select * from public.get_mom_leaderboard()")).rows.length, 0, "ineligible actor cannot read cumulative awards");
  });
  await scenario(0, async () => {
    await rejects(vote(2,2,3), "42501", "anonymous direct write denied");
    await rejects("select * from public.get_event_mom_results()", "42501", "anonymous result RPC denied");
  }, "", "anon");
  for (const [status, stamp] of [["absent", "clock_timestamp()"], [null, "null"]]) await scenario(2, async () => {
    await rejects(vote(2,2,3), "42501", "absent or unchecked voter cannot vote despite old timestamp");
  }, "update public.attendance set check_in_status=" + quote(status) + ",checked_in_at=" + stamp + " where event_id=" + quote(eventId(2)) + " and member_id=" + quote(memberId(2)));
  await scenario(2, async () => { await db.exec(vote(2,2,3)); checks++; }, "update public.attendance set check_in_status=null where event_id=" + quote(eventId(2)));
  await scenario(2, async () => {
    await rejects(vote(2,2,3),"42501","unchecked candidate cannot be selected through direct insert");
  }, "update public.attendance set check_in_status=null,checked_in_at=null where event_id=" + quote(eventId(2)) + " and member_id=" + quote(memberId(3)));
  await scenario(2, async () => {
    await db.exec(vote(2,2,7));
    await actor(0,"postgres");
    await db.exec("update public.profiles set status='inactive' where id="+quote(memberId(7)));
    await actor(2);
    equal((await db.query(remove(2,2))).rows.length,1,"eligible voter may withdraw after candidate becomes inactive");
  });
  await scenario(2, async () => {
    equal(await counts(1), [
      { candidate_profile_id: memberId(2), vote_count: 2, mom_rank: 1 },
      { candidate_profile_id: memberId(3), vote_count: 2, mom_rank: 1 },
      { candidate_profile_id: memberId(4), vote_count: 1, mom_rank: 2 },
    ], "hidden voters/candidates are removed before dense rank; ties remain");
    const before = await counts(1);
    await actor(0,"postgres"); await db.exec("update public.attendance set check_in_status='absent',checked_in_at=null"); await actor(2);
    equal(await counts(1), before, "attendance edits do not rewrite historical result totals");
  });
  await scenario(2, async () => {
    const before = (await db.query("select * from public.get_mom_leaderboard() order by member_id")).rows;
    await db.exec(vote(2,2,3));
    equal((await db.query("select * from public.get_mom_leaderboard() order by member_id")).rows, before, "open event does not award provisional first place");
    await actor(0,"postgres"); await db.exec(updateEvent(2,"starts_at=clock_timestamp()-interval '6 days',ends_at=clock_timestamp()-interval '4 days'")); await actor(2);
    equal(Number((await db.query("select first_place_count from public.get_mom_leaderboard() where member_id=" + quote(memberId(3)))).rows[0].first_place_count), Number(before.find((row) => row.member_id===memberId(3)).first_place_count)+1, "closed event contributes to cumulative awards");
  });
  await scenario(1, async () => {
    equal((await db.query(updateEvent(2,"mom_voting_days=5"))).rows.length,1,"authorized officer can change voting period");
    await actor(0,"postgres"); await db.exec("delete from public.officer_permissions where officer_title='president' and permission='events.manage'"); await actor(1);
    equal((await db.query(updateEvent(2,"mom_voting_days=4"))).rows.length,0,"revoked events.manage prevents period changes");
  });
  for (const assignment of ["must_change_password=true", "is_test_account=true"]) await scenario(3, async () => {
    for (const update of ["mom_voting_days=5", "ends_at=starts_at+interval '3 hours'", "starts_at=starts_at-interval '1 hour'"])
      await rejects(updateEvent(2,update),"42501","ineligible administrator cannot reopen voting: "+assignment);
    await rejects("insert into public.events(title,starts_at,venue) values('Denied',clock_timestamp(),'Fixture')","42501","ineligible administrator cannot create a window");
  }, "update public.profiles set " + assignment + " where id=" + quote(memberId(3)));
  await scenario(3, async () => {
    equal((await db.query("delete from public.events where id="+quote(eventId(1))+" returning id")).rows.length,1,"authorized parent deletion cascades closed votes");
    equal((await db.query("select * from public.get_event_mom_results() where event_id="+quote(eventId(1)))).rows.length,0,"deleted event has no vote results");
  });
  await scenario(0, async () => {
    await db.exec("delete from public.profiles where id="+quote(memberId(2)));
    equal(await scalar("select count(*)::integer as value from public.event_mom_votes where voter_id="+quote(memberId(2))+" or candidate_profile_id="+quote(memberId(2))),0,"authorized profile deletion cascades historical votes");
  },"","postgres");

  console.log("POTM SQL verification passed: "+checks+" checks (synthetic PGlite; independent-connection concurrency not tested)");
  if (process.env.PROFILE_PGTAP_SQL) {
    const pgtap=await readFile(process.env.PROFILE_PGTAP_SQL,"utf8");
    await db.exec(pgtap.replaceAll("__VERSION__","1.034").replaceAll("__OS__","PGlite"));
    await db.exec("alter table auth.users add column instance_id uuid,add column aud text,add column role text");
    const results=await db.exec(await read("supabase/tests/database/event_potm.test.sql"));
    const lines=results.flatMap((result)=>result.rows.flatMap((row)=>Object.values(row).filter((value)=>typeof value==="string" && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
    const failures=lines.filter((line)=>/^not ok/m.test(line));
    const assertions=lines.filter((line)=>/^ok \d/.test(line));
    assert.ok(assertions.length,"pgTAP must run assertions");
    assert.equal(failures.length,0,failures.join("\n"));
    console.log("event_potm.test.sql: "+assertions.length+" pgTAP assertions passed");
  }
} catch(error) {
  console.error(error.message);console.error(JSON.stringify({code:error.code,detail:error.detail,where:error.where}));process.exitCode=1;
} finally { await db.close(); }
