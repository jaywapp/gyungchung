import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./attendance.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const exports = {};
new Function("exports", output.outputText)(exports);
const { countAttendanceByEvent, getCheckInStatus } = exports;

test("indexed attendance preserves legacy, pending, present, late and absent counts for each event", () => {
  const rows = [
    { event_id: "a", check_in_status: "present", checked_in_at: null },
    { event_id: "a", check_in_status: "late", checked_in_at: "2026-10-03" },
    { event_id: "a", check_in_status: null, checked_in_at: "2026-10-03" },
    { event_id: "a", check_in_status: null, checked_in_at: null },
    { event_id: "b", check_in_status: "absent", checked_in_at: "2026-10-03" },
    { event_id: "b", check_in_status: "present", checked_in_at: null },
  ];
  const indexed = countAttendanceByEvent(rows);
  assert.deepEqual(indexed.get("a"), { present: 2, late: 1, absent: 0 });
  assert.deepEqual(indexed.get("b"), { present: 1, late: 0, absent: 1 });
  assert.equal(indexed.get("empty"), undefined);
  for (const eventId of ["a", "b"]) {
    for (const status of ["present", "late", "absent"]) {
      assert.equal(indexed.get(eventId)[status], rows.filter((row) => row.event_id === eventId && getCheckInStatus(row) === status).length);
    }
  }
  assert.deepEqual(rows[2], { event_id: "a", check_in_status: null, checked_in_at: "2026-10-03" });
});
