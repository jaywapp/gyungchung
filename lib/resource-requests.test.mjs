import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(name, imports = {}) {
  const source = readFileSync(new URL(name, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("exports", "require", output.outputText)(exports, (name) => imports[name]);
  return exports;
}
const { ResourceRequests } = compile("./resource-requests.ts");
const loadState = compile("./load-state.ts");
const { getReloadResources, editorScopes, tableScopes } = compile("./ui-feedback.ts", { "./load-state": loadState });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const ok = (data) => ({ data, error: null });

test("shares only reads that are still in progress for the same owner and resource", async () => {
  const requests = new ResourceRequests();
  const gate = deferred();
  let calls = 0;
  const query = () => { calls++; return gate.promise; };
  const first = requests.load("fees", "member", query);
  const second = requests.load("fees", "member", query);
  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);
  gate.resolve(ok(["current"]));
  assert.equal((await first).isCurrent(), true);
  await requests.load("fees", "member", () => { calls++; return Promise.resolve(ok(["next"])); });
  assert.equal(calls, 2, "completed reads must not become a stale response cache");
});

test("a completed save cancels a pre-save read and concurrent invalidations share the fresh follow-up", async () => {
  const requests = new ResourceRequests();
  const old = deferred();
  const fresh = deferred();
  let signal;
  let calls = 0;
  const first = requests.load("attendance", "member", (value) => { signal = value; calls++; return old.promise; });
  await tick();
  const saved = requests.load("attendance", "member", () => { calls++; return fresh.promise; }, true);
  const secondSave = requests.load("attendance", "member", () => { calls++; return fresh.promise; }, true);
  assert.equal(signal.aborted, true);
  assert.equal(first, saved);
  assert.equal(saved, secondSave);
  // Model a transport that still completes after cancellation: its payload must be discarded.
  old.resolve(ok(["before save"]));
  await tick();
  assert.equal(calls, 2);
  fresh.resolve(ok(["after saves"]));
  const result = await first;
  assert.deepEqual(result.data, ["after saves"]);
  assert.equal(result.isCurrent(), true);
});

test("resource versions preserve unrelated results and reject a response superseded before batch application", async () => {
  const requests = new ResourceRequests();
  const fees = await requests.load("fees", "member", () => Promise.resolve(ok(["old fees"])));
  const attendance = await requests.load("attendance", "member", () => Promise.resolve(ok(["attendance"])));
  const fresh = deferred();
  const changed = requests.load("fees", "member", () => fresh.promise, true);
  assert.equal(fees.isCurrent(), false);
  assert.equal(attendance.isCurrent(), true);
  fresh.resolve(ok(["fresh fees"]));
  assert.equal((await changed).isCurrent(), true);
});

test("reset aborts old owners and a late identity response never becomes current", async () => {
  const requests = new ResourceRequests();
  const gate = deferred();
  let signal;
  const old = requests.load("profiles", "first-user", (value) => { signal = value; return gate.promise; });
  await tick();
  requests.reset();
  assert.equal(signal.aborted, true);
  const current = await requests.load("profiles", "second-user", () => Promise.resolve(ok(["second profile"])));
  gate.resolve(ok(["first profile"]));
  assert.equal((await old).isCurrent(), false);
  assert.equal(current.isCurrent(), true);
  requests.reset();
  assert.equal(current.isCurrent(), false, "unmount invalidates even already-completed results");
});

test("partial query failures stay attached to their resource and explicit retry issues a new read", async () => {
  const requests = new ResourceRequests();
  const failure = new Error("injected failure");
  const [fees, attendance] = await Promise.all([
    requests.load("fees", "member", () => Promise.reject(failure)),
    requests.load("attendance", "member", () => Promise.resolve(ok(["saved attendance"]))),
  ]);
  assert.equal(fees.error, failure);
  assert.equal(fees.isCurrent(), true);
  assert.equal(attendance.error, null);
  const errors = loadState.getLoadErrors({ fees, attendance });
  assert.deepEqual(errors, { fees: true, attendance: false });
  const retry = await requests.load("fees", "member", () => Promise.resolve(ok(["recovered"])), true);
  assert.equal(retry.error, null);
  assert.equal(fees.isCurrent(), false);
});

test("optimistic writes invalidate late background reads without invalidating unrelated resources", async () => {
  const requests = new ResourceRequests();
  const attendance = await requests.load("attendance", "member", () => Promise.resolve(ok(["before RSVP"])));
  const fees = await requests.load("fees", "member", () => Promise.resolve(ok(["fees"])));
  requests.invalidate("attendance");
  assert.equal(attendance.isCurrent(), false);
  assert.equal(fees.isCurrent(), true);
  const late = deferred();
  const readDuringWrite = requests.load("attendance", "member", () => late.promise);
  await tick();
  requests.invalidate("attendance");
  late.resolve(ok(["server before RSVP commit"]));
  assert.equal((await readDuringWrite).isCurrent(), false);
});

test("mutation resources include trigger and cascade dependencies while identity changes preserve full loading", () => {
  assert.equal(getReloadResources("all").length, 18);
  assert.equal(getReloadResources("public").length, 4);
  assert.equal(getReloadResources("member").length, 14);
  assert.deepEqual(getReloadResources(["fees", "fees", "attendance"]), ["fees", "attendance"]);
  assert.equal(getReloadResources(editorScopes.members).length, 18);
  assert.equal(getReloadResources(tableScopes.events).length, 18);
  assert.deepEqual(getReloadResources(tableScopes.venues), ["venues", "events"]);
  for (const key of ["events", "venues", "guestFees"]) assert.ok(getReloadResources(editorScopes.events).includes(key));
  for (const key of ["feedback", "feedbackFeed"]) assert.ok(getReloadResources(editorScopes.feedback).includes(key));
  for (const key of ["forms", "submissions"]) assert.ok(getReloadResources(tableScopes.participation_forms).includes(key));
  assert.deepEqual(getReloadResources(editorScopes.attendance), ["attendance"]);
  assert.deepEqual(getReloadResources(editorScopes.teams), ["events"]);
});

test("attendance invalidation follows the current migration writes and MOM result dependencies", () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const definitions = new Map();
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(name, directory), "utf8");
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.\w+)\s*\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$/gi)) definitions.set(match[1].toLowerCase(), match[2]);
  }
  const attendanceWrites = ["public.protect_attendance_check_in", "public.save_attendance_batch", "private.capture_attendance_notification"].map((name) => {
    assert.ok(definitions.has(name), `migration function missing: ${name}`);
    return definitions.get(name);
  }).join("\n");
  assert.doesNotMatch(attendanceWrites, /(?:insert\s+into|update|delete\s+from)\s+public\.(?:fees|event_mom_votes)\b/i);
  assert.match(attendanceWrites, /(?:insert\s+into|update)\s+public\.attendance\b/i);
  const momResults = definitions.get("private.get_event_mom_results_data");
  assert.ok(momResults);
  assert.match(momResults, /public\.event_mom_votes/);
  assert.match(momResults, /public\.profiles/);
  assert.doesNotMatch(momResults, /public\.attendance/);
});
