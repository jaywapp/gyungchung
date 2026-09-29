import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./update-notes.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { updateNotes, updateSourceLabels } = compiledModule.exports;

test("every update note has a unique id, even when dates repeat", () => {
  const ids = updateNotes.map((note) => note.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
});

test("every update note names a known source with a badge label", () => {
  for (const note of updateNotes) {
    assert.ok(note.source in updateSourceLabels, `${note.id} has source ${note.source}`);
  }
  assert.deepEqual(updateSourceLabels, { feedback: "제보", request: "직접 요청" });
});

test("update notes carry a valid date and positive PR numbers", () => {
  for (const note of updateNotes) {
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/, note.id);
    assert.ok(note.pullRequests.every((number) => Number.isInteger(number) && number > 0), note.id);
    assert.ok(note.changes.length > 0, note.id);
  }
});
