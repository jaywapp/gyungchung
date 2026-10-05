import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Isolated synthetic PostgreSQL only. No credentials or project connection.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PROFILE_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(path.join(root, name), "utf8");
const migrations = await readdir(path.join(root, "supabase/migrations"));
const match = (suffix) => {
  const matches = migrations.filter((name) => name.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return "supabase/migrations/" + matches[0];
};
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
const authId = (number) => "51000000-0000-0000-0000-" + String(number).padStart(12, "0");
const memberId = (number) => "51010000-0000-0000-0000-" + String(number).padStart(12, "0");
const quote = (value) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const rpc = (month, day, revision = 0, schema = "public") =>
  "select * from " + schema + ".set_my_birthday(" + quote(month) + "," + quote(day) + "," + quote(revision) + ")";
const birthdayInsert = (number, month = 2, day = 29, revision = 1) =>
  "insert into private.member_birthdays(profile_id,birthday_month,birthday_day,revision) values(" + [memberId(number), month, day, revision].map(quote).join(",") + ")";
const profileUpdate = (number, assignments) => "update public.profiles set " + assignments + " where id=" + quote(memberId(number));
const oldColumns = ["id", "name", "role", "officer_title", "is_system_admin", "position", "jersey_number", "joined_at", "status", "fee_plan", "avatar_path"];
const birthdayColumns = ["birthday_month", "birthday_day", "birthday_revision"];
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub=" + quote(number ? authId(number) : "") + "; set role " + role);
}
async function scenario(number, work, setup = "", role = "authenticated") {
  await db.exec("begin; reset role; set request.jwt.claim.sub=''");
  try {
    if (setup) await db.exec(setup);
    await actor(number, role);
    await work();
  } finally { await db.exec("rollback; reset role; set request.jwt.claim.sub=''"); }
}
async function rejects(sql, code, label) {
  await db.exec("savepoint denied_operation");
  try {
    await assert.rejects(db.query(sql), (error) => error.code === code, label);
    checks++;
  } finally { await db.exec("rollback to savepoint denied_operation; release savepoint denied_operation"); }
}
async function directory() { return (await db.query("select * from public.get_member_directory() order by id")).rows; }
async function saved(month, day, revision = 0, schema = "public") {
  return (await db.query(rpc(month, day, revision, schema))).rows.map((row) => ({ ...row, birthday_revision: Number(row.birthday_revision) }));
}
const expectedBirthday = (month, day, revision) => [{ birthday_month: month, birthday_day: day, birthday_revision: revision }];

