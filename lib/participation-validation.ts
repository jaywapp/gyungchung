import type { ParticipationQuestion } from "@/lib/types";

export type ParticipationAnswerValue = string | string[] | number;

export function hasAnswer(question: ParticipationQuestion, value: ParticipationAnswerValue | undefined) {
  if (value === undefined) return false;
  if (question.type === "multiple_choice") return Array.isArray(value) && value.length > 0;
  if (question.type === "short_text" || question.type === "long_text") return typeof value === "string" && value.trim().length > 0;
  if (question.type === "rating") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string" && value.length > 0;
}

export function findFirstMissingRequiredQuestion(questions: ParticipationQuestion[], answers: Record<string, ParticipationAnswerValue>) {
  return questions.find((question) => question.is_required && !hasAnswer(question, answers[question.id]));
}

export function createSubmittedAnswers(questions: ParticipationQuestion[], answers: Record<string, ParticipationAnswerValue>) {
  return questions
    .filter((question) => hasAnswer(question, answers[question.id]))
    .map((question) => ({ question_id: question.id, answer: answers[question.id] }));
}

export function getRequiredQuestionIdFromRpcError(error: unknown) {
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "";
  return message.match(/Required answer is missing for question ([0-9a-f-]{36})/i)?.[1];
}
