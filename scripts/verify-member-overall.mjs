import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Intentionally accepts only a local pg module, never a connection URL or credentials.
assert.ok(process.env.OVERALL_PG_MODULE, "OVERALL_PG_MODULE must identify the isolated pg package");
const { default: pg } = await import(pathToFileURL(process.env.OVERALL_PG_MODULE).href);
pg.types.setTypeParser(20, Number);
const config = { host: "127.0.0.1", port: 55439, user: "postgres", database: "member_overall_zero_synthetic" };
const clients = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const [admin, first, second] = clients;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const auth = (n) => "51000000-0000-0000-0000-" + String(n).padStart(12, "0");
const member = (n) => "51010000-0000-0000-0000-" + String(n).padStart(12, "0");
const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical"];
const scores = (n = 50) => Object.fromEntries(keys.map((key) => [key, n]));
const quote = (value) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
let checks = 0;
let tapChecks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql, values = []) { return (await admin.query(sql, values)).rows[0]?.value; }
async function actor(client, n, role = "authenticated") {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? auth(n) : ""]);
  await client.query("set role " + role);
}
async function owner() { await actor(admin, 0, "postgres"); }
async function scenario(n, work, setup = "", role = "authenticated") {
  await owner(); await admin.query("begin");
  try { if (setup) await admin.query(setup); await actor(admin, n, role); await work(); }
  finally { await admin.query("rollback"); await owner(); }
}
async function rejects(client, sql, values, code, label) {
  await client.query("savepoint denied_operation");
  try { await assert.rejects(client.query(sql, values), (error) => error.code === code, label); checks++; }
  finally { await client.query("rollback to savepoint denied_operation; release savepoint denied_operation"); }
}
const get = (schema = "public") => "select * from " + schema + ".get_member_overalls($1::uuid[])";
const set = (schema = "public") => "select * from " + schema + ".set_member_overall($1,$2::jsonb,$3)";
const values = (n = 2, revision = 0, value = scores()) => [member(n), JSON.stringify(value), revision];
async function directory() { return (await admin.query("select * from public.get_member_directory() order by id")).rows; }
const functionsSnapshot = `select n.nspname, f.oid::regprocedure::text as signature,
  pg_get_functiondef(f.oid) as definition,f.proacl::text as acl
  from pg_proc f join pg_namespace n on n.oid=f.pronamespace
  where n.nspname in ('public','private') and f.proname not in
  ('get_member_overalls','set_member_overall','apply_officer_permission_batch') order by 1,2`;
const policiesSnapshot = "select * from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname";
async function waitForLock(client) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const { rows } = await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [client.processID]);
    if (rows[0]?.wait_event_type === "Lock") { checks++; return; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Expected independent PostgreSQL connection to wait on a lock");
}
const settled = (operation) => operation.then((result) => ({ result }), (error) => ({ error }));
async function begin(client, n = 1) { await client.query("begin"); await actor(client, n); }
async function end() {
  await Promise.all([first.query("rollback; reset role"), second.query("rollback; reset role")]);
  await owner();
}

