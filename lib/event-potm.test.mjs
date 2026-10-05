import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const trees = new Map();
function tree(path) {
  if (!trees.has(path)) trees.set(path, ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return trees.get(path);
}
function compile(source, dependencies = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function("require", ...Object.keys(dependencies), `${code}`)(require, ...Object.values(dependencies));
}
function moduleExports(path) {
  const exports = {};
  compile(readFileSync(new URL(path, import.meta.url), "utf8"), { exports });
  return exports;
}
const mom = moduleExports("./mom-vote.ts");
const attendanceHelpers = moduleExports("./attendance.ts");
const permissions = moduleExports("./permission-access.ts");
const capacityHelpers = moduleExports("./event-capacity.ts");
const dateHelpers = moduleExports("./event-date.ts");
function actualCallback(path, component, name, dependencies) {
  const sourceTree = tree(path);
  const owner = sourceTree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let expression;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(sourceTree) === name) expression = node.initializer; ts.forEachChild(node, visit); };
  visit(owner);
  assert.ok(expression, `${component}.${name} must exercise production code`);
  if (ts.isCallExpression(expression)) expression = expression.arguments[0];
  const code = ts.transpileModule(`const callback = ${expression.getText(sourceTree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return callback;`)(...Object.values(dependencies));
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const openTime = Date.parse("2026-10-04T10:00:00+09:00");
const closeTime = openTime + 72 * 3600000;
const event = { id: "synthetic-event", title: "합성 경기", starts_at: "2026-10-04T08:00:00+09:00", ends_at: null, mom_voting_days: 3, venue: "합성 구장", capacity: 18 };
const actor = { id: "synthetic-voter", auth_user_id: "owner-A", name: "합성 투표자", status: "active", must_change_password: false, is_test_account: false, role: "member", officer_title: null, is_system_admin: false };
const candidate = { id: "synthetic-candidate", name: "합성 후보", status: "active", is_test_account: false, position: "MF" };
function clock(value) {
  const state = { value };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.value])); } static now() { return state.value; } }
  return { Date: Clock, state };
}
function voteFixture({ verificationGate = null, writeGate = null, error = null, lostResponse = false, refreshFails = false } = {}) {
  const calls = [], time = clock(openTime + 1000);
  const scope = mom.getMomVoteScope("owner-A", actor, [], 1);
  const deps = { ...mom, ...attendanceHelpers, Date: time.Date, momScope: scope, votingEventId: event.id, scopeRef: { current: { value: scope, generation: 0 } }, modalScopeRef: { current: { value: scope, generation: 0 } }, mountedRef: { current: true }, submittingMomVoteRef: { current: null },
    latestRef: { current: { events: [event], profiles: [actor, candidate], attendance: [actor, candidate].map((p) => ({ event_id: event.id, member_id: p.id, check_in_status: "present", status: "going" })), user: { id: "owner-A" }, profile: actor, loading: false, loadError: false, sessionPending: false, isMomCurrent: () => true } },
    verifyMomAccess: async () => { calls.push(["verify"]); if (verificationGate) await verificationGate.promise; return true; },
    supabase: { from: (table) => ({ upsert: async (payload, options) => { calls.push(["write", table, payload, options]); if (writeGate) await writeGate.promise; if (lostResponse) { calls.push(["server-committed", payload]); throw new Error("synthetic response loss"); } return { error }; } }) },
    setSubmittingMomCandidateId: (id) => calls.push(["pending", id]), setVotingEventId: (id) => calls.push(["modal", id]), setNow: (value) => calls.push(["clock", value]), toast: (...args) => calls.push(["toast", ...args]), onRetry: () => calls.push(["retry"]), reload: async () => { calls.push(["reload"]); if (refreshFails) throw new Error("synthetic read error"); } };
  return { deps, calls, time, submit: (id = candidate.id) => actualCallback("../components/event-detail.tsx", "EventDetail", "submitMomVote", deps)(id) };
}

