import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./submission-history.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { canReviewParticipationAnswers, formatParticipationAnswer, indexOwnSubmissions } = compiledModule.exports;

const choiceQuestion = {
  id: "question-id",
  type: "single_choice",
  participation_options: [
    { id: "option-a", label: "오후 4시" },
    { id: "option-b", label: "오후 6시" },
  ],
};

test("multiple choices preserve answer order, first duplicate option and missing options", () => {
  const question = { ...choiceQuestion, type: "multiple_choice", participation_options: [
    ...choiceQuestion.participation_options, { id: "option-a", label: "duplicate" },
  ] };
  assert.equal(formatParticipationAnswer(question, ["option-b", "missing", "option-a", "option-a"]), "오후 6시, 오후 4시, 오후 4시");
  assert.equal(formatParticipationAnswer(question, []), "응답하지 않음");
  assert.equal(formatParticipationAnswer(question, 1), "선택 항목을 확인할 수 없음");
});

test("own submissions preserve last duplicate and never include another member", () => {
  const input = [
    { id: "first", form_id: "f", participant_id: "me" },
    { id: "last", form_id: "f", participant_id: "me" },
    { id: "private", form_id: "other", participant_id: "them" },
  ];
  assert.deepEqual([...indexOwnSubmissions(input, "me").values()].map(x => x.id), ["last"]);
  assert.equal(indexOwnSubmissions([], "me").size, 0);
});

test("selects only the signed-in member's submission", () => {
  const submissions = [
    { id: "other", form_id: "form-id", participant_id: "other-profile" },
    { id: "mine", form_id: "form-id", participant_id: "my-profile" },
  ];

  assert.equal(indexOwnSubmissions(submissions, "my-profile").get("form-id")?.id, "mine");
  assert.equal(indexOwnSubmissions(submissions, undefined).size, 0);
});

test("formats stored option ids as public option labels", () => {
  assert.equal(formatParticipationAnswer(choiceQuestion, "option-b"), "오후 6시");
  assert.equal(
    formatParticipationAnswer({ ...choiceQuestion, type: "multiple_choice" }, ["option-a", "option-b"]),
    "오후 4시, 오후 6시",
  );
});

test("does not allow individual secret-ballot answers to be reviewed", () => {
  assert.equal(canReviewParticipationAnswers(true), false);
  assert.equal(canReviewParticipationAnswers(false), true);
});

test("migration blocks individual secret-ballot answers and keeps ownership checks", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260821121716_protect_submission_history.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /not f\.secret_ballot/i);
  assert.match(migration, /s\.participant_id = \(select private\.current_profile_id\(\)\)/i);
  assert.match(migration, /private\.can_manage_form\(f\.kind\)/i);
  assert.doesNotMatch(migration, /security definer/i);
});
