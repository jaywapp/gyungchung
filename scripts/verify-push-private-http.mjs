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
const workerSecret = "private-http-fixture-only-" + "x".repeat(40);
const project = "b0000000-0000-0000-0000-000000000401";
const account = "b0000000-0000-0000-0000-000000000001";
let checks = 0;
async function value(sql, args = []) { return (await db.query(sql, args)).rows[0]?.value; }
function equal(actual, expected, description) { assert.deepEqual(actual, expected, description); checks++; }
async function invoke(action = "dispatch") { return value("select private.invoke_notification_worker($1) value", [action]); }
async function calls() { return value("select case when is_called then last_value else 0 end value from private_test.http_call_count"); }
async function logs() { return value("select count(*)::integer value from private.notification_worker_runs"); }
async function latest() { return (await db.query("select action,http_status,processed,error_code from private.notification_worker_runs order by id desc limit 1")).rows[0]; }
async function secret(name, content) {
  await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values($1,$2) on conflict(name) do update set decrypted_secret=excluded.decrypted_secret", [name, content]);
}
async function blocked(description) {
  const before = { calls: await calls(), logs: await logs() };
  equal(await invoke(), null, description);
  equal({ calls: await calls(), logs: await logs() }, before, description + " sends no HTTP and records no execution");
}
async function response(status = 200, payload = '{"action":"dispatch","processed":0}', fail = false) {
  await db.query("update private_test.response set status=$1,payload=$2,fail=$3", [status, payload, fail]);
}
try {
  // HTTP and cron are local stubs; the real base, scheduler and corrective migration SQL execute.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role extension_public_user;
    create schema private;
    create schema vault;
    create schema net;
    create schema cron;
    create schema extensions;
    create schema private_test;
    create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
    create table net.http_request_queue(id bigserial primary key,headers jsonb);
    create table net._http_response(id bigint,content text);
    create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
    returns bigint language plpgsql as $$ begin raise exception 'Async HTTP must never be used'; end; $$;
    create type extensions.http_header as(field varchar,value varchar);
    create type extensions.http_request as(method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create type extensions.http_response as(status integer,content_type varchar,headers extensions.http_header[],content varchar);
    create table private_test.curlopts(name text primary key,value text);
    create sequence private_test.http_call_count;
    create table private_test.requests(id bigint,request extensions.http_request,timeout_msec text,client_messages text);
    create table private_test.response(status integer,payload text,fail boolean);
    insert into private_test.response values(200,'{"action":"dispatch","processed":0}',false);
    create function extensions.http_reset_curlopt() returns boolean language plpgsql as $$
    begin delete from private_test.curlopts; return true; end; $$;
    create function extensions.http_set_curlopt(curlopt varchar,value varchar) returns boolean language plpgsql as $$
    begin
      if curlopt not in ('CURLOPT_TIMEOUT_MS','CURLOPT_CONNECTTIMEOUT','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST') then raise exception 'Unsupported http 1.6 curl option'; end if;
      insert into private_test.curlopts values(curlopt,value) on conflict(name) do update set value=excluded.value;
      return true;
    end; $$;
    create function extensions.http(request extensions.http_request) returns extensions.http_response language plpgsql as $$
    declare r private_test.response%rowtype; call_id bigint;
    begin
      call_id:=nextval('private_test.http_call_count');
      insert into private_test.requests values(call_id,request,current_setting('http.timeout_msec'),current_setting('client_min_messages'));
      select * into r from private_test.response;
      if r.fail then raise exception 'Synthetic transport failure contains fixture header: %',(request.headers[1]).value; end if;
      return row(r.status,'application/json',null,r.payload)::extensions.http_response;
    end; $$;
    create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,username text,active boolean);
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command,username,active) values($1,$2,$3,current_user,true)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
    $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
    returns void language sql as $$ update cron.job j set active=coalesce($6,j.active) where j.jobid=$1; $$;
    select cron.schedule('gyungchung-weekly-events','5 0 * * *','select private.ensure_weekly_events()');
    set log_min_messages='warning';
  `);
  const base = await read("supabase/migrations/20261001114159_push_notifications.sql");
  await db.exec(base.match(/create table private\.notification_runtime \([\s\S]*?insert into private\.notification_runtime default values;/)[0]);
  const rollout = await read("supabase/migrations/20261001231341_push_production_rollout.sql");
  await db.exec(rollout.match(/alter table private\.notification_runtime[\s\S]*?;/)[0]);
  const scheduler = await read("supabase/migrations/20261001231617_push_worker_schedules.sql");
  await db.exec(scheduler.replace(/^create extension if not exists pg_net with schema extensions;\r?\n/m, ""));
  // Reproduce the deployed pg_net PUBLIC access that managed Postgres cannot revoke.
  await db.exec("grant usage on schema net to public; grant all on all tables in schema net to public; grant all on all sequences in schema net to public");
  const previousJobs = (await db.query("select jobname,schedule,command,username from cron.job order by jobname")).rows;
  const migration = await read("supabase/migrations/20261001232748_push_worker_private_http.sql");
  equal(/net\.http_post\s*\(/.test(migration), false, "corrective helper never queues async requests");
  equal(/SQLERRM|raise\s+(log|notice|warning)/i.test(migration), false, "corrective migration has no raw error or payload logging");
  await db.exec(migration.replace(/^create extension if not exists http with schema extensions;\r?\n/m, ""));
  equal((await db.query("select jobname,schedule,command,username from cron.job order by jobname")).rows, previousJobs, "existing cron cadence and commands are unchanged");
  equal(await value("select bool_and(not active) value from cron.job where jobname like 'gyungchung-push-%'"), true, "push jobs remain inactive");
  equal(await value("select active value from cron.job where jobname='gyungchung-weekly-events'"), true, "weekly cron remains active");
  equal(await value("select relrowsecurity value from pg_class where oid='private.notification_worker_runs'::regclass"), true, "run metadata uses RLS");
  equal((await db.query("select attname from pg_attribute where attrelid='private.notification_worker_runs'::regclass and attnum>0 and not attisdropped order by attnum")).rows.map(row => row.attname),
    ["id", "action", "started_at", "finished_at", "http_status", "processed", "error_code"], "run metadata has no body, header or raw error columns");
  equal((await db.query("select prosecdef,pg_get_userbyid(proowner) owner,proconfig from pg_proc where oid='private.invoke_notification_worker(text)'::regprocedure")).rows[0],
    { prosecdef: true, owner: "postgres", proconfig: ['search_path=""', 'client_min_messages=warning', 'http.timeout_msec=60000'] }, "helper fixes ownership, search path, messages and timeout");
  for (const role of ["anon", "authenticated", "service_role", "extension_public_user"]) {
    equal(await value("select has_table_privilege($1,'net.http_request_queue','select') value", [role]), true, "existing public pg_net ACL is reproduced");
    equal(await value("select has_function_privilege($1,'private.invoke_notification_worker(text)','execute') value", [role]), false, role + " cannot invoke privileged helper");
    for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      equal(await value("select has_table_privilege($1,'private.notification_worker_runs',$2) value", [role, permission]), false, role + " has no run metadata " + permission);
    }
    for (const permission of ["USAGE", "SELECT", "UPDATE"]) {
      equal(await value("select has_sequence_privilege($1,'private.notification_worker_runs_id_seq',$2) value", [role, permission]), false, role + " has no run sequence " + permission);
    }
    await db.exec("grant usage on schema private to " + role);
    await db.exec("set role " + role);
    for (const sql of ["select * from private.notification_worker_runs", "update private.notification_worker_runs set error_code='http_failed'", "insert into private.notification_worker_runs(action) values('dispatch')", "delete from private.notification_worker_runs", "select nextval('private.notification_worker_runs_id_seq')", "select private.invoke_notification_worker('dispatch')"]) {
      await assert.rejects(() => db.exec(sql), /permission denied/, role + " cannot access privileged worker internals"); checks++;
    }
    await db.exec("reset role");
  }
  for (const action of [null, "", "other", "Dispatch"]) {
    await assert.rejects(() => invoke(action), /Invalid notification worker action/); checks++;
  }
  await secret("gyungchung-push-worker-url", workerUrl);
  await secret("gyungchung-push-worker-secret", workerSecret);
  await blocked("disabled runtime blocks all HTTP");
  await db.exec("update private.notification_runtime set enabled=true");
  await blocked("missing project blocks all HTTP");
  await db.query("update private.notification_runtime set allowed_project_id=$1", [project]);
  await blocked("test mode requires an allowlist");
  await db.query("update private.notification_runtime set test_auth_user_ids=array[$1::uuid]", [account]);
  for (const logLevel of ["debug1", "debug2", "debug3", "debug4", "debug5"]) {
    await db.exec("set log_min_messages='" + logLevel + "'");
    await blocked("debug logging blocks credential handling");
  }
  await db.exec("set log_min_messages='warning'");
  for (const endpoint of [null, "", workerUrl + "/", workerUrl + "?redirect=1", "https://other.supabase.co/functions/v1/push-worker", workerUrl.replace("https:", "http:")]) {
    await secret("gyungchung-push-worker-url", endpoint); await blocked("invalid endpoint fails closed");
  }
  await db.exec("delete from vault.decrypted_secrets where name='gyungchung-push-worker-url'");
  await blocked("missing endpoint fails closed");
  await secret("gyungchung-push-worker-url", workerUrl);
  for (const credential of [null, "", "x".repeat(31), " ".repeat(32), workerSecret + "\n", workerSecret + "\r"]) {
    await secret("gyungchung-push-worker-secret", credential); await blocked("invalid credential fails closed");
  }
  await db.exec("delete from vault.decrypted_secrets where name='gyungchung-push-worker-secret'");
  await blocked("missing credential fails closed");
  await secret("gyungchung-push-worker-secret", workerSecret);
  await db.exec("insert into private_test.curlopts values('inherited_proxy','untrusted'); set http.timeout_msec='10'; set client_min_messages='debug2'");
  equal(await invoke(), 200, "valid test configuration returns HTTP status");
  equal(await latest(), { action: "dispatch", http_status: 200, processed: 0, error_code: null }, "valid response stores metadata only");
  const captured = (await db.query("select (request).*,timeout_msec,client_messages from private_test.requests order by id desc limit 1")).rows[0];
  equal(captured.method, "POST", "worker uses POST"); equal(captured.uri, workerUrl, "worker uses fixed HTTPS endpoint");
  equal(captured.content_type, "application/json", "worker sends JSON"); equal(JSON.parse(captured.content), { action: "dispatch" }, "request sends only action");
  equal(await value("select ((request).headers[1]).field value from private_test.requests order by id desc limit 1"), "Authorization", "worker uses standard auth header");
  equal(await value("select ((request).headers[1]).value=$1 value from private_test.requests order by id desc limit 1", ["Bearer " + workerSecret]), true, "worker sends authentication only at call time");
  equal(await value("select cardinality((request).headers) value from private_test.requests order by id desc limit 1"), 1, "custom auth header is absent");
  equal(captured.timeout_msec, "60000", "function timeout overrides caller session"); equal(captured.client_messages, "warning", "function suppresses client debug headers");
  equal(await value("select current_setting('http.timeout_msec') value"), "10", "function restores caller timeout");
  equal((await db.query("select name,value from private_test.curlopts order by name")).rows, [
    { name: "CURLOPT_CONNECTTIMEOUT", value: "5" }, { name: "CURLOPT_SSL_VERIFYHOST", value: "2" },
    { name: "CURLOPT_SSL_VERIFYPEER", value: "1" }, { name: "CURLOPT_TIMEOUT_MS", value: "60000" },
  ], "HTTP resets inherited options and enforces supported timeout and TLS settings");
  await response(200, '{"action":"receipts","processed":100}');
  equal(await invoke("receipts"), 200, "receipt action is supported"); equal((await latest()).processed, 100, "bounded receipt count is accepted");
  for (const payload of [null, "", "invalid JSON", "null", "[]", "{}", '{"action":"receipts","processed":0}', '{"action":"dispatch","processed":"1"}', '{"action":"dispatch","processed":-1}', '{"action":"dispatch","processed":1.5}', '{"action":"dispatch","processed":101}', '{"action":"dispatch","processed":100000000000000000000}', '{"action":"dispatch","processed":null}']) {
    await response(200, payload); const before = await calls();
    equal(await invoke(), 200, "bad worker response returns HTTP status only");
    equal(await latest(), { action: "dispatch", http_status: 200, processed: null, error_code: "bad_response" }, "invalid response stores fixed failure only");
    equal(await calls(), before + 1, "invalid response is never retried immediately");
  }
  for (const status of [302, 401, 503]) {
    await response(status, JSON.stringify({ action: "dispatch", processed: 1, sensitive: workerSecret }));
    equal(await invoke(), status, "unsuccessful status is returned without response content");
    equal(await latest(), { action: "dispatch", http_status: status, processed: null, error_code: "bad_response" }, "unsuccessful status cannot record success");
  }
  await response(200, "ignored", true); const beforeFailure = await calls();
  equal(await invoke(), null, "transport error is sanitized");
  equal(await latest(), { action: "dispatch", http_status: null, processed: null, error_code: "http_failed" }, "transport failure cannot persist exception text");
  equal(await calls(), beforeFailure + 1, "transport failure is never immediately retried");
  equal(await value("select exists(select 1 from private.notification_worker_runs r where to_jsonb(r)::text like '%'||$1||'%') value", [workerSecret]), false, "metadata never contains credentials or echoed error text");
  await response();
  await db.exec("alter table private.notification_runtime drop constraint production_activation_required; update private.notification_runtime set delivery_mode='production',production_activated_at=null,test_auth_user_ids='{}'");
  await blocked("incomplete production configuration fails closed");
  await db.exec("update private.notification_runtime set production_activated_at=now(); alter table private.notification_runtime add constraint production_activation_required check(delivery_mode<>'production' or production_activated_at is not null)");
  equal(await invoke(), 200, "activated production runs without allowlist");
  await db.exec("insert into private.notification_worker_runs(action,started_at,finished_at,http_status,processed) values('dispatch',now()-interval '15 days',now()-interval '15 days',200,0)");
  await invoke(); equal(await value("select count(*)::integer value from private.notification_worker_runs where started_at<now()-interval '14 days'"), 0, "old metadata is removed after 14 days");
  await db.exec("update private.notification_runtime set enabled=false"); await blocked("runtime disable immediately stops HTTP");
  await db.exec("delete from private.notification_runtime"); await blocked("missing singleton fails closed");
  equal(await value("select count(*)::integer value from net.http_request_queue"), 0, "no worker credentials ever enter public pg_net queue");
  console.log(`Private HTTP scheduler verification: ${checks} assertions passed (HTTP and cron are local stubs).`);
} finally {
  await db.close();
}