test("actual vote callback verifies fresh access then upserts one changeable own vote and refreshes", async () => {
  const f = voteFixture(); await f.submit();
  assert.deepEqual(f.calls.find(([key]) => key === "write"), ["write", "event_mom_votes", { event_id: event.id, voter_id: actor.id, candidate_profile_id: candidate.id }, { onConflict: "event_id,voter_id" }]);
  assert.ok(f.calls.findIndex(([key]) => key === "verify") < f.calls.findIndex(([key]) => key === "write"));
  assert.deepEqual(f.calls.find(([key]) => key === "modal"), ["modal", null]);
  assert.ok(f.calls.some(([key, text]) => key === "toast" && text.includes("저장했습니다")));
  assert.equal(f.calls.filter(([key]) => key === "reload").length, 1);
  assert.equal(f.deps.submittingMomVoteRef.current, null);
});

test("actual callback blocks a duplicate click during pending verification", async () => {
  const gate = deferred(), f = voteFixture({ verificationGate: gate });
  const first = f.submit(); await f.submit(); assert.equal(f.calls.filter(([key]) => key === "verify").length, 1);
  gate.resolve(); await first; assert.equal(f.calls.filter(([key]) => key === "write").length, 1);
});

test("actual callback uses latest event and exact deadline after pending verification", async () => {
  for (const mutate of [(f) => { f.time.state.value = closeTime; }, (f) => { f.deps.latestRef.current.events = [{ ...event, mom_voting_days: 1 }]; f.time.state.value = openTime + 25 * 3600000; }, (f) => { f.deps.latestRef.current.events = []; }, (f) => { f.deps.latestRef.current.events = [{ id: event.id, starts_at: event.starts_at }]; }]) {
    const gate = deferred(), f = voteFixture({ verificationGate: gate }); const pending = f.submit(); mutate(f); gate.resolve(); await pending;
    assert.equal(f.calls.some(([key]) => key === "write"), false); assert.ok(f.calls.some(([key]) => key === "retry"));
  }
});

test("actual callback rejects changed actor, attendance and candidate state before writing", async () => {
  const mutations = [
    (f) => { f.deps.latestRef.current.profile = { ...actor, status: "inactive" }; },
    (f) => { f.deps.latestRef.current.profile = { ...actor, must_change_password: true }; },
    (f) => { f.deps.latestRef.current.profile = { ...actor, is_test_account: true }; },
    (f) => { f.deps.latestRef.current.profile = { ...actor, auth_user_id: "owner-B" }; },
    (f) => { f.deps.latestRef.current.attendance = []; },
    (f) => { f.deps.latestRef.current.profiles = [actor, { ...candidate, status: "inactive" }]; },
    (f) => { f.deps.latestRef.current.profiles = [actor, { ...candidate, is_test_account: true }]; },
    (f) => { f.deps.latestRef.current.sessionPending = true; },
  ];
  for (const mutate of mutations) {
    const gate = deferred(), f = voteFixture({ verificationGate: gate }); const pending = f.submit(); mutate(f); gate.resolve(); await pending;
    assert.equal(f.calls.some(([key]) => key === "write"), false);
  }
  const f = voteFixture(); await f.submit(actor.id); assert.equal(f.calls.some(([key]) => key === "write"), false);
});

test("late logout, auth ABA, permission scope ABA and unmount suppress writes and notices", async () => {
  for (const mutate of [(f) => { f.deps.latestRef.current.isMomCurrent = () => false; }, (f) => { f.deps.scopeRef.current.generation += 2; }, (f) => { f.deps.scopeRef.current.value = mom.getMomVoteScope("owner-A", actor, ["events.manage"], 3); }, (f) => { f.deps.mountedRef.current = false; }]) {
    const gate = deferred(), f = voteFixture({ verificationGate: gate }); const pending = f.submit(); mutate(f); gate.resolve(); await pending;
    assert.equal(f.calls.some(([key]) => ["write", "toast", "retry", "reload"].includes(key)), false);
  }
});

