import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../components/clubhouse.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("clubhouse.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function evaluate(node, dependencies) {
  assert.ok(node, "the actual production callback must be found");
  const code = ts.transpileModule("const actual = " + node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code + "; return actual;")(...Object.values(dependencies));
}
function callback(name, dependencies) {
  const component = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AccountModal");
  let value;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) value = node.initializer; ts.forEachChild(node, visit); };
  visit(component);
  return evaluate(value, dependencies);
}

function fixture() {
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  const calls = [];
  const state = { mounted: true, current: true };
  const deps = {
    supabase: {}, profile: { auth_user_id: "synthetic-owner", avatar_path: null }, eligible: true, busy: false,
    isCurrent: () => state.current, savingRef: { current: false }, mountedRef: { current: true },
    setSaving: (value) => calls.push(["saving", value]), onBusyChange: (value) => calls.push(["busy", value]),
    setError: (value) => calls.push(["error", value]), setStatus: (value) => calls.push(["status", value]),
    saveProfileAvatar: async () => { calls.push(["save"]); return gate; },
    onSaved: async (path) => calls.push(["saved", path]), onRefresh: async () => calls.push(["refresh"]),
    AvatarRequestError: Error, onClose: () => calls.push(["close"]),
  };
  return { deps, calls, state, resolve, change: callback("changeAvatar", deps), close: callback("close", deps) };
}

test("actual account handler synchronously blocks duplicate saves and closing while pending", async () => {
  const f = fixture();
  const pending = f.change(new Blob(["synthetic"]));
  await f.change(new Blob(["duplicate"])); f.close();
  assert.equal(f.calls.filter(([kind]) => kind === "save").length, 1);
  assert.equal(f.calls.some(([kind]) => kind === "close"), false);
  f.resolve({ path: "synthetic-path", cleanupFailed: false }); await pending;
  assert.equal(f.calls.filter(([kind]) => kind === "saved").length, 1);
  f.close(); assert.equal(f.calls.at(-1)[0], "close");
});

test("actual account handler suppresses old owner results and notices", async () => {
  const f = fixture(); const pending = f.change(new Blob(["synthetic"]));
  f.state.current = false; f.deps.mountedRef.current = false;
  f.resolve({ path: "old-owner-path", cleanupFailed: false }); await pending;
  assert.equal(f.calls.some(([kind]) => kind === "saved"), false);
  assert.equal(f.calls.some(([kind, value]) => kind === "status" && value), false);
});

test("actual parent owner guard rejects A to B to A auth transitions and revoked profile eligibility", () => {
  let guard;
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "AccountModal") {
      const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(tree) === "isCurrent");
      guard = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const deps = { user: { id: "A" }, me: { id: "profile-A" }, userRef: { current: { id: "A" } }, requestsRef: { current: { epoch: 1 } }, avatarOwnerEpoch: 1,
    accessRef: { current: { profile: { id: "profile-A", status: "active", must_change_password: false } } } };
  const check = evaluate(guard, deps);
  assert.equal(check(), true);
  deps.userRef.current = { id: "B" }; deps.requestsRef.current.epoch = 2; assert.equal(check(), false);
  deps.userRef.current = { id: "A" }; deps.requestsRef.current.epoch = 3; assert.equal(check(), false);
  deps.requestsRef.current.epoch = 1; deps.accessRef.current.profile.status = "inactive"; assert.equal(check(), false);
  deps.accessRef.current.profile.status = "active"; deps.accessRef.current.profile.must_change_password = true; assert.equal(check(), false);
});
