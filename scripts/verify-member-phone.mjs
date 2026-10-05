import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Prepared for the next verification batch. Synthetic, in-memory SQL only.
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
const rpc = (number, schema = "public") => "select " + schema + ".get_member_phone(" + quote(number === null ? null : memberId(number)) + ") as value";
const profileUpdate = (number, assignments) => "update public.profiles set " + assignments + " where id=" + quote(memberId(number));
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
const functionSnapshot = `select namespace.nspname as schema, fn.oid::regprocedure::text as signature,
  pg_get_functiondef(fn.oid) as definition, fn.proacl::text as acl
  from pg_proc as fn join pg_namespace as namespace on namespace.oid=fn.pronamespace
  where namespace.nspname in ('public','private') and fn.proname <> 'get_member_phone' order by 1,2`;
const policySnapshot = "select * from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname";
const grantSnapshot = `select namespace.nspname as schema, relation.relname, relation.relacl::text as acl, relation.relrowsecurity
  from pg_class as relation join pg_namespace as namespace on namespace.oid=relation.relnamespace
  where namespace.nspname in ('public','private','storage') and relation.relkind='r' order by 1,2`;

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
  await db.exec(await read(match("_add_member_birthdays.sql")));
  await db.exec("insert into private.member_birthdays(profile_id,birthday_month,birthday_day,revision) values(" + quote(memberId(2)) + ",2,29,1),(" + quote(memberId(3)) + ",12,31,2)");

  const previousFunctions = (await db.query(functionSnapshot)).rows;
  const previousPolicies = (await db.query(policySnapshot)).rows;
  const previousGrants = (await db.query(grantSnapshot)).rows;
  const previousProfiles = (await db.query("select * from public.profiles order by id")).rows;
  const previousBirthdays = (await db.query("select * from private.member_birthdays order by profile_id")).rows;
  const previousDirectories = new Map();
  for (const number of [0, 1, 2, 3, 6, 8, 9, 10, 11, 12])
    await scenario(number, async () => previousDirectories.set(number, await directory()));

  await db.exec(await read(match("_add_member_phone_lookup.sql")));
  equal((await db.query(functionSnapshot)).rows, previousFunctions, "existing function definitions and ACL are preserved");
  equal((await db.query(policySnapshot)).rows, previousPolicies, "all existing RLS policies are preserved");
  equal((await db.query(grantSnapshot)).rows, previousGrants, "all existing table grants and RLS states are preserved");
  equal((await db.query("select * from public.profiles order by id")).rows, previousProfiles, "migration does not change profile data");
  equal((await db.query("select * from private.member_birthdays order by profile_id")).rows, previousBirthdays, "migration does not change birthday data");
  for (const [number, previous] of previousDirectories) await scenario(number, async () => {
    equal(await directory(), previous, "all 14 directory fields and rows preserved for actor " + number);
  });
  for (const role of ["anon", "authenticated", "service_role", "fixture_untrusted"]) {
    for (const schema of ["public", "private"])
      equal(await scalar("select has_function_privilege(" + quote(role) + "," + quote(schema + ".get_member_phone(uuid)") + ",'execute') as value"), role === "authenticated", role + " phone ACL " + schema);
  }
  const functions = (await db.query("select pronamespace::regnamespace::text as schema,prosecdef,provolatile,proconfig,proargnames,prorettype::regtype::text as result_type,pg_get_userbyid(proowner) as owner from pg_proc where oid in ('public.get_member_phone(uuid)'::regprocedure,'private.get_member_phone(uuid)'::regprocedure) order by 1")).rows;
  equal(functions.map((fn) => [fn.schema, fn.prosecdef, fn.owner]), [["private", true, "postgres"], ["public", false, "postgres"]], "private definer and public invoker boundary");
  for (const fn of functions) {
    equal(fn.proconfig, ['search_path=""'], fn.schema + " has fixed search path");
    equal(fn.provolatile, "s", fn.schema + " lookup is stable");
    equal(fn.proargnames, ["p_member_id"], fn.schema + " looks up one selected member");
    equal(fn.result_type, "text", fn.schema + " returns only phone text");
  }
  for (const number of [0, 6, 9, 10, 11, 12]) await scenario(number, async () => {
    for (const schema of ["public", "private"]) {
      await rejects(rpc(2, schema), "42501", "ineligible actor cannot read another phone: " + number + "/" + schema);
      await rejects(rpc(null, schema), "42501", "null target does not bypass actor check: " + number + "/" + schema);
    }
  });
  for (const role of ["anon", "service_role", "fixture_untrusted"]) await scenario(2, async () => {
    for (const schema of ["public", "private"])
      await rejects(rpc(2, schema), "42501", role + " cannot call phone lookup even with a claimed active identity");
  }, "", role);
  for (const number of [1, 2, 3, 8]) await scenario(number, async () => {
    for (const target of [1, 2, 3, 5, 7, 8, 9])
      equal(await scalar(rpc(target)), previousProfiles.find((profile) => profile.id === memberId(target)).phone, "eligible actor " + number + " can read active visible target " + target);
    for (const target of [6, 10, 11, 12, 99, null])
      equal(await scalar(rpc(target)), null, "inactive/hidden/pending/nonexistent target returns null: " + target);
    equal(await scalar(rpc(2, "private")), previousProfiles.find((profile) => profile.id === memberId(2)).phone, "direct private invocation repeats authorization");
  });
  await scenario(2, async () => {
    equal((await db.query("select phone from public.profiles where id=" + quote(memberId(3)))).rows, [], "member still cannot query another profile directly");
    equal(Object.keys((await directory())[0]), ["id", "name", "role", "officer_title", "is_system_admin", "position", "jersey_number", "joined_at", "status", "fee_plan", "avatar_path", "birthday_month", "birthday_day", "birthday_revision"], "phone is not added to bulk directory projection");
  });
  for (const phone of [null, "", "   "]) await scenario(2, async () => {
    equal(await scalar(rpc(7)), null, "missing or blank phone returns null");
  }, profileUpdate(7, "phone=" + quote(phone)));
  await scenario(2, async () => {
    equal(await scalar(rpc(7)), "+82 (10) 8700-0011", "lookup preserves stored phone text for client normalization");
  }, profileUpdate(7, "phone=" + quote("+82 (10) 8700-0011")));
  for (const assignments of ["status='inactive'", "must_change_password=true", "is_test_account=true", "auth_user_id=null"]) await scenario(2, async () => {
    equal(await scalar(rpc(3)), previousProfiles.find((profile) => profile.id === memberId(3)).phone, "actor starts eligible");
    await actor(0, "postgres");
    await db.exec(profileUpdate(2, assignments));
    await actor(2);
    await rejects(rpc(3), "42501", "next lookup rechecks current profile state: " + assignments);
  });
  equal((await db.query("select * from public.profiles order by id")).rows, previousProfiles, "lookups leave all profile values unchanged");
  equal((await db.query("select * from private.member_birthdays order by profile_id")).rows, previousBirthdays, "lookups leave all birthdays unchanged");

  console.log("Member phone SQL verification passed: " + checks + " checks (isolated synthetic PGlite)");
  if (process.env.PROFILE_PGTAP_SQL) {
    const pgtap = await readFile(process.env.PROFILE_PGTAP_SQL, "utf8");
    await db.exec(pgtap.replaceAll("__VERSION__", "1.034").replaceAll("__OS__", "PGlite"));
    await db.exec("alter table auth.users add column instance_id uuid, add column aud text, add column role text");
    for (const file of ["member_phone.test.sql", "member_birthdays.test.sql", "member_directory_auth_boundary.test.sql"]) {
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