try {
  await db.exec(await read("supabase/tests/fixtures/profile_permissions.sql"));
  await db.exec(await read("supabase/tests/fixtures/profile_avatars.sql"));
  const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
  const basePolicy = await read("supabase/migrations/20260808234223_club_platform.sql");
  const hiddenPolicy = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
  for (const name of ["private.current_profile_id", "private.has_permission", "public.handle_new_user", "public.sync_profile_email_from_auth"])
    await db.exec(extractFunction(accounts, name));
  await db.exec(extractFunction(await read("supabase/migrations/20260816122500_accept_auth_phone_format.sql"), "private.normalize_member_phone"));
  await db.exec(extractFunction(await read("supabase/migrations/20260821135553_atomic_permission_batch.sql"), "public.protect_account_roles"));
  for (const [source, name] of [
    [accounts, "Members read own profile"], [accounts, "Member managers insert profiles"],
    [hiddenPolicy, "Member managers read all profiles"],
    [basePolicy, "Member managers update profiles"], [basePolicy, "Member managers delete profiles"],
  ]) await db.exec(extractPolicy(source, name));
  await db.exec(`
    revoke all on function private.current_profile_id(), private.has_permission(text) from public, anon, service_role;
    grant execute on function private.current_profile_id() to authenticated, service_role;
    grant execute on function private.has_permission(text) to authenticated;
    create trigger protect_account_roles_before_write before update or delete on public.profiles
      for each row execute function public.protect_account_roles();
  `);
  await db.exec(await read(match("_harden_profile_account_boundaries.sql")));
  const directorySource = await read(match("_fix_fee_manager_policy_lookup.sql"));
  await db.exec(directorySource.slice(directorySource.indexOf("create function public.get_member_directory()"), directorySource.indexOf("notify pgrst")));
  await db.exec(await read(match("_add_profile_avatars.sql")));

  const existingDirectory = new Map();
  for (const number of [0, 1, 2, 3, 6, 8, 9, 10, 11, 12]) {
    await scenario(number, async () => existingDirectory.set(number, await directory()));
  }
  const existingFunctions = (await db.query(`select oid::regprocedure::text as signature, pg_get_functiondef(oid) as definition, proacl::text as acl
    from pg_proc where oid in ('public.set_profile_avatar(text,text)'::regprocedure,
      'private.set_profile_avatar(text,text)'::regprocedure,'public.protect_account_roles()'::regprocedure,
      'public.protect_profile_avatar()'::regprocedure,'private.has_permission(text)'::regprocedure) order by 1`)).rows;
  const migration = await read(match("_add_member_birthdays.sql"));
  await db.exec(migration);

  equal(await scalar("select count(*)::integer as value from private.member_birthdays"), 0, "no DOB backfill or existing birthdays");
  equal(await scalar("select relrowsecurity as value from pg_class where oid='private.member_birthdays'::regclass"), true, "private table enables RLS");
  equal(await scalar("select count(*)::integer as value from pg_policies where schemaname='private' and tablename='member_birthdays'"), 0, "default-deny RLS has no client policy");
  equal((await db.query("select column_name from information_schema.columns where table_schema='private' and table_name='member_birthdays' order by ordinal_position")).rows.map((row) => row.column_name), ["profile_id", "birthday_month", "birthday_day", "revision"], "storage has no birth year or DOB");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const permission of ["select", "insert", "update", "delete", "truncate", "references", "trigger"])
      equal(await scalar("select has_table_privilege(" + quote(role) + ",'private.member_birthdays'," + quote(permission) + ") as value"), false, role + " cannot " + permission + " birthday table");
    for (const schema of ["public", "private"])
      equal(await scalar("select has_function_privilege(" + quote(role) + "," + quote(schema + ".set_my_birthday(integer,integer,bigint)") + ",'execute') as value"), role === "authenticated", role + " setter ACL " + schema);
    equal(await scalar("select has_function_privilege(" + quote(role) + ",'public.get_member_directory()','execute') as value"), role !== "anon", role + " directory ACL survives");
  }
  const functions = (await db.query("select pronamespace::regnamespace::text as schema, prosecdef,proconfig,proargnames,pg_get_userbyid(proowner) as owner from pg_proc where oid in ('public.set_my_birthday(integer,integer,bigint)'::regprocedure,'private.set_my_birthday(integer,integer,bigint)'::regprocedure) order by 1")).rows;
  equal(functions.map((fn) => [fn.schema, fn.prosecdef, fn.owner]), [["private", true, "postgres"], ["public", false, "postgres"]], "private definer and public invoker boundary");
  for (const fn of functions) {
    equal(fn.proconfig, ['search_path=""'], fn.schema + " fixed search path");
    equal(fn.proargnames, ["p_month", "p_day", "p_expected_revision", ...birthdayColumns], fn.schema + " has no target member argument");
  }
  equal((await db.query(`select oid::regprocedure::text as signature, pg_get_functiondef(oid) as definition, proacl::text as acl
    from pg_proc where oid in ('public.set_profile_avatar(text,text)'::regprocedure,
      'private.set_profile_avatar(text,text)'::regprocedure,'public.protect_account_roles()'::regprocedure,
      'public.protect_profile_avatar()'::regprocedure,'private.has_permission(text)'::regprocedure) order by 1`)).rows, existingFunctions, "avatar, fee authorization, and account protection definitions and ACL are unchanged");

  for (const [number, before] of existingDirectory) await scenario(number, async () => {
    const rows = await directory();
    equal(rows.map((row) => Object.fromEntries(oldColumns.map((column) => [column, row[column]]))), before, "all 11 existing directory columns and rows survive for actor " + number);
    if (rows.length) equal(Object.keys(rows[0]), [...oldColumns, ...birthdayColumns], "directory fields append in order");
  });
  await scenario(2, async () => {
    const own = (await directory()).find((row) => row.id === memberId(2));
    equal([own.birthday_month, own.birthday_day, Number(own.birthday_revision)], [null, null, 0], "unregistered own directory uses revision zero");
    equal(await saved(2, 29), expectedBirthday(2, 29, 1), "leap-day registration succeeds without a birth year");
    equal(await saved(12, 31, 1), expectedBirthday(12, 31, 2), "own birthday changes with current revision");
    equal(await saved(null, null, 2), expectedBirthday(null, null, 3), "clear deletes month/day and retains increasing revision");
    const cleared = (await directory()).find((row) => row.id === memberId(2));
    equal([cleared.birthday_month, cleared.birthday_day, Number(cleared.birthday_revision)], [null, null, 3], "directory returns the clear revision");
    await rejects(rpc(3, 1, 0), "40001", "old unregistered tab cannot recreate cleared birthday");
    equal(await saved(2, 29, 3), expectedBirthday(2, 29, 4), "new registration after clear uses current revision");
    await rejects(rpc(null, null, 1), "40001", "ABA birthday value does not allow stale deletion");
    await rejects(rpc(4, 1, 3), "40001", "second tab cannot overwrite the first tab");
    await rejects(rpc(2, 29, 3), "40001", "retry after lost success does not overwrite silently");
    equal(await saved(null, null, 4, "private"), expectedBirthday(null, null, 5), "private helper enforces the same own-only contract");
  });
  await scenario(2, async () => {
    equal(await saved(null, null), expectedBirthday(null, null, 1), "clearing unregistered data still creates a CAS tombstone");
    await rejects(rpc(1, 1, 0), "40001", "initial clear blocks a stale first registration");
  });
  const invalidDates = [[null, 1], [1, null], [0, 1], [13, 1], [-1, 1], [2, 30], [4, 31], [6, 31], [9, 31], [11, 31], [1, 0], [1, -1], [12, 32], [2147483647, 1], [1, 2147483647]];
  await scenario(2, async () => {
    for (const [month, day] of invalidDates) await rejects(rpc(month, day), "22023", "invalid date " + month + "/" + day);
    for (const revision of [null, -1]) await rejects(rpc(1, 1, revision), "22023", "invalid revision " + revision);
    await rejects(rpc(1, 1, 42), "40001", "nonexistent future revision is a conflict");
    equal(await saved(1, 31), expectedBirthday(1, 31, 1), "invalid attempts preserve unregistered state");
    equal(await saved(4, 30, 1), expectedBirthday(4, 30, 2), "valid thirty-day month accepted");
  });
  for (const number of [0, 6, 9, 10, 11, 12]) await scenario(number, async () => {
    for (const schema of ["public", "private"]) {
      await rejects(rpc(1, 1, 0, schema), "42501", "ineligible actor cannot save: " + number + "/" + schema);
      await rejects(rpc(null, null, 0, schema), "42501", "ineligible actor cannot clear: " + number + "/" + schema);
    }
    equal((await directory()).every((row) => birthdayColumns.every((key) => row[key] === null)), true, "ineligible actor sees no birthday or revision: " + number);
  }, birthdayInsert(2));
  for (const role of ["anon", "service_role"]) await scenario(0, async () => {
    for (const schema of ["public", "private"]) await rejects(rpc(1, 1, 0, schema), "42501", role + " cannot execute setter");
    if (role === "anon") await rejects("select * from public.get_member_directory()", "42501", "anon cannot read directory");
  }, "", role);

  for (const number of [1, 2, 3]) await scenario(number, async () => {
    const result = await saved(10, 5);
    equal(result, expectedBirthday(10, 5, 1), "member/manager/admin can save own birthday: " + number);
    await rejects("select * from private.member_birthdays", "42501", "even managers cannot select raw birthday table");
    await rejects(birthdayInsert(4), "42501", "even managers cannot insert another member's birthday");
    await rejects("update private.member_birthdays set birthday_day=1 where profile_id=" + quote(memberId(4)), "42501", "even managers cannot update another member's birthday");
    await rejects("delete from private.member_birthdays where profile_id=" + quote(memberId(4)), "42501", "even managers cannot delete another member's birthday");
    const other = (await directory()).find((row) => row.id === memberId(4));
    equal([other.birthday_month, other.birthday_day, other.birthday_revision], [2, 29, null], "another member's birthday stays unchanged; their revision stays private");
  }, birthdayInsert(4));
  await scenario(2, async () => {
    const rows = await directory();
    equal(rows.find((row) => row.id === memberId(3)).birthday_month, 2, "eligible member sees eligible target birthday");
    for (const number of [5, 7, 9]) {
      const target = rows.find((row) => row.id === memberId(number));
      equal([target.birthday_month, target.birthday_day, target.birthday_revision], [null, null, null], "unlinked/password target birthday is hidden: " + number);
    }
    equal(rows.some((row) => [memberId(6), memberId(10), memberId(11)].includes(row.id)), false, "inactive/hidden/pending targets remain outside roster");
  }, [2, 3, 5, 6, 7, 9, 10, 11].map((number) => birthdayInsert(number)).join(";"));

  for (const assignments of ["status='inactive'", "must_change_password=true", "is_test_account=true", "auth_user_id=null"]) await scenario(2, async () => {
    equal(await saved(1, 1), expectedBirthday(1, 1, 1), "actor starts eligible");
    await actor(0, "postgres");
    await db.exec(profileUpdate(2, assignments));
    await actor(2);
    await rejects(rpc(2, 2, 1), "42501", "live profile transition blocks save: " + assignments);
    await rejects(rpc(null, null, 1), "42501", "live profile transition blocks clear: " + assignments);
    equal((await directory()).every((row) => birthdayColumns.every((key) => row[key] === null)), true, "live profile transition hides all birthdays");
    await actor(3);
    const target = (await directory()).find((row) => row.id === memberId(2));
    equal(target ? [target.birthday_month, target.birthday_day, target.birthday_revision] : null, assignments.includes("inactive") || assignments.includes("is_test_account") ? null : [null, null, null], "target transition hides existing birthday");
  });
  await scenario(2, async () => {
    await saved(1, 1);
    await actor(0, "postgres");
    await db.exec(profileUpdate(2, "auth_user_id=" + quote(authId(12))));
    await actor(2);
    await rejects(rpc(2, 2, 1), "42501", "old identity cannot write after authentication relink");
    await actor(12);
    equal(await saved(2, 2, 1), expectedBirthday(2, 2, 2), "currently linked owner can edit the member's birthday");
  });

  await scenario(0, async () => {
    for (const [month, day] of invalidDates.filter(([month, day]) => (month === null || month < 32768) && (day === null || day < 32768)))
      await rejects(birthdayInsert(2, month, day), "23514", "table CHECK rejects invalid date independently of RPC");
    await rejects(birthdayInsert(2, 1, 1, 0), "23514", "table CHECK rejects revision zero");
    await rejects(birthdayInsert(2, 1, 1, null), "23502", "table requires a revision");
    await rejects(birthdayInsert(99), "23503", "birthday owner must be a real profile");
    await db.exec(birthdayInsert(2));
    await db.exec("delete from public.profiles where id=" + quote(memberId(2)));
    equal(await scalar("select count(*)::integer as value from private.member_birthdays"), 0, "profile deletion cleans up birthday via FK");
  }, "", "postgres");
  await scenario(2, async () => {
    equal(await scalar("select count(*)::integer as value from private.member_birthdays"), 0, "default-deny RLS hides data even if a table grant is accidentally added");
    await rejects(birthdayInsert(2), "42501", "default-deny RLS rejects insert with accidental grants");
    equal((await db.query("update private.member_birthdays set birthday_day=1 returning profile_id")).rows.length, 0, "default-deny RLS rejects update with accidental grants");
    equal((await db.query("delete from private.member_birthdays returning profile_id")).rows.length, 0, "default-deny RLS rejects delete with accidental grants");
  }, birthdayInsert(3) + "; grant select,insert,update,delete on private.member_birthdays to authenticated");

  const avatarPath = authId(2) + "/52000000-0000-0000-0000-000000000001.jpg";
  await scenario(2, async () => {
    await db.exec("insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-avatars'," + quote(avatarPath) + "," + quote(authId(2)) + ",' {\"mimetype\":\"image/jpeg\",\"size\":1024}'::jsonb)");
    equal(await scalar("select public.set_profile_avatar(" + quote(avatarPath) + ",null) as value"), avatarPath, "existing avatar setter still works after birthday migration");
    await saved(2, 29);
    let own = (await directory()).find((row) => row.id === memberId(2));
    equal([own.avatar_path, own.fee_plan, own.birthday_month, own.birthday_day], [avatarPath, "monthly", 2, 29], "directory combines avatar, own fee, and birthday");
    await actor(8);
    own = (await directory()).find((row) => row.id === memberId(2));
    equal([own.fee_plan, own.birthday_month, own.birthday_revision], ["monthly", 2, null], "fee manager preserves fee access but not another member's revision");
    await actor(3);
    await rejects(profileUpdate(3, "is_system_admin=false"), "42501", "birthday feature leaves administrator self-access guard intact");
  });

  console.log("Member birthday SQL verification passed: " + checks + " checks (real birthday/avatar migrations on isolated synthetic PGlite; CAS interleavings, not independent concurrent connections)");

  // An external, pinned pgTAP source can run the same suites used by test:db.
  // Keep verification dependencies outside the shipped application package.
  if (process.env.PROFILE_PGTAP_SQL) {
    const pgtap = await readFile(process.env.PROFILE_PGTAP_SQL, "utf8");
    await db.exec(pgtap.replaceAll("__VERSION__", "1.034").replaceAll("__OS__", "PGlite"));
    await db.exec("alter table auth.users add column instance_id uuid, add column aud text, add column role text");
    for (const file of ["member_birthdays.test.sql", "member_directory_auth_boundary.test.sql"]) {
      const results = await db.exec(await read("supabase/tests/database/" + file));
      const lines = results.flatMap((result) => result.rows.flatMap((row) => Object.values(row)
        .filter((value) => typeof value === "string" && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
      const failures = lines.filter((line) => /^not ok/m.test(line));
      const assertions = lines.filter((line) => /^ok \d/.test(line));
      assert.ok(assertions.length, "pgTAP suite must run assertions: " + file);
      assert.equal(failures.length, 0, file + "\n" + failures.join("\n"));
      console.log(file + ": " + assertions.length + " pgTAP assertions passed");
    }
  }
} catch (error) {
  console.error(error.message);
  console.error(JSON.stringify({ code: error.code, detail: error.detail, where: error.where }));
  process.exitCode = 1;
} finally { await db.close(); }
