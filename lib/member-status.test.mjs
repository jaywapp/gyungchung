import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./member-status.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { requiresMemberApprovalConfirmation } = compiledModule.exports;

test("pending member keeps the pending status when unrelated fields are saved", () => {
  assert.equal(requiresMemberApprovalConfirmation("pending", "pending"), false);
});

test("pending member requires confirmation before becoming active", () => {
  assert.equal(requiresMemberApprovalConfirmation("pending", "active"), true);
});
