import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PROFILE_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(path.join(root, name), "utf8");
const migrations = await readdir(path.join(root, "supabase/migrations"));
const matches = migrations.filter((name) => name.endsWith("_harden_profile_account_boundaries.sql"));
assert.equal(matches.length, 1);
const migration = await read("supabase/migrations/" + matches[0]);
const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
const baseline = await read("supabase/migrations/20260821135553_atomic_permission_batch.sql");
const basePolicy = await read("supabase/migrations/20260808234223_club_platform.sql");
const hiddenPolicy = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
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
const update = (number, fields) => "update public.profiles set " + fields + " where id='" + memberId(number) + "' returning id";
const remove = (number) => "delete from public.profiles where id='" + memberId(number) + "' returning id";
const insert = (fields = "", values = "") => "insert into public.profiles(name,phone,status" + fields + ") values('New Fixture','+821000000090','active'" + values + ") returning id";
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub='" + (number ? authId(number) : "") + "'; set role " + role);
}
// Every write scenario rolls back, including successful vulnerability repros.
async function scenario(number, role, work, setup = "") {
  await db.exec("begin; reset role; set request.jwt.claim.sub=''");
  try {
    if (setup) await db.exec(setup);
    await actor(number, role);
    await work();
  } finally {
    await db.exec("rollback; reset role; set request.jwt.claim.sub=''");
  }
}
async function allowed(number, sql, label, role = "authenticated", setup = "") {
  await scenario(number, role, async () => equal((await db.query(sql)).rows.length, 1, label), setup);
}
async function denied(number, sql, label, role = "authenticated", setup = "") {
  await scenario(number, role, async () => {
    await assert.rejects(db.query(sql), (error) => error.code === "42501", label);
    checks++;
  }, setup);
}
const privilegedInsert = insert(",role,officer_title,fee_plan", ",'manager','president',null");
const adminInsert = insert(",is_system_admin", ",true");
const linkedInsert = insert(",auth_user_id", ",'" + authId(90) + "'");
const linkSetup = "insert into auth.users(id) values('" + authId(90) + "')";
const lastAdminSetup = "set request.jwt.claim.sub='" + authId(3) + "'; " + update(4, "is_system_admin=false");
try {
  await db.exec(await read("supabase/tests/fixtures/profile_permissions.sql"));
  for (const name of ["private.current_profile_id", "private.has_permission", "public.handle_new_user", "public.sync_profile_email_from_auth"]) {
    await db.exec(extractFunction(accounts, name));
  }
  const phoneSource = await read("supabase/migrations/20260816122500_accept_auth_phone_format.sql");
  await db.exec(extractFunction(phoneSource, "private.normalize_member_phone"));
  await db.exec(extractFunction(baseline, "public.protect_account_roles"));
  for (const [source, name] of [
    [accounts, "Members read own profile"], [accounts, "Member managers insert profiles"],
    [hiddenPolicy, "Member managers read all profiles"],
    [basePolicy, "Member managers update profiles"], [basePolicy, "Member managers delete profiles"],
  ]) await db.exec(extractPolicy(source, name));
  await db.exec(`
    revoke all on function private.current_profile_id(), private.has_permission(text) from public, anon, service_role;
    grant execute on function private.current_profile_id() to authenticated, service_role;
    grant execute on function private.has_permission(text) to authenticated;
    revoke execute on function public.handle_new_user(), public.sync_profile_email_from_auth(), public.protect_account_roles() from public, anon, authenticated;
    create trigger protect_account_roles_before_write before update or delete on public.profiles
      for each row execute function public.protect_account_roles();
  `);
  // These statements were reachable under the real existing profile policies.
  await allowed(1, privilegedInsert, "baseline member manager can insert an officer");
  await allowed(1, adminInsert, "baseline member manager can insert a system administrator");
  await allowed(1, linkedInsert, "baseline member manager can insert an authentication link", "authenticated", linkSetup);
  await allowed(1, update(7, "auth_user_id='" + authId(90) + "'"), "baseline member manager can link another identity", "authenticated", linkSetup);
  await allowed(1, update(2, "auth_user_id=null"), "baseline member manager can unlink another identity");
  await allowed(1, update(3, "name='Changed Admin Fixture'"), "baseline member manager can edit an administrator");
  await allowed(1, remove(3), "baseline member manager can delete another administrator");
  await allowed(1, update(3, "auth_user_id=null"), "baseline last linked administrator can be unlinked", "authenticated", lastAdminSetup);
  await db.exec("create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()");
  await scenario(0, "supabase_auth_admin", async () => {
    await db.exec("insert into auth.users(id,phone,raw_user_meta_data) values('" + authId(90) + "','+821000000005','{\"member_id\":\"" + memberId(5) + "\"}')");
    await actor(90);
    equal(await scalar("select private.current_profile_id()::text as value"), memberId(5), "baseline public Auth metadata links an unlinked administrator");
    equal(await scalar("select private.has_permission('roles.manage') as value"), true, "baseline Auth metadata grants administrator access without an Admin API marker");
  });
  await db.exec("drop trigger on_auth_user_created on auth.users");
  const policies = (await db.query("select * from pg_policies order by tablename,policyname")).rows;

  await db.exec(migration);
  equal((await db.query("select * from pg_policies order by tablename,policyname")).rows, policies, "all profile RLS remains unchanged");
  equal(await scalar("select prosecdef as value from pg_proc where oid='public.protect_account_roles()'::regprocedure"), false, "protection stays security invoker");
  equal(await scalar("select proconfig as value from pg_proc where oid='public.protect_account_roles()'::regprocedure"), ['search_path=""'], "protection has a fixed empty search path");
  equal(await scalar("select tgtype::integer as value from pg_trigger where tgname='protect_account_roles_before_write'"), 31, "one before-row trigger protects insert update delete");
  for (const role of ["anon", "authenticated"]) {
    equal(await scalar("select has_function_privilege('" + role + "','public.protect_account_roles()','EXECUTE') as value"), false, role + " cannot call the trigger directly");
  }
  await denied(1, privilegedInsert, "member manager cannot insert an officer");
  await denied(1, adminInsert, "member manager cannot insert a system administrator");
  await denied(1, insert(",is_test_account", ",true"), "member manager cannot insert a hidden test account");
  await denied(1, linkedInsert, "member manager cannot insert a linked profile", "authenticated", linkSetup);
  await denied(1, insert(",officer_title", ",'president'"), "officer title injection is rejected before the table constraint");
  await denied(1, update(7, "auth_user_id='" + authId(90) + "'"), "member manager cannot link another identity", "authenticated", linkSetup);
  await denied(1, update(2, "auth_user_id=null"), "member manager cannot unlink another identity");
  await denied(1, update(2, "auth_user_id='" + authId(90) + "'"), "member manager cannot replace another identity", "authenticated", linkSetup);
  await denied(1, update(3, "name='Changed Admin Fixture'"), "member manager cannot edit an administrator");
  await denied(1, remove(3), "member manager cannot delete another administrator");
  await denied(1, update(2, "role='manager',officer_title='president',fee_plan=null"), "role escalation denied");
  await denied(1, update(2, "is_system_admin=true"), "administrator escalation denied");
  await denied(1, update(2, "is_test_account=true"), "member manager cannot change account visibility");
  await denied(1, update(1, "is_test_account=false"), "member manager cannot remove own existing test account flag", "authenticated", update(1, "is_test_account=true"));
  await denied(1, update(2, "fee_plan='per_event'"), "existing fee plan protection retained");
  await denied(1, adminInsert, "a delegated roles.manage permission cannot grant system administrator status", "authenticated",
    "insert into public.officer_permissions values('president','roles.manage')");
  await allowed(1, insert(), "member manager still registers ordinary members");
  await allowed(1, insert(",is_test_account", ",false"), "member manager may keep the normal visibility default");
  await allowed(1, insert(",fee_plan", ",'per_event'"), "member manager still registers per-event members");
  await allowed(1, update(2, "name='Edited Fixture',phone='+821000000091'"), "member manager still edits ordinary basic fields");
  await allowed(1, update(8, "name='Edited Officer Fixture'"), "member manager still edits officer basic fields");
  await allowed(1, update(1, "name='Edited Hidden Fixture',is_test_account=true"), "member manager may retain an existing test flag during a basic edit", "authenticated", update(1, "is_test_account=true"));
  await allowed(1, update(2, "status='inactive'"), "member manager still changes ordinary member status");
  await allowed(1, remove(2), "member manager still deletes ordinary members");
  for (const number of [2, 6, 8, 99, 0]) {
    await denied(number, insert(), "non-member-manager registration denied for actor " + number);
    await scenario(number, "authenticated", async () => equal((await db.query(update(7, "name='Forbidden Fixture'"))).rows.length, 0, "non-member-manager update denied for actor " + number));
  }
  await denied(0, insert(), "anonymous registration denied", "anon");
  // Bypass-RLS test role proves null JWTs do not bypass the trigger itself.
  await denied(0, adminInsert, "untrusted SQL writer with no JWT cannot grant admin", "fixture_untrusted");
  await denied(0, update(7, "auth_user_id='" + authId(90) + "'"), "untrusted SQL writer with no JWT cannot link accounts", "fixture_untrusted", linkSetup);
  await denied(0, update(3, "name='Forbidden Fixture'"), "untrusted SQL writer with no JWT cannot edit an administrator", "fixture_untrusted");
  await denied(0, remove(3), "untrusted SQL writer with no JWT cannot delete an administrator", "fixture_untrusted");
  await allowed(3, privilegedInsert, "system administrator can insert an officer");
  await allowed(3, adminInsert, "system administrator can insert another administrator");
  await scenario(3, "authenticated", async () => {
    equal((await db.query(insert(",is_test_account", ",true").replace(" returning id", ""))).affectedRows, 1, "system administrator may insert a hidden test account");
  });
  await allowed(3, linkedInsert, "system administrator can insert a linked profile", "authenticated", linkSetup);
  await allowed(3, update(7, "auth_user_id='" + authId(90) + "'"), "system administrator can link an ordinary profile", "authenticated", linkSetup);
  await allowed(3, update(4, "name='Edited Admin Fixture'"), "system administrator can edit another administrator");
  await allowed(3, remove(4), "system administrator can delete another linked administrator");
  await allowed(3, update(4, "auth_user_id=null"), "system administrator can unlink another administrator while retaining access");
  await allowed(3, update(4, "is_system_admin=false"), "system administrator can demote another administrator");
  await allowed(3, update(2, "role='manager',officer_title='treasurer',fee_plan=null"), "system administrator can assign officer status");
  await allowed(3, update(2, "fee_plan='per_event'"), "system administrator can change protected fee plan");
  await allowed(3, update(3, "name='Edited Own Fixture'"), "system administrator can edit own basic fields");
  await scenario(3, "authenticated", async () => {
    equal((await db.query(update(3, "is_test_account=true"))).affectedRows, 1, "system administrator can mark own account as a test account");
  });
  await allowed(0, update(2, "is_test_account=true"), "trusted service can maintain another account's test flag", "service_role");
  await allowed(3, update(3, "is_test_account=false"), "system administrator can remove own test account flag", "authenticated", update(3, "is_test_account=true"));
  for (const sql of [remove(3), update(3, "is_system_admin=false"), update(3, "status='inactive',is_system_admin=false"), update(3, "auth_user_id=null"), update(3, "auth_user_id='" + authId(90) + "'")]) {
    await denied(3, sql, "administrator cannot remove own access", "authenticated", linkSetup);
  }
  // An active administrator without an Auth link cannot replace the last login.
  for (const sql of [remove(3), update(3, "is_system_admin=false"), update(3, "auth_user_id=null"), update(3, "status='inactive',is_system_admin=false")]) {
    await denied(0, sql, "last linked administrator is preserved", "service_role", lastAdminSetup);
    await denied(0, sql, "trusted owner also preserves last linked administrator", "postgres", lastAdminSetup);
  }
  await denied(0, "delete from auth.users where id='" + authId(3) + "' returning id", "Auth deletion cannot detach the last linked administrator", "service_role", lastAdminSetup);
  await denied(0, "delete from public.profiles where is_system_admin and auth_user_id is not null returning id", "multi-row deletion cannot remove all linked administrators", "service_role");
  await denied(0, "update public.profiles set auth_user_id=null where is_system_admin returning id", "multi-row unlink cannot remove all linked administrators", "service_role");
  await denied(3, insert(",is_system_admin", ",true").replace("'active'", "'inactive'"), "new administrator must remain active");
  await allowed(0, update(7, "auth_user_id='" + authId(90) + "'"), "trusted service can attach an issued account", "service_role", linkSetup);
  await allowed(0, update(4, "auth_user_id=null"), "trusted service can detach another linked administrator", "service_role");
  await allowed(0, update(3, "must_change_password=true"), "trusted account reset can require administrator password change", "service_role");
  await allowed(0, adminInsert, "trusted owner can perform administrative maintenance", "postgres");

  await db.exec(`
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
    create trigger sync_profile_email_after_auth_update after update of email, phone on auth.users
      for each row when (old.email is distinct from new.email or old.phone is distinct from new.phone)
      execute function public.sync_profile_email_from_auth();
  `);
  for (const number of [7, 5]) {
    await scenario(0, "supabase_auth_admin", async () => {
      await db.exec("insert into auth.users(id,email,phone,raw_user_meta_data,raw_app_meta_data) values('" + authId(90) + "','issued@example.invalid','+82100000000" + number + "','{\"member_id\":\"" + memberId(number) + "\"}','{\"provider\":\"phone\",\"providers\":[\"phone\"]}')");
      await actor(90);
      equal(await scalar("select private.current_profile_id() as value"), null, "initial Auth INSERT without a server marker does not link the target");
      equal(await scalar("select private.has_permission('roles.manage') as value"), false, "unlinked Auth INSERT has no administrator access");
      await actor(0, "supabase_auth_admin");
      await db.exec("update auth.users set raw_app_meta_data=raw_app_meta_data || '{\"member_provisioning_id\":\"" + memberId(number) + "\"}'::jsonb where id='" + authId(90) + "'");
      await actor(90);
      equal(await scalar("select auth_user_id::text as value from public.profiles where id='" + memberId(number) + "'"), authId(90), "real Auth provisioning definer links a member or administrator");
      equal(await scalar("select private.has_permission('roles.manage') as value"), number === 5, "server marker assigns exactly the target's existing access");
    });
  }
  for (const number of [2, 3]) {
    await scenario(1, "service_role", async () => {
      await db.exec("update auth.users set email='UPDATED@example.invalid',phone='+821000000091' where id='" + authId(number) + "'");
      equal((await db.query("select email,phone from public.profiles where id='" + memberId(number) + "'")).rows[0], { email: "updated@example.invalid", phone: "+821000000091" }, "real Auth email/phone definer can synchronize a member or administrator");
    });
  }
  await scenario(0, "service_role", async () => {
    await assert.rejects(db.exec("insert into auth.users(id,phone,raw_user_meta_data,raw_app_meta_data) values('" + authId(90) + "','+821000000099','{\"member_id\":\"" + memberId(7) + "\"}','{\"member_provisioning_id\":\"" + memberId(7) + "\"}')"), (error) => error.code === "42501" && error.message === "Invalid member provisioning request", "provisioning phone mismatch remains rejected without private details");
    checks++;
  });
  equal(await scalar("select prosecdef as value from pg_proc where oid='public.handle_new_user()'::regprocedure"), true, "Auth linking keeps the trusted definer execution contract");
  equal(await scalar("select proconfig as value from pg_proc where oid='public.handle_new_user()'::regprocedure"), ['search_path=""'], "Auth linking has a fixed empty search path");
  for (const role of ["anon", "authenticated"]) {
    equal(await scalar("select has_function_privilege('" + role + "','public.handle_new_user()','EXECUTE') as value"), false, role + " cannot call the Auth linker directly");
  }
  const marker = (number) => ({ member_provisioning_id: memberId(number) });
  function authInsert(number = 7, appMetadata = {}, userMetadata = { member_id: memberId(number) }, phone = "+82100000000" + number, identity = 90) {
    return "insert into auth.users(id,phone,raw_user_meta_data,raw_app_meta_data) values('" + authId(identity) + "'," + (phone === null ? "null" : "'" + phone + "'") + ",'" + JSON.stringify(userMetadata) + "','" + JSON.stringify(appMetadata) + "') returning id";
  }
  for (const number of [7, 5]) {
    await scenario(0, "supabase_auth_admin", async () => {
      await db.exec(authInsert(number, marker(number)));
      await actor(90);
      equal(await scalar("select private.current_profile_id()::text as value"), memberId(number), "runtimes with an immediate server marker still link the intended profile");
    });
    await scenario(0, "supabase_auth_admin", async () => {
      await db.exec(authInsert(number, {}, { member_id: memberId(number), member_provisioning_id: memberId(number), app_metadata: marker(number) }));
      await actor(90);
      equal(await scalar("select private.current_profile_id() as value"), null, "forged server markers inside user metadata never link a profile");
      equal(await scalar("select private.has_permission('members.manage') as value"), false, "forged metadata grants no management access");
    });
  }
  await scenario(0, "supabase_auth_admin", async () => {
    await db.exec(authInsert(7, {}, {}));
    await actor(90);
    equal(await scalar("select private.current_profile_id() as value"), null, "ordinary Auth signup without any provisioning metadata remains unlinked");
    equal(await scalar("select private.has_permission('roles.manage') as value"), false, "ordinary Auth signup gains no administrator access");
  });
  const invalidMarkers = [null, false, true, 7, {}, [], "", "invalid-uuid", memberId(5)];
  for (const value of invalidMarkers) {
    const appMetadata = { member_provisioning_id: value };
    await denied(0, authInsert(7, appMetadata), "invalid or mismatched server marker is rejected on INSERT: " + JSON.stringify(value), "supabase_auth_admin");
    await scenario(0, "supabase_auth_admin", async () => {
      await db.exec(authInsert());
      await assert.rejects(db.exec("update auth.users set raw_app_meta_data='" + JSON.stringify(appMetadata) + "' where id='" + authId(90) + "'"), (error) => error.code === "42501" && error.message === "Invalid member provisioning request", "invalid server marker is rejected on metadata UPDATE");
      checks++;
    });
  }
  for (const userMetadata of [{}, { member_id: null }, { member_id: 7 }, { member_id: memberId(5) }]) {
    await denied(0, authInsert(7, marker(7), userMetadata), "server marker requires an exactly matching string member id", "supabase_auth_admin");
  }
  for (const phone of [null, "", "not-a-phone", "+821000000099"]) {
    await denied(0, authInsert(7, marker(7), { member_id: memberId(7) }, phone), "server marker requires a valid matching phone", "supabase_auth_admin");
  }
  await denied(0, authInsert(2, marker(2)), "server marker cannot replace an existing profile link", "supabase_auth_admin");
  await scenario(0, "supabase_auth_admin", async () => {
    await db.exec(authInsert(7, marker(7)));
    await assert.rejects(db.exec(authInsert(7, marker(7), { member_id: memberId(7) }, "+821000000007", 91)), (error) => error.code === "42501", "a second Auth identity cannot reuse a consumed profile marker");
    checks++;
  });
  await scenario(0, "supabase_auth_admin", async () => {
    await db.exec(authInsert(7, marker(7)));
    await db.exec("update auth.users set raw_user_meta_data='{\"member_id\":\"" + memberId(5) + "\"}' where id='" + authId(90) + "'");
    await db.exec("update auth.users set raw_app_meta_data=raw_app_meta_data || '{\"maintenance\":true}'::jsonb where id='" + authId(90) + "'");
    await actor(90);
    equal(await scalar("select private.current_profile_id()::text as value"), memberId(7), "unchanged server marker ignores subsequent target changes and metadata maintenance");
    equal(await scalar("select private.has_permission('roles.manage') as value"), false, "metadata maintenance cannot relink an ordinary member to an administrator");
    await actor(0, "supabase_auth_admin");
    await db.exec("update auth.users set raw_app_meta_data='{}' where id='" + authId(90) + "'");
    await db.exec("savepoint retarget_attempt");
    await assert.rejects(db.exec("update auth.users set phone='+821000000005',raw_app_meta_data='" + JSON.stringify(marker(5)) + "' where id='" + authId(90) + "'"), (error) => error.code === "42501", "a changed server marker cannot retarget an already linked identity even with matching phone and user metadata");
    checks++;
    await db.exec("rollback to savepoint retarget_attempt; release savepoint retarget_attempt");
    await assert.rejects(db.exec("update auth.users set raw_user_meta_data='{\"member_id\":\"" + memberId(7) + "\"}',raw_app_meta_data='" + JSON.stringify(marker(7)) + "' where id='" + authId(90) + "'"), (error) => error.code === "42501", "removing and restoring the marker cannot run provisioning twice");
    checks++;
  });
  await actor(8);
  equal(await scalar("select count(*)::integer as value from public.profiles where id<>'" + memberId(8) + "'"), 0, "fee-only manager never gains profile read access");
  console.log(JSON.stringify({ passed: true, checks, baselineVulnerabilitiesReproduced: 9, authAdminInsertThenMetadataUpdateVerified: true, scope: "isolated PostgreSQL profile account boundary regression" }));
} finally {
  await db.close();
}
