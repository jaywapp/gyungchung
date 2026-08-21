import assert from "node:assert/strict";
import test from "node:test";

import { applyPermissionBatch, updatePendingPermissionChanges } from "./permission-batch.mjs";

const baseRows = [{ officer_title: "vice_president", permission: "events.manage" }];

test("collects permission edits locally and removes a reverted edit", () => {
  const pending = updatePendingPermissionChanges(baseRows, [], "vice_president", "events.manage", false);
  assert.deepEqual(pending, [{ officer_title: "vice_president", permission: "events.manage", enabled: false, expected_enabled: true }]);

  const reverted = updatePendingPermissionChanges(baseRows, pending, "vice_president", "events.manage", true);
  assert.deepEqual(reverted, []);
});

test("applies the complete permission draft with one RPC", async () => {
  const changes = [{ officer_title: "treasurer", permission: "notices.manage", enabled: true, expected_enabled: false }];
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { status: "applied", applied_count: 1 }, error: null };
    },
  };

  const result = await applyPermissionBatch(supabase, changes);

  assert.deepEqual(result, { status: "applied", applied_count: 1 });
  assert.deepEqual(calls, [{ name: "apply_officer_permission_batch", args: { permission_changes: changes } }]);
});

test("keeps the caller's draft intact when the RPC fails", async () => {
  const changes = [{ officer_title: "treasurer", permission: "notices.manage", enabled: true, expected_enabled: false }];
  const original = structuredClone(changes);
  const rpcError = Object.assign(new Error("network unavailable"), { code: "NETWORK" });
  const supabase = { rpc: async () => ({ data: null, error: rpcError }) };

  await assert.rejects(applyPermissionBatch(supabase, changes), rpcError);
  assert.deepEqual(changes, original);
});

test("rejects an incomplete server result instead of reporting partial success", async () => {
  const changes = [
    { officer_title: "treasurer", permission: "notices.manage", enabled: true, expected_enabled: false },
    { officer_title: "vice_president", permission: "fees.manage", enabled: true, expected_enabled: false },
  ];
  const original = structuredClone(changes);
  const supabase = { rpc: async () => ({ data: { status: "applied", applied_count: 1 }, error: null }) };

  await assert.rejects(applyPermissionBatch(supabase, changes), { code: "INCOMPLETE_PERMISSION_BATCH" });
  assert.deepEqual(changes, original);
});
