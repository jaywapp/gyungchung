import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoreHorizontal, Pencil, Phone, UserMinus, X } from "lucide-react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleExports(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function("exports", code)(exports); return exports;
}
const phone = moduleExports("./member-phone.ts");
const directory = moduleExports("./member-directory.ts");
const trees = new Map();
function sourceTree(path) {
  if (!trees.has(path)) trees.set(path, ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return trees.get(path);
}
function callback(path, component, name, dependencies) {
  const tree = sourceTree(path);
  const owner = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let expression;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer; ts.forEachChild(node, visit); };
  visit(owner); assert.ok(expression, `${component}.${name} must exercise production code`);
  const code = ts.transpileModule(`const actual = ${expression.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return actual;`)(...Object.values(dependencies));
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const actor = { id: "actor-profile", auth_user_id: "actor-A", name: "합성 회원", status: "active", must_change_password: false, is_test_account: false, role: "member", officer_title: null, is_system_admin: false };
const target = { id: "target-profile", name: "합성 대상", status: "active", is_test_account: false, auth_user_id: null, must_change_password: true, role: "member", officer_title: null, is_system_admin: false, position: "MF", joined_at: "2026-01-01", phone: "010-1111-2222" };

function fixture({ data = "+82 (10) 1111-2222", responseError = null, transportError = false, gate = null, verification = null } = {}) {
  const calls = [];
  const scope = phone.getMemberPhoneScope("actor-A", actor, [], 1);
  const parent = { ...phone, phoneScope: scope, supabase: { rpc: async (name, args) => { calls.push(["rpc", name, args]); if (gate) await gate.promise; if (transportError) throw new Error("synthetic network failure"); return { data, error: responseError }; } }, userRef: { current: { id: "actor-A" } }, requestsRef: { current: { epoch: 1 } }, accessRef: { current: { profile: actor, permissions: new Set() } }, verifyAccess: async () => { calls.push(["verify"]); if (verification) return verification(parent); return { isCurrent: () => true }; } };
  parent.isPhoneCurrent = callback("../components/clubhouse.tsx", "Clubhouse", "isPhoneCurrent", parent);
  const lookup = callback("../components/clubhouse.tsx", "Clubhouse", "readMemberPhone", parent);
  const deps = { ...phone, phoneScope: scope, isPhoneCurrent: parent.isPhoneCurrent, onPhoneLookup: lookup, phonePendingRef: { current: null }, mountedRef: { current: true }, scopeRef: { current: { value: scope, generation: 0 } }, profilesRef: { current: [target] }, preparedPhone: null,
    setPhonePending: (v) => calls.push(["pending", v]), setPreparedPhone: (v) => { calls.push(["prepared", v]); deps.preparedPhone = v; }, setPhoneNotice: (v) => calls.push(["notice", v]), openMemberPhone: (uri) => calls.push(["open", uri]) };
  return { parent, deps, calls, request: callback("../components/member-directory.tsx", "MemberDirectory", "requestPhone", deps), dial: () => callback("../components/member-directory.tsx", "MemberDirectory", "dialPhone", deps)() };
}

test("normalizes permitted phone separators and rejects tel injection or malformed values", () => {
  assert.equal(phone.normalizeMemberPhone("010-1111-2222"), "tel:01011112222");
  assert.equal(phone.normalizeMemberPhone("821011112222"), "tel:+821011112222");
  assert.equal(phone.normalizeMemberPhone("02-111-2222"), "tel:021112222");
  assert.equal(phone.normalizeMemberPhone("0507-1111-2222"), "tel:050711112222");
  assert.equal(phone.normalizeMemberPhone(" +82 (10) 1111-2222 "), "tel:+821011112222");
  for (const value of [null, undefined, "", "   ", "123", "1234567890123456", "010;1111", "javascript:alert(1)", "tel:01011112222", "010/1111/2222", "+82+1011112222", "010#1111", "010\n11112222"]) assert.equal(phone.normalizeMemberPhone(value), null);
});

test("actual member request calls the guarded RPC on demand and waits for a second click before mocked opener", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.request(target);
  assert.deepEqual(f.calls.find(([key]) => key === "rpc"), ["rpc", "get_member_phone", { p_member_id: target.id }]);
  assert.equal(f.calls.filter(([key]) => key === "verify").length, 1);
  assert.equal(f.calls.some(([key]) => key === "open"), false);
  assert.equal(f.deps.preparedPhone.uri, "tel:+821011112222");
  f.dial(); assert.deepEqual(f.calls.find(([key]) => key === "open"), ["open", "tel:+821011112222"]);
});

