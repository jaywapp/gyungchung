import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./participation-draft.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { clearParticipationDraft, loadParticipationDraft, saveParticipationDraft, PARTICIPATION_DRAFT_TTL_MS } = compiledModule.exports;

const longTextQuestion = question("long-text", "long_text");

test("restores a full 5,000-character Korean answer after a same-tab refresh", () => {
  const storage = createStorage();
  const draftScope = scope({ questions: [longTextQuestion] });
  const answer = "가".repeat(5000);

  assert.equal(saveParticipationDraft(storage, draftScope, { "long-text": answer }, 1_000), true);
  assert.deepEqual(loadParticipationDraft(storage, draftScope, 2_000), { "long-text": answer });
});

test("isolates drafts by user and form", () => {
  const storage = createStorage();
  const draftScope = scope({ questions: [longTextQuestion] });
  saveParticipationDraft(storage, draftScope, { "long-text": "작성 중" }, 1_000);

  assert.deepEqual(loadParticipationDraft(storage, draftScope, 2_000), { "long-text": "작성 중" });
  assert.deepEqual(loadParticipationDraft(storage, { ...draftScope, userId: "user-b" }, 2_000), {});
  assert.deepEqual(loadParticipationDraft(storage, { ...draftScope, formId: "form-b" }, 2_000), {});
});

test("expires drafts after 24 hours or the form deadline, whichever comes first", () => {
  const storage = createStorage();
  const draftScope = scope({ questions: [longTextQuestion] });
  saveParticipationDraft(storage, draftScope, { "long-text": "하루 동안 보존" }, 1_000);

  assert.deepEqual(loadParticipationDraft(storage, draftScope, 1_000 + PARTICIPATION_DRAFT_TTL_MS - 1), { "long-text": "하루 동안 보존" });
  assert.deepEqual(loadParticipationDraft(storage, draftScope, 1_000 + PARTICIPATION_DRAFT_TTL_MS), {});

  const deadlineScope = scope({ questions: [longTextQuestion], endsAt: new Date(10_000).toISOString() });
  saveParticipationDraft(storage, deadlineScope, { "long-text": "마감 전" }, 1_000);
  assert.deepEqual(loadParticipationDraft(storage, deadlineScope, 10_000), {});
});

test("never persists secret-ballot answers", () => {
  const storage = createStorage();
  const draftScope = scope({ questions: [longTextQuestion], secretBallot: true });

  assert.equal(saveParticipationDraft(storage, draftScope, { "long-text": "민감한 선택" }, 1_000), false);
  assert.equal(storage.entries.size, 0);
  assert.deepEqual(loadParticipationDraft(storage, draftScope, 2_000), {});
});

test("drops answers that no longer match the current form definition", () => {
  const storage = createStorage();
  const originalScope = scope({ questions: [question("choice", "single_choice", ["option-a"])] });
  saveParticipationDraft(storage, originalScope, { choice: "option-a" }, 1_000);

  const editedScope = scope({ questions: [question("choice", "single_choice", ["option-b"])] });
  assert.deepEqual(loadParticipationDraft(storage, editedScope, 2_000), {});
  assert.equal(storage.entries.size, 0);
});

test("explicit removal deletes a restorable draft", () => {
  const storage = createStorage();
  const draftScope = scope({ questions: [longTextQuestion] });
  saveParticipationDraft(storage, draftScope, { "long-text": "삭제할 초안" }, 1_000);

  clearParticipationDraft(storage, draftScope);
  assert.deepEqual(loadParticipationDraft(storage, draftScope, 2_000), {});
});

test("submission failure returns before the component clears the draft", () => {
  const component = readFileSync("components/participation-hub.tsx", "utf8");
  assert.match(component, /if \(error\) return toast\(toErrorMessage\(error\), "error"\);\s*const storage = getDraftStorage\(\);\s*if \(storage\) clearParticipationDraft\(storage/);
  assert.match(component, /window\.addEventListener\("beforeunload", warnBeforeUnload\)/);
});

function scope({ questions, userId = "user-a", formId = "form-a", secretBallot = false, endsAt = null }) {
  return { userId, formId, secretBallot, endsAt, questions };
}

function question(id, type, optionIds = []) {
  return {
    id,
    form_id: "form-a",
    prompt: id,
    type,
    is_required: false,
    position: 0,
    min_value: type === "rating" ? 1 : null,
    max_value: type === "rating" ? 5 : null,
    participation_options: optionIds.map((optionId, position) => ({
      id: optionId,
      question_id: id,
      label: optionId,
      description: null,
      candidate_profile_id: null,
      position,
    })),
  };
}

function createStorage() {
  const entries = new Map();
  return {
    entries,
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}
