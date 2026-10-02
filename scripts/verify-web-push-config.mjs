import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { loadWebPushConfig } from "../supabase/functions/_shared/web-push-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PUSH_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const subject = "https://gyungchung.vercel.app";
const migrationPath = "supabase/migrations/20261002122905_web_push_vapid_configuration.sql";
const workerUrl = "https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker";
const workerCredential = "isolated-http-test-only-" + "x".repeat(40);
let checks = 0;
let currentCheck = "fixture setup";
const equal = (actual, expected, description) => {
  currentCheck = description; assert.deepEqual(actual, expected, description); checks++;
};
async function value(sql, parameters = []) { return (await db.query(sql, parameters)).rows[0]?.value; }
async function rejected(operation, expected, description) {
  currentCheck = description;
  await assert.rejects(operation, expected, description); checks++;
}
function keys() {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  return {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(key.x, "base64url"), Buffer.from(key.y, "base64url")]).toString("base64url"),
    privateKey: key.d,
  };
}
const pair = keys();
const alternativePair = keys();
async function initialize(candidate = pair) {
  return value("select public.initialize_web_push_config($1,$2) value", [candidate.publicKey, candidate.privateKey]);
}
async function config() { return value("select public.get_web_push_config() value"); }
async function invoke(force = false) { return value("select private.invoke_web_notification_worker($1) value", [force]); }
async function calls() { return value("select count(*)::integer value from private_test.requests"); }
async function latest() {
  return (await db.query("select http_status,processed,error_code from private.web_notification_worker_runs order by id desc limit 1")).rows[0];
}
async function response(status = 200, payload = '{"action":"dispatch","processed":0}', fail = false) {
  await db.query("update private_test.response set status=$1,payload=$2,fail=$3", [status, payload, fail]);
}
async function blocked(force, description) {
  const before = await calls(); equal(await invoke(force), null, description);
  equal(await calls(), before, description + " sends no HTTP");
}

