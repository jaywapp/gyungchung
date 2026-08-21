import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./account-state.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { getAccountState, getMembershipRestriction, getMembershipRestrictionCopy } = compiledModule.exports;

test("identifies signed-out, member, and unlinked account states", () => {
  assert.equal(getAccountState(null, null), "signed-out");
  assert.equal(getAccountState({ id: "user-id" }, { id: "profile-id" }), "member");
  assert.equal(getAccountState({ id: "user-id" }, null), "unlinked");
});

test("describes pending and inactive membership restrictions separately", () => {
  assert.equal(getMembershipRestriction(null), null);
  assert.equal(getMembershipRestriction({ status: "active" }), null);
  assert.equal(getMembershipRestriction({ status: "pending" }), "pending");
  assert.equal(getMembershipRestriction({ status: "inactive" }), "inactive");
  assert.match(getMembershipRestrictionCopy("pending").title, /승인/);
  assert.match(getMembershipRestrictionCopy("inactive").title, /활동/);
});