test("actual handler blocks duplicate phone requests and allows target without auth link or password change", async () => {
  const gate = deferred(); const f = fixture({ gate });
  const pending = f.request(target); await f.request(target);
  assert.equal(f.calls.filter(([key]) => key === "rpc").length, 1);
  gate.resolve(); await pending;
  assert.ok(f.deps.preparedPhone); assert.equal(f.deps.phonePendingRef.current, null);
});

test("actual handler treats missing number, RPC error and network failure as recoverable without dialer", async () => {
  for (const options of [{ data: null }, { responseError: { code: "42501" } }, { transportError: true }, { data: "01011112222;other" }]) {
    const f = fixture(options); await f.request(target);
    assert.equal(f.deps.preparedPhone, null); assert.equal(f.calls.some(([key]) => key === "open"), false);
    assert.ok(f.calls.some(([key, value]) => key === "notice" && value?.text));
    assert.equal(f.deps.phonePendingRef.current, null);
  }
});

test("actual handler discards late logout, auth A-B-A, scope ABA and removed-target responses without notices", async () => {
  for (const mutate of [(f) => { f.parent.userRef.current = null; }, (f) => { f.parent.requestsRef.current.epoch = 3; }, (f) => { f.deps.scopeRef.current.generation = 2; }, (f) => { f.deps.profilesRef.current = []; }]) {
    const gate = deferred(); const f = fixture({ gate }); const pending = f.request(target);
    mutate(f); gate.resolve(); await pending;
    assert.equal(f.calls.some(([key, value]) => key === "prepared" && value), false);
    assert.equal(f.calls.some(([key, value]) => key === "notice" && value), false);
    assert.equal(f.calls.some(([key]) => key === "open"), false);
  }
});

test("fresh actor eligibility and authority changes suppress returned phone data and notifications", async () => {
  for (const patch of [{ status: "inactive" }, { must_change_password: true }, { is_test_account: true }, { id: "relinked-profile" }, { auth_user_id: "actor-B" }, { role: "manager", officer_title: "treasurer" }]) {
    const f = fixture({ verification: (parent) => { parent.accessRef.current.profile = { ...actor, ...patch }; return { isCurrent: () => true }; } }); await f.request(target);
    assert.equal(f.calls.some(([key, value]) => key === "prepared" && value), false);
    assert.equal(f.calls.some(([key, value]) => key === "notice" && value), false);
  }
  const f = fixture({ verification: (parent) => { parent.accessRef.current.permissions = new Set(["members.manage"]); return { isCurrent: () => true }; } }); await f.request(target);
  assert.equal(f.deps.preparedPhone, null);
  const failed = fixture({ verification: () => null }); await failed.request(target);
  assert.equal(failed.deps.preparedPhone, null); assert.ok(failed.calls.some(([key, value]) => key === "notice" && value?.error));
});

test("prepared dialer action rechecks the owner and reports synchronous app-opening failure", async () => {
  const stale = fixture(); await stale.request(target); stale.parent.requestsRef.current.epoch = 2; stale.dial();
  assert.equal(stale.calls.some(([key]) => key === "open"), false);
  const failure = fixture(); await failure.request(target); failure.deps.openMemberPhone = () => { throw new Error("synthetic opener failure"); }; failure.dial();
  assert.ok(failure.calls.some(([key, value]) => key === "notice" && value?.error && value.text.includes("열지 못했습니다")));
});

test("actual directory renders no telephone URI or raw number before the user's request", () => {
  const tree = sourceTree("../components/member-directory.tsx");
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MemberDirectory");
  assert.ok(component);
  const code = ts.transpileModule(component.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const bindings = { ...directory, ...phone, useEffect: React.useEffect, useMemo: React.useMemo, useRef: React.useRef, useState: React.useState, useDialogFocus: () => ({ current: null }), MoreHorizontal, Pencil, Phone, UserMinus, X, officerTitleLabels: {}, MemberAvatar: () => null };
  const MemberDirectory = new Function("require", "exports", ...Object.keys(bindings), `${code}; return MemberDirectory;`)(require, {}, ...Object.values(bindings));
  const html = renderToStaticMarkup(React.createElement(MemberDirectory, { profiles: [target], currentUserId: "actor-A", canManage: false, phoneScope: "synthetic scope", isPhoneCurrent: () => true, onPhoneLookup: async () => { throw new Error("render must not query"); }, onEdit() {}, onKick() {} }));
  assert.match(html, /합성 대상에게 전화걸기/); assert.match(html, /합성 대상 상세 정보 보기/); assert.doesNotMatch(html, /tel:|010-1111-2222|등록된 전화번호가 없습니다/);
});