try {
  // Vault encryption, HTTP transport and cron are isolated mocks; production migration SQL is unchanged.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema vault; create schema extensions; create schema cron; create schema private_test;
    create table private.web_push_runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false,
      activated_at timestamptz,check(not enabled or activated_at is not null));
    insert into private.web_push_runtime default values;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,decrypted_secret text);
    create view vault.decrypted_secrets as select id,name,decrypted_secret from vault.secrets;
    revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated,service_role;
    create table private_test.vault_failure(enabled boolean); insert into private_test.vault_failure values(false);
    create function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql as $$
    declare secret_id uuid;
    begin
      if exists(select 1 from private_test.vault_failure where enabled) then raise exception 'Synthetic secret failure: %',new_secret; end if;
      insert into vault.secrets(name,decrypted_secret) values(new_name,new_secret) returning id into secret_id; return secret_id;
    end; $$;
    create type extensions.http_header as(field varchar,value varchar);
    create type extensions.http_request as(method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create type extensions.http_response as(status integer,content_type varchar,headers extensions.http_header[],content varchar);
    create table private_test.requests(request extensions.http_request);
    create table private_test.curlopts(name text primary key,value text);
    create table private_test.response(status integer,payload text,fail boolean); insert into private_test.response values(200,'{"action":"dispatch","processed":0}',false);
    create function extensions.http_reset_curlopt() returns boolean language plpgsql as $$ begin delete from private_test.curlopts; return true; end; $$;
    create function extensions.http_set_curlopt(option varchar,value varchar) returns boolean language plpgsql as $$ begin
      if option not in ('CURLOPT_TIMEOUT_MS','CURLOPT_CONNECTTIMEOUT','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST') then raise exception 'Unsupported option'; end if;
      insert into private_test.curlopts values(option,value) on conflict(name) do update set value=excluded.value; return true; end; $$;
    create function extensions.http(request extensions.http_request) returns extensions.http_response language plpgsql as $$
    declare r private_test.response%rowtype;
    begin
      insert into private_test.requests values(request); select * into r from private_test.response;
      if r.fail then raise exception 'Synthetic transport error: %',(request.headers[1]).value; end if;
      return row(r.status,'application/json',null,r.payload)::extensions.http_response;
    end; $$;
    create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean);
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command,active) values($1,$2,$3,true) returning jobid;
    $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
    returns void language sql as $$ update cron.job j set active=coalesce($6,j.active) where j.jobid=$1; $$;
    select cron.schedule('gyungchung-push-dispatch','* * * * *','select private.invoke_notification_worker(''dispatch'')');
    set log_min_messages='warning';
  `);
  const migration = await readFile(path.join(root, migrationPath), "utf8");
  equal(/pg_advisory_xact_lock\s*\(/.test(migration), true, "initialization uses a transaction advisory lock");
  equal(/net\.http_post\s*\(/.test(migration), false, "worker credentials are never enqueued in pg_net");
  equal(/SQLERRM|raise\s+(log|notice|warning)/i.test(migration), false, "migration never logs raw errors or secrets");
  await db.exec(migration);
  equal(await config(), null, "uninitialized server configuration is null");
  equal(await value("select public.get_web_push_public_key() value"), null, "uninitialized public point is null");
  equal(await value("select active value from cron.job where jobname='gyungchung-web-push-dispatch'"), false, "new web cron is disabled");
  equal(await value("select active value from cron.job where jobname='gyungchung-push-dispatch'"), true, "native cron remains untouched");
  equal(await value("select schedule value from cron.job where jobname='gyungchung-web-push-dispatch'"), "* * * * *", "web cron cadence is one minute");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const serverOnly = role === "service_role";
    equal(await value("select has_function_privilege($1,'public.get_web_push_config()','execute') value", [role]), serverOnly, role + " private getter ACL");
    equal(await value("select has_function_privilege($1,'public.initialize_web_push_config(text,text)','execute') value", [role]), serverOnly, role + " initializer ACL");
    equal(await value("select has_function_privilege($1,'public.get_web_push_public_key()','execute') value", [role]), true, role + " public getter ACL");
    equal(await value("select has_function_privilege($1,'private.invoke_web_notification_worker(boolean)','execute') value", [role]), false, role + " cannot invoke privileged cron helper");
    for (const table of ["private.web_push_configuration", "private.web_notification_worker_runs", "vault.decrypted_secrets"]) {
      equal(await value("select has_table_privilege($1,$2,'select') value", [role, table]), false, role + " cannot directly read " + table);
    }
  }
  for (const signature of ["public.get_web_push_config()", "public.initialize_web_push_config(text,text)", "public.get_web_push_public_key()", "private.invoke_web_notification_worker(boolean)"]) {
    equal(await value("select prosecdef and pg_get_userbyid(proowner)='postgres' and proconfig @> array['search_path=\"\"'] value from pg_proc where oid=$1::regprocedure", [signature]), true, "definer search path and ownership: " + signature);
  }
  for (const candidate of [
    { publicKey: null, privateKey: pair.privateKey }, { publicKey: pair.publicKey, privateKey: null },
    { publicKey: "B" + "A".repeat(85), privateKey: pair.privateKey },
    { publicKey: pair.publicKey, privateKey: "A".repeat(43) },
    { publicKey: pair.publicKey + "=", privateKey: pair.privateKey },
    { publicKey: pair.publicKey, privateKey: pair.privateKey + "=" },
  ]) await rejected(() => initialize(candidate), /Invalid web push signing configuration/, "invalid candidate rejected before Vault write");
  await db.exec("update private_test.vault_failure set enabled=true");
  await rejected(() => initialize(), /^error: Web push signing initialization failed$/, "Vault errors are sanitized");
  equal(await value("select count(*)::integer value from private.web_push_configuration"), 0, "failed Vault write leaves no runtime row");
  equal(await value("select count(*)::integer value from vault.secrets"), 0, "failed Vault write leaves no secret");
  await db.exec("update private_test.vault_failure set enabled=false");
  await db.exec("set role service_role");
  const first = await initialize();
  equal(first.public_key === pair.publicKey && first.private_key === pair.privateKey && first.subject === subject, true, "service initializer returns the persisted signing pair");
  const retry = await initialize(alternativePair);
  equal(retry.public_key === first.public_key && retry.private_key === first.private_key, true, "retry keeps the original signing pair");
  await db.exec("reset role");
  const repeated = await Promise.all([initialize(pair), initialize(alternativePair)]);
  equal(repeated.every(result => result.public_key === first.public_key && result.private_key === first.private_key), true, "overlapping client retries use the stored pair");
  equal(await value("select count(*)::integer value from vault.secrets"), 1, "retries never create extra Vault secrets");
  for (const role of ["anon", "authenticated"]) {
    await db.exec("set role " + role);
    equal(await value("select public.get_web_push_public_key()=$1 value", [pair.publicKey]), true, role + " sees only the public point");
    await rejected(() => config(), /permission denied/, role + " cannot read the signing key");
    await rejected(() => initialize(), /permission denied/, role + " cannot initialize the signing key");
    await db.exec("reset role");
  }
  await db.exec("update vault.secrets set decrypted_secret=null");
  await rejected(() => config(), /Web push signing configuration unavailable/, "missing Vault material fails closed");
  await rejected(() => initialize(alternativePair), /Web push signing configuration unavailable/, "missing Vault material cannot trigger key rotation");
  equal(await value("select count(*)::integer value from vault.secrets"), 1, "corrupt configuration never creates replacement material");
  await db.query("update vault.secrets set decrypted_secret=$1", [pair.privateKey]);

  const persisted = { public_key: pair.publicKey, private_key: pair.privateKey, subject };
  let generated = 0;
  const loaderDatabase = { rpc: async name => ({ data: name === "get_web_push_config" ? persisted : null, error: null }) };
  const loaded = await loadWebPushConfig(loaderDatabase, () => { generated++; return alternativePair; });
  equal(loaded.publicKey === pair.publicKey && loaded.privateKey === pair.privateKey && loaded.subject === subject, true, "loader reads existing configuration");
  equal(generated, 0, "existing keys avoid generation");
  let initCalls = 0;
  const racingDatabase = { rpc: async (name, parameters) => {
    if (name === "get_web_push_config") return { data: null, error: null };
    initCalls++;
    equal(parameters.target_public_key === alternativePair.publicKey && parameters.target_private_key === alternativePair.privateKey, true, "loader initializes with its generated candidate");
    return { data: persisted, error: null };
  } };
  const winner = await loadWebPushConfig(racingDatabase, () => alternativePair);
  equal(initCalls, 1, "loader initializes only once");
  equal(winner.publicKey === pair.publicKey && winner.privateKey === pair.privateKey, true, "loader uses the database winner rather than its candidate");
  for (const database of [
    { rpc: async () => ({ data: null, error: { message: pair.privateKey } }) },
    { rpc: async () => { throw new Error(pair.privateKey); } },
    { rpc: async () => ({ data: { ...persisted, subject: "https://localhost" }, error: null }) },
    { rpc: async name => ({ data: name === "get_web_push_config" ? null : persisted, error: name === "get_web_push_config" ? null : pair.privateKey }) },
  ]) await rejected(() => loadWebPushConfig(database, () => alternativePair), /^Error: Web push signing configuration unavailable$/, "loader strips all raw upstream errors");
  await rejected(() => loadWebPushConfig({ rpc: async () => ({ data: null, error: null }) }, () => { throw new Error(pair.privateKey); }), /^Error: Web push signing configuration unavailable$/, "generator errors cannot reveal key material");

  await db.query("insert into vault.secrets(name,decrypted_secret) values('gyungchung-push-worker-url',$1),('gyungchung-push-worker-secret',$2)", [workerUrl, workerCredential]);
  await blocked(false, "disabled runtime blocks normal cron calls");
  equal(await invoke(true), 200, "postgres bootstrap can call the disabled worker");
  equal(await latest(), { http_status: 200, processed: 0, error_code: null }, "bootstrap stores zero processed metadata");
  equal(await value("select ((request).uri)='https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/web-push-worker' value from private_test.requests limit 1"), true, "native Vault URL resolves to the fixed web endpoint");
  equal(await value("select ((request).headers[1]).field='Authorization' and ((request).headers[1]).value=$1 value from private_test.requests limit 1", ["Bearer " + workerCredential]), true, "existing worker credential is sent only in Authorization");
  equal(await value("select (request).content::jsonb='{" + '"action":"dispatch"' + "}'::jsonb value from private_test.requests limit 1"), true, "worker body contains only the dispatch action");
  await response(200, '{"action":"dispatch","processed":1}'); await invoke(true);
  equal(await latest(), { http_status: 200, processed: null, error_code: "bad_response" }, "bootstrap cannot report deliveries");
  await response();
  await db.exec("update private.web_push_runtime set enabled=true,activated_at=now()");
  await blocked(true, "bootstrap refuses an already enabled runtime");
  equal(await invoke(), 200, "activated runtime permits normal cron");
  for (const logLevel of ["debug1", "debug2", "debug3", "debug4", "debug5"]) {
    await db.exec("set log_min_messages='" + logLevel + "'"); await blocked(false, "debug logging blocks credential handling");
  }
  await db.exec("set log_min_messages='warning'");
  for (const endpoint of [null, workerUrl + "/", workerUrl + "?redirect=1", workerUrl.replace("https:", "http:"), "https://other.supabase.co/functions/v1/push-worker"]) {
    await db.query("update vault.secrets set decrypted_secret=$1 where name='gyungchung-push-worker-url'", [endpoint]);
    await blocked(false, "invalid Vault URL prevents authentication transmission");
  }
  await db.query("update vault.secrets set decrypted_secret=$1 where name='gyungchung-push-worker-url'", [workerUrl]);
  for (const credential of [null, "", "x".repeat(31), workerCredential + "\r", workerCredential + "\n"]) {
    await db.query("update vault.secrets set decrypted_secret=$1 where name='gyungchung-push-worker-secret'", [credential]);
    await blocked(false, "invalid worker credential fails closed");
  }
  await db.query("update vault.secrets set decrypted_secret=$1 where name='gyungchung-push-worker-secret'", [workerCredential]);
  for (const payload of ["null", "[]", "invalid JSON", "{}", '{"action":"other","processed":0}', '{"action":"dispatch","processed":101}', '{"action":"dispatch","processed":"0"}']) {
    await response(200, payload); await invoke();
    equal(await latest(), { http_status: 200, processed: null, error_code: "bad_response" }, "invalid worker body persists a fixed error code only");
  }
  for (const status of [302, 401, 503]) {
    await response(status, JSON.stringify({ action: "dispatch", processed: 0, secret: workerCredential })); await invoke();
    equal(await latest(), { http_status: status, processed: null, error_code: "bad_response" }, "unsuccessful HTTP never stores the response body");
  }
  await response(200, "ignored", true); await invoke();
  equal(await latest(), { http_status: null, processed: null, error_code: "http_failed" }, "transport errors cannot echo authentication");
  equal(await value("select exists(select 1 from private.web_notification_worker_runs r where to_jsonb(r)::text like '%'||$1||'%') value", [workerCredential]), false, "run metadata never contains credentials");
  await response();
  await db.exec("insert into private.web_notification_worker_runs(started_at,finished_at,http_status,processed) values(now()-interval '15 days',now()-interval '15 days',200,0)");
  await invoke();
  equal(await value("select count(*)::integer value from private.web_notification_worker_runs where started_at<now()-interval '14 days'"), 0, "run metadata retention is fourteen days");
  equal((await db.query("select name,value from private_test.curlopts order by name")).rows, [
    { name: "CURLOPT_CONNECTTIMEOUT", value: "5" }, { name: "CURLOPT_SSL_VERIFYHOST", value: "2" },
    { name: "CURLOPT_SSL_VERIFYPEER", value: "1" }, { name: "CURLOPT_TIMEOUT_MS", value: "60000" },
  ], "HTTP uses supported TLS and timeout settings");
  console.log(`Web push configuration verification: ${checks} assertions passed (Vault, HTTP and cron are isolated mocks; contention and transport are not cloud tests).`);
} catch {
  // Never print generated fixture keys or raw SQL/HTTP exception details on failure.
  console.error("Web push configuration verification failed at: " + currentCheck);
  process.exitCode = 1;
} finally {
  await db.close();
}