test("actual parent POTM scope detects owner epoch ABA, relink and changed role or capabilities", async () => {
  const momScope = mom.getMomVoteScope("owner-A", actor, [], 1);
  for (const mutate of [
    (deps) => { deps.userRef.current = null; },
    (deps) => { deps.requestsRef.current.epoch = 3; },
    (deps) => { deps.accessRef.current.profile = { ...actor, id: "relinked-profile" }; },
    (deps) => { deps.accessRef.current.profile = { ...actor, role: "manager", officer_title: "treasurer" }; },
    (deps) => { deps.accessRef.current.permissions = new Set(["events.manage"]); },
    (deps) => { deps.accessRef.current.profile = { ...actor, must_change_password: true }; },
  ]) {
    const deps = { ...mom, momScope, userRef: { current: { id: "owner-A" } }, requestsRef: { current: { epoch: 1 } }, accessRef: { current: { profile: actor, permissions: new Set() } } };
    deps.isMomCurrent = actualCallback("../components/clubhouse.tsx", "Clubhouse", "isMomCurrent", deps);
    assert.equal(deps.isMomCurrent(), true);
    deps.verifyAccess = async () => { mutate(deps); return { isCurrent: () => true }; };
    assert.equal(await actualCallback("../components/clubhouse.tsx", "Clubhouse", "verifyMomAccess", deps)(), false);
  }
});

test("late completed write after account change cannot notify or close another owner's modal", async () => {
  const gate = deferred(), f = voteFixture({ writeGate: gate }); const pending = f.submit();
  await Promise.resolve(); await Promise.resolve();
  f.deps.latestRef.current.isMomCurrent = () => false; gate.resolve(); await pending;
  assert.equal(f.calls.filter(([key]) => key === "write").length, 1);
  assert.equal(f.calls.some(([key]) => ["toast", "retry", "reload", "modal"].includes(key)), false);
});

test("explicit server deadline and permission refusals offer reread without success", async () => {
  for (const error of [{ code: "40001", message: "Event lock contention" }, { code: "42501", message: "Permission denied" }, { code: "23514", message: "MOM voting closed" }]) {
    const f = voteFixture({ error }); await f.submit();
    assert.ok(f.calls.some(([key]) => key === "retry"));
    assert.equal(f.calls.some(([key, text]) => key === "toast" && text.includes("저장했습니다")), false);
    assert.ok(f.calls.some(([key, text]) => key === "toast" && /다시 불러온/.test(text)));
  }
});

test("server-committed response loss reports unknown outcome and rereads current selection", async () => {
  const f = voteFixture({ lostResponse: true }); await f.submit();
  assert.ok(f.calls.some(([key]) => key === "server-committed"));
  const messages = f.calls.filter(([key]) => key === "toast").map(([, text]) => text).join(" ");
  assert.match(messages, /저장 결과를 확인하지 못했습니다.*현재 선택/); assert.doesNotMatch(messages, /저장되지|저장 실패/);
  assert.ok(f.calls.some(([key]) => key === "retry"));
});

test("statement completion unknown and unrecognized server codes never claim definite write failure", async () => {
  for (const code of ["40003", "CUSTOM_UNKNOWN", "08006", "PGRST000"]) {
    const f = voteFixture({ error: { code, message: "Synthetic unknown completion" } }); await f.submit();
    const message = f.calls.filter(([key]) => key === "toast").map(([, text]) => text).join(" ");
    assert.match(message, /저장 결과를 확인하지 못했습니다.*현재 선택/);
    assert.doesNotMatch(message, /저장되지|저장 실패/); assert.ok(f.calls.some(([key]) => key === "retry"));
  }
});

test("confirmed write then read failure retains confirmed save and provides separate read recovery", async () => {
  const f = voteFixture({ refreshFails: true }); await f.submit();
  const messages = f.calls.filter(([key]) => key === "toast").map(([, text]) => text).join(" ");
  assert.match(messages, /저장했습니다/); assert.match(messages, /저장됐지만 최신 정보를 불러오지/); assert.doesNotMatch(messages, /저장 결과를 확인하지|저장 실패/);
});

