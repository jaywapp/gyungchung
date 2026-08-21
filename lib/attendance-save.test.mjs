import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./attendance-save.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { applyAttendanceSaveSuccesses, buildAttendanceSaveItems, reconcileAttendanceSaveResults } = compiledModule.exports;

const records = [
  { event_id: "event", member_id: "a", status: "going", check_in_status: null, checked_in_at: null, checked_in_by: null, updated_at: "" },
  { event_id: "event", member_id: "b", status: "not_going", check_in_status: null, checked_in_at: null, checked_in_by: null, updated_at: "" },
  { event_id: "event", member_id: "c", status: "undecided", check_in_status: null, checked_in_at: null, checked_in_by: null, updated_at: "" },
];

test("builds only changed rows and keeps each response status", () => {
  const items = buildAttendanceSaveItems(
    ["a", "b", "c"],
    records,
    { a: "present", b: null, c: "late" },
    { a: null, b: null, c: null },
    new Set(),
  );

  assert.deepEqual(items, [
    { member_id: "a", response_status: "going", check_in_status: "present" },
    { member_id: "c", response_status: "undecided", check_in_status: "late" },
  ]);
});

test("keeps legacy rows pending until their normalized save succeeds", () => {
  const items = buildAttendanceSaveItems(
    ["a"],
    records,
    { a: "present" },
    { a: "present" },
    new Set(["a"]),
  );

  assert.equal(items.length, 1);
});

test("partial success leaves only failed rows for retry", () => {
  const requested = buildAttendanceSaveItems(
    ["a", "b", "c"],
    records,
    { a: "present", b: "absent", c: "late" },
    { a: null, b: null, c: null },
    new Set(),
  );
  const result = reconcileAttendanceSaveResults(requested, [
    { result_member_id: "a", succeeded: true, error_message: null },
    { result_member_id: "b", succeeded: false, error_message: "injected failure" },
    { result_member_id: "c", succeeded: true, error_message: null },
  ]);
  const saved = applyAttendanceSaveSuccesses({ a: null, b: null, c: null }, requested, result.succeededIds);
  const retry = buildAttendanceSaveItems(["a", "b", "c"], records, { a: "present", b: "absent", c: "late" }, saved, new Set());

  assert.deepEqual(result.succeededIds, ["a", "c"]);
  assert.deepEqual(result.failures, [{ memberId: "b", message: "injected failure" }]);
  assert.deepEqual(retry, [{ member_id: "b", response_status: "not_going", check_in_status: "absent" }]);
});

test("treats missing RPC rows as failures so uncertain writes remain retryable", () => {
  const requested = [{ member_id: "a", response_status: "going", check_in_status: "present" }];
  const result = reconcileAttendanceSaveResults(requested, []);

  assert.deepEqual(result.succeededIds, []);
  assert.equal(result.failures[0].memberId, "a");
});
