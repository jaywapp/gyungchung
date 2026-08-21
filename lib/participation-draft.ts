import type { ParticipationQuestion } from "@/lib/types";

export type ParticipationDraftAnswer = string | string[] | number;
export type ParticipationDraftAnswers = Record<string, ParticipationDraftAnswer>;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ParticipationDraftScope = {
  userId: string;
  formId: string;
  secretBallot: boolean;
  endsAt: string | null;
  questions: ParticipationQuestion[];
};

type StoredParticipationDraft = {
  version: 1;
  savedAt: number;
  expiresAt: number;
  answers: ParticipationDraftAnswers;
};

const storagePrefix = "gyungchung:participation-draft:v1";
export const PARTICIPATION_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export function loadParticipationDraft(storage: DraftStorage, scope: ParticipationDraftScope, now = Date.now()): ParticipationDraftAnswers {
  if (scope.secretBallot) {
    clearParticipationDraft(storage, scope);
    return {};
  }

  const key = getDraftKey(scope);
  try {
    const stored = storage.getItem(key);
    if (!stored) return {};
    const draft = JSON.parse(stored) as unknown;
    if (!isStoredDraft(draft)) {
      storage.removeItem(key);
      return {};
    }

    const formEndsAt = parseTimestamp(scope.endsAt);
    const expiresAt = Math.min(draft.expiresAt, draft.savedAt + PARTICIPATION_DRAFT_TTL_MS, formEndsAt ?? Number.POSITIVE_INFINITY);
    if (expiresAt <= now) {
      storage.removeItem(key);
      return {};
    }

    const answers = sanitizeAnswers(draft.answers, scope.questions);
    if (!hasMeaningfulAnswers(answers)) {
      storage.removeItem(key);
      return {};
    }
    return answers;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return {};
  }
}

export function saveParticipationDraft(storage: DraftStorage, scope: ParticipationDraftScope, answers: ParticipationDraftAnswers, now = Date.now()) {
  if (scope.secretBallot) {
    clearParticipationDraft(storage, scope);
    return false;
  }

  const sanitizedAnswers = sanitizeAnswers(answers, scope.questions);
  const formEndsAt = parseTimestamp(scope.endsAt);
  const expiresAt = Math.min(now + PARTICIPATION_DRAFT_TTL_MS, formEndsAt ?? Number.POSITIVE_INFINITY);
  if (!hasMeaningfulAnswers(sanitizedAnswers) || expiresAt <= now) {
    clearParticipationDraft(storage, scope);
    return false;
  }

  const draft: StoredParticipationDraft = { version: 1, savedAt: now, expiresAt, answers: sanitizedAnswers };
  try {
    storage.setItem(getDraftKey(scope), JSON.stringify(draft));
    return true;
  } catch {
    clearParticipationDraft(storage, scope);
    return false;
  }
}

export function clearParticipationDraft(storage: DraftStorage, scope: Pick<ParticipationDraftScope, "userId" | "formId">) {
  try {
    storage.removeItem(getDraftKey(scope));
  } catch {
    // Removing a draft should never block closing or submitting the form.
  }
}

function getDraftKey(scope: Pick<ParticipationDraftScope, "userId" | "formId">) {
  return `${storagePrefix}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.formId)}`;
}

function sanitizeAnswers(value: unknown, questions: ParticipationQuestion[]): ParticipationDraftAnswers {
  if (!isRecord(value)) return {};
  const answers: ParticipationDraftAnswers = {};

  for (const question of questions) {
    const answer = value[question.id];
    if (question.type === "short_text" && typeof answer === "string") {
      answers[question.id] = answer.slice(0, 500);
      continue;
    }
    if (question.type === "long_text" && typeof answer === "string") {
      answers[question.id] = answer.slice(0, 5000);
      continue;
    }
    if (question.type === "rating" && typeof answer === "number" && Number.isInteger(answer)) {
      const minimum = question.min_value ?? 1;
      const maximum = question.max_value ?? 5;
      if (answer >= minimum && answer <= maximum) answers[question.id] = answer;
      continue;
    }

    const optionIds = new Set(question.participation_options.map((option) => option.id));
    if ((question.type === "single_choice" || question.type === "yes_no") && typeof answer === "string" && optionIds.has(answer)) {
      answers[question.id] = answer;
      continue;
    }
    if (question.type === "multiple_choice" && Array.isArray(answer)) {
      const selected = [...new Set(answer.filter((item): item is string => typeof item === "string" && optionIds.has(item)))];
      if (selected.length > 0) answers[question.id] = selected;
    }
  }

  return answers;
}

function hasMeaningfulAnswers(answers: ParticipationDraftAnswers) {
  return Object.values(answers).some((answer) => Array.isArray(answer) ? answer.length > 0 : typeof answer === "string" ? answer.trim().length > 0 : true);
}

function parseTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isStoredDraft(value: unknown): value is StoredParticipationDraft {
  return isRecord(value)
    && value.version === 1
    && typeof value.savedAt === "number"
    && Number.isFinite(value.savedAt)
    && typeof value.expiresAt === "number"
    && Number.isFinite(value.expiresAt)
    && isRecord(value.answers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
