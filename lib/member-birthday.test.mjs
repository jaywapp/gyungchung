import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleExports(path) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function("exports", output)(exports); return exports;
}
const birthday = moduleExports("./member-birthday.ts");
const dates = moduleExports("./event-date.ts");
const source = readFileSync(new URL("../components/clubhouse.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("clubhouse.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const member = (id, month = null, day = null, revision = 0) => ({ id, auth_user_id: `auth-${id}`, name: `회원 ${id}`, status: "active", must_change_password: false, is_test_account: false, role: "member", birthday_month: month, birthday_day: day, birthday_revision: revision });
function evaluateCallback(componentName, callbackName, dependencies) {
  const owner = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  let callback;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === callbackName) callback = node.initializer; ts.forEachChild(node, visit); };
  visit(owner); assert.ok(callback);
  const output = ts.transpileModule(`const actual = ${callback.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${output};return actual;`)(...Object.values(dependencies));
}
function loadComponents(names, bindings) {
  bindings = Object.fromEntries(Object.entries(bindings).filter(([name]) => name !== "default"));
  const declarations = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  const output = ts.transpileModule(declarations.map((node) => node.getText(tree)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function("require", "exports", ...Object.keys(bindings), `${output};return {${names.join(",")}};`)(require, {}, ...Object.values(bindings));
}

test("month/day validation accepts leap birthdays but rejects impossible dates and partial deletion", async () => {
  for (const [m, d] of [[1, 31], [2, 29], [4, 30], [12, 31]]) assert.equal(birthday.isValidBirthday(m, d), true);
  for (const [m, d] of [[0, 1], [13, 1], [2, 30], [4, 31], [1.5, 1], [1, 0], [null, 1], ["2", 29]]) assert.equal(birthday.isValidBirthday(m, d), false);
  let calls = 0;
  await assert.rejects(birthday.saveMyBirthday({ rpc: async () => { calls++; } }, { month: null, day: 1, revision: 0, isCurrent: () => true }), /유효한/);
  assert.equal(calls, 0);
});

test("year indexes preserve collisions, year boundaries, and leap/non-leap century rules", () => {
  const rows = [member("a", 2, 29), member("b", 2, 28), member("c", 1, 1), member("d", 12, 31), { ...member("hidden", 2, 28), is_test_account: true }, { ...member("pending", 2, 28), status: "pending" }, { ...member("initial", 2, 28), must_change_password: true }, { ...member("unlinked", 2, 28), auth_user_id: null }];
  const normal = birthday.buildBirthdayIndex(rows, 2026);
  assert.deepEqual(normal.get("20260228").map((row) => row.id), ["a", "b"]);
  assert.equal(normal.get("20260101")[0].id, "c"); assert.equal(normal.get("20261231")[0].id, "d");
  assert.equal(birthday.buildBirthdayIndex(rows, 2028).get("20280229")[0].id, "a");
  assert.equal(birthday.buildBirthdayIndex(rows, 2100).get("21000228").length, 2);
  assert.equal(birthday.buildBirthdayIndex(rows, 2000).get("20000229")[0].id, "a");
});

test("own directory merge preserves authority and distinguishes errors, legacy, missing, and restricted states", () => {
  const original = member("own"); delete original.birthday_month; delete original.birthday_day; delete original.birthday_revision;
  const directory = { id: "own", name: "회원 own", phone: null, role: "manager", officer_title: null, position: null, position_detail: null, jersey_number: null, joined_at: "2026-01-01", status: "active", avatar_path: null, birthday_month: 10, birthday_day: 5, birthday_revision: 3 };
  const merged = birthday.mergeOwnBirthday(original, [directory], original.auth_user_id);
  assert.equal(Object.keys(directory).length, 14);
  const peer = { ...directory, id: "peer", birthday_revision: null };
  assert.equal(birthday.buildBirthdayIndex([peer], 2026).get("20261005")[0].id, "peer");
  assert.equal(merged.role, "member"); assert.equal(merged.is_system_admin, undefined); assert.equal(merged.birthday_revision, 3);
  assert.equal(birthday.getBirthdayState(original.auth_user_id, merged, false, false), "registered");
  assert.equal(birthday.getBirthdayState(original.auth_user_id, birthday.mergeOwnBirthday(original, [], original.auth_user_id), false, false), "unknown");
  assert.equal(birthday.getBirthdayState(original.auth_user_id, member("own"), false, false), "missing");
  assert.equal(birthday.getBirthdayState(original.auth_user_id, merged, false, true), "error");
  assert.equal(birthday.getBirthdayState(original.auth_user_id, merged, true, false), "loading");
  for (const profile of [null, { ...merged, status: "inactive" }, { ...merged, is_test_account: true }, { ...merged, must_change_password: true }]) {
    assert.equal(birthday.getBirthdayState(original.auth_user_id, profile, false, false), "restricted");
    assert.equal(birthday.mergeOwnBirthday(profile, [directory], original.auth_user_id)?.birthday_month, undefined);
  }
  assert.equal(birthday.getBirthdayState("other-owner", merged, false, false), "restricted");
});

test("birthday RPC uses CAS revision, tombstone deletion and suppresses auth ABA responses", async () => {
  const requests = [];
  const client = { rpc: async (name, args) => { requests.push([name, args]); return { data: [{ birthday_month: args.p_month, birthday_day: args.p_day, birthday_revision: args.p_expected_revision + 1 }], error: null }; } };
  assert.deepEqual(await birthday.saveMyBirthday(client, { month: null, day: null, revision: 7, isCurrent: () => true }), { birthday_month: null, birthday_day: null, birthday_revision: 8 });
  assert.deepEqual(requests[0], ["set_my_birthday", { p_month: null, p_day: null, p_expected_revision: 7 }]);
  await assert.rejects(birthday.saveMyBirthday({ rpc: async () => ({ error: { code: "40001" } }) }, { month: 1, day: 1, revision: 0, isCurrent: () => true }), (error) => error.code === "40001" && error.message.includes("다른 곳"));
  let epoch = 1; let release; const response = new Promise((resolve) => { release = resolve; });
  const save = birthday.saveMyBirthday({ rpc: () => response }, { month: 1, day: 1, revision: 0, isCurrent: () => epoch === 1 });
  epoch = 3; release({ data: [{ birthday_month: 1, birthday_day: 1, birthday_revision: 1 }], error: null });
  await assert.rejects(save, (error) => error.code === "stale");
});

const commonBindings = { ...React, CalendarDays: icons.CalendarDays, Cake: icons.Cake, ChevronLeft: icons.ChevronLeft, ChevronRight: icons.ChevronRight, Plus: icons.Plus, ...birthday, ...dates,
  PageIntro: ({ title, description }) => React.createElement("header", null, title, description),
  Empty: ({ title }) => React.createElement("p", null, title),
  MemberAvatar: () => null,
  formatTime: () => "10:00",
};
const { Events } = loadComponents(["MonthCalendar", "Events"], commonBindings);
const eventsProps = { birthdayProfiles: [], birthdayState: "missing", events: [], attendance: [], user: { id: "auth-own" }, profile: member("own"), sessionPending: false, rsvpPendingEventIds: new Set(), loading: false, loadError: false, canManage: false, onCreate() {}, onEdit() {}, onManageMatch() {}, onManageAttendance() {}, onManageWinners() {}, onDelete() {}, onAttendance() {}, onLogin() {}, onRetry() {}, onBirthday() {}, onBirthdayRetry() {} };
test("actual calendar renders birthdays and selected names with no events and keeps seven columns and one button per day", () => {
  const today = new Date(); const rows = [member("a", today.getMonth() + 1, today.getDate()), member("b", today.getMonth() + 1, today.getDate())];
  const html = renderToStaticMarkup(React.createElement(Events, { ...eventsProps, birthdayProfiles: rows }));
  assert.match(html, /생일 2명/); assert.match(html, /이날 생일인 구성원 2명/); assert.match(html, /회원 a/); assert.match(html, /회원 b/); assert.match(html, /내 생일 등록/);
  assert.equal((html.match(/aria-pressed=/g) ?? []).length, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  assert.equal((html.match(/aria-controls="event-focus"/g) ?? []).length, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  assert.match(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  const failed = renderToStaticMarkup(React.createElement(Events, { ...eventsProps, birthdayState: "error" }));
  assert.doesNotMatch(failed, /내 생일 등록/); assert.match(failed, /생일 다시 불러오기/);
});

function handlerFixture(options = {}) {
  const calls = []; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const profile = member("own");
  const state = { current: true, mounted: true };
  const deps = { ...birthday, profile, birthdayState: "missing", supabase: {}, busy: false, birthdayMonth: "2", birthdayDay: "29", savingRef: { current: false }, mountedRef: { current: true }, isCurrent: () => state.current,
    setSaving: (v) => calls.push(["saving", v]), setBirthdaySaving: (v) => calls.push(["birthday-saving", v]), onBusyChange: (v) => calls.push(["busy", v]), setBirthdayError: (v) => calls.push(["error", v]), setBirthdayStatus: (v) => calls.push(["status", v]),
    saveMyBirthday: async () => gate, onBirthdaySaved: async () => { calls.push(["parent"]); return true; }, ...options };
  return { calls, state, deps, release, handler: evaluateCallback("AccountModal", "changeBirthday", deps) };
}
test("actual account birthday handler locks duplicates, preserves confirmed success after refresh failure and drops stale results", async () => {
  const f = handlerFixture({ onBirthdaySaved: async () => { throw new Error("refresh failed"); } });
  const pending = f.handler(false); await f.handler(false);
  assert.equal(f.calls.filter(([key, value]) => key === "saving" && value).length, 1);
  f.release({ birthday_month: 2, birthday_day: 29, birthday_revision: 1 }); await pending;
  assert.ok(f.calls.some(([key, text]) => key === "status" && text?.includes("생일을 저장했습니다")));
  assert.equal(f.calls.some(([key, text]) => key === "error" && text), false);
  const stale = handlerFixture(); const staleSave = stale.handler(false); stale.state.current = false;
  stale.release({ birthday_month: 2, birthday_day: 29, birthday_revision: 1 }); await staleSave;
  assert.equal(stale.calls.some(([key]) => key === "parent"), false);
  assert.equal(stale.calls.some(([key, text]) => key === "status" && text), false);
});

test("actual account handler blocks unknown/error/restricted profiles and reports CAS recovery without rewriting", async () => {
  for (const birthdayState of ["unknown", "error", "restricted", "loading"]) {
    const f = handlerFixture({ birthdayState }); await f.handler(false); assert.equal(f.calls.length, 0);
  }
  const f = handlerFixture({ saveMyBirthday: async () => { throw new birthday.BirthdayRequestError("40001", "다른 곳에서 생일이 변경되었습니다. 다시 불러온 뒤 수정해 주세요."); } });
  await f.handler(false); assert.ok(f.calls.some(([key, text]) => key === "error" && text?.includes("다른 곳"))); assert.equal(f.calls.some(([key]) => key === "parent"), false);
});

test("actual committed-write parent refreshes eligibility before merging and refuses revoked or ABA owners", async () => {
  const own = member("own"); const result = { birthday_month: 10, birthday_day: 5, birthday_revision: 1 };
  const build = (verify) => {
    const calls = []; const deps = { ...birthday, user: { id: own.auth_user_id }, me: own, avatarOwnerEpoch: 1, userRef: { current: { id: own.auth_user_id } }, requestsRef: { current: { epoch: 1, invalidate: (r) => calls.push(["invalidate", r]) } }, accessRef: { current: { profile: own } }, profileSourcesRef: { current: { directory: [own], private: [own] } }, loadMemberData: async (...args) => { calls.push(["verify", args]); return verify(deps); }, setMe: (v) => calls.push(["me", v]), setProfiles: (v) => calls.push(["profiles", v]) };
    return { deps, calls, callback: evaluateCallback("Clubhouse", "birthdaySaved", deps) };
  };
  const good = build(() => true); assert.equal(await good.callback(result), true); assert.equal(good.calls[0][0], "invalidate"); assert.equal(good.calls[1][0], "verify"); assert.equal(good.calls[2][1].birthday_revision, 1);
  for (const mutate of [(d) => { d.accessRef.current.profile = { ...own, id: "relinked-profile" }; return true; }, (d) => { d.accessRef.current.profile = { ...own, status: "inactive" }; return true; }, (d) => { d.requestsRef.current.epoch = 3; return true; }, () => false]) {
    const f = build(mutate); assert.equal(await f.callback(result), false); assert.equal(f.calls.some(([key]) => key === "me"), false);
  }
});
