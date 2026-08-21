import type { ParticipationQuestionResult, ParticipationResultOption, QuestionType } from "@/lib/types";

export function parseParticipationResults(value: unknown): ParticipationQuestionResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.question_id !== "string" || typeof item.prompt !== "string" || !isQuestionType(item.type)) return [];
    const options = Array.isArray(item.options) ? item.options.flatMap(parseOption) : [];
    return [{
      question_id: item.question_id,
      prompt: item.prompt,
      type: item.type,
      response_count: toNonNegativeInteger(item.response_count),
      average: typeof item.average === "number" && Number.isFinite(item.average) ? item.average : null,
      options,
    } satisfies ParticipationQuestionResult];
  });
}

function parseOption(value: unknown): ParticipationResultOption[] {
  if (!isRecord(value) || typeof value.option_id !== "string" || typeof value.label !== "string") return [];
  return [{ option_id: value.option_id, label: value.label, count: toNonNegativeInteger(value.count) }];
}

function toNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isQuestionType(value: unknown): value is QuestionType {
  return value === "single_choice" || value === "multiple_choice" || value === "short_text" || value === "long_text" || value === "rating" || value === "yes_no";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
