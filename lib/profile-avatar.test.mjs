import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./profile-avatar.ts", import.meta.url), "utf8");
const exports = {};
new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
const { AvatarUrlCache, saveProfileAvatar, compressProfileAvatar, validateAvatarInput, getAvatarAccessScope } = exports;
const owner = "00000000-0000-4000-8000-000000000001";
const oldPath = `${owner}/00000000-0000-4000-8000-000000000002.jpg`;
const otherPath = `${owner}/00000000-0000-4000-8000-000000000003.jpg`;
const jpeg = new Blob(["synthetic jpeg"], { type: "image/jpeg" });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };

function fixture() {
  const calls = [];
  const state = { current: true, referenced: oldPath, rpcError: null, uploadError: null, cleanupError: null, readError: null, gate: null, switchAt: null, commitBeforeError: false };
  const client = {
    storage: { from(bucket) {
      assert.equal(bucket, "profile-avatars");
      return {
        async upload(path, blob, options) {
          calls.push({ action: "upload", path, blob, options });
          if (state.gate) await state.gate.promise;
          if (state.switchAt === "upload") state.current = false;
          return { error: state.uploadError };
        },
        async remove(paths) {
          calls.push({ action: "remove", paths });
          assert.ok(!paths.includes(state.referenced), "never delete the currently referenced avatar");
          return { error: state.cleanupError };
        },
      };
    } },
    async rpc(name, payload) {
      calls.push({ action: "rpc", name, payload });
      if (!state.rpcError || state.commitBeforeError) state.referenced = payload.next_avatar_path;
      if (state.switchAt === "rpc") state.current = false;
      return { data: state.referenced, error: state.rpcError };
    },
    from(table) {
      assert.equal(table, "profiles");
      return { select(fields) {
        assert.equal(fields, "avatar_path");
        return { eq(column, value) {
          assert.equal(column, "auth_user_id"); assert.equal(value, owner);
          return { async maybeSingle() { calls.push({ action: "reconcile" }); return { data: { avatar_path: state.referenced }, error: state.readError }; } };
        } };
      } };
    },
  };
  const save = (file = jpeg) => saveProfileAvatar(client, { owner, expectedPath: oldPath, file, isCurrent: () => state.current, compress: async () => jpeg });
  return { client, state, calls, save };
}

test("avatar access requires the current active linked owner and completed password change", () => {
  const profile = { id: "synthetic", auth_user_id: owner, status: "active", must_change_password: false };
  assert.ok(getAvatarAccessScope(owner, profile, []));
  for (const row of [{ ...profile, status: "inactive" }, { ...profile, must_change_password: true }, { ...profile, auth_user_id: "other" }]) assert.equal(getAvatarAccessScope(owner, row, []), "");
  assert.notEqual(getAvatarAccessScope(owner, profile, ["fees.manage"]), getAvatarAccessScope(owner, profile, []));
});

test("only supported nonempty input images up to ten MiB are accepted", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.doesNotThrow(() => validateAvatarInput(new Blob(["synthetic"], { type })));
  for (const blob of [new Blob([], { type: "image/jpeg" }), new Blob(["<svg/>"], { type: "image/svg+xml" }), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" })]) assert.throws(() => validateAvatarInput(blob));
});

test("image decoding crops the center, removes source metadata by JPEG encoding, and closes the bitmap", async (t) => {
  let closed = false;
  const draws = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage: (...args) => draws.push(args) }), toBlob(done, type) { assert.equal(type, "image/jpeg"); done(jpeg); } };
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  t.after(() => { globalThis.createImageBitmap = originalBitmap; globalThis.document = originalDocument; });
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 800, close() { closed = true; } });
  globalThis.document = { createElement: () => canvas };
  const result = await compressProfileAvatar(new Blob(["synthetic PNG with metadata"], { type: "image/png" }));
  assert.equal(result, jpeg); assert.equal(canvas.width, 512); assert.equal(canvas.height, 512);
  assert.deepEqual(draws[0].slice(1), [200, 0, 800, 800, 0, 0, 512, 512]); assert.equal(closed, true);
});

test("replace uploads a new immutable JPEG, commits CAS, and only then removes the old object", async () => {
  const f = fixture(); const result = await f.save();
  assert.deepEqual(f.calls.map((call) => call.action), ["upload", "rpc", "remove"]);
  assert.deepEqual(f.calls[0].options, { contentType: "image/jpeg", upsert: false });
  assert.ok(result.path.startsWith(`${owner}/`)); assert.notEqual(result.path, oldPath);
  assert.deepEqual(f.calls[1].payload, { next_avatar_path: result.path, expected_avatar_path: oldPath });
  assert.deepEqual(f.calls[2].paths, [oldPath]);
});

test("remove commits nullable path before deleting the previous object", async () => {
  const f = fixture(); const result = await f.save(null);
  assert.equal(result.path, null); assert.deepEqual(f.calls.map((call) => call.action), ["rpc", "remove"]);
});

