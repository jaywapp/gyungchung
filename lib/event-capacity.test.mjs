import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./event-capacity.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { getEventCapacity } = compiledModule.exports;

test("includes scheduled guests in the capacity total", () => {
  assert.deepEqual(getEventCapacity(18, 15, 2), { capacity: 18, memberCount: 15, guestCount: 2, totalCount: 17, remaining: 1, status: "nearly_full" });
});

test("marks two or fewer remaining seats as nearly full", () => {
  assert.equal(getEventCapacity(18, 14, 2).status, "nearly_full");
  assert.equal(getEventCapacity(18, 15, 2).status, "nearly_full");
});

test("does not signal a limit when capacity is unset", () => {
  assert.deepEqual(getEventCapacity(null, 17, 3), { capacity: null, memberCount: 17, guestCount: 3, totalCount: 20, remaining: null, status: "unlimited" });
});

test("distinguishes full and over-capacity events", () => {
  assert.equal(getEventCapacity(18, 16, 2).status, "full");
  assert.deepEqual(getEventCapacity(18, 17, 2), { capacity: 18, memberCount: 17, guestCount: 2, totalCount: 19, remaining: -1, status: "over_capacity" });
});
