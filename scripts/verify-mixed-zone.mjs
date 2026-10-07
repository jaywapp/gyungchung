import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// No remote URL, credentials or production database is accepted.
assert.ok(process.env.MIXED_ZONE_PG_MODULE, "MIXED_ZONE_PG_MODULE must identify the isolated pg package");
const { default: pg } = await import(pathToFileURL(process.env.MIXED_ZONE_PG_MODULE).href);
pg.types.setTypeParser(20, Number);
assert.match(process.env.MIXED_ZONE_RUN || "", /^\d{0,3}$/, "Synthetic run suffix only");
const config = { host: "127.0.0.1", port: 55440, user: "postgres", database: "mixed_zone_synthetic" + (process.env.MIXED_ZONE_RUN ? "_" + process.env.MIXED_ZONE_RUN : "") };
const clients = [new pg.Client(config), new pg.Client(config), new pg.Client(config)];
const [admin, first, second] = clients;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");
const migrations = await readdir(path.join(root, "supabase/migrations"));
const match = (suffix) => {
  const names = migrations.filter((name) => name.endsWith(suffix));
  assert.equal(names.length, 1, suffix); return "supabase/migrations/" + names[0];
};
function extractFunction(source, name) {
  const marker = source.includes("create or replace function " + name + "(") ? "create or replace function " : "create function ";
  const start = source.indexOf(marker + name + "("); assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}
function extractPolicy(source, name) {
  const start = source.indexOf('create policy "' + name + '"'); assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(";", start) + 1);
}
function extractTable(source, name) {
  const start = source.indexOf("create table " + name + " ("); assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(";", start) + 1);
}
const auth = (n) => "51000000-0000-0000-0000-" + String(n).padStart(12, "0");
const member = (n) => "51010000-0000-0000-0000-" + String(n).padStart(12, "0");
const event = (n) => "51020000-0000-0000-0000-" + String(n).padStart(12, "0");
const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical"];
const scores = (n = 3) => Object.fromEntries(keys.map((key) => [key, n]));
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
let checks = 0, tapChecks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const scalar = async (sql, values = []) => (await admin.query(sql, values)).rows[0]?.value;
async function actor(client, n, role = "authenticated") {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [n ? auth(n) : ""]);
  await client.query("set role " + role);
}
const owner = () => actor(admin, 0, "postgres");
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
const write = "select * from public.set_mixed_zone_entry($1,$2,$3::jsonb,$4)";
const get = "select * from public.get_mixed_zone_entries($1)";
const overall = "select * from public.get_mixed_zone_overalls($1::uuid[])";
const vals = (e = 1, m = 2, revision = 0, value = scores()) => [event(e), member(m), JSON.stringify(value), revision];
const allFunctions = `select n.nspname,f.oid::regprocedure::text signature,pg_get_functiondef(f.oid) definition,
 f.proacl::text acl from pg_proc f join pg_namespace n on n.oid=f.pronamespace
 where n.nspname in ('public','private') order by 1,2`;
const allPolicies = "select * from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname";
async function begin(client, n = 1) { await client.query("begin"); await actor(client, n); }
async function end() { await Promise.all([first.query("rollback;reset role"), second.query("rollback;reset role")]); await owner(); }