function componentFixture({ at = openTime + 1000, modal = false, currentEvent = event, scope = "synthetic-scope", results = [], user = { id: "owner-A" } } = {}) {
  const sourceTree = tree("../components/event-detail.tsx");
  const component = sourceTree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "EventDetail");
  const helpers = sourceTree.statements.filter((n) => ts.isFunctionDeclaration(n) && ["naverMapUrl", "formatPotmTime"].includes(n.name?.text)).map((n) => n.getText(sourceTree)).join("\n");
  const time = clock(at), states = [modal ? event.id : null, at], refs = [], calls = [], effects = [], timers = [], listeners = new Map();
  let stateIndex = 0, refIndex = 0;
  const deps = { ...Object.fromEntries(["CalendarDays", "Check", "ChevronLeft", "ClipboardCheck", "Clock3", "MapPin", "MoreHorizontal", "Pencil", "Shield", "Trash2", "Trophy", "Users", "X"].map((name) => [name, icons[name]])), ...mom, ...attendanceHelpers, ...capacityHelpers, ...dateHelpers, Date: time.Date,
    useState: (initial) => { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef: (initial) => { const index = refIndex++; if (!refs[index]) refs[index] = { current: index === 2 && modal ? { value: scope, generation: 0 } : initial }; return refs[index]; },
    window: { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout: () => {}, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name) },
    document: { addEventListener: () => {}, removeEventListener: () => {} },
    useEffect: (effect) => { effects.push(effect); }, useMemo: (calculate) => calculate(), useDialogFocus: () => ({ current: null }),
    Link: ({ children, ...props }) => React.createElement("a", props, children),
    RsvpControls: () => null, Empty: ({ title }) => React.createElement("p", null, title), LoadError: () => React.createElement("p", null, "Read error"), SectionSkeleton: ({ label }) => React.createElement("p", null, label),
    checkInLabels: { present: "출석", late: "지각", absent: "결석" } };
  const code = ts.transpileModule(`${component.getText(sourceTree).replace("export default ", "")}\n${helpers}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const Actual = new Function("require", "exports", ...Object.keys(deps), `${code}; return EventDetail;`)(require, {}, ...Object.values(deps));
  const props = { momScope: scope, isMomCurrent: () => Boolean(scope), verifyMomAccess: async () => true, refreshMomWindow: async () => { calls.push("window-refresh"); }, dateKey: dateHelpers.toEventDateKey(event.starts_at), events: [currentEvent], profiles: [actor, candidate], attendance: [actor, candidate].map((p) => ({ event_id: event.id, member_id: p.id, check_in_status: "present", status: "going" })), momVotes: [], momResults: results, user, profile: user ? actor : null, supabase: { from: () => ({ upsert: async () => { calls.push("write"); return { error: null }; } }) }, loading: false, loadError: false, sessionPending: false, rsvpPendingEventIds: new Set(), canManage: false, toast: (message) => calls.push(message), reload: () => {}, onRetry: () => {}, onLogin: () => {}, onEdit: () => {}, onManageMatch: () => {}, onManageAttendance: () => {}, onManageWinners: () => {}, onDelete: () => {}, onAttendance: () => {} };
  const render = () => { stateIndex = 0; refIndex = 0; return Actual(props); };
  return { props, states, calls, render, html: () => renderToStaticMarkup(render()), time, effects, timers, listeners };
}
function elements(element, predicate, found = []) {
  if (!element || typeof element !== "object") return found;
  if (Array.isArray(element)) { element.forEach((child) => elements(child, predicate, found)); return found; }
  if (predicate(element)) found.push(element);
  if (element.props) elements(element.props.children, predicate, found);
  return found;
}

test("actual page button opens actual modal and actual candidate button executes guarded submission", async () => {
  const f = componentFixture();
  const open = elements(f.render(), (node) => node.type === "button" && node.props.children === "POTM 투표하기")[0];
  assert.ok(open); open.props.onClick();
  const button = elements(f.render(), (node) => node.type === "button" && node.props["aria-label"] === `${candidate.name}에게 POTM 투표`)[0];
  assert.ok(button); assert.equal(button.props.disabled, false); button.props.onClick();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.ok(f.calls.includes("write"));
});

test("actual open modal disables voting at deadline and displays latest changed period", () => {
  const f = componentFixture({ modal: true });
  f.states[1] = closeTime; f.time.state.value = closeTime;
  const button = elements(f.render(), (node) => node.type === "button" && node.props["aria-label"] === `${candidate.name}에게 POTM 투표`)[0];
  assert.equal(button.props.disabled, true); assert.match(f.html(), /투표가 마감되었습니다/);
  f.props.events = [{ ...event, mom_voting_days: 4 }];
  const reopened = elements(f.render(), (node) => node.type === "button" && node.props["aria-label"] === `${candidate.name}에게 POTM 투표`)[0];
  assert.equal(reopened.props.disabled, false);
});

test("actual timer schedules the exact deadline and disables the existing modal at its callback", () => {
  const f = componentFixture({ at: closeTime - 10, modal: true }); f.render();
  const effect = f.effects.find((callback) => callback.toString().includes("getMomClockDelay")); assert.ok(effect);
  const cleanup = effect(); assert.equal(f.timers[0].delay, 10);
  f.time.state.value = closeTime; f.timers[0].callback();
  const button = elements(f.render(), (node) => node.type === "button" && node.props["aria-label"] === `${candidate.name}에게 POTM 투표`)[0];
  assert.equal(button.props.disabled, true); cleanup();
});

test("actual boundary timer waits for changed final results and offers retry on read failure", async () => {
  const gate = deferred(), f = componentFixture({ at: closeTime - 10, modal: true });
  f.props.refreshMomWindow = async () => { await gate.promise; f.props.momResults = [{ event_id: event.id, candidate_profile_id: candidate.id, candidate_name: candidate.name, vote_count: 3, mom_rank: 1 }]; };
  f.render(); const effect = f.effects.find((callback) => callback.toString().includes("getMomClockDelay")); effect();
  f.time.state.value = closeTime; f.timers[0].callback();
  assert.match(f.html(), /POTM 결과 확인 중/); assert.doesNotMatch(f.html(), /POTM 최종 결과|선정된 선수가 없습니다/);
  gate.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.match(f.html(), /POTM 최종 결과/); assert.match(f.html(), /3표/);
  const failed = componentFixture({ at: closeTime - 10, modal: true }); failed.props.refreshMomWindow = async () => { throw new Error("Synthetic read failure"); };
  failed.render(); failed.effects.find((callback) => callback.toString().includes("getMomClockDelay"))(); failed.time.state.value = closeTime; failed.timers[0].callback();
  await Promise.resolve(); await Promise.resolve(); assert.match(failed.html(), /POTM 결과 미확인/); assert.doesNotMatch(failed.html(), /POTM 최종 결과/);
  const retry = elements(failed.render(), (node) => node.type === "button" && node.props.children === "POTM 결과 다시 불러오기")[0]; assert.ok(retry);
});

test("actual long-return focus callback refreshes changed current results without waiting for deadline", async () => {
  const f = componentFixture(); f.props.refreshMomWindow = async () => { f.calls.push("window-refresh"); f.props.momResults = [{ event_id: event.id, candidate_profile_id: candidate.id, candidate_name: candidate.name, vote_count: 5, mom_rank: 1 }]; };
  f.render(); f.effects.find((callback) => callback.toString().includes("getMomClockDelay"))();
  f.time.state.value += 61_000; f.listeners.get("focus")(); await Promise.resolve(); await Promise.resolve();
  assert.ok(f.calls.includes("window-refresh")); assert.match(f.html(), /POTM 현재 집계/); assert.match(f.html(), /5표/);
});

test("actual page shows empty current and final outcomes, ties, and no anonymous member results", () => {
  assert.match(componentFixture().html(), /POTM 현재 집계.*아직 등록된 표가 없습니다/);
  assert.match(componentFixture({ at: closeTime }).html(), /POTM 최종 결과.*등록된 표가 없어 선정된 선수가 없습니다/);
  const results = [candidate, { ...candidate, id: "second", name: "합성 공동 후보" }].map((p) => ({ event_id: event.id, candidate_profile_id: p.id, candidate_name: p.name, vote_count: 2, mom_rank: 1 }));
  assert.match(componentFixture({ results, at: closeTime }).html(), /공동 1위.*합성 공동 후보/);
  const anonymous = componentFixture({ results, scope: "", user: null }).html();
  assert.doesNotMatch(anonymous, /합성 공동 후보|POTM 현재 집계|POTM 최종 결과/);
  const legacy = componentFixture({ currentEvent: { ...event, ends_at: undefined, mom_voting_days: undefined } }).html();
  assert.match(legacy, /투표 기간 미확인/); assert.doesNotMatch(legacy, /POTM 투표하기|별도 마감 없이/);
});

function editorFixture({ row = {}, existingEvents = [], allowed = true, current = true, gate = null } = {}) {
  const calls = [], access = new Set(allowed ? ["events.manage"] : []), time = clock(Date.parse("2026-10-05T00:00:00Z"));
  const state = { current }; access.isCurrent = () => state.current; access.profiles = [actor];
  const supabase = { from: (table) => {
    let payload, action;
    const result = () => ({ error: null, data: Array.isArray(payload) ? payload.map((_, index) => ({ id: `saved-${index}` })) : { id: "saved" } });
    const chain = { update: (value) => { action = "update"; payload = value; calls.push([table, action, payload]); return chain; }, insert: (value) => { action = "insert"; payload = value; calls.push([table, action, payload]); return chain; }, eq: () => chain, select: () => chain, single: async () => result(), then: (resolve) => Promise.resolve(result()).then(resolve) }; return chain;
  } };
  const deps = { ...mom, ...permissions, Date: time.Date, config: { type: "events" }, currentProfileId: actor.id, row, events: existingEvents, scheduledGuests: [], savingRef: { current: false }, setSaving: (value) => calls.push(["saving", value]), verifyAccess: async () => { if (gate) await gate.promise; return access; }, supabase, userError: (message) => ({ message, userFacing: true }), toErrorMessage: (error) => error.message, setFormDirty: () => {}, onClose: () => calls.push(["close"]), onError: (message) => calls.push(["error", message]), onSaved: () => calls.push(["saved"]) };
  const fd = new FormData();
  for (const [key, value] of Object.entries({ title: "Synthetic weekly event", starts_at: "2026-12-20T08:00:00+09:00", ends_at: "2026-12-20T10:30:00+09:00", mom_voting_days: "3", venue_id: "existing-venue", venue: "Synthetic venue", capacity: "18" })) fd.set(key, value);
  return { calls, fd, state, deps, save: () => actualCallback("../components/admin-console.tsx", "AdminEditor", "save", deps)(fd, null) };
}

test("actual event editor saves explicit end and period for existing event and default end for new event", async () => {
  const existing = editorFixture({ row: { id: event.id } }); existing.fd.set("mom_voting_days", "30"); await existing.save();
  const update = existing.calls.find(([table, action]) => table === "events" && action === "update");
  assert.equal(update[2].mom_voting_days, 30); assert.equal(Date.parse(update[2].ends_at) - Date.parse(update[2].starts_at), 2.5 * 3600000);
  const fresh = editorFixture(); fresh.fd.set("ends_at", ""); await fresh.save();
  const insert = fresh.calls.find(([table, action]) => table === "events" && action === "insert"); assert.equal(insert[2].ends_at, null); assert.equal(insert[2].mom_voting_days, 3);
});

test("actual weekly creation shifts every explicit end alongside start and skips existing start", async () => {
  const f = editorFixture(); f.fd.set("recurring", "on"); await f.save();
  const payloads = f.calls.find(([table, action]) => table === "events" && action === "insert")[2]; assert.equal(payloads.length, 2);
  assert.equal(Date.parse(payloads[1].starts_at) - Date.parse(payloads[0].starts_at), 7 * 86400000);
  for (const payload of payloads) assert.equal(Date.parse(payload.ends_at) - Date.parse(payload.starts_at), 2.5 * 3600000);
  const second = editorFixture({ existingEvents: [{ starts_at: payloads[0].starts_at }] }); second.fd.set("recurring", "on"); second.fd.set("ends_at", ""); await second.save();
  const remaining = second.calls.find(([table, action]) => table === "events" && action === "insert")[2]; assert.equal(remaining.length, 1); assert.equal(remaining[0].ends_at, null);
});

test("actual event editor validates period/end and fresh events.manage before writes", async () => {
  for (const fields of [{ mom_voting_days: "0" }, { mom_voting_days: "31" }, { mom_voting_days: "1.5" }, { ends_at: "2026-12-20T08:00:00+09:00" }]) {
    const f = editorFixture(); for (const [name, value] of Object.entries(fields)) f.fd.set(name, value); await f.save();
    assert.equal(f.calls.some(([table]) => table === "events"), false); assert.ok(f.calls.some(([key]) => key === "error"));
  }
  for (const patch of [{ auth_user_id: null }, { status: "inactive" }, { must_change_password: true }, { is_test_account: true }]) {
    const f = editorFixture(); f.deps.verifyAccess = async () => Object.assign(new Set(["events.manage"]), { profiles: [{ ...actor, ...patch }], isCurrent: () => true }); await f.save();
    assert.equal(f.calls.some(([table]) => table === "events"), false);
  }
  const denied = editorFixture({ allowed: false }); await denied.save(); assert.equal(denied.calls.some(([table]) => table === "events"), false);
  const gate = deferred(), stale = editorFixture({ gate }); const pending = stale.save(); stale.state.current = false; gate.resolve(); await pending;
  assert.equal(stale.calls.some(([table]) => table === "events"), false); assert.equal(stale.calls.some(([key]) => key === "error"), false);
});

test("directory or attendance read errors prevent actual vote write and retain recovery", async () => {
  const f = voteFixture(); f.deps.latestRef.current.loadError = true; await f.submit();
  assert.equal(f.calls.some(([key]) => key === "write"), false); assert.ok(f.calls.some(([key]) => key === "retry"));
  const source = readFileSync(new URL("../components/clubhouse.tsx", import.meta.url), "utf8");
  const jsx = source.slice(source.indexOf("{eventDateKey && <EventDetail"), source.indexOf("\n", source.indexOf("{eventDateKey && <EventDetail")));
  assert.match(jsx, /hasLoadError\("memberDirectory", "profiles", "attendance", "momVotes", "momResults"\)/);
  assert.match(jsx, /reload\(\["events", "memberDirectory", "profiles", "attendance", "momVotes", "momResults"\]\)/);
});

test("actual events reader retains new timing fields in relationship fallback and old backend list", async () => {
  for (const failureCount of [1, 2]) {
    const selects = [], state = { events: [] }, signal = new AbortController().signal;
    const deps = { publicLoadResources: ["events"], userRef: { current: null }, requestsRef: { current: { epoch: 1, load: async (_, __, query) => ({ ...await query(signal), isCurrent: () => true }) } }, getLoadErrors: () => ({}), setLoadErrors: () => {}, setPublicLoading: () => {}, setEvents: (rows) => { state.events = rows; }, supabase: { from: () => {
      const chain = { select: (value) => { selects.push(value); return chain; }, order: () => chain, abortSignal: async () => selects.length <= failureCount ? { data: null, error: { code: "42703", message: "Synthetic missing column" } } : { data: [failureCount === 1 ? event : { id: event.id, starts_at: event.starts_at }], error: null } }; return chain;
    } } };
    await actualCallback("../components/clubhouse.tsx", "Clubhouse", "loadPublicData", deps)(false, ["events"], true);
    assert.match(selects[0], /ends_at, mom_voting_days/); assert.match(selects[1], /ends_at, mom_voting_days/);
    if (failureCount === 2) { assert.doesNotMatch(selects[2], /ends_at|mom_voting_days/); assert.equal(mom.getMomVotingWindow(state.events[0], openTime).state, "unknown"); }
    assert.equal(state.events[0].id, event.id);
  }
});