test("CAS conflict rolls back only the newly uploaded object", async () => {
  const f = fixture(); f.state.rpcError = { code: "40001" };
  await assert.rejects(f.save(), (error) => error.code === "40001");
  assert.deepEqual(f.calls.at(-1).paths, [f.calls[0].path]); assert.equal(f.state.referenced, oldPath);
});

test("failed upload never calls the profile RPC or deletes the old file", async () => {
  const f = fixture(); f.state.uploadError = {};
  await assert.rejects(f.save()); assert.deepEqual(f.calls.map((call) => call.action), ["upload"]);
});

test("owner change after upload stops RPC and never deletes using the new session", async () => {
  const f = fixture(); f.state.switchAt = "upload";
  await assert.rejects(f.save(), (error) => error.code === "stale"); assert.deepEqual(f.calls.map((call) => call.action), ["upload"]);
});

test("owner change after committed RPC preserves the new object and skips old cleanup", async () => {
  const f = fixture(); f.state.switchAt = "rpc";
  await assert.rejects(f.save(), (error) => error.code === "stale"); assert.deepEqual(f.calls.map((call) => call.action), ["upload", "rpc"]);
});

test("lost RPC response reconciles a committed avatar and never rolls it back", async () => {
  const f = fixture(); f.state.rpcError = { code: "" }; f.state.commitBeforeError = true;
  const result = await f.save(); assert.equal(result.path, f.state.referenced);
  assert.deepEqual(f.calls.map((call) => call.action), ["upload", "rpc", "reconcile", "remove"]);
  assert.deepEqual(f.calls.at(-1).paths, [oldPath]);
});

test("unknown commit and failed reconciliation preserve files for a later refresh", async () => {
  const f = fixture(); f.state.rpcError = {}; f.state.readError = {};
  await assert.rejects(f.save(), (error) => error.code === "unknown");
  assert.deepEqual(f.calls.map((call) => call.action), ["upload", "rpc", "reconcile"]);
});

test("a definite failure reports rollback cleanup failure without false success", async () => {
  const f = fixture(); f.state.rpcError = { code: "42501" }; f.state.cleanupError = {};
  await assert.rejects(f.save(), (error) => error.code === "42501" && error.cleanupFailed);
});

test("old cleanup failure preserves a successful commit and reports its limited failure", async () => {
  const f = fixture(); f.state.cleanupError = {};
  const result = await f.save(); assert.equal(result.cleanupFailed, true); assert.equal(result.path, f.state.referenced);
});

test("no photos performs zero signed URL calls; batching deduplicates and expires before five minutes", async () => {
  let now = 0; const calls = []; const cache = new AvatarUrlCache(() => now);
  const client = { storage: { from: () => ({ async createSignedUrls(paths, ttl) { calls.push({ paths, ttl }); return { data: paths.map((path) => ({ path, signedUrl: `synthetic:${path}` })), error: null }; } }) } };
  assert.deepEqual(await cache.read(client, [], "owner", () => true), {}); assert.equal(calls.length, 0);
  const urls = await cache.read(client, [oldPath, otherPath, oldPath], "owner", () => true);
  assert.equal(Object.keys(urls).length, 2); assert.equal(calls.length, 1); assert.equal(calls[0].ttl, 300);
  await cache.read(client, [oldPath], "owner", () => true); assert.equal(calls.length, 1);
  now = 240_001; await cache.read(client, [oldPath], "owner", () => true); assert.equal(calls.length, 2);
});

test("concurrent signing is shared and old identity responses cannot repopulate the cache", async () => {
  const cache = new AvatarUrlCache(); const gate = deferred(); let calls = 0;
  const client = { storage: { from: () => ({ async createSignedUrls() { calls += 1; await gate.promise; return { data: [{ path: oldPath, signedUrl: "synthetic:old" }], error: null }; } }) } };
  const a = cache.read(client, [oldPath], "owner-A", () => true); const b = cache.read(client, [oldPath], "owner-A", () => true);
  assert.equal(calls, 1); cache.setScope("owner-B"); gate.resolve();
  assert.deepEqual(await a, {}); assert.deepEqual(await b, {});
});

test("read errors and a revoked viewer return initials without retaining a URL", async () => {
  const cache = new AvatarUrlCache(); let calls = 0;
  const client = { storage: { from: () => ({ async createSignedUrls() { calls += 1; throw new Error("synthetic offline"); } }) } };
  assert.deepEqual(await cache.read(client, [oldPath], "owner", () => true), {});
  assert.deepEqual(await cache.read(client, [oldPath], "owner", () => false), {}); assert.equal(calls, 1);
});

test("a delayed signed response cannot extend expiry beyond the request lifetime", async () => {
  let now = 0; const cache = new AvatarUrlCache(() => now); const gate = deferred();
  const client = { storage: { from: () => ({ async createSignedUrls() { await gate.promise; return { data: [{ path: oldPath, signedUrl: "synthetic:expired" }], error: null }; } }) } };
  const pending = cache.read(client, [oldPath], "owner", () => true);
  now = 300_001; gate.resolve(); assert.deepEqual(await pending, {});
});
