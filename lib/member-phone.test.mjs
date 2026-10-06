import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactRound, Download, MoreHorizontal, Pencil, Phone, UserMinus, X } from "lucide-react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function moduleExports(path, imports = {}, bindings = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; new Function("exports", "require", ...Object.keys(bindings), code)(exports, (name) => imports[name] ?? require(name), ...Object.values(bindings)); return exports;
}
const phone = moduleExports("./member-phone.ts");
const contact = moduleExports("./member-contact.ts", { "./member-phone": phone });
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

function fixture({ data = "+82 (10) 1111-2222", responseError = null, transportError = false, gate = null, verification = null, actorProfile = actor, canManage = false } = {}) {
  const calls = [];
  const permissions = canManage ? ["members.manage"] : [];
  const scope = phone.getMemberPhoneScope("actor-A", actorProfile, permissions, 1);
  const parent = { ...phone, phoneScope: scope, supabase: { rpc: async (name, args) => { calls.push(["rpc", name, args]); if (gate) await gate.promise; if (transportError) throw new Error("synthetic network failure"); return { data, error: responseError }; } }, userRef: { current: { id: "actor-A" } }, requestsRef: { current: { epoch: 1 } }, accessRef: { current: { profile: actorProfile, permissions: new Set(permissions) } }, verifyAccess: async () => { calls.push(["verify"]); if (verification) return verification(parent); return { isCurrent: () => true }; } };
  parent.isPhoneCurrent = callback("../components/clubhouse.tsx", "Clubhouse", "isPhoneCurrent", parent);
  const lookup = callback("../components/clubhouse.tsx", "Clubhouse", "readMemberPhone", parent);
  const deps = { ...phone, currentUserId: "actor-A", canManage, phoneScope: scope, isPhoneCurrent: parent.isPhoneCurrent, onPhoneLookup: lookup, phonePendingRef: { current: null }, preparedPhoneRef: { current: null }, contactCleanupRef: { current: null }, mountedRef: { current: true }, scopeRef: { current: { value: scope, generation: 0 } }, menuActorRef: { current: { owner: "actor-A", canManage, generation: 0 } }, menuRef: { current: { memberId: target.id, targetScope: JSON.stringify([target.id, target.auth_user_id, target.status, target.is_test_account]), generation: 1, actorGeneration: 0 } }, profilesRef: { current: [target] }, accessRef: { current: { currentUserId: "actor-A", canManage, isPhoneCurrent: parent.isPhoneCurrent } }, preparedPhone: null,
    setSelectedProfileId: (v) => calls.push(["selected", v]), setPhonePending: (v) => calls.push(["pending", v]), setPreparedPhone: (v) => { calls.push(["prepared", v]); deps.preparedPhone = v; }, setPhoneNotice: (v) => calls.push(["notice", v]), openMemberPhone: (uri) => calls.push(["open", uri]), downloadMemberContact: (name, uri) => { calls.push(["download", name, uri]); return () => calls.push(["cleanup"]); }, onEdit: (profile) => calls.push(["edit", profile]), onKick: (profile) => calls.push(["kick", profile]) };
  deps.clearContact = callback("../components/member-directory.tsx", "MemberDirectory", "clearContact", deps);
  deps.closeMenu = callback("../components/member-directory.tsx", "MemberDirectory", "closeMenu", deps);
  return { parent, deps, calls, request: callback("../components/member-directory.tsx", "MemberDirectory", "requestPhone", deps), dial: () => callback("../components/member-directory.tsx", "MemberDirectory", "dialPhone", deps)(), save: () => callback("../components/member-directory.tsx", "MemberDirectory", "saveContact", deps)(), close: deps.closeMenu, open: (profile) => callback("../components/member-directory.tsx", "MemberDirectory", "openMenu", deps)(profile), manage: (action) => callback("../components/member-directory.tsx", "MemberDirectory", "manageMember", { ...deps, menuGeneration: deps.menuRef.current.generation })(action) };
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
  for (const action of ["dial", "save"]) for (const options of [{ data: null }, { responseError: { code: "42501" } }, { transportError: true }, { data: "01011112222;other" }]) {
    const f = fixture(options); await f.request(target, action);
    assert.equal(f.deps.preparedPhone, null); assert.equal(f.calls.some(([key]) => key === "open" || key === "download"), false);
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

function renderDirectory({ selected = false, canManage = false, profiles = [target], prepared = null, phoneScope = "synthetic scope", isPhoneCurrent = () => true } = {}) {
  const tree = sourceTree("../components/member-directory.tsx");
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "MemberDirectory");
  assert.ok(component);
  const code = ts.transpileModule(component.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let stateIndex = 0;
  const states = [null, prepared, null, selected ? profiles[0].id : null, "ALL"];
  const bindings = { ...directory, ...phone, ...contact, useEffect: React.useEffect, useMemo: React.useMemo, useRef: React.useRef, useState: () => [states[stateIndex++], () => {}], useDialogFocus: () => ({ current: null }), ContactRound, Download, MoreHorizontal, Pencil, Phone, UserMinus, X, officerTitleLabels: {}, MemberAvatar: () => null };
  const MemberDirectory = new Function("require", "exports", ...Object.keys(bindings), `${code}; return MemberDirectory;`)(require, {}, ...Object.values(bindings));
  return renderToStaticMarkup(React.createElement(MemberDirectory, { profiles, currentUserId: "actor-A", canManage, phoneScope, isPhoneCurrent, onPhoneLookup: async () => { throw new Error("render must not query"); }, onEdit() {}, onKick() {} }));
}

test("actual directory renders one accessible whole-card trigger without phone actions or raw contact before selection", () => {
  for (const canManage of [false, true]) {
    const html = renderDirectory({ canManage });
    const card = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1]; assert.ok(card);
    assert.equal([...card.matchAll(/<button\b/g)].length, 1);
    assert.match(card, /합성 대상 회원 메뉴 및 상세 정보 보기/);
    assert.match(card, /class="directory-card-trigger"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
    assert.doesNotMatch(card, /전화걸기|전화 앱 열기|정보 수정|회원 강퇴|<details|<summary/);
    assert.doesNotMatch(html, /tel:|010-1111-2222|등록된 전화번호가 없습니다|role="dialog"/);
  }
});

test("actual menu keeps the member detail fields and exposes contact actions to ordinary members", () => {
  const html = renderDirectory({ selected: true });
  assert.match(html, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="member-detail-title"/);
  for (const text of ["포지션", "등번호", "회원 유형", "가입일", "전화걸기", "연락처 저장"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /정보 수정|회원 강퇴|tel:|010-1111-2222/);
  const noScope = renderDirectory({ selected: true, phoneScope: "" }); assert.doesNotMatch(noScope, /전화걸기|연락처 저장/);
});

test("actual menu retains manager actions and hides kick for the owner and system administrator", () => {
  const manager = renderDirectory({ selected: true, canManage: true });
  assert.match(manager, /정보 수정/); assert.match(manager, /회원 강퇴/);
  for (const patch of [{ auth_user_id: "actor-A" }, { is_system_admin: true }]) {
    const html = renderDirectory({ selected: true, canManage: true, profiles: [{ ...target, ...patch }] });
    assert.match(html, /정보 수정/); assert.doesNotMatch(html, /회원 강퇴/);
  }
});

test("actual ready menu makes the second explicit click distinct and never embeds a telephone link", () => {
  for (const [action, label] of [["dial", "전화 앱 열기"], ["save", "연락처 파일 내려받기"]]) {
    const html = renderDirectory({ selected: true, prepared: { memberId: target.id, uri: "tel:01011112222", action, isCurrent: () => true } });
    assert.ok(html.includes(label)); assert.doesNotMatch(html, /tel:|01011112222|저장되었습니다/);
  }
});

test("actual contact request reuses the guarded single-member RPC and saves only after an explicit click with the latest name", async () => {
  const f = fixture(); await f.request(target, "save");
  assert.deepEqual(f.calls.find(([key]) => key === "rpc"), ["rpc", "get_member_phone", { p_member_id: target.id }]);
  assert.equal(f.calls.filter(([key]) => key === "verify").length, 1);
  assert.equal(f.calls.some(([key]) => key === "download" || key === "open"), false);
  f.deps.profilesRef.current = [{ ...target, name: "최신 합성 이름 🏃" }];
  f.dial(); assert.equal(f.calls.some(([key]) => key === "open"), false);
  f.save(); f.save();
  assert.deepEqual(f.calls.filter(([key]) => key === "download"), [["download", "최신 합성 이름 🏃", "tel:+821011112222"]]);
  assert.ok(f.calls.some(([key, value]) => key === "notice" && value?.text.includes("요청했습니다") && value.text.includes("연락처 앱")));
  assert.equal(f.calls.some(([key, value]) => key === "notice" && value?.text.includes("저장되었습니다")), false);
  f.close(); assert.equal(f.calls.filter(([key]) => key === "cleanup").length, 1);
});

test("actual menu closes, switches A-B-A and target authority changes discard pending phone and contact responses", async () => {
  for (const action of ["dial", "save"]) {
    for (const mutate of [(f) => f.close(), (f) => { f.open({ ...target, id: "target-B" }); f.open(target); }, (f) => { f.deps.menuRef.current.generation += 2; }, (f) => { f.deps.profilesRef.current = [{ ...target, status: "inactive" }]; }, (f) => { f.deps.profilesRef.current = [{ ...target, is_test_account: true }]; }, (f) => { f.deps.profilesRef.current = [{ ...target, auth_user_id: "new-owner" }]; }, (f) => { f.deps.mountedRef.current = false; }]) {
      const gate = deferred(); const f = fixture({ gate });
      f.deps.profilesRef.current = [target, { ...target, id: "target-B" }];
      const pending = f.request(target, action); mutate(f); gate.resolve(); await pending;
      assert.equal(f.calls.some(([key, value]) => key === "prepared" && value), false);
      assert.equal(f.calls.some(([key, value]) => key === "notice" && value), false);
      assert.equal(f.calls.some(([key]) => key === "open" || key === "download"), false);
    }
  }
});

test("actual closed menu cannot start an RPC and an old request cannot clear a new menu's pending lock", async () => {
  const gates = [deferred(), deferred()]; const f = fixture(); let requestIndex = 0;
  f.parent.supabase.rpc = async (name, args) => { f.calls.push(["rpc", name, args]); await gates[requestIndex++].promise; return { data: "01011112222", error: null }; };
  f.close(); await f.request(target, "save"); assert.equal(f.calls.some(([key]) => key === "rpc"), false);
  f.open(target); const first = f.request(target, "save");
  f.close(); f.open(target); const second = f.request(target, "dial");
  const latestLock = f.deps.phonePendingRef.current;
  gates[0].resolve(); await first;
  assert.equal(f.deps.phonePendingRef.current, latestLock);
  assert.equal(f.calls.some(([key, value]) => key === "prepared" && value), false);
  gates[1].resolve(); await second;
  assert.equal(f.calls.filter(([key, value]) => key === "prepared" && value).length, 1);
  assert.equal(f.deps.preparedPhone.action, "dial");
});

test("actual prepared actions recheck account, menu and target state and consume a ready action once", async () => {
  for (const action of ["dial", "save"]) {
    for (const mutate of [(f) => { f.parent.requestsRef.current.epoch = 2; }, (f) => f.close(), (f) => { f.deps.scopeRef.current.generation += 2; }, (f) => { f.deps.profilesRef.current = [{ ...target, is_test_account: true }]; }, (f) => { f.deps.accessRef.current.isPhoneCurrent = () => false; }]) {
      const f = fixture(); await f.request(target, action); mutate(f); f.dial(); f.save();
      assert.equal(f.calls.some(([key]) => key === "open" || key === "download"), false);
    }
  }
  const f = fixture(); await f.request(target); f.dial(); f.dial();
  assert.equal(f.calls.filter(([key]) => key === "open").length, 1);
});

test("actual save reports a recoverable download failure without claiming contact storage", async () => {
  const f = fixture(); await f.request(target, "save");
  f.deps.downloadMemberContact = () => { throw new Error("synthetic download failure"); }; f.save();
  assert.ok(f.calls.some(([key, value]) => key === "notice" && value?.error && value.text.includes("다운로드 설정")));
  assert.equal(f.deps.preparedPhoneRef.current, null);
});

test("actual manager callbacks recheck latest permissions, target protections and member data", () => {
  for (const patch of [{}, { auth_user_id: "actor-A" }, { is_system_admin: true }]) {
    const f = fixture(); f.deps.profilesRef.current = [{ ...target, ...patch }]; f.manage("kick");
    assert.equal(f.calls.some(([key]) => key === "kick"), false);
  }
  for (const patch of [{ auth_user_id: "actor-A" }, { is_system_admin: true }, { status: "inactive" }, { is_test_account: true }]) {
    const f = fixture({ canManage: true }); f.deps.profilesRef.current = [{ ...target, ...patch }]; f.manage("kick");
    assert.equal(f.calls.some(([key]) => key === "kick"), false);
  }
  const f = fixture({ canManage: true }); f.deps.profilesRef.current = [{ ...target, name: "수정된 합성 이름" }]; f.manage("edit");
  assert.equal(f.calls.find(([key]) => key === "edit")[1].name, "수정된 합성 이름");
  assert.equal(f.deps.menuRef.current.memberId, null);
  const kick = fixture({ canManage: true }); kick.manage("kick"); assert.ok(kick.calls.some(([key]) => key === "kick"));
});

test("actual hidden QA manager can edit and kick through existing authority while contact RPC and actions stay blocked", async () => {
  const hiddenManager = { ...actor, role: "manager", is_test_account: true };
  for (const action of ["edit", "kick"]) {
    const f = fixture({ canManage: true, actorProfile: hiddenManager });
    assert.equal(f.deps.phoneScope, ""); assert.equal(f.parent.isPhoneCurrent(), false);
    await f.request(target, "dial"); await f.request(target, "save"); f.dial(); f.save();
    assert.equal(f.calls.some(([key]) => key === "rpc" || key === "open" || key === "download"), false);
    f.manage(action); assert.ok(f.calls.some(([key]) => key === action));
  }
  const html = renderDirectory({ selected: true, canManage: true, phoneScope: "", isPhoneCurrent: () => false });
  assert.match(html, /정보 수정/); assert.match(html, /회원 강퇴/);
  assert.doesNotMatch(html, /전화걸기|연락처 저장|tel:/);
});

function syncFixtureActor(f, owner, canManage) {
  f.deps.accessRef.current.currentUserId = owner;
  f.deps.accessRef.current.canManage = canManage;
  callback("../components/member-directory.tsx", "MemberDirectory", "syncMenuActor", { ...f.deps, currentUserId: owner, canManage })();
}

test("actual manager callbacks reject owner and permission changes before effects, including A-B-A and old menu callbacks", () => {
  for (const mutate of [(f) => syncFixtureActor(f, "actor-B", true), (f) => syncFixtureActor(f, "", true), (f) => syncFixtureActor(f, "actor-A", false), (f) => { syncFixtureActor(f, "actor-B", true); syncFixtureActor(f, "actor-A", true); }, (f) => { syncFixtureActor(f, "actor-A", false); syncFixtureActor(f, "actor-A", true); }, (f) => { f.close(); f.open(target); }, (f) => { f.deps.mountedRef.current = false; }]) {
    for (const action of ["edit", "kick"]) {
      const f = fixture({ canManage: true });
      const stale = callback("../components/member-directory.tsx", "MemberDirectory", "manageMember", { ...f.deps, menuGeneration: f.deps.menuRef.current.generation });
      mutate(f); stale(action);
      assert.equal(f.calls.some(([key]) => key === "edit" || key === "kick"), false);
    }
  }
  const f = fixture({ canManage: true }); syncFixtureActor(f, "actor-A", false); syncFixtureActor(f, "actor-A", true);
  f.manage("edit"); assert.equal(f.calls.some(([key]) => key === "edit"), false);
  f.open(target); f.manage("edit"); assert.ok(f.calls.some(([key]) => key === "edit"));
});

test("vCard preserves UTF-8 name and validated phone only, escapes injected lines and folds within 75 octets", () => {
  const name = "합성;이름,\\🏃\r\nEMAIL:injected".repeat(8);
  const vcard = contact.createMemberVCard(name, "tel:+821011112222");
  assert.ok(vcard.endsWith("\r\n")); assert.doesNotMatch(vcard.replace(/\r\n/g, ""), /[\r\n]/);
  for (const line of vcard.trimEnd().split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  const unfolded = vcard.replace(/\r\n /g, "");
  assert.match(unfolded, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nN:/);
  assert.ok(unfolded.includes("FN:합성\\;이름\\,\\\\🏃\\nEMAIL:injected"));
  assert.match(unfolded, /\r\nTEL;TYPE=VOICE:\+821011112222\r\nEND:VCARD\r\n$/);
  assert.match(contact.createMemberVCard("합성 회원", "tel:021112222"), /TEL;TYPE=VOICE:021112222\r\n/);
  assert.doesNotMatch(unfolded, /\r\nEMAIL:|PHOTO:|UID:|ORG:/);
  assert.equal(contact.createMemberVCard(" ", "tel:01011112222").includes("FN:회원\r\n"), true);
  for (const uri of ["javascript:alert(1)", "tel:01011112222\r\nEMAIL:injected", "tel:123", "tel:010;11112222"]) assert.throws(() => contact.createMemberVCard("합성 회원", uri), phone.MemberPhoneError);
});

test("contact filenames remove paths, controls, bidi overrides and reserved names without splitting emoji", () => {
  for (const name of ["../../합성\r\n이름<>:\"/\\|?*", "\u2028\u2029\u202e합성\u2066", "...", "CON", "LPT1.txt", " "]) {
    const filename = contact.memberContactFilename(name);
    assert.match(filename, /\.vcf$/); assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/);
    assert.doesNotMatch(filename, /^[. ]/); assert.ok(Array.from(filename.slice(0, -4)).length <= 80);
  }
  assert.equal(contact.memberContactFilename("CON"), "member.vcf");
  assert.equal(contact.memberContactFilename("🏃".repeat(100)), "🏃".repeat(80) + ".vcf");
});

test("download uses a UTF-8 local vCard blob and removes its link and URL on timeout or explicit cleanup", async () => {
  for (const mode of ["cleanup", "timeout", "failure"]) {
    const calls = []; let blob; let timerCallback;
    const link = { click: () => { calls.push(["click"]); if (mode === "failure") throw new Error("synthetic click failure"); }, remove: () => calls.push(["remove"]) };
    const actual = moduleExports("./member-contact.ts", { "./member-phone": phone }, { URL: { createObjectURL: (value) => { blob = value; return "blob:synthetic"; }, revokeObjectURL: (url) => calls.push(["revoke", url]) }, document: { createElement: (tag) => { assert.equal(tag, "a"); return link; }, body: { appendChild: (value) => { assert.equal(value, link); calls.push(["append"]); } } }, setTimeout: (fn, delay) => { assert.equal(delay, 30_000); timerCallback = fn; return 123; }, clearTimeout: (id) => calls.push(["clear", id]) });
    if (mode === "failure") assert.throws(() => actual.downloadMemberContact("합성 🏃", "tel:01011112222"));
    else { const cleanup = actual.downloadMemberContact("합성 🏃", "tel:01011112222"); assert.equal(calls.some(([key]) => key === "revoke"), false); if (mode === "timeout") timerCallback(); cleanup(); cleanup(); }
    assert.equal(blob.type, "text/vcard;charset=utf-8"); assert.ok((await blob.text()).includes("FN:합성 🏃\r\n"));
    assert.equal(link.href, "blob:synthetic"); assert.equal(link.download, "합성 🏃.vcf"); assert.equal(link.hidden, true);
    assert.equal(calls.filter(([key]) => key === "remove").length, 1); assert.equal(calls.filter(([key]) => key === "revoke").length, 1);
  }
});
