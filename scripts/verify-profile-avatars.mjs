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
const match = (suffix) => {
  const matches = migrations.filter((name) => name.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return "supabase/migrations/" + matches[0];
};
const migration = await read(match("_add_profile_avatars.sql"));
const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
const basePolicy = await read("supabase/migrations/20260808234223_club_platform.sql");
const hiddenPolicy = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
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
const avatar = (number, version = 1) => authId(number) + "/52000000-0000-0000-0000-" + String(version).padStart(12, "0") + ".jpg";
const quote = (value) => value === null ? "null" : "'" + value.replaceAll("'", "''") + "'";
const rpc = (next, expected = null) => "select public.set_profile_avatar(" + quote(next) + "," + quote(expected) + ") as value";
const profileUpdate = (number, value) => "update public.profiles set avatar_path=" + quote(value) + " where id='" + memberId(number) + "' returning id";
const storageInsert = (number, objectName = avatar(number), owner = authId(number), metadata = { mimetype: "image/jpeg", size: 1024 }) =>
  "insert into storage.objects(bucket_id,name,owner_id,metadata) values('profile-avatars'," + quote(objectName) + "," + quote(owner) + "," + quote(JSON.stringify(metadata)) + "::jsonb) returning id";
const remove = (objectName) => "delete from storage.objects where name=" + quote(objectName) + " returning name";
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub='" + (number ? authId(number) : "") + "'; set role " + role);
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
try {
  await db.exec(await read("supabase/tests/fixtures/profile_permissions.sql"));
  await db.exec(await read("supabase/tests/fixtures/profile_avatars.sql"));
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
  await db.exec(migration);

  equal(await scalar("select public as value from storage.buckets where id='profile-avatars'"), false, "bucket is private");
  equal(await scalar("select file_size_limit::integer as value from storage.buckets where id='profile-avatars'"), 1048576, "bucket is capped at 1 MiB");
  equal(await scalar("select allowed_mime_types as value from storage.buckets where id='profile-avatars'"), ["image/jpeg"], "bucket accepts JPEG only");
  equal(await scalar("select count(*)::integer as value from pg_policies where schemaname='storage' and cmd='UPDATE'"), 0, "no overwrite policy");
  for (const [role, expected] of [["anon", false], ["authenticated", true], ["service_role", false]]) {
    for (const name of ["public.set_profile_avatar(text,text)", "private.set_profile_avatar(text,text)", "private.can_use_profile_avatars()", "private.owns_profile_avatar(text,text)", "private.can_read_profile_avatar(text,text)", "private.can_delete_profile_avatar(text,text)"])
      equal(await scalar("select has_function_privilege('" + role + "','" + name + "','execute') as value"), expected, role + " ACL " + name);
    equal(await scalar("select has_function_privilege('" + role + "','public.get_member_directory()','execute') as value"), role !== "anon", role + " directory ACL");
  }
  const functions = (await db.query("select proname,prosecdef,proconfig,pg_get_userbyid(proowner) as owner from pg_proc where oid in ('public.set_profile_avatar(text,text)'::regprocedure,'private.set_profile_avatar(text,text)'::regprocedure,'public.protect_profile_avatar()'::regprocedure,'private.can_delete_profile_avatar(text,text)'::regprocedure) order by proname,prosecdef desc")).rows;
  equal(functions.map((fn) => [fn.proname, fn.prosecdef, fn.owner]), [["can_delete_profile_avatar", true, "postgres"], ["protect_profile_avatar", false, "postgres"], ["set_profile_avatar", true, "postgres"], ["set_profile_avatar", false, "postgres"]], "invoker/definer and trusted owner boundary");
  for (const fn of functions) equal(fn.proconfig, ['search_path=""'], fn.proname + " has fixed search path");
  equal(/delete\s+from\s+storage\.objects/i.test(migration), false, "migration never deletes Storage metadata");
  equal(/\bcascade\b/i.test(migration), false, "directory recreation never cascades");

  await scenario(2, async () => {
    equal((await db.query(storageInsert(2))).rows.length, 1, "own upload allowed");
    equal(await scalar(rpc(avatar(2))), avatar(2), "own member saves through guarded helper despite no profiles update policy");
    equal((await db.query(remove(avatar(2)))).rows.length, 0, "current avatar cannot be deleted after a lost success response");
    equal((await db.query("select id from storage.objects where name=" + quote(avatar(2)))).rows.length, 1, "current object remains readable to its owner");
    equal(await scalar(rpc(null, avatar(2))), null, "photo removal clears the reference first");
    equal((await db.query(remove(avatar(2)))).rows.length, 1, "SDK-shaped delete is allowed after reference removal");
  });
  await scenario(2, async () => {
    equal((await db.query(storageInsert(2, avatar(2), authId(2), null))).rows.length, 1, "Storage upload permission probe can omit metadata");
    await rejects(rpc(avatar(2)), "42501", "incomplete upload cannot be committed");
  });
  for (const number of [0, 6, 9, 11, 12]) {
    await scenario(number, async () => {
      await rejects(storageInsert(number || 2), "42501", "ineligible actor cannot upload: " + number);
      await rejects(rpc(null), "42501", "ineligible actor cannot set/remove avatar: " + number);
      equal((await db.query("select * from storage.objects")).rows.length, 0, "ineligible actor cannot read avatars: " + number);
      equal((await db.query(remove(avatar(2)))).rows.length, 0, "ineligible actor cannot delete avatars: " + number);
    }, storageInsert(2));
  }
  await scenario(0, async () => {
    await rejects(rpc(null), "42501", "anon cannot execute public RPC");
    await rejects("select private.set_profile_avatar(null,null)", "42501", "anon cannot execute private helper");
    await rejects(storageInsert(2), "42501", "anon cannot upload");
    equal((await db.query("select * from storage.objects")).rows.length, 0, "anon reads no objects");
  }, storageInsert(2), "anon");

  await scenario(2, async () => {
    await rejects(storageInsert(2, avatar(3), authId(2)), "42501", "foreign folder upload denied");
    await rejects(storageInsert(2, avatar(2), authId(3)), "42501", "forged owner upload denied");
    for (const name of [authId(2)+"/plain.jpg",authId(2)+"/../"+avatar(2),avatar(2)+"/extra",avatar(2).replace(".jpg", ".png")])
      await rejects(storageInsert(2, name), "42501", "invalid path rejected: " + name);
    await rejects(rpc(avatar(3)), "42501", "cannot save someone else's object");
    await rejects("select private.set_profile_avatar(" + quote(avatar(3)) + ",null)", "42501", "private helper repeats ownership checks");
    equal((await db.query(remove(avatar(3)))).rows.length, 0, "cannot delete another member's object");
    equal((await db.query("update storage.objects set metadata='{}' where name=" + quote(avatar(2)) + " returning id")).rows.length, 0, "own object cannot be overwritten");
    await rejects(storageInsert(2), "23505", "existing file cannot be overwritten by INSERT");
  }, storageInsert(2) + ";" + storageInsert(3));

  const invalidMetadata = [null, {}, {mimetype:"image/png",size:1024}, {mimetype:"IMAGE/JPEG",size:1024}, {mimetype:"image/jpeg",size:0}, {mimetype:"image/jpeg",size:-1}, {mimetype:"image/jpeg",size:1048577}, {mimetype:"image/jpeg",size:"1024"}, {mimetype:"image/jpeg",size:false}, {mimetype:"image/jpeg",size:1.5}];
  for (const metadata of invalidMetadata) await scenario(2, async () => {
    await rejects(rpc(avatar(2)), "42501", "reject invalid actual object metadata " + JSON.stringify(metadata));
    equal(await scalar("select avatar_path as value from public.profiles where auth_user_id='"+authId(2)+"'"), null, "invalid object preserves old profile reference");
  }, storageInsert(2, avatar(2), authId(2), metadata));
  await scenario(2, async () => { await rejects(rpc(avatar(2)), "42501", "missing object denied"); });
  await scenario(2, async () => { await rejects(rpc(avatar(2)), "42501", "wrong actual object owner denied"); }, storageInsert(2, avatar(2), authId(3)));
  await scenario(2, async () => { await rejects(rpc(avatar(2)), "42501", "ownerless object denied"); equal((await db.query(remove(avatar(2)))).rows.length,0,"ownerless object cannot be deleted"); }, storageInsert(2, avatar(2), null));
  await scenario(2, async () => {
    equal(await scalar(rpc(avatar(2))), avatar(2), "maximum-sized JPEG accepted");
  }, storageInsert(2, avatar(2), authId(2), {mimetype:"image/jpeg",size:1048576}));

  await scenario(2, async () => {
    equal(await scalar(rpc(avatar(2))), avatar(2), "first tab wins null expected CAS");
    await rejects(rpc(avatar(2,2)), "40001", "second tab with stale null expected loses CAS");
    equal(await scalar(rpc(avatar(2,2),avatar(2))), avatar(2,2), "fresh expected can replace avatar");
    await rejects(rpc(null,avatar(2)), "40001", "stale removal cannot clear replacement");
    equal((await db.query(remove(avatar(2,2)))).rows.length, 0, "replacement stays protected from stale cleanup");
    equal((await db.query(remove(avatar(2)))).rows.length, 1, "old object cleanup allowed after replacement");
    equal(await scalar("select avatar_path as value from public.profiles where auth_user_id='"+authId(2)+"'"), avatar(2,2), "CAS failure preserves winning path");
    equal(/for share/i.test(migration),false,"setter never takes a Storage object lock in reverse order");
    assert.match(migration,/member_profile\.avatar_path is distinct from object_name/,"delete guard checks the locked profile value"); checks++;
  }, storageInsert(2) + ";" + storageInsert(2, avatar(2,2)));

  // Trigger checks use the real existing manager RLS, plus a bypass-RLS role to
  // prove that an empty JWT or bypass privilege never creates a trusted writer.
  for (const [number,role] of [[1,"authenticated"],[3,"authenticated"],[0,"fixture_untrusted"]]) await scenario(number, async () => {
    await rejects(profileUpdate(2,avatar(2)), "42501", "direct avatar UPDATE is blocked for " + role + "/" + number);
    await rejects("insert into public.profiles(name,phone,status,avatar_path) values('Avatar Insert Fixture','+821000000090','active'," + quote(avatar(2)) + ")", "42501", "direct initial avatar blocked for " + role + "/" + number);
  }, "", role);
  await scenario(0, async () => {
    equal((await db.query(profileUpdate(2,avatar(2)))).rows.length, 1, "trusted service internal write remains compatible");
  }, "", "service_role");
  await scenario(3, async () => {
    equal((await db.query(storageInsert(3))).rows.length, 1, "administrator can upload own photo");
    equal(await scalar(rpc(avatar(3))), avatar(3), "guarded helper works with existing administrator protection trigger");
    await rejects("update public.profiles set is_system_admin=false where id='"+memberId(3)+"'", "42501", "avatar RPC does not weaken administrator self-access protection");
  });

  await scenario(2, async () => {
    const names = (await db.query("select name from storage.objects order by name")).rows.map((row) => row.name);
    equal(names,[avatar(2),avatar(3)], "own unreferenced and active public referenced avatars are readable");
    const directory = (await db.query("select * from public.get_member_directory() order by id")).rows;
    equal(directory.find((row) => row.id===memberId(3)).avatar_path,avatar(3), "directory adds current photo path");
    equal(directory.find((row) => row.id===memberId(3)).fee_plan,null, "directory still hides another member's fee plan");
    equal(directory.find((row) => row.id===memberId(2)).fee_plan,"monthly", "directory still reveals own fee plan");
    equal(directory.some((row)=>row.id===memberId(6)||row.id===memberId(10)),false, "directory still excludes inactive and hidden members");
    equal(Object.keys(directory[0]).at(-1),"avatar_path", "avatar return field is additive at the end");
    equal(Object.hasOwn(directory[0],"phone")||Object.hasOwn(directory[0],"email")||Object.hasOwn(directory[0],"auth_user_id"),false, "directory does not expose private account fields");
  }, [storageInsert(2),storageInsert(3),storageInsert(3,avatar(3,2)),storageInsert(6),storageInsert(10),profileUpdate(3,avatar(3)),profileUpdate(6,avatar(6)),profileUpdate(10,avatar(10))].join(";"));
  await scenario(8, async () => {
    const directory=(await db.query("select * from public.get_member_directory() where id='"+memberId(2)+"'")).rows;
    equal(directory[0].fee_plan,"monthly", "fee manager's existing fee-plan access survives recreation");
  });
  await scenario(2, async () => {
    equal((await db.query(remove(avatar(2)))).rows.length,0,"any current reference protects own object even when its referencing member is hidden");
  },storageInsert(2)+";"+profileUpdate(10,avatar(2)));
  console.log("Profile avatar SQL verification passed: " + checks + " checks (isolated synthetic PGlite; CAS interleavings, not independent concurrent connections)");
} finally { await db.close(); }
