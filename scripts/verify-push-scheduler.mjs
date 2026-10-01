import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PUSH_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = filename => readFile(path.join(root, filename), "utf8");
const workerUrl = "https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker";
const workerSecret = "scheduler-fixture-only-" + "x".repeat(42);
const project = "b0000000-0000-0000-0000-000000000401";
const account = "b0000000-0000-0000-0000-000000000001";
let checks = 0;
async function value(sql, args = []) { return (await db.query(sql, args)).rows[0]?.value; }
function equal(actual, expected, description) { assert.deepEqual(actual, expected, description); checks++; }
async function invoke(action = "dispatch") { return value("select private.invoke_notification_worker($1) value", [action]); }
async function secret(name, content) {
  await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values($1,$2) on conflict(name) do update set decrypted_secret=excluded.decrypted_secret", [name, content]);
}
async function blocked(description) {
  const before = await value("select count(*)::integer value from net.http_request_queue");
  equal(await invoke(), null, description);
  equal(await value("select count(*)::integer value from net.http_request_queue"), before, description + " queues no HTTP request");
}
try {
  // Only network, Vault decryption and cron extensions are stubbed; the migration SQL executes unchanged.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role extension_public_user;
    create schema private;
    create schema vault;
    create schema net;
    create schema cron;
    create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
    create table net.http_request_queue(id bigserial primary key,url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds integer);
    create table net._http_response(id bigint,status_code integer,headers jsonb,content text);
    create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{"Content-Type":"application/json"}',timeout_milliseconds integer default 2000)
    returns bigint language sql as $$
      insert into net.http_request_queue(url,body,params,headers,timeout_milliseconds) values($1,$2,$3,$4,$5) returning id;
    $$;
    grant usage on schema net to public;
    grant all on all tables in schema net to public,anon,authenticated,service_role;
    grant all on all sequences in schema net to public,anon,authenticated,service_role;
    grant execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) to public,anon,authenticated,service_role;
    create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,username text,active boolean);
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command,username,active) values($1,$2,$3,current_user,true)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid;
    $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
    returns void language plpgsql as $$
    begin
      if username is not null then raise exception 'Managed cron username must be inherited from caller'; end if;
      update cron.job j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),active=coalesce($6,j.active) where j.jobid=$1;
    end; $$;
    select cron.schedule('gyungchung-weekly-events','5 0 * * *','select private.ensure_weekly_events()');
  `);
  const base = await read("supabase/migrations/20261001114159_push_notifications.sql");
  const runtimeSource = base.match(/create table private\.notification_runtime \([\s\S]*?insert into private\.notification_runtime default values;/)?.[0];
  assert.ok(runtimeSource, "actual base runtime definition is required");
  await db.exec(runtimeSource);
  const rollout = await read("supabase/migrations/20261001231341_push_production_rollout.sql");
  const modeSource = rollout.match(/alter table private\.notification_runtime[\s\S]*?;/)?.[0];
  assert.ok(modeSource, "actual production mode definition is required");
  await db.exec(modeSource);
  const migration = await read("supabase/migrations/20261001231617_push_worker_schedules.sql");
  const scheduleRoleGuard = migration.match(/do \$\$[\s\S]*?end; \$\$;/)?.[0];
  assert.ok(scheduleRoleGuard, "actual cron installation role guard is required");
  equal((migration.match(/create extension if not exists pg_net with schema extensions;/g) ?? []).length, 1, "pg_net is installed by migration");
  equal(/vault\.create_secret|vault\.update_secret/.test(migration), false, "migration contains no Vault provisioning");
  for (const role of ["anon", "authenticated", "service_role", "extension_public_user"]) {
    equal(await value("select has_table_privilege($1,'net.http_request_queue','select') value", [role]), true, role + " inherits unsafe extension queue access before hardening");
  }
  await db.exec(migration.replace(/^create extension if not exists pg_net with schema extensions;\r?\n/m, ""));
  equal((await db.query("select enabled,delivery_mode,production_activated_at from private.notification_runtime")).rows[0],
    { enabled: false, delivery_mode: "test", production_activated_at: null }, "migration preserves disabled test runtime");
  equal((await db.query("select jobname,schedule,command,username,active from cron.job where jobname like 'gyungchung-push-%' order by jobname")).rows, [
    { jobname: "gyungchung-push-dispatch", schedule: "* * * * *", command: "select private.invoke_notification_worker('dispatch');", username: "postgres", active: false },
    { jobname: "gyungchung-push-receipts", schedule: "*/5 * * * *", command: "select private.invoke_notification_worker('receipts');", username: "postgres", active: false },
  ], "dispatch and receipt jobs start inactive with administrative ownership");
  equal((await db.query("select schedule,command,active from cron.job where jobname='gyungchung-weekly-events'")).rows[0],
    { schedule: "5 0 * * *", command: "select private.ensure_weekly_events()", active: true }, "weekly schedule is unchanged");
  equal((await db.query("select prosecdef,proconfig,pg_get_userbyid(proowner) owner from pg_proc where oid='private.invoke_notification_worker(text)'::regprocedure")).rows[0],
    { prosecdef: true, proconfig: ['search_path=""'], owner: "postgres" }, "helper uses secured administrative execution");
  for (const role of ["anon", "authenticated", "service_role", "extension_public_user"]) {
    equal(await value("select has_function_privilege($1,'private.invoke_notification_worker(text)','execute') value", [role]), false, role + " has no helper execute permission");
    for (const table of ["net.http_request_queue", "net._http_response"]) {
      for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        equal(await value("select has_table_privilege($1,$2,$3) value", [role, table, permission]), false, role + " cannot " + permission + " " + table);
      }
    }
    for (const permission of ["USAGE", "SELECT", "UPDATE"]) {
      equal(await value("select has_sequence_privilege($1,'net.http_request_queue_id_seq',$2) value", [role, permission]), false, role + " has no queue sequence " + permission);
    }
    equal(await value("select has_function_privilege($1,'net.http_post(text,jsonb,jsonb,jsonb,integer)','execute') value", [role]), false, role + " cannot directly queue HTTP requests");
    await db.exec("grant usage on schema private to " + role);
    await db.exec("set role " + role);
    for (const sql of [
      "select headers from net.http_request_queue",
      "update net.http_request_queue set url='https://invalid.example'",
      "insert into net.http_request_queue(url) values('https://invalid.example')",
      "delete from net.http_request_queue",
      "truncate net.http_request_queue",
      "select content from net._http_response",
      "update net._http_response set content='tampered'",
      "insert into net._http_response(id) values(1)",
      "select nextval('net.http_request_queue_id_seq')",
      "select setval('net.http_request_queue_id_seq',1)",
      "select net.http_post('https://invalid.example')",
    ]) {
      await assert.rejects(() => db.exec(sql), /permission denied/, role + " is blocked from pg_net internals");
      checks++;
    }
    await assert.rejects(() => invoke(), /permission denied for function invoke_notification_worker/, role + " cannot invoke helper");
    checks++;
    await assert.rejects(() => db.exec(scheduleRoleGuard), /Push schedules must be installed as postgres/, role + " cannot own worker schedules");
    checks++;
    await db.exec("reset role");
  }
  equal(await value("select has_function_privilege('postgres','private.invoke_notification_worker(text)','execute') value"), true, "cron role can invoke helper");
  for (const action of [null, "", "cleanup", "DISPATCH", "dispatch;select 1"]) {
    await assert.rejects(() => invoke(action), /Invalid notification worker action/, "unsupported actions are rejected");
    checks++;
  }
  await secret("gyungchung-push-worker-url", workerUrl);
  await secret("gyungchung-push-worker-secret", workerSecret);
  await blocked("disabled runtime blocks invocation");
  await db.exec("update private.notification_runtime set enabled=true");
  await blocked("missing allowed project blocks invocation");
  await db.query("update private.notification_runtime set allowed_project_id=$1", [project]);
  await blocked("test mode requires a nonempty allowlist");
  await db.query("update private.notification_runtime set test_auth_user_ids=array[$1::uuid]", [account]);
  const request = await invoke();
  equal(request !== null, true, "valid test runtime queues dispatch");
  const queued = (await db.query("select url,body,params,headers,timeout_milliseconds from net.http_request_queue where id=$1", [request])).rows[0];
  equal(queued.url, workerUrl, "only project worker endpoint is called");
  equal(queued.body, { action: "dispatch" }, "dispatch sends only its action");
  equal(queued.params, {}, "request has no URL parameters");
  equal(queued.headers["Content-Type"], "application/json", "request uses JSON content type");
  equal(queued.headers["x-push-worker-secret"] === workerSecret, true, "request uses worker authentication header");
  equal(Object.keys(queued.headers).sort(), ["Content-Type", "x-push-worker-secret"], "request contains only required headers");
  equal(queued.timeout_milliseconds, 60000, "worker request has the specified timeout");
  const receipt = await invoke("receipts");
  equal(await value("select body value from net.http_request_queue where id=$1", [receipt]), { action: "receipts" }, "receipts uses the receipt action");
  for (const invalidUrl of [null, "", "http://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker", workerUrl + "?redirect=1", workerUrl + "/", "https://other.supabase.co/functions/v1/push-worker"]) {
    await secret("gyungchung-push-worker-url", invalidUrl);
    await blocked("invalid endpoint blocks invocation");
  }
  await db.exec("delete from vault.decrypted_secrets where name='gyungchung-push-worker-url'");
  await blocked("missing endpoint blocks invocation");
  await secret("gyungchung-push-worker-url", workerUrl);
  for (const invalidSecret of [null, "", "   ", "x".repeat(31), " ".repeat(32), "x".repeat(32) + "\rheader", "x".repeat(32) + "\nheader"]) {
    await secret("gyungchung-push-worker-secret", invalidSecret);
    await blocked("invalid worker authentication blocks invocation");
  }
  await db.exec("delete from vault.decrypted_secrets where name='gyungchung-push-worker-secret'");
  await blocked("missing worker authentication blocks invocation");
  await secret("gyungchung-push-worker-secret", workerSecret);
  await assert.rejects(() => db.exec("update private.notification_runtime set delivery_mode='production',production_activated_at=null"), /production_activation_required/, "production mode requires explicit activation");
  checks++;
  // Simulate an incomplete production configuration to verify the helper's own fail-closed check.
  await db.exec("alter table private.notification_runtime drop constraint production_activation_required; update private.notification_runtime set delivery_mode='production',production_activated_at=null,test_auth_user_ids='{}'");
  await blocked("production mode with missing activation blocks invocation");
  await db.exec("update private.notification_runtime set production_activated_at=now(); alter table private.notification_runtime add constraint production_activation_required check(delivery_mode<>'production' or production_activated_at is not null)");
  equal((await invoke()) !== null, true, "activated production mode runs without test allowlist");
  await db.exec("update private.notification_runtime set enabled=false");
  await blocked("production runtime disable blocks invocation immediately");
  await db.exec("update private.notification_runtime set enabled=true,allowed_project_id=null");
  await blocked("production mode also requires allowed project");
  await db.exec("delete from private.notification_runtime");
  await blocked("missing runtime singleton blocks invocation");
  await db.exec(migration.replace(/^create extension if not exists pg_net with schema extensions;\r?\n/m, ""));
  equal(await value("select count(*)::integer value from cron.job where jobname like 'gyungchung-push-%' and not active"), 2, "reapplying schedule SQL keeps only two inactive jobs");
  console.log(`Push scheduler verification: ${checks} assertions passed (HTTP, Vault, and cron are local stubs).`);
} finally {
  await db.close();
}
