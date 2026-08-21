import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./admin-list-filters.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { filterAdminRows } = compiledModule.exports;

const rows = [
  { item: "pending member", searchValues: ["홍길동", "010-1234-5678"], status: "pending" },
  { item: "active member", searchValues: ["김활동", "010-8765-4321"], status: "active" },
  { item: "guest fee", searchValues: ["용병 이순신", "2026-08-23"], status: "unpaid" },
];

test("filters admin rows by a case-insensitive search query", () => {
  assert.deepEqual(filterAdminRows(rows, "용병").map((row) => row.item), ["guest fee"]);
  assert.deepEqual(filterAdminRows(rows, "010-1234").map((row) => row.item), ["pending member"]);
});

test("combines a status filter with a search query and can reset to all rows", () => {
  assert.deepEqual(filterAdminRows(rows, "", "pending").map((row) => row.item), ["pending member"]);
  assert.deepEqual(filterAdminRows(rows, "김", "pending"), []);
  assert.deepEqual(filterAdminRows(rows, "", "all").map((row) => row.item), ["pending member", "active member", "guest fee"]);
});
