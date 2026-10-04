import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("exports", "require", ...Object.keys(globals), output)(exports, (name) => {
    assert.ok(imports[name], "unexpected runtime import: " + name);
    return imports[name];
  }, ...Object.values(globals));
  return exports;
}
const { AvatarUrlCache } = compile("./profile-avatar.ts");
const path = "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.jpg";
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Run the actual Provider body and effects, retaining its hook state across renders. */
function fixture() {
  const slots = []; let cursor = 0; let effects = []; let now = 0;
  const changed = (before, after) => !before || before.length !== after.length || before.some((value, index) => value !== after[index]);
  const hooks = {
    createContext: (value) => ({ Provider: "provider", value }), useContext: (context) => context.value,
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() };
      });
    },
  };
  const listeners = new Map();
  const window = { setInterval: () => 1, clearInterval() {}, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); } };
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const { MemberAvatarProvider } = compile("../components/member-avatar-provider.tsx", {
    react: hooks, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
  }, { window, document });
  const requests = [];
  const client = { storage: { from: () => ({ createSignedUrls(paths) {
    let resolve; const promise = new Promise((done) => { resolve = done; });
    requests.push({ paths, resolve }); return promise;
  } }) } };
  const cache = new AvatarUrlCache(() => now);
  const scope = "synthetic-owner-A:full";
  cache.setScope(scope);
  const current = () => true;
  const render = () => {
    cursor = 0; effects = [];
    return MemberAvatarProvider({ client, cache, revision: cache.revision, paths: [path], scope, isCurrent: current, children: null }).props.value;
  };
  const commit = () => { for (const effect of effects) effect(); effects = []; };
  const resolve = async (index, label) => { requests[index].resolve({ data: [{ path, signedUrl: label }], error: null }); await flush(); };
  const prime = async () => { assert.deepEqual(render(), {}); commit(); await resolve(0, "synthetic:old"); assert.deepEqual(render(), { [path]: "synthetic:old" }); };
  return { cache, scope, render, commit, resolve, requests, prime, focus: () => listeners.get("focus")?.(), setNow: (value) => { now = value; } };
}

test("the actual Provider hides retained React URLs on A-to-B-to-A before a new signing effect runs", async () => {
  const f = fixture(); await f.prime();
  f.cache.clear(); f.cache.setScope("synthetic-owner-B"); f.cache.clear(); f.cache.setScope(f.scope);
  assert.deepEqual(f.render(), {}, "same scope must not expose a previous generation's React state");
  assert.equal(f.requests.length, 1);
  f.commit(); assert.equal(f.requests.length, 2, "revision changes must restart signing even with identical scope and paths");
  await f.resolve(1, "synthetic:fresh"); assert.deepEqual(f.render(), { [path]: "synthetic:fresh" });
});

test("the actual Provider hides old URLs when permissions shrink and return before the next render", async () => {
  const f = fixture(); await f.prime();
  f.cache.setScope("synthetic-owner-A:reduced"); f.cache.setScope(f.scope);
  assert.deepEqual(f.render(), {});
  f.commit(); await f.resolve(1, "synthetic:restored"); assert.deepEqual(f.render(), { [path]: "synthetic:restored" });
});

test("a previous Provider signing callback cannot restore URLs while the new generation is still pending", async () => {
  const f = fixture(); await f.prime();
  f.setNow(241_000); f.focus(); assert.equal(f.requests.length, 2);
  f.cache.clear(); f.cache.setScope(f.scope);
  assert.deepEqual(f.render(), {}); f.commit(); assert.equal(f.requests.length, 3);
  await f.resolve(1, "synthetic:late-old"); assert.deepEqual(f.render(), {});
  await f.resolve(2, "synthetic:current"); assert.deepEqual(f.render(), { [path]: "synthetic:current" });
});
