import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.OFFICER_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(path.join(root, name), "utf8");
const migrationNames = await readdir(path.join(root, "supabase/migrations"));
const matches = migrationNames.filter((name) => name.endsWith("_align_officer_service_permissions.sql"));
assert.equal(matches.length, 1);
const migration = await read("supabase/migrations/" + matches[0]);
const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
const officers = await read("supabase/migrations/20260811120839_add_officer_titles.sql");
const base = await read("supabase/migrations/20260808234223_club_platform.sql");
const guests = await read("supabase/migrations/20260809055058_add_guest_players.sql");
const hidden = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
const checkIn = await read("supabase/migrations/20260816143000_add_attendance_check_in_status.sql");
const attendance = await read("supabase/migrations/20260821121500_save_attendance_batch.sql");
const welcome = await read("supabase/migrations/20261002005032_welcome_page.sql");
function extractFunction(source, name) {
  const start = source.indexOf("create or replace function " + name + "(");
  assert.ok(start >= 0, "Existing function " + name);
  const end = source.indexOf("$$;", start);
  assert.ok(end > start);
  return source.slice(start, end + 3);
}
function extractPolicy(source, name) {
  const start = source.indexOf('create policy "' + name + '"');
  assert.ok(start >= 0, "Existing policy " + name);
  return source.slice(start, source.indexOf(";", start) + 1);
}
const memberId = (number) => "51010000-0000-0000-0000-" + String(number).padStart(12, "0");
const authId = (number) => "51000000-0000-0000-0000-" + String(number).padStart(12, "0");
const eventId = "52000000-0000-0000-0000-000000000001";
const guestId = "53000000-0000-0000-0000-000000000001";
const titles = ["president", "vice_president", "treasurer"];
const services = ["members", "fees", "notices", "events", "feedback", "elections", "polls", "surveys", "welcome"].map((name) => name + ".manage");
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function rejected(sql, pattern, label) { await assert.rejects(db.exec(sql), pattern, label); checks++; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub='" + (number ? authId(number) : "") + "'; set role " + role);
}
function changes(number, status = "present") {
  return { member_id: memberId(number), response_status: "undecided", check_in_status: status };
}
function attendanceSql(records, target = eventId) {
  return "select * from public.save_attendance_batch('" + target + "','" + JSON.stringify(records) + "'::jsonb)";
}
function teamData(first = 9, second = 10) {
  return [
    { team_number: 1, team_name: "Fixture A", participants: [{ kind: "member", id: memberId(first) }] },
    { team_number: 2, team_name: "Fixture B", participants: [{ kind: "member", id: memberId(second) }, { kind: "guest", id: guestId }] },
  ];
}
function teamsSql(teams = teamData(), mode = "balanced") {
  return "select public.save_event_teams('" + eventId + "','" + mode + "','" + JSON.stringify(teams) + "'::jsonb)";
}
function permissionChange(title, permission, enabled, expected = !enabled) {
  return { officer_title: title, permission, enabled, expected_enabled: expected };
}
function batchSql(records) {
  return "select public.apply_officer_permission_batch('" + JSON.stringify(records) + "'::jsonb) as value";
}
const lookupSql = (number = 9) => "select * from private.get_managed_event_member('" + memberId(number) + "')";
const feeSql = "insert into public.fees(member_id,amount) values('" + memberId(9) + "',30000)";
async function snapshotTeams() {
  return (await db.query("select id,event_id,team_number,team_name,generation_mode,created_by from public.event_teams order by id")).rows;
}
try {
  await db.exec(await read("supabase/tests/fixtures/officer_service_permissions.sql"));
  for (const name of ["private.current_profile_id", "private.has_permission", "private.is_active_member", "private.can_manage_officer_permission", "public.save_event_teams"]) {
    await db.exec(extractFunction(accounts, name));
  }
  await db.exec(extractFunction(officers, "public.protect_officer_permissions"));
  await db.exec(extractFunction(checkIn, "public.protect_attendance_check_in"));
  await db.exec(attendance);
  await db.exec(extractFunction(welcome, "public.apply_officer_permission_batch"));
  await db.exec(`
    revoke all on function private.current_profile_id(), private.has_permission(text), private.is_active_member(),
      private.can_manage_officer_permission(public.officer_title), public.save_event_teams(uuid,text,jsonb),
      public.apply_officer_permission_batch(jsonb) from public, anon, authenticated, service_role;
    grant execute on function private.current_profile_id(), private.has_permission(text), private.is_active_member(),
      private.can_manage_officer_permission(public.officer_title), public.save_event_teams(uuid,text,jsonb),
      public.apply_officer_permission_batch(jsonb) to authenticated;
    revoke execute on function public.protect_officer_permissions(), public.protect_attendance_check_in()
      from public, anon, authenticated;
    create trigger protect_officer_permissions_before_write before insert or update or delete on public.officer_permissions
      for each row execute function public.protect_officer_permissions();
    create trigger protect_attendance_check_in_before_write before insert or update on public.attendance
      for each row execute function public.protect_attendance_check_in();
  `);
  for (const [source, names] of [
    [base, ["Member managers update profiles", "Events are public", "Event managers update", "Members read attendance", "Event managers delete attendance", "Fee managers insert", "Fee managers update", "Fee managers delete"]],
    [accounts, ["Members read own profile", "Members and event managers insert attendance", "Members update own attendance"]],
    [hidden, ["Member managers read all profiles"]],
    [officers, ["Active members read officer permissions", "Authorized officers insert officer permissions", "Authorized officers update officer permissions", "Authorized officers delete officer permissions"]],
    [guests, ["Scheduled guests are public", "Event teams are public", "Event managers create teams", "Event managers update teams", "Event managers delete teams", "Event team members are public", "Event managers create team members", "Event managers update team members", "Event managers delete team members"]],
  ]) for (const name of names) await db.exec(extractPolicy(source, name));
  await db.exec("create policy \"Fee managers read fixtures\" on public.fees for select to authenticated using ((select private.has_permission('fees.manage')))");

  await actor(1);
  equal(await scalar("select private.can_manage_officer_permission('treasurer') as value"), true, "reproduce president delegation before the fix");
  await db.exec("reset role");
  await rejected("delete from public.officer_permissions where officer_title='president' and permission='officers.manage'", /president must retain/, "reproduce protected delegation seed");
  await db.exec("delete from public.officer_permissions where officer_title='vice_president' and permission='members.manage'");
  await actor(2);
  equal(await scalar("select private.has_permission('events.manage') as value"), true, "baseline events-only officer");
  equal(await scalar("select private.has_permission('members.manage') as value"), false, "baseline officer lacks member access");
  equal(await scalar("select count(*)::integer as value from public.profiles where id='" + memberId(9) + "'"), 0, "baseline profile hidden by RLS");
  const failure = (await db.query(attendanceSql([changes(9)]))).rows[0];
  equal([failure.succeeded, failure.error_message], [false, "Active member not found"], "reproduce real attendance lookup failure");
  await rejected(teamsSql(), /Participant is not eligible/, "reproduce real team lookup failure");
  equal(await scalar("select count(*)::integer as value from public.event_teams"), 0, "baseline team replacement rolls back");
  await db.exec("reset role");
  const policies = (await db.query("select * from pg_policies where tablename<>'officer_permissions' order by tablename,policyname")).rows;
  const foreignKeys = (await db.query("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' order by conname")).rows;
  const batchDefinition = await scalar("select pg_get_functiondef('public.apply_officer_permission_batch(jsonb)'::regprocedure) as value");
  await db.exec(migration);
  equal((await db.query("select * from pg_policies where tablename<>'officer_permissions' order by tablename,policyname")).rows, policies, "profile and service policies remain unchanged");
  equal((await db.query("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' order by conname")).rows, foreignKeys, "foreign key and cascade behavior stays unchanged");
  equal(await scalar("select pg_get_functiondef('public.apply_officer_permission_batch(jsonb)'::regprocedure) as value"), batchDefinition, "latest batch validation, lock and CAS definition is preserved");
  equal(await scalar("select count(*)::integer as value from public.officer_permissions"), 27, "three officer titles receive nine services once");
  equal(await scalar("select to_regprocedure('public.protect_officer_permissions()') is null as value"), true, "delegation protection is removed");
  equal(await scalar("select count(*)::integer as value from pg_policies where tablename='officer_permissions' and cmd<>'SELECT'"), 0, "obsolete direct officer-write policies removed");
  for (const signature of ["public.save_attendance_batch(uuid,jsonb)", "public.save_event_teams(uuid,text,jsonb)"]) {
    equal(await scalar("select prosecdef as value from pg_proc where oid='" + signature + "'::regprocedure"), false, signature + " remains an invoker");
  }
  equal(await scalar("select prosecdef as value from pg_proc where oid='private.get_managed_event_member(uuid)'::regprocedure"), true, "minimal lookup is private definer");
  equal(await scalar("select proconfig as value from pg_proc where oid='private.get_managed_event_member(uuid)'::regprocedure"), ['search_path=""'], "lookup has a fixed empty search path");
  for (const role of ["anon", "service_role"]) {
    for (const signature of ["private.get_managed_event_member(uuid)", "private.can_manage_officer_permission(public.officer_title)", "public.save_attendance_batch(uuid,jsonb)", "public.save_event_teams(uuid,text,jsonb)", "public.apply_officer_permission_batch(jsonb)"]) {
      equal(await scalar("select has_function_privilege('" + role + "','" + signature + "','EXECUTE') as value"), false, role + " lacks " + signature);
    }
  }
  for (const number of [1, 2, 3]) {
    await actor(number);
    for (const permission of services) equal(await scalar("select private.has_permission('" + permission + "') as value"), true, titles[number - 1] + " baseline " + permission);
    equal(await scalar("select private.has_permission('roles.manage') as value"), false, "officers cannot manage system roles");
    equal(await scalar("select private.has_permission('officers.manage') as value"), false, "delegation no longer granted");
    for (const title of titles) equal(await scalar("select private.can_manage_officer_permission('" + title + "') as value"), false, "officer cannot configure " + title);
    await rejected(batchSql([permissionChange("treasurer", "fees.manage", false)]), /management access is required/, "every officer is denied batch configuration");
    await rejected("delete from public.officer_permissions where officer_title='treasurer' and permission='fees.manage'", /permission denied/, "direct table writes remain denied");
  }

  await actor(4);
  for (const title of titles) equal(await scalar("select private.can_manage_officer_permission('" + title + "') as value"), true, "system admin can configure " + title);
  equal(await scalar(batchSql([permissionChange("vice_president", "fees.manage", false)])), { status: "applied", applied_count: 1 }, "system administrator excludes vice-president fees");
  await rejected(batchSql([permissionChange("vice_president", "fees.manage", false)]), /changed while this batch was pending/, "stale expected_enabled is rejected");
  await rejected(batchSql([permissionChange("president", "events.manage", false), permissionChange("vice_president", "fees.manage", false)]), /changed while this batch was pending/, "late stale conflict rolls back the whole batch");
  equal(await scalar("select exists(select 1 from public.officer_permissions where officer_title='president' and permission='events.manage') as value"), true, "earlier batch write was rolled back");
  await rejected(batchSql([permissionChange("vice_president", "roles.manage", true)]), /invalid change/, "batch cannot grant system roles");
  await rejected(batchSql([permissionChange("vice_president", "officers.manage", true)]), /invalid change/, "batch cannot reintroduce delegation");
  await rejected(batchSql([permissionChange("treasurer", "events.manage", false), permissionChange("treasurer", "events.manage", false)]), /duplicate changes/, "batch duplicate validation retained");
  await rejected(batchSql([permissionChange("treasurer", "events.manage", true, true)]), /invalid change/, "no-op change validation retained");
  equal(await scalar(batchSql([permissionChange("president", "welcome.manage", false), permissionChange("treasurer", "surveys.manage", false)])), { status: "applied", applied_count: 2 }, "system admin can exclude services from any title");
  await actor(2);
  equal(await scalar("select private.has_permission('fees.manage') as value"), false, "vice-president exclusion applies immediately");
  await rejected(feeSql, /row-level security/, "excluded vice-president cannot write fees");
  await db.exec("reset role");
  // Reapply only DDL, as a later deployment would. The one-time INSERT is absent.
  const seedStart = migration.indexOf("insert into public.officer_permissions (officer_title, permission)");
  const seedEnd = migration.indexOf(";", seedStart) + 1;
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  await db.exec(migration.slice(0, seedStart) + migration.slice(seedEnd));
  await actor(2);
  equal(await scalar("select private.has_permission('fees.manage') as value"), false, "later function deployment does not restore excluded service");
  await rejected(feeSql, /row-level security/, "fee exclusion persists after redeployment");
  await actor(4);
  await db.exec(batchSql([permissionChange("vice_president", "members.manage", false)]));
  await actor(2);
  equal(await scalar("select private.has_permission('members.manage') as value"), false, "event-only regression has no profile management");
  equal((await db.query(lookupSql())).rows, [{ id: memberId(9), name: "Target Member Fixture", position: "FW", status: "active" }], "event manager gets exactly four roster fields");
  equal(await scalar("select count(*)::integer as value from public.profiles where id<>'" + memberId(2) + "'"), 0, "event lookup does not expose private profiles");
  equal((await db.query("update public.profiles set phone='forbidden' where id='" + memberId(9) + "' returning id")).rows.length, 0, "event manager cannot edit private member fields");
  await db.exec("reset role; insert into public.attendance(event_id,member_id,status) values('" + eventId + "','" + memberId(9) + "','going')");
  await actor(2);
  equal((await db.query(attendanceSql([changes(9), changes(10, "late")]))).rows.map((row) => row.succeeded), [true, true], "events-only manager saves attendance");
  const attendanceRows = (await db.query("select member_id,status,check_in_status,checked_in_by from public.attendance order by member_id")).rows;
  equal(attendanceRows.map((row) => [row.status, row.check_in_status, row.checked_in_by]), [["going", "present", memberId(2)], ["undecided", "late", memberId(2)]], "response is retained and check-in attribution uses profile ID");
  equal((await db.query(attendanceSql([changes(9)]))).rows[0].succeeded, true, "attendance repeated save succeeds");
  equal(await scalar("select count(*)::integer as value from public.attendance"), 2, "attendance repeated save is idempotent");
  equal((await db.query(attendanceSql([changes(9, null)]))).rows[0].succeeded, true, "check-in can be cleared");
  equal(await scalar("select checked_in_at is null and checked_in_by is null and check_in_status is null as value from public.attendance where member_id='" + memberId(9) + "'"), true, "clearing check-in clears its timestamp and actor");
  await db.exec(teamsSql());
  equal(await scalar("select team_mode as value from public.events where id='" + eventId + "'"), "balanced", "event-only manager saves team mode");
  equal((await db.query("select participant_name,participant_position from public.event_team_members order by participant_name")).rows, [
    { participant_name: "Guest Fixture", participant_position: "DF" },
    { participant_name: "Second Target Fixture", participant_position: "GK" },
    { participant_name: "Target Member Fixture", participant_position: "FW" },
  ], "member and scheduled guest snapshots save correctly");
  const teamsBeforeFailure = await snapshotTeams();
  for (const number of [11, 12]) {
    equal((await db.query(lookupSql(number))).rows.length, 0, "hidden or inactive target excluded from lookup");
    const result = (await db.query(attendanceSql([changes(number)]))).rows[0];
    equal([result.succeeded, result.error_message], [false, "Active member not found"], "hidden or inactive attendance target denied");
    await rejected(teamsSql(teamData(9, number)), /Participant is not eligible/, "hidden or inactive team target denied");
    equal(await snapshotTeams(), teamsBeforeFailure, "failed replacement preserves previous teams");
  }
  const mixed = (await db.query(attendanceSql([changes(9), changes(11), changes(10)]))).rows;
  equal(mixed.map((row) => [row.result_index, row.succeeded]), [[1, true], [2, false], [3, true]], "attendance keeps row-level outcomes and successful rows");
  equal((await db.query(attendanceSql([changes(9), changes(9)]))).rows.map((row) => row.error_message), [null, "Duplicate member in attendance changes"], "duplicate attendance validation retained");
  const missingCheckIn = changes(9); delete missingCheckIn.check_in_status;
  equal((await db.query(attendanceSql([missingCheckIn]))).rows[0].error_message, "Check-in status is required", "required check-in validation retained");
  equal((await db.query(attendanceSql([changes(9, "invalid")]))).rows[0].succeeded, false, "invalid attendance enum remains rejected");
  await rejected("select * from public.save_attendance_batch('" + eventId + "','{}')", /changes must be an array/, "attendance array validation retained");
  await rejected(attendanceSql(Array.from({ length: 501 }, () => changes(9))), /cannot exceed 500/, "attendance size validation retained");
  await rejected(attendanceSql([], "52000000-0000-0000-0000-000000000099"), /Event not found/, "attendance event validation retained");
  await rejected(teamsSql(teamData(), "invalid"), /Invalid team generation/, "team mode validation retained");
  await rejected(teamsSql(teamData().slice(0, 1)), /between two and four/, "team count validation retained");
  await rejected(teamsSql(teamData(9, 9)), /duplicate key/, "duplicate team participants stay rejected atomically");
  equal(await snapshotTeams(), teamsBeforeFailure, "all invalid team saves preserve existing teams");

  for (const number of [5, 6, 7, 8, 13, 14, 99, 0]) {
    await actor(number);
    equal((await db.query(lookupSql())).rows.length, 0, "unauthorized, inactive, pending, hidden or unlinked actor cannot look up members: " + number);
    await rejected(attendanceSql([changes(9)]), /Only event managers/, "unauthorized actor cannot save attendance: " + number);
    await rejected(attendanceSql([]), /Only event managers/, "unauthorized actor cannot bypass guard with an empty batch: " + number);
    await rejected(teamsSql(), /Event management permission/, "unauthorized actor cannot save teams: " + number);
    if (number !== 8) {
      equal(await scalar("select private.can_manage_officer_permission('treasurer') as value"), false, "non-admin or inactive actor cannot configure services: " + number);
      await rejected(batchSql([permissionChange("treasurer", "fees.manage", false)]), /management access is required|Authentication is required/, "batch configuration denies non-admin actor: " + number);
    }
  }
  await actor(0, "anon");
  await rejected(lookupSql(), /permission denied/, "anonymous roster lookup denied");
  await rejected(attendanceSql([]), /permission denied/, "anonymous attendance RPC denied");
  await rejected(teamsSql(), /permission denied/, "anonymous teams RPC denied");
  await rejected(batchSql([permissionChange("treasurer", "fees.manage", false)]), /permission denied/, "anonymous permission batch denied");
  await actor(4);
  await db.exec(batchSql([permissionChange("vice_president", "events.manage", false)]));
  await actor(2);
  equal((await db.query(lookupSql())).rows.length, 0, "event permission revocation applies immediately");
  await rejected(attendanceSql([changes(9)]), /Only event managers/, "revoked officer cannot save attendance");
  await rejected(teamsSql(), /Event management permission/, "revoked officer cannot save teams");
  await db.exec("reset role");
  await rejected("insert into public.officer_permissions values('president','officers.manage')", /check constraint/, "schema excludes obsolete delegation permission");
  await rejected("insert into public.officer_permissions values('vice_president','roles.manage')", /check constraint/, "schema cannot grant system permission to an officer");
  console.log(JSON.stringify({ passed: true, checks, baselineFailuresReproduced: ["attendance", "team lookup", "president delegation"], scope: "isolated PostgreSQL officer service permissions" }));
} finally {
  await db.close();
}
