import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./participation-validation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { createSubmittedAnswers, findFirstMissingRequiredQuestion, getRequiredQuestionIdFromRpcError, hasAnswer } = compiledModule.exports;

const question = (id, type, isRequired = true) => ({
  id,
  form_id: "form-1",
  prompt: "Question",
  type,
  is_required: isRequired,
  position: 0,
  min_value: type === "rating" ? 1 : null,
  max_value: type === "rating" ? 5 : null,
  participation_options: [],
});

test("validates blank, partial, and multiple required participation answers", () => {
  assert.equal(hasAnswer(question("text", "short_text"), "   "), false);
  assert.equal(hasAnswer(question("multiple", "multiple_choice"), []), false);

  const questions = [question("single", "single_choice"), question("multiple", "multiple_choice"), question("optional", "long_text", false)];
  const answers = { single: "option-1", multiple: [] };
  assert.equal(findFirstMissingRequiredQuestion(questions, answers)?.id, "multiple");

  assert.deepEqual(createSubmittedAnswers(questions, { single: "option-1", multiple: ["option-2"], optional: "" }), [
    { question_id: "single", answer: "option-1" },
    { question_id: "multiple", answer: ["option-2"] },
  ]);

  assert.equal(getRequiredQuestionIdFromRpcError({ message: "Required answer is missing for question 7e8d5f5e-60c4-4cac-9a82-3e39eb15d540" }), "7e8d5f5e-60c4-4cac-9a82-3e39eb15d540");
});
