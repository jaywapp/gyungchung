import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const output = ts.transpileModule(readFileSync(new URL("./web-push.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function("require", "exports", output)(() => ({}), exports);
const { WebPushController, parseWebPushRecord, parseWebPushPreferences, readWebPushSource } = exports;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000010";
const initial = () => ({ id, proof: "a".repeat(64), owner: null, epoch: 0, revision: 0, revocationProof: null, pendingRevocation: null, bindingPending: false, optedIn: false });
const preferences = () => ({ enabled: true, attendance_enabled: true, schedule_enabled: true, notices_enabled: true, event_reminders_enabled: true, rsvp_reminders_enabled: true, participation_enabled: true, feedback_enabled: true });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function harness(options = {}) {
  let record = initial(), binding = null, permission = "default", currentPreferences = preferences();
  const calls = [], writes = [];
  const ports = {
    read: () => structuredClone(record), write(value) { if (options.writeFails) throw new Error("Full storage"); record = structuredClone(value); writes.push(structuredClone(value)); },
    lock: (operation) => operation(), binding: async (value) => { if (options.bindingFails) throw new Error("Unavailable storage"); binding = structuredClone(value); }, randomProof: () => "b".repeat(64),
    support: () => "supported", permission: () => permission,
    requestPermission() { calls.push(["permission"]); permission = "granted"; return Promise.resolve(permission); },
    subscription: async () => ({ endpoint: "https://web.push.apple.com/synthetic", keys: { p256dh: "synthetic", auth: "synthetic" } }),
    unsubscribe: async () => { calls.push(["unsubscribe"]); if (options.unsubscribeFails) throw new Error("Unavailable subscription"); },
    async rpc(name, args, identity) {
      calls.push([name, structuredClone(args), identity]);
      if (options.rpc) { const result = await options.rpc(name, args, identity); if (result !== undefined) return result; }
      if (name === "get_notification_settings") return { preferences: currentPreferences };
      if (name === "save_notification_preferences") { currentPreferences = { ...currentPreferences, ...args.target_preferences }; return { preferences: currentPreferences }; }
      if (name === "reserve_web_push_installation") return { installation_id: id, transition_epoch: args.target_transition_epoch, binding_revision: args.target_binding_revision, stale: false, reserved: true, expires_at: "2030-01-01T00:00:00Z" };
      if (name === "register_web_push_installation") return { installation_id: id, transition_epoch: args.target_transition_epoch, binding_revision: 1, stale: false, enabled: true };
      if (name === "revoke_web_push_installation") return { installation_id: id, transition_epoch: args.target_transition_epoch, binding_revision: args.target_binding_revision, revoked: true, terminal: true, enabled: false };
      return { queued: true };
    },
  };
  const controller = new WebPushController(ports);
  return { controller, calls, writes, record: () => record, binding: () => binding, setPermission: (value) => { permission = value; } };
}
test("permission starts synchronously on the click, then ownership proof is persisted before reservation", async () => {
  const h = harness(); await h.controller.setOwner(owner);
  h.calls.length = 0;
  const enabled = h.controller.enable();
  assert.equal(h.calls[0][0], "permission");
  await enabled;
  const reservation = h.calls.find((call) => call[0] === "reserve_web_push_installation");
  assert.ok(h.writes.some((record) => record.bindingPending && record.revocationProof === reservation[1].target_revocation_proof));
  assert.equal(h.controller.getSnapshot().connected, true);
  assert.equal(h.binding().owner, owner); assert.equal(h.binding().revision, 1);
});
test("storage failure prevents network reservation and registration", async () => {
  const h = harness({ writeFails: true }); await h.controller.setOwner(owner); await h.controller.enable();
  assert.equal(h.calls.some(([name]) => name === "reserve_web_push_installation" || name === "register_web_push_installation"), false);
  assert.equal(h.controller.getSnapshot().connected, false);
});
test("logout while registration is in flight leaves a revision-zero revocation and discards late success", async () => {
  const waiting = deferred(), entered = deferred();
  const h = harness({ rpc: async (name, args) => {
    if (name === "register_web_push_installation") { entered.resolve(); await waiting.promise; return { installation_id: id, transition_epoch: args.target_transition_epoch, binding_revision: 1, stale: false, enabled: true }; }
    if (name === "revoke_web_push_installation") throw new Error("Offline");
  } });
  await h.controller.setOwner(owner);
  const enabled = h.controller.enable(); await entered.promise;
  await h.controller.beforeLogout();
  assert.equal(h.record().owner, null); assert.equal(h.record().pendingRevocation.revision, 0); assert.equal(h.binding().enabled, false);
  waiting.resolve(); await enabled;
  assert.equal(h.controller.getSnapshot().connected, false); assert.equal(h.record().owner, null);
});
test("a pending offline revocation blocks binding another account until the proof is cleared", async () => {
  const h = harness({ rpc: async (name) => { if (name === "revoke_web_push_installation") throw new Error("Offline"); } });
  await h.controller.setOwner(owner); await h.controller.enable(); await h.controller.beforeLogout();
  await h.controller.setOwner(other); await h.controller.enable();
  assert.equal(h.calls.filter(([name]) => name === "register_web_push_installation").length, 1);
  assert.ok(h.record().pendingRevocation); assert.equal(h.controller.getSnapshot().connected, false);
});
test("logout still clears local delivery when one browser storage is unavailable", async () => {
  for (const options of [{ writeFails: true }, { bindingFails: true }, { bindingFails: true, writeFails: true }]) {
    const h = harness(options); await h.controller.beforeLogout();
    assert.equal(h.calls.some(([name]) => name === "unsubscribe"), true);
  }
  const h = harness({ bindingFails: true, unsubscribeFails: true });
  await assert.rejects(h.controller.beforeLogout(), /알림 연결을 해제/);
});
test("late settings responses from an old account cannot replace the new account state", async () => {
  const waiting = deferred(), entered = deferred();
  const h = harness({ rpc: async (name, _args, identity) => {
    if (name === "get_notification_settings" && identity === owner) { entered.resolve(); await waiting.promise; return { preferences: { ...preferences(), enabled: false } }; }
  } });
  const first = h.controller.setOwner(owner); await entered.promise;
  await h.controller.setOwner(other); waiting.resolve(); await first;
  assert.equal(h.controller.getSnapshot().owner, other); assert.equal(h.controller.getSnapshot().preferences.enabled, true);
});
test("master off immediately removes the worker display binding without changing the browser permission", async () => {
  const h = harness(); await h.controller.setOwner(owner); await h.controller.enable();
  await h.controller.savePreferences({ enabled: false });
  assert.equal(h.binding().enabled, false); assert.equal(h.controller.getSnapshot().permission, "granted");
});
test("master on re-registers a previously opted-in device without requesting permission again", async () => {
  const h = harness(); await h.controller.setOwner(owner); await h.controller.enable();
  await h.controller.savePreferences({ enabled: false });
  await h.controller.savePreferences({ enabled: true });
  assert.equal(h.controller.getSnapshot().connected, true);
  assert.equal(h.calls.filter(([name]) => name === "permission").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "register_web_push_installation").length, 2);
});
test("stored ownership and settings reject invalid shapes; source links require the matching account", () => {
  assert.throws(() => parseWebPushRecord({ ...initial(), epoch: -1 }));
  assert.throws(() => parseWebPushRecord({ ...initial(), pendingRevocation: undefined }));
  assert.throws(() => parseWebPushPreferences({ preferences: { enabled: true } }));
  assert.equal(readWebPushSource(owner, `?gc_source=${id}&gc_owner=${owner}`), id);
  assert.equal(readWebPushSource(other, `?gc_source=${id}&gc_owner=${owner}`), null);
  assert.equal(readWebPushSource(owner, `?gc_source=https://outside.test&gc_owner=${owner}`), null);
});