try {
  await Promise.all(clients.map((client) => client.connect()));
  const { rows: identity } = await admin.query("select current_database() as db,host(inet_server_addr()) as host,version() as version");
  equal(identity[0].db, config.database, "dedicated synthetic database identity");
  equal(identity[0].host, "127.0.0.1", "loopback-only database identity");
  equal(await scalar("select count(*)::integer value from pg_tables where schemaname in ('public','private','auth','storage')"), 0, "refuse an existing database with tables");
  for (const fixture of ["profile_permissions.sql","profile_avatars.sql"]) {
    const source = await read("supabase/tests/fixtures/"+fixture);
    await admin.query(source.replace(/create role ([a-z_]+)( bypassrls)?;/g, (_,role,option="") =>
      "do $role$ begin if not exists(select 1 from pg_roles where rolname='"+role+"') then create role "+role+option+"; end if; end $role$;"));
  }
  const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
  const base = await read("supabase/migrations/20260808234223_club_platform.sql");
  const hidden = await read("supabase/migrations/20260821223412_hidden_test_account_visibility.sql");
  for (const name of ["private.current_profile_id", "private.has_permission", "public.handle_new_user", "public.sync_profile_email_from_auth"])
    await admin.query(extractFunction(accounts, name));
  await admin.query(extractFunction(await read("supabase/migrations/20260816122500_accept_auth_phone_format.sql"), "private.normalize_member_phone"));
  await admin.query(extractFunction(await read("supabase/migrations/20260821135553_atomic_permission_batch.sql"), "public.protect_account_roles"));
  for (const [source, name] of [[accounts, "Members read own profile"], [accounts, "Member managers insert profiles"],
    [hidden, "Member managers read all profiles"], [base, "Member managers update profiles"], [base, "Member managers delete profiles"]])
    await admin.query(extractPolicy(source, name));
  await admin.query(`revoke all on function private.current_profile_id(),private.has_permission(text) from public,anon,service_role;
    grant execute on function private.current_profile_id() to authenticated,service_role;
    grant execute on function private.has_permission(text) to authenticated;
    create trigger protect_account_roles_before_write before update or delete on public.profiles
    for each row execute function public.protect_account_roles();`);
  await admin.query(await read(match("_harden_profile_account_boundaries.sql")));
  const directorySource = await read(match("_fix_fee_manager_policy_lookup.sql"));
  await admin.query(directorySource.slice(directorySource.indexOf("create function public.get_member_directory()"), directorySource.indexOf("notify pgrst")));
  await admin.query(await read(match("_add_profile_avatars.sql")));
  await admin.query(await read(match("_add_member_birthdays.sql")));
  await admin.query(await read(match("_add_member_phone_lookup.sql")));
  await admin.query(await read("supabase/tests/fixtures/member_overalls.sql"));
  const align = await read(match("_align_officer_service_permissions.sql"));
  const welcome = await read("supabase/migrations/20261002005032_welcome_page.sql");
  await admin.query(extractFunction(align, "private.can_manage_officer_permission"));
  await admin.query(extractFunction(welcome, "public.apply_officer_permission_batch"));
  await admin.query("revoke all on function public.apply_officer_permission_batch(jsonb) from public,anon,authenticated,service_role; grant execute on function public.apply_officer_permission_batch(jsonb) to authenticated");
  await admin.query("insert into private.member_birthdays values($1,2,29,1)", [member(2)]);
  const existingFunctions = (await admin.query(functionsSnapshot)).rows;
  const existingPolicies = (await admin.query(policiesSnapshot)).rows;
  const existingProfiles = (await admin.query("select * from public.profiles order by id")).rows;
  const existingPermissions = (await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows;
  const existingBirthday = (await admin.query("select * from private.member_birthdays order by profile_id")).rows;
  const originalBatch = await scalar("select pg_get_functiondef('public.apply_officer_permission_batch(jsonb)'::regprocedure) value");
  const directories = new Map();
  for (const n of [0,1,2,3,6,8,9,10,11,12,13,14,15,16,17,18,19,20])
    await scenario(n, async () => directories.set(n, await directory()));
  const migration = await read(match("_add_member_overalls.sql"));
  await admin.query(migration);
  equal((await admin.query(functionsSnapshot)).rows, existingFunctions, "all prior functions and ACL preserved except required batch whitelist");
  equal((await admin.query(policiesSnapshot)).rows, existingPolicies, "prior RLS policies unchanged; new table has default-deny RLS");
  equal((await admin.query("select * from public.profiles order by id")).rows, existingProfiles, "no profile data modified");
  equal((await admin.query("select * from private.member_birthdays order by profile_id")).rows, existingBirthday, "no birthday data modified");
  equal((await admin.query("select * from public.officer_permissions where permission<>'ratings.manage' order by officer_title,permission")).rows,
    existingPermissions, "earlier service exclusions are preserved");
  equal(await scalar("select count(*)::integer value from public.officer_permissions where permission='ratings.manage'"), 3, "exactly three officer defaults added");
  equal((await scalar("select pg_get_functiondef('public.apply_officer_permission_batch(jsonb)'::regprocedure) value"))
    .replace(", 'ratings.manage'", ""), originalBatch, "batch changes only its allowed-key list");
  for (const [n, previous] of directories) await scenario(n, async () => equal(await directory(), previous, "directory unchanged for actor " + n));
  const snapshotDigest = createHash("sha256").update(JSON.stringify({ functions:existingFunctions, policies:existingPolicies, profiles:existingProfiles, directories:[...directories] })).digest("hex");

  // Model an installed positive-score row, then prove the additive migration
  // only changes the six lower bounds and the existing private validator.
  await actor(admin,1);
  await admin.query(set(),values(5,0,scores(73)));
  await owner();
  const installedFunctionsSql = `select n.nspname,f.oid,f.oid::regprocedure::text signature,
    pg_get_functiondef(f.oid) definition,f.proacl::text acl,f.proargnames,f.proargmodes,
    f.prorettype::regtype::text result_type,f.prosecdef,f.provolatile,f.proconfig,pg_get_userbyid(f.proowner) owner
    from pg_proc f join pg_namespace n on n.oid=f.pronamespace
    where n.nspname in ('public','private') order by n.nspname,f.oid::regprocedure::text`;
  const tableBoundarySql = `select n.nspname,c.relname,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private','auth','storage') and c.relkind='r' order by 1,2`;
  const installedFunctions = (await admin.query(installedFunctionsSql)).rows;
  const installedBoundaries = (await admin.query(tableBoundarySql)).rows;
  const installedPermissions = (await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows;
  const installedOveralls = (await admin.query("select * from private.member_overalls order by member_id")).rows;
  const installedPolicies = (await admin.query(policiesSnapshot)).rows;
  const priorConstraints = (await admin.query(`select conname,pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid='private.member_overalls'::regclass order by conname`)).rows;
  for (const key of keys) equal(priorConstraints.find((row) => row.conname === "member_overalls_"+key+"_check")?.definition,
    "CHECK ((("+key+" >= 1) AND ("+key+" <= 100)))","installed lower bound is one for "+key);
  await scenario(1,async () => rejects(admin,set(),values(2,0,scores(0)),"22023","installed helper rejects all-zero scores before migration"));
  const zeroMigrationPath = match("_allow_zero_member_overalls.sql");
  const zeroMigration = await read(zeroMigrationPath);
  await admin.query(zeroMigration);
  const upgradedFunctions = (await admin.query(installedFunctionsSql)).rows;
  equal(upgradedFunctions.map((fn) => ({ ...fn,definition:fn.nspname === "private" && fn.signature === "private.set_member_overall(uuid,jsonb,bigint)"
    ? fn.definition.replace("score.value::numeric < 0","score.value::numeric < 1")
      .replaceAll("Overall scores must be integers between 0 and 100","Overall scores must be integers between 1 and 100")
    : fn.definition })),installedFunctions,"function identities, signatures, ACL, metadata and all logic except lower-bound validation preserved");
  equal((await admin.query(tableBoundarySql)).rows,installedBoundaries,"all installed table privileges and RLS flags preserved");
  equal((await admin.query(policiesSnapshot)).rows,installedPolicies,"all installed RLS policies preserved");
  equal((await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows,installedPermissions,
    "zero migration neither reseeds nor updates permission data");
  equal((await admin.query("select * from private.member_overalls order by member_id")).rows,installedOveralls,
    "positive scores, revision, creator and timestamps survive migration unchanged");
  const upgradedConstraints = (await admin.query(`select conname,pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid='private.member_overalls'::regclass order by conname`)).rows;
  for (const key of keys) equal(upgradedConstraints.find((row) => row.conname === "member_overalls_"+key+"_check")?.definition,
    "CHECK ((("+key+" >= 0) AND ("+key+" <= 100)))","upgraded lower bound is zero for "+key);
  const axisConstraintNames = new Set(keys.map((key) => "member_overalls_"+key+"_check"));
  equal(upgradedConstraints.filter((row) => !axisConstraintNames.has(row.conname)),
    priorConstraints.filter((row) => !axisConstraintNames.has(row.conname)),"all non-score constraints preserved");
  const installedSnapshotDigest = createHash("sha256").update(JSON.stringify({ functions:installedFunctions,boundaries:installedBoundaries,
    permissions:installedPermissions,overalls:installedOveralls,policies:installedPolicies,constraints:priorConstraints })).digest("hex");

  for (const initial of [scores(0),{ pace:0,shooting:100,passing:0,dribbling:20,defending:0,physical:100 },scores(100)]) {
    await scenario(1,async () => {
      const saved = (await admin.query(set(),values(2,0,initial))).rows[0];
      equal(Object.fromEntries(keys.map((key) => [key,saved[key]])),initial,"zero, mixed and maximum scores save exactly");
      equal(saved.revision,1,"zero-inclusive score set is an actual evaluation row");
      equal((await admin.query(get(),[[member(2)]])).rows,[saved],"zero-inclusive scores round-trip through authorized reader");
      const revised = (await admin.query(set(),values(2,1,scores(0)))).rows[0];
      equal(Object.fromEntries(keys.map((key) => [key,revised[key]])),scores(0),"editing positive or mixed scores to zero is supported");
      equal(revised.revision,2,"zero edit increments CAS revision");
      await rejects(admin,set(),values(2,1,initial),"40001","stale zero-inclusive edit is rejected");
    });
  }
  for (const key of keys) await scenario(1,async () => {
    await owner();
    await rejects(admin,`update private.member_overalls set ${key}=-1 where member_id=$1`,[member(5)],"23514","table rejects negative "+key);
    await rejects(admin,`update private.member_overalls set ${key}=101 where member_id=$1`,[member(5)],"23514","table rejects excessive "+key);
  });

  for (const schema of ["public", "private"]) for (const signature of ["get_member_overalls(uuid[])", "set_member_overall(uuid,jsonb,bigint)"]) {
    for (const role of ["authenticated","anon","service_role","fixture_untrusted"])
      equal(await scalar("select has_function_privilege($1,$2,'execute') value", [role,schema+"."+signature]), role === "authenticated", role+" RPC ACL "+schema+"."+signature);
    const info = (await admin.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [schema+"."+signature])).rows[0];
    equal(info.prosecdef, schema === "private", "only private helper is definer");
    equal(info.proconfig, ['search_path=""'], "function search path is fixed");
  }
  equal(await scalar("select relrowsecurity value from pg_class where oid='private.member_overalls'::regclass"), true, "private table RLS enabled");
  for (const role of ["anon","authenticated","service_role","fixture_untrusted"])
    for (const privilege of ["select","insert","update","delete"])
      equal(await scalar("select has_table_privilege($1,'private.member_overalls',$2) value", [role,privilege]), false, "no direct "+role+" "+privilege);

  for (const n of [0,2,6,9,10,11,12,15,16,17,18,20]) await scenario(n, async () => {
    for (const schema of ["public","private"]) {
      await rejects(admin,get(schema),[[member(2)]],"42501","unauthorized read "+n+"/"+schema);
      await rejects(admin,get(schema),[[]],"42501","empty array cannot bypass authorization "+n);
      await rejects(admin,set(schema),values(),"42501","unauthorized write "+n+"/"+schema);
    }
    await rejects(admin,"select * from private.member_overalls",[],"42501","direct table read denied");
    await rejects(admin,"update private.member_overalls set pace=99",[],"42501","direct table write denied");
  });
  for (const role of ["anon","service_role","fixture_untrusted"]) await scenario(1, async () => {
    for (const schema of ["public","private"]) {
      await rejects(admin,get(schema),[[]],"42501","non-client read ACL "+role);
      await rejects(admin,set(schema),values(),"42501","non-client write ACL "+role);
    }
  },"",role);
  for (const n of [1,3,8,13,14,19]) await scenario(n, async () => {
    equal((await admin.query(get(),[[]])).rows, [], "authorized empty query "+n);
    const saved = (await admin.query(set(),values())).rows[0];
    equal(Object.keys(saved),["member_id",...keys,"revision","updated_at"], "RPC projection excludes audit identity");
    equal(saved.revision,1,"authorized first save "+n);
    equal((await admin.query(get(),[[member(2),member(2),member(7),member(10),member(11),member(999)]])).rows.length,1,"deduplicated eligible rated members only");
    const revised = (await admin.query(set("private"),values(2,1,scores(100)))).rows[0];
    equal(revised.revision,2,"private helper rechecks and revises "+n);
    for (const key of keys) equal(revised[key],100,"upper score boundary "+key);
    await rejects(admin,set(),values(),"40001","revision-zero cannot overwrite existing row");
    await rejects(admin,set(),values(2,1),"40001","stale revision cannot overwrite existing row");
    await owner();
    const audit = (await admin.query("select created_by,updated_by,created_at,updated_at from private.member_overalls where member_id=$1", [member(2)])).rows[0];
    equal(audit.created_by,member(n),"server authored creator"); equal(audit.updated_by,member(n),"server authored editor");
    equal(audit.updated_at >= audit.created_at,true,"server authored audit times");
  });
  await scenario(1, async () => {
    equal((await admin.query(set(),values(7,0,scores(0)))).rows[0].pace,0,"unprovisioned active target and zero boundary are valid");
    await rejects(admin,set(),values(21,1),"40001","missing row with positive revision conflicts");
    for (const n of [6,10,11,16,17,999]) await rejects(admin,set(),values(n),"22023","invalid target "+n);
    for (const value of [null,[],{}, { ...scores(), updated_by:member(3) }, { ...scores(), extra:1 }])
      await rejects(admin,set(),values(2,0,value),"22023","invalid object or spoofed audit property");
    for (const key of keys) {
      const missing = scores(); delete missing[key];
      await rejects(admin,set(),values(2,0,missing),"22023","missing score "+key);
      for (const value of [101,-1,1.5,"50",null,true,[],{}])
        await rejects(admin,set(),values(2,0,{ ...scores(),[key]:value }),"22023","invalid "+key+" "+JSON.stringify(value));
    }
    for (const revision of [null,-1]) await rejects(admin,set(),values(2,revision),"22023","invalid revision");
    await rejects(admin,set(),[null,JSON.stringify(scores()),0],"22023","missing member id");
    for (const ids of [null,[null],Array(301).fill(member(2))])
      await rejects(admin,get(),[ids],"22023","invalid read member ids");
    equal((await admin.query(get(),[Array(300).fill(member(2))])).rows.length,0,"300 ids are accepted without invented ratings");
  });

  const permissionChange = (title,permission,enabled,expected) => ({ officer_title:title,permission,enabled,expected_enabled:expected });
  await scenario(3, async () => {
    equal((await admin.query("select public.apply_officer_permission_batch($1::jsonb) value", [JSON.stringify([permissionChange("vice_president","ratings.manage",false,true)])])).rows[0].value,
      { status:"applied",applied_count:1 },"system administrator can exclude new service");
    await actor(admin,13);
    await rejects(admin,get(),[[]],"42501","exclusion immediately revokes read");
    await rejects(admin,set(),values(),"42501","exclusion immediately revokes save");
    await actor(admin,3);
    equal((await admin.query(set(),values())).rows[0].revision,1,"ordinary-role system admin remains allowed");
    await rejects(admin,"select public.apply_officer_permission_batch($1::jsonb)",[JSON.stringify([permissionChange("vice_president","ratings.manage",false,true)])],"40001","batch stale CAS retained");
    await rejects(admin,"select public.apply_officer_permission_batch($1::jsonb)",[JSON.stringify([permissionChange("vice_president","roles.manage",true,false)])],"22023","batch cannot grant system roles");
  });
  for (const n of [1,8,13,14]) await scenario(n, async () =>
    rejects(admin,"select public.apply_officer_permission_batch($1::jsonb)",[JSON.stringify([permissionChange("treasurer","ratings.manage",false,true)])],"42501","officers cannot configure permission grants"));
  for (const [n,assignment] of [[1,"status='inactive'"],[1,"must_change_password=true"],[1,"auth_user_id=null"],
    [1,"role='member',officer_title=null,fee_plan='monthly'"],[3,"is_system_admin=false"]]) await scenario(n, async () => {
    equal((await admin.query(get(),[[]])).rows,[],"actor starts authorized");
    await owner(); await admin.query("update public.profiles set "+assignment+" where id=$1",[member(n)]); await actor(admin,n);
    await rejects(admin,get(),[[]],"42501","next read checks latest authority "+assignment);
    await rejects(admin,set(),values(),"42501","next save checks latest authority "+assignment);
  });
  await scenario(2, async () => {
    equal(await scalar("select public.get_member_phone($1) value",[member(1)]),"+821000000001","ordinary member phone lookup unchanged");
    equal((await admin.query("select * from public.set_my_birthday(3,1,1)")).rows[0].birthday_revision,2,"ordinary member birthday edit unchanged");
    equal((await admin.query("select * from public.profiles where id=$1",[member(1)])).rows,[],"profile privacy unchanged");
    equal((await admin.query("update public.profiles set is_system_admin=true where id=$1 returning id",[member(2)])).rows,
      [],"existing profile RLS blocks ordinary system-role escalation");
  });
  await scenario(1, async () => {
    await rejects(admin,"update public.profiles set is_system_admin=true where id=$1",[member(2)],"42501","member manager cannot grant system role");
    await rejects(admin,"update public.profiles set auth_user_id=null where id=$1",[member(2)],"42501","member manager cannot relink identity");
    await rejects(admin,"update public.profiles set role='manager',officer_title='president',fee_plan=null where id=$1",[member(2)],
      "42501","member manager cannot assign officer role");
    await rejects(admin,"select * from private.member_overalls",[],"42501","authorized manager still has no direct table read");
  });
  await scenario(2, async () => {
    await owner();
    await admin.query("grant select,insert,update,delete on private.member_overalls to authenticated");
    await actor(admin,2);
    equal((await admin.query("select * from private.member_overalls")).rows,[],"default-deny RLS survives accidentally granted direct SELECT");
    equal((await admin.query("update private.member_overalls set pace=100 returning member_id")).rows,[],"default-deny RLS survives accidentally granted UPDATE");
    await rejects(admin,`insert into private.member_overalls(member_id,pace,shooting,passing,dribbling,defending,physical,revision,created_at,updated_at)
      values($1,50,50,50,50,50,50,1,now(),now())`,[member(21)],"42501","default-deny RLS survives accidentally granted INSERT");
  });

  // Real independent connections: both creation and editing have one winner.
  for (const initialRevision of [0,1]) {
    await owner(); await admin.query("delete from private.member_overalls where member_id=$1",[member(2)]);
    if (initialRevision) { await begin(first); await first.query(set(),values()); await first.query("commit"); await end(); }
    await begin(first,1); await first.query(set(),values(2,initialRevision,scores(0)));
    await begin(second,13);
    const competing = settled(second.query(set(),values(2,initialRevision,scores(90))));
    await waitForLock(second); await first.query("commit");
    equal((await competing).error?.code,"40001","simultaneous CAS has one winner for revision "+initialRevision);
    await end();
    equal((await admin.query("select pace,revision from private.member_overalls where member_id=$1",[member(2)])).rows,
      [{ pace:0,revision:initialRevision+1 }],"losing concurrent save never overwrites zero-score winner");
  }
  for (const [n,assignment,restore,retryCode] of [[1,"must_change_password=true","must_change_password=false","42501"],
    [1,"status='inactive'","status='active'","42501"],[1,"auth_user_id=null","auth_user_id="+quote(auth(1)),"42501"],
    [3,"is_system_admin=false","is_system_admin=true","42501"],[2,"status='inactive'","status='active'","22023"],
    [2,"is_test_account=true","is_test_account=false","22023"]]) {
    await begin(first); await actor(first,0,"postgres");
    await first.query("update public.profiles set "+assignment+" where id=$1",[member(n)]);
    await begin(second,n===3?3:1);
    await rejects(second,set(),values(2,2),"40001","in-flight profile mutation conflicts "+assignment);
    await second.query("rollback"); await first.query("commit");
    await begin(second,n===3?3:1);
    await rejects(second,set(),values(2,2),retryCode,"committed profile mutation rechecked "+assignment);
    await end(); await admin.query("update public.profiles set "+restore+" where id=$1",[member(n)]);
  }
  await begin(first); await actor(first,0,"postgres");
  await first.query("delete from public.officer_permissions where officer_title='vice_president' and permission='ratings.manage'");
  await begin(second,13);
  await rejects(second,set(),values(2,2),"40001","concurrent permission exclusion conflicts with save");
  await second.query("rollback"); await first.query("commit");
  await begin(second,13);
  await rejects(second,set(),values(2,2),"42501","committed exclusion is rechecked on retry");
  await end(); await admin.query("insert into public.officer_permissions values('vice_president','ratings.manage')");
  await begin(first,13); await first.query(set(),values(2,2));
  await begin(second); await actor(second,0,"postgres");
  const revoke = settled(second.query("delete from public.officer_permissions where officer_title='vice_president' and permission='ratings.manage'"));
  await waitForLock(second); await first.query("commit");
  equal((await revoke).error,undefined,"permission exclusion waits for already-authorized write transaction");
  await second.query("rollback"); await end();
  equal((await admin.query("select created_by,updated_by from private.member_overalls where member_id=$1",[member(2)])).rows,
    [{ created_by:member(1),updated_by:member(13) }],"another editor updates audit identity without changing creator");
  await begin(first); await actor(first,0,"postgres");
  await first.query("select member_id from private.member_overalls where member_id=$1 for update",[member(2)]);
  await begin(second); await actor(second,0,"postgres");
  const cascade = settled(second.query("delete from public.profiles where id=$1",[member(2)]));
  await waitForLock(second); await actor(first,1);
  await rejects(first,set(),values(2,3),"40001","NOWAIT avoids reverse parent deletion/overall-row cascade deadlock");
  await first.query("rollback"); equal((await cascade).error,undefined,"parent cascade proceeds after conflicting save aborts");
  await second.query("rollback"); await end();

  if (process.env.OVERALL_PGTAP_SQL) {
    const tap = await readFile(process.env.OVERALL_PGTAP_SQL,"utf8");
    await admin.query(tap.replaceAll("__VERSION__","1.034").replaceAll("__OS__","Windows"));
    await admin.query("alter table auth.users add column instance_id uuid,add column aud text,add column role text");
    for (const file of ["member_overalls.test.sql","member_phone.test.sql","member_birthdays.test.sql","member_directory_auth_boundary.test.sql"]) {
      const result = await admin.query(await read("supabase/tests/database/"+file));
      const lines = (Array.isArray(result)?result:[result]).flatMap((item) => item.rows.flatMap((row) => Object.values(row)
        .filter((value) => typeof value === "string" && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
      const failures = lines.filter((line) => /^not ok/m.test(line));
      const passed = lines.filter((line) => /^ok \d/.test(line)).length;
      assert.ok(passed,"pgTAP assertions must run: "+file); assert.equal(failures.length,0,file+"\n"+failures.join("\n"));
      tapChecks += passed; console.log(file+": "+passed+" pgTAP assertions passed");
    }
  }
  equal((await admin.query("select * from public.profiles order by id")).rows,existingProfiles,"final synthetic profile state unchanged");
  equal((await admin.query("select * from private.member_birthdays order by profile_id")).rows,existingBirthday,"final birthday state unchanged");
  console.log(JSON.stringify({ passed:true,checks,tapChecks,engine:identity[0].version,migration:match("_add_member_overalls.sql"),
    migrationSha256:createHash("sha256").update(migration).digest("hex"),zeroMigration:zeroMigrationPath,
    zeroMigrationSha256:createHash("sha256").update(zeroMigration).digest("hex"),regressionSnapshotSha256:snapshotDigest,
    installedSnapshotSha256:installedSnapshotDigest,
    scope:"three independent loopback PostgreSQL connections, synthetic fixtures only" }));
} catch (error) {
  console.error(error.message); console.error(JSON.stringify({ code:error.code,detail:error.detail,where:error.where })); process.exitCode=1;
} finally {
  await Promise.allSettled(clients.map((client) => client.query("rollback")));
  await Promise.allSettled(clients.map((client) => client.end()));
}