try {
  await Promise.all(clients.map((client) => client.connect()));
  const identity = (await admin.query("select current_database() db,host(inet_server_addr()) host,version() engine")).rows[0];
  equal(identity.db, config.database, "dedicated synthetic database");
  equal(identity.host, config.host, "loopback only");
  equal(await scalar("select count(*)::integer value from pg_tables where schemaname in ('public','private','auth','storage')"), 0, "refuse nonempty database");
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

  await admin.query(await read(match("_add_member_overalls.sql")));
  await admin.query(await read(match("_allow_zero_member_overalls.sql")));
  await admin.query(extractFunction(accounts, "private.is_active_member"));
  await admin.query("grant execute on function private.is_active_member() to authenticated");
  await admin.query("create type public.attendance_status as enum ('going','not_going','undecided'); create type public.attendance_check_in_status as enum ('present','late','absent')");
  await admin.query(extractTable(base, "public.events"));
  await admin.query(extractTable(base, "public.attendance"));
  await admin.query("alter table public.attendance add column checked_in_at timestamptz,add column checked_in_by uuid references public.profiles(id),add column check_in_status public.attendance_check_in_status");
  await admin.query("alter table public.events enable row level security; alter table public.attendance enable row level security; grant select,insert,update,delete on public.events,public.attendance to authenticated,service_role");
  for (const name of ["Events are public", "Event managers insert", "Event managers update", "Event managers delete"])
    await admin.query(extractPolicy(base, name));
  for (const name of ["Members read attendance", "Members and event managers insert attendance", "Members update own attendance"])
    await admin.query(extractPolicy(name === "Members read attendance" ? base : accounts, name));
  const guest = await read("supabase/migrations/20260809055058_add_guest_players.sql");
  await admin.query(guest.slice(guest.indexOf("create table public.event_mom_votes"),guest.indexOf("create or replace function public.get_event_mom_results()")));
  await admin.query(await read(match("_add_event_potm_voting_window.sql")));
  const attendanceSource = await read("supabase/migrations/20260816143000_add_attendance_check_in_status.sql");
  await admin.query(extractFunction(attendanceSource,"public.protect_attendance_check_in"));
  await admin.query("create trigger protect_attendance_check_in_before_write before insert or update on public.attendance for each row execute function public.protect_attendance_check_in()");
  await admin.query("insert into public.officer_permissions values('president','events.manage') on conflict do nothing");
  await actor(admin,1);
  await admin.query("select * from public.set_member_overall($1,$2::jsonb,0)",[member(2),JSON.stringify(scores(73))]);
  await owner();
  const originalManual = (await admin.query("select * from private.member_overalls order by member_id")).rows;
  const originalPermissions = (await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows;
  const originalFunctions = (await admin.query(allFunctions)).rows;
  const originalPolicies = (await admin.query(allPolicies)).rows;
  const originalProfiles = (await admin.query("select * from public.profiles order by id")).rows;
  const migrationPath = match("_add_mixed_zone_ratings.sql");
  const migration = await read(migrationPath);
  await admin.query(migration);
  const installedFunctions = (await admin.query(allFunctions)).rows;
  equal(installedFunctions.filter((fn) => originalFunctions.some((old) => old.signature === fn.signature))
    .map((fn) => ["private.get_member_overalls(uuid[])","private.set_member_overall(uuid,jsonb,bigint)"].includes(fn.signature)
      ? { ...fn, definition:originalFunctions.find((old) => old.signature === fn.signature).definition } : fn),
    originalFunctions, "all prior function signatures, ACL and definitions preserved except two legacy private bodies");
  equal((await admin.query(allPolicies)).rows,originalPolicies,"existing RLS policies unchanged including POTM");
  equal((await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows,originalPermissions,"permission exclusions unchanged");
  equal((await admin.query("select * from private.member_overalls order by member_id")).rows,originalManual,"manual audit preserved");
  equal((await admin.query("select * from public.profiles order by id")).rows,originalProfiles,"profile state preserved");
  await admin.query(await read("supabase/tests/fixtures/mixed_zone.sql"));

  for (const schema of ["public","private"]) for (const fn of ["get_mixed_zone_entries(uuid)","set_mixed_zone_entry(uuid,uuid,jsonb,bigint)","get_mixed_zone_overalls(uuid[])"]) {
    const signature = schema + "." + fn;
    equal(await scalar("select has_function_privilege('authenticated',$1,'execute') value",[signature]),true,"authenticated RPC grant "+signature);
    for (const role of ["anon","service_role"])
      equal(await scalar("select has_function_privilege($1,$2,'execute') value",[role,signature]),false,"RPC denied "+role+" "+signature);
    equal(await scalar("select prosecdef value from pg_proc where oid=$1::regprocedure",[signature]),schema === "private","definer confined to private "+signature);
    equal(await scalar("select proconfig value from pg_proc where oid=$1::regprocedure",[signature]),['search_path=""'],"empty search path "+signature);
  }
  equal(await scalar("select relrowsecurity value from pg_class where oid='private.mixed_zone_entries'::regclass"),true,"private table RLS enabled");
  for (const role of ["anon","authenticated","service_role"])
    for (const access of ["select","insert","update","delete","truncate","references","trigger"])
      equal(await scalar("select has_table_privilege($1,'private.mixed_zone_entries',$2) value",[role,access]),false,"private table denied "+role+" "+access);

  await scenario(1,async () => {
    const row = (await admin.query(write,vals())).rows[0]; equal(row.revision,1,"new response revision"); equal(row.pace,3,"score preserved");
    equal((await admin.query(get,[event(1)])).rows.length,1,"author sees own response");
    await rejects(admin,write,vals(),"40001","duplicate first insert");
    const edited = (await admin.query(write,vals(1,2,1,scores(5)))).rows[0]; equal(edited.revision,2,"CAS edit revision");
    await rejects(admin,write,vals(1,2,1),"40001","stale CAS");
    await rejects(admin,write,vals(1,3,1),"40001","missing-row positive revision");
    for (const n of [1,6,10,11]) await rejects(admin,write,vals(1,n),"42501","self/inactive/hidden/pending target "+n);
    await rejects(admin,write,vals(1,8),"42501","target RSVP going without actual attendance");
    await rejects(admin,write,vals(2),"42501","unstarted event");
    await rejects(admin,write,vals(3),"42501","expired event");
    await rejects(admin,write,vals(99),"42501","unknown event");
    for (const value of [null,[],{},scores(0),scores(6),scores(1.5),scores("3"),{...scores(),extra:1},{...scores(),pace:null},{...scores(),pace:1e100}])
      await rejects(admin,write,vals(1,2,0,value),"22023","invalid scores "+JSON.stringify(value));
    for (const revision of [null,-1]) await rejects(admin,write,vals(1,2,revision),"22023","invalid revision");
    await rejects(admin,write,[null,member(2),JSON.stringify(scores()),0],"22023","null event");
    await rejects(admin,write,[event(1),null,JSON.stringify(scores()),0],"22023","null target");
    await rejects(admin,get,[null],"22023","null owner query");
  });
  for (const n of [0,6,8,9,10,11,12,14,15,16,17,18,19,20]) await scenario(n,async () => {
    await rejects(admin,write,vals(),"42501","ineligible evaluator "+n);
    await rejects(admin,get,[event(1)],"42501","ineligible own reader "+n);
  });
  await scenario(2,async () => {
    equal((await admin.query(write,vals(1,3))).rows[0].revision,1,"late attendance qualifies");
    await rejects(admin,overall,[[member(2)]],"42501","ordinary member cannot see aggregates");
  });
  await scenario(3,async () => equal((await admin.query(write,vals(1,2))).rows[0].revision,1,"legacy timestamp attendance qualifies"));
  await scenario(1,async () => await rejects(admin,write,vals(),"42501","explicit absent does not inherit legacy timestamp"),
    "alter table public.attendance disable trigger user; update public.attendance set check_in_status='absent',checked_in_at=clock_timestamp() where event_id="+quote(event(1))+" and member_id="+quote(member(1)));

  for (const role of ["anon","service_role"]) await scenario(1,async () => {
    await rejects(admin,write,vals(),"42501","RPC denied "+role);
    await rejects(admin,get,[event(1)],"42501","owner RPC denied "+role);
    await rejects(admin,overall,[[member(2)]],"42501","aggregate RPC denied "+role);
  },"",role);
  await scenario(1,async () => {
    for (const sql of ["select * from private.mixed_zone_entries","delete from private.mixed_zone_entries","update private.mixed_zone_entries set revision=revision+1"])
      await rejects(admin,sql,[],"42501","direct table access denied");
    for (const schema of ["private","public"]) await rejects(admin,"select * from "+schema+".set_member_overall($1,$2::jsonb,0)",
      [member(2),JSON.stringify(scores(50))],"42501","retired manual RPC "+schema);
    for (const ids of [null,[null],Array(301).fill(member(2))]) await rejects(admin,overall,[ids],"22023","invalid aggregate IDs");
    equal((await admin.query(overall,[[]])).rows,[],"empty ID set");
    equal((await admin.query(overall,[[member(2)]])).rows,[],"manual row never used as aggregate fallback");
    equal((await admin.query("select * from public.get_member_overalls($1::uuid[])",[[member(2)]])).rows,[],"legacy aggregate read has no manual fallback");
  });
  await scenario(1,async () => {
    await admin.query(write,vals()); await admin.query("update public.events set mixed_zone_days=1,starts_at=clock_timestamp()-interval '5 days',ends_at=null where id=$1",[event(1)]);
    equal((await admin.query(get,[event(1)])).rows.length,1,"owner reads after deadline");
    await rejects(admin,write,vals(1,2,1),"42501","owner cannot edit after deadline");
    equal((await admin.query("select mom_voting_days from public.events where id=$1",[event(1)])).rows[0].mom_voting_days,3,"POTM duration independent");
  });
  await scenario(2,async () => await rejects(admin,"update public.events set mixed_zone_days=9 where id=$1",[event(1)],"42501","nonmanager config update"),
    'create policy "Synthetic broad update" on public.events for update to authenticated using(true) with check(true)');
  await scenario(1,async () => {
    await admin.query("update public.events set mixed_zone_days=30 where id=$1",[event(1)]);
    equal(await scalar("select mixed_zone_days value from public.events where id=$1",[event(1)]),30,"event manager config update");
    for (const days of [0,31]) await rejects(admin,"update public.events set mixed_zone_days=$1 where id=$2",[days,event(1)],"23514","period range constraint");
  });

  await admin.query("begin"); await actor(admin,1); await admin.query(write,vals()); await admin.query("commit"); await owner();
  await scenario(2,async () => equal((await admin.query(get,[event(1)])).rows,[],"another author cannot read response"));
  await scenario(2,async () => equal((await admin.query(write,vals(1,3))).rows.length,1,"author owns independent response"));
  await scenario(1,async () => {
    const row = (await admin.query(overall,[[member(2)]])).rows[0]; equal([row.pace,row.response_count,row.event_count,row.revision],[60,1,1,1],"real response aggregate metadata");
    const legacy = (await admin.query("select * from public.get_member_overalls($1::uuid[])",[[member(2)]])).rows[0];
    const expected = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "response_count" && key !== "event_count")); equal(legacy,expected,"legacy read signature mirrors aggregate");
  });
  await scenario(1,async () => equal((await admin.query(overall,[[member(2)]])).rows.length,1,"attendance correction preserves historical responses"),
    'alter table public.attendance disable trigger user; update public.attendance set check_in_status=null,checked_in_at=null');
  await scenario(3,async () => equal((await admin.query(overall,[[member(2)]])).rows.length,1,"historical inactive/hidden author responses preserved"),
    "update public.profiles set status='inactive',is_test_account=true where id="+quote(member(1))+
    ";update public.profiles set is_system_admin=true where id="+quote(member(3)));
  // Use a different eligible manager for the preceding historical-author scenario.

  for (const setup of ["update public.profiles set status='inactive' where id=", "update public.profiles set is_test_account=true where id="])
    await scenario(1,async () => equal((await admin.query(overall,[[member(2)]])).rows,[],"current hidden/inactive target excluded"),setup+quote(member(2)));
  await scenario(1,async () => await rejects(admin,overall,[[member(2)]],"42501","withdrawn aggregate permission"),
    "delete from public.officer_permissions where officer_title='president' and permission='ratings.manage'");
  await scenario(1,async () => await rejects(admin,"update public.events set mixed_zone_days=4 where id=$1",[event(1)],"42501","withdrawn event management permission"),
    "delete from public.officer_permissions where officer_title='president' and permission='events.manage'; create policy \"Synthetic broad config\" on public.events for update to authenticated using(true) with check(true)");

  // Different response counts must not distort equal weighting between events.
  await scenario(1,async () => {
    const row = (await admin.query(overall,[[member(2),member(2)]])).rows[0];
    equal([row.pace,row.response_count,row.event_count],[67,4,2],"event averages have equal weight despite uneven samples");
  }, `insert into public.events(id,title,starts_at,ends_at,venue) values('${event(4)}','Uneven event',clock_timestamp()-interval '4 hours',clock_timestamp()-interval '3 hours','Synthetic');
    insert into private.mixed_zone_entries(event_id,actor_id,member_id,pace,shooting,passing,dribbling,defending,physical,revision,created_at,updated_at)
    values('${event(1)}','${member(3)}','${member(2)}',1,1,1,1,1,1,1,clock_timestamp(),clock_timestamp()),
      ('${event(1)}','${member(4)}','${member(2)}',1,1,1,1,1,1,1,clock_timestamp(),clock_timestamp()),
      ('${event(4)}','${member(1)}','${member(2)}',5,5,5,5,5,5,1,clock_timestamp(),clock_timestamp())`);
  await scenario(1,async () => {
    const row = (await admin.query(overall,[[member(2)]])).rows[0];
    equal([row.pace,row.response_count,row.event_count],[100,10,10],"target-specific newest ten rated events only");
  }, `insert into public.events(id,title,starts_at,ends_at,venue)
    select ('51020000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Recent rated event',
      clock_timestamp()-interval '1 hour' - n*interval '1 minute',clock_timestamp()-n*interval '1 minute','Synthetic' from generate_series(10,19) n;
    insert into private.mixed_zone_entries(event_id,actor_id,member_id,pace,shooting,passing,dribbling,defending,physical,revision,created_at,updated_at)
    select ('51020000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${member(1)}','${member(2)}',5,5,5,5,5,5,1,clock_timestamp(),clock_timestamp() from generate_series(10,19) n;
    insert into public.events(id,title,starts_at,ends_at,venue) values('${event(30)}','Unrated newest event',clock_timestamp()-interval '1 hour',clock_timestamp(),'Synthetic')`);
  await scenario(1,async () => {
    const row = (await admin.query(overall,[[member(2)]])).rows[0];
    equal([row.pace,row.response_count,row.event_count],[92,10,10],"stable event UUID tie-break excludes lower UUID event");
  }, `delete from private.mixed_zone_entries;
    insert into public.events(id,title,starts_at,ends_at,venue)
    select ('51020000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Tied rated event',
      '2026-10-01T09:00:00Z','2026-10-01T11:00:00Z','Synthetic' from generate_series(40,50) n;
    insert into private.mixed_zone_entries(event_id,actor_id,member_id,pace,shooting,passing,dribbling,defending,physical,revision,created_at,updated_at)
    select ('51020000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${member(1)}','${member(2)}',
      case when n in (40,41) then 1 else 5 end,5,5,5,5,5,1,clock_timestamp(),clock_timestamp() from generate_series(40,50) n`);

  // An existing transaction must use wall clock after every guard is acquired.
  await scenario(1,async () => {
    await admin.query("select pg_sleep(0.12)");
    await rejects(admin,write,vals(),"42501","transaction-start time cannot extend expired deadline");
  }, `update public.events set ends_at=clock_timestamp()-interval '72 hours'+interval '60 milliseconds',starts_at=clock_timestamp()-interval '74 hours' where id='${event(1)}'`);

  // Independent connections prove immediate 40001 on shared-guard changes.
  for (const mutation of [
    `update public.events set mixed_zone_days=4 where id='${event(1)}'`,
    `update public.profiles set status='inactive' where id='${member(1)}'`,
    `update public.profiles set is_test_account=true where id='${member(2)}'`,
    `delete from public.attendance where event_id='${event(1)}' and member_id='${member(2)}'`,
    `delete from public.profiles where id='${member(2)}'`,
    `delete from public.events where id='${event(1)}'`
  ]) {
    await first.query("begin"); await actor(first,0,"postgres"); await first.query(mutation);
    await begin(second); await rejects(second,write,vals(1,2,1),"40001","NOWAIT shared guard "+mutation); await end();
  }
  await begin(first); await first.query(write,vals(1,2,1,scores(4)));
  await begin(second); await rejects(second,write,vals(1,2,1,scores(5)),"40001","same-author edit serialization");
  await first.query("commit"); await rejects(second,write,vals(1,2,1),"40001","stale revision after committed winner"); await end();
  await begin(first); await first.query(write,vals(1,3));
  await begin(second); await rejects(second,write,vals(1,3),"40001","concurrent new response serialization"); await end();
  await begin(first); await first.query(write,vals(1,3));
  await begin(second,2); equal((await second.query(write,vals(1,3))).rows[0].revision,1,"different authors can rate same target concurrently"); await end();
  await begin(first); await first.query(write,vals(1,2,2));
  await second.query("begin"); await actor(second,0,"postgres");
  const withdrawal = second.query(`delete from public.attendance where event_id='${event(1)}' and member_id='${member(2)}'`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await admin.query("select wait_event_type from pg_stat_activity where pid=$1",[second.processID])).rows[0];
    if (state?.wait_event_type === "Lock") { checks++; break; }
    if (attempt === 99) assert.fail("Attendance withdrawal must wait for response guard");
    await new Promise((resolve) => setTimeout(resolve,20));
  }
  await first.query("rollback"); await withdrawal; await end();

  for (const mutation of [
    "delete from public.officer_permissions where officer_title='president' and permission='events.manage'",
    `update public.profiles set must_change_password=true where id='${member(1)}'`
  ]) {
    await first.query("begin"); await actor(first,0,"postgres"); await first.query(mutation);
    await begin(second);
    for (const statement of ["mixed_zone_days=8", "starts_at=starts_at-interval '1 hour'", "ends_at=clock_timestamp()-interval '30 minutes'"])
      await rejects(second,"update public.events set "+statement+" where id=$1",[event(1)],"40001","config/time membership/permission NOWAIT "+mutation+" "+statement);
    await end();
  }
  await begin(first); await first.query("update public.events set mixed_zone_days=8 where id=$1",[event(1)]);
  await second.query("begin"); await actor(second,0,"postgres");
  const eventPermissionWithdrawal = second.query("delete from public.officer_permissions where officer_title='president' and permission='events.manage'");
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await admin.query("select wait_event_type from pg_stat_activity where pid=$1",[second.processID])).rows[0];
    if (state?.wait_event_type === "Lock") { checks++; break; }
    if (attempt === 99) assert.fail("Event permission withdrawal must wait for config guard");
    await new Promise((resolve) => setTimeout(resolve,20));
  }
  await first.query("rollback"); await eventPermissionWithdrawal; await end();
  await scenario(1,async () => equal((await admin.query(write,vals(1,9))).rows[0].revision,1,"target password-change status does not forbid rating"));
  await scenario(1,async () => equal((await admin.query(write,vals(1,7))).rows[0].revision,1,"unlinked actual attending target is rateable"));
  await scenario(1,async () => await rejects(admin,get,[event(1)],"42501","owner access withdrawn with actual attendance"),
    `alter table public.attendance disable trigger user; update public.attendance set check_in_status=null,checked_in_at=null where event_id='${event(1)}' and member_id='${member(1)}'`);

  // POTM remains a separate existing write surface and source table.
  await scenario(1,async () => {
    await admin.query("insert into public.event_mom_votes(event_id,voter_id,candidate_profile_id) values($1,$2,$3)",[event(1),member(1),member(2)]);
    equal((await admin.query("select * from public.event_mom_votes")).rows.length,1,"POTM write still works");
    await admin.query(write,vals(1,3));
    equal((await admin.query("select * from public.event_mom_votes")).rows.length,1,"mixed zone does not mutate POTM");
  });
  equal((await admin.query("select * from private.member_overalls order by member_id")).rows,originalManual,"final manual audit untouched");
  equal((await admin.query("select * from public.officer_permissions order by officer_title,permission")).rows,originalPermissions,"final permissions unchanged");
  equal((await admin.query("select * from public.profiles order by id")).rows,originalProfiles,"final profile state unchanged");

  assert.ok(process.env.MIXED_ZONE_PGTAP_SQL,"MIXED_ZONE_PGTAP_SQL is required for exact boundary verification");
  const tap = await readFile(process.env.MIXED_ZONE_PGTAP_SQL,"utf8");
  await admin.query(tap.replaceAll("__VERSION__","1.034").replaceAll("__OS__","Windows"));
  const tapResults = await admin.query(await read("supabase/tests/database/mixed_zone.test.sql"));
  const tapLines = (Array.isArray(tapResults)?tapResults:[tapResults]).flatMap((item) => item.rows.flatMap((row) => Object.values(row)
    .filter((value) => typeof value === "string" && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
  const failures = tapLines.filter((line) => /^not ok/m.test(line));
  tapChecks = tapLines.filter((line) => /^ok \d/.test(line)).length;
  assert.ok(tapChecks,"pgTAP assertions must execute"); equal(failures,[],"pgTAP exact time boundaries");
  await admin.query("alter table auth.users add column instance_id uuid,add column aud text,add column role text");
  for (const file of ["member_phone.test.sql","member_birthdays.test.sql","member_directory_auth_boundary.test.sql"]) {
    const result = await admin.query(await read("supabase/tests/database/"+file));
    const lines = (Array.isArray(result)?result:[result]).flatMap((item) => item.rows.flatMap((row) => Object.values(row)
      .filter((value) => typeof value === "string" && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
    const failures = lines.filter((line) => /^not ok/m.test(line));
    const passed = lines.filter((line) => /^ok \d/.test(line)).length;
    assert.ok(passed,"Existing pgTAP assertions must run: "+file); equal(failures,[],"Existing pgTAP regression: "+file);
    tapChecks += passed; console.log(file+": "+passed+" pgTAP assertions passed");
  }
  console.log(JSON.stringify({passed:true,checks,tapChecks,engine:identity.engine,migration:migrationPath,
    migrationSha256:createHash("sha256").update(migration).digest("hex"),
    originalSnapshotSha256:createHash("sha256").update(JSON.stringify({originalFunctions,originalPolicies,originalPermissions,originalManual})).digest("hex"),
    scope:"three independent loopback PostgreSQL connections; synthetic fixtures only"}));
} catch (error) {
  console.error(error.message); console.error(JSON.stringify({code:error.code,detail:error.detail,where:error.where})); process.exitCode=1;
} finally {
  await Promise.allSettled(clients.map((client) => client.query("rollback")));
  await Promise.allSettled(clients.map((client) => client.end()));
}
