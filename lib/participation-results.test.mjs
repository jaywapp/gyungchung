import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./participation-results.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { parseParticipationResults } = compiledModule.exports;

test("normalizes aggregate results without accepting malformed or negative counts", () => {
  assert.deepEqual(parseParticipationResults([
    {
      question_id: "q-1",
      prompt: "선호 색상",
      type: "single_choice",
      response_count: 2,
      average: null,
      options: [{ option_id: "o-1", label: "초록", count: 2 }, { option_id: "o-2", label: "파랑", count: -1 }],
    },
    { question_id: "bad", prompt: "잘못된 문항", type: "unknown", response_count: 99, options: [] },
  ]), [{
    question_id: "q-1",
    prompt: "선호 색상",
    type: "single_choice",
    response_count: 2,
    average: null,
    options: [{ option_id: "o-1", label: "초록", count: 2 }, { option_id: "o-2", label: "파랑", count: 0 }],
  }]);
});
