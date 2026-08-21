import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./participation-form-editor.ts", import.meta.url), "utf8")
  .replace('import type { ParticipationQuestion, QuestionType } from "@/lib/types";\n', "");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { answeredFormPolicyViolation, createQuestionDraft, createQuestionDrafts, moveItem, optionsForType, requiresResponseImpactConfirmation, serializeQuestionDrafts, validateQuestionDrafts } = compiledModule.exports;

const savedQuestion = {
  id: "11111111-1111-1111-1111-111111111111",
  form_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  prompt: "기존 문항",
  type: "single_choice",
  is_required: true,
  position: 0,
  min_value: null,
  max_value: null,
  participation_options: [
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", question_id: "11111111-1111-1111-1111-111111111111", label: "두 번째", description: null, candidate_profile_id: null, position: 1 },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", question_id: "11111111-1111-1111-1111-111111111111", label: "첫 번째", description: null, candidate_profile_id: null, position: 0 },
  ],
};

test("form editor initializes saved questions and options in position order", () => {
  const [draft] = createQuestionDrafts([savedQuestion]);
  assert.equal(draft.id, savedQuestion.id);
  assert.deepEqual(draft.options.map((option) => option.label), ["첫 번째", "두 번째"]);
});

test("form editor supports adding and reordering multiple questions", () => {
  const questions = [createQuestionDraft(), createQuestionDraft(), createQuestionDraft()];
  questions.forEach((question, index) => { question.prompt = `${index + 1}번`; });
  const reordered = moveItem(questions, 2, -1);
  assert.deepEqual(reordered.map((question) => question.prompt), ["1번", "3번", "2번"]);
  assert.deepEqual(serializeQuestionDrafts(reordered).map((question) => question.position), [0, 1, 2]);
});

test("saved prompt, required state, and option edits are serialized for the participation screen", () => {
  const [draft] = createQuestionDrafts([savedQuestion]);
  draft.prompt = "수정된 문항";
  draft.isRequired = false;
  draft.options[0].label = "수정된 첫 번째";
  const [payload] = serializeQuestionDrafts([draft]);
  assert.equal(payload.prompt, "수정된 문항");
  assert.equal(payload.is_required, false);
  assert.deepEqual(payload.options.map((option) => option.label), ["수정된 첫 번째", "두 번째"]);
});

test("optional text questions pass while invalid choices and rating ranges fail", () => {
  const optional = createQuestionDraft();
  optional.prompt = "선택 답변";
  optional.type = "long_text";
  optional.isRequired = false;
  optional.options = optionsForType(optional.type, optional.options);
  assert.equal(validateQuestionDrafts([optional]), null);

  const choice = createQuestionDraft();
  choice.prompt = "선택";
  choice.options[0].label = "같음";
  choice.options[1].label = "같음";
  assert.match(validateQuestionDrafts([choice]), /같은 선택지/);

  const rating = createQuestionDraft();
  rating.prompt = "평점";
  rating.type = "rating";
  rating.minValue = 8;
  rating.maxValue = 5;
  assert.match(validateQuestionDrafts([rating]), /최솟값/);
});

test("answered forms require confirmation before prompt changes or removal", () => {
  const [unchanged] = createQuestionDrafts([savedQuestion]);
  assert.equal(requiresResponseImpactConfirmation([savedQuestion], [unchanged]), false);
  assert.equal(requiresResponseImpactConfirmation([savedQuestion], [{ ...unchanged, prompt: "수정 문항" }]), true);
  assert.equal(requiresResponseImpactConfirmation([savedQuestion], []), true);
});

test("answered form policy blocks destructive edits but permits safe changes", () => {
  const [draft] = createQuestionDrafts([savedQuestion]);
  assert.match(answeredFormPolicyViolation([savedQuestion], []), /삭제/);
  assert.match(answeredFormPolicyViolation([savedQuestion], [{ ...draft, type: "long_text" }]), /답변 형식/);
  assert.match(answeredFormPolicyViolation([savedQuestion], [{ ...draft, options: draft.options.slice(1) }]), /선택지/);
  assert.equal(answeredFormPolicyViolation([savedQuestion], [{ ...draft, isRequired: false }]), null);
  assert.equal(answeredFormPolicyViolation([savedQuestion], [{ ...draft, prompt: "오타 수정" }]), null);
});
