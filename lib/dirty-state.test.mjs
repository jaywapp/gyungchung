import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./dirty-state.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { countChangedFields, countChangedRecords, countSetChanges, dirtyDialogAction, hasMeaningfulDraft } = compiledModule.exports;

test("only meaningful participation answers make a draft dirty", () => {
  assert.equal(hasMeaningfulDraft({}), false);
  assert.equal(hasMeaningfulDraft({ question: "" }), false);
  assert.equal(hasMeaningfulDraft({ question: [] }), false);
  assert.equal(hasMeaningfulDraft({ question: "answer" }), true);
  assert.equal(hasMeaningfulDraft({ question: ["option"] }), true);
  assert.equal(hasMeaningfulDraft({ question: 0 }), true);
});

test("blocks dirty backdrop clicks and confirms explicit close requests", () => {
  assert.equal(dirtyDialogAction(false, "backdrop"), "close");
  assert.equal(dirtyDialogAction(false, "request"), "close");
  assert.equal(dirtyDialogAction(true, "backdrop"), "ignore");
  assert.equal(dirtyDialogAction(true, "request"), "confirm");
});

test("counts changed team fields and roster selections", () => {
  assert.equal(countChangedFields({ goals: 1, rating: null }, { goals: 2, rating: null }), 1);
  assert.equal(countChangedFields({ score: 0 }, { score: 0, rating: 8 }), 1);
  assert.equal(countSetChanges(["member-a", "member-b"], ["member-b", "member-c"]), 2);
});

test("counts each added, removed, or edited match once", () => {
  const baseline = [
    { id: "match-a", score: 1 },
    { id: "match-b", score: 0 },
  ];
  const current = [
    { id: "match-a", score: 2 },
    { id: "match-c", score: 0 },
  ];
  assert.equal(countChangedRecords(baseline, current), 3);
  assert.equal(countChangedRecords(current, current), 0);
});
