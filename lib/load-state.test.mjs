import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./load-state.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { getLoadErrors, loadResources } = compiledModule.exports;

test("records every failed clubhouse query instead of treating its data as empty", () => {
  for (const failedResource of loadResources) {
    const results = Object.fromEntries(loadResources.map((resource) => [resource, { error: resource === failedResource ? new Error("injected failure") : null }]));
    const errors = getLoadErrors(results);
    assert.equal(errors[failedResource], true, `${failedResource} failure must be visible`);
    assert.equal(Object.values(errors).filter(Boolean).length, 1, `${failedResource} must not hide unrelated successful sections`);
  }
});
