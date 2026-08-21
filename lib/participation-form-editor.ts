import type { ParticipationQuestion, QuestionType } from "@/lib/types";

export type ParticipationOptionDraft = {
  clientId: string;
  id: string | null;
  label: string;
};

export type ParticipationQuestionDraft = {
  clientId: string;
  id: string | null;
  prompt: string;
  type: QuestionType;
  isRequired: boolean;
  initialIsRequired: boolean | null;
  minValue: number;
  maxValue: number;
  options: ParticipationOptionDraft[];
};

let draftSequence = 0;

function nextClientId(prefix: "question" | "option") {
  draftSequence += 1;
  return `${prefix}-${draftSequence}`;
}

export function createOptionDraft(label = "", id: string | null = null): ParticipationOptionDraft {
  return { clientId: nextClientId("option"), id, label };
}

export function createQuestionDraft(question?: ParticipationQuestion): ParticipationQuestionDraft {
  if (question) {
    return {
      clientId: nextClientId("question"),
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      isRequired: question.is_required,
      initialIsRequired: question.is_required,
      minValue: question.min_value ?? 1,
      maxValue: question.max_value ?? 5,
      options: [...question.participation_options]
        .sort((left, right) => left.position - right.position)
        .map((option) => createOptionDraft(option.label, option.id)),
    };
  }

  return {
    clientId: nextClientId("question"),
    id: null,
    prompt: "",
    type: "single_choice",
    isRequired: true,
    initialIsRequired: null,
    minValue: 1,
    maxValue: 5,
    options: [createOptionDraft(), createOptionDraft()],
  };
}

export function createQuestionDrafts(questions: ParticipationQuestion[] | undefined) {
  const drafts = [...(questions ?? [])]
    .sort((left, right) => left.position - right.position)
    .map(createQuestionDraft);
  return drafts.length > 0 ? drafts : [createQuestionDraft()];
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function optionsForType(type: QuestionType, current: ParticipationOptionDraft[] = []) {
  if (type === "yes_no") {
    return [
      current[0] ? { ...current[0], label: current[0].label || "찬성" } : createOptionDraft("찬성"),
      current[1] ? { ...current[1], label: current[1].label || "반대" } : createOptionDraft("반대"),
    ];
  }
  if (type === "single_choice" || type === "multiple_choice") {
    return current.length >= 2 ? current : [...current, ...Array.from({ length: 2 - current.length }, () => createOptionDraft())];
  }
  return [];
}

export function validateQuestionDrafts(questions: ParticipationQuestionDraft[]) {
  if (questions.length === 0) return "문항을 하나 이상 추가해 주세요.";
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (!question.prompt.trim()) return `${index + 1}번 문항의 내용을 입력해 주세요.`;
    if (question.prompt.trim().length > 500) return `${index + 1}번 문항은 500자 이하로 입력해 주세요.`;
    if (["single_choice", "multiple_choice", "yes_no"].includes(question.type)) {
      const labels = question.options.map((option) => option.label.trim());
      if (labels.length < 2 || labels.some((label) => !label)) return `${index + 1}번 문항의 선택지를 2개 이상 입력해 주세요.`;
      if (labels.some((label) => label.length > 200)) return `${index + 1}번 문항의 선택지는 200자 이하로 입력해 주세요.`;
      if (new Set(labels).size !== labels.length) return `${index + 1}번 문항에 같은 선택지가 두 번 있습니다.`;
      if (question.type === "yes_no" && labels.length !== 2) return `${index + 1}번 찬반 문항은 선택지가 정확히 2개여야 합니다.`;
    }
    if (question.type === "rating" && (!Number.isInteger(question.minValue) || !Number.isInteger(question.maxValue) || question.minValue < 0 || question.maxValue > 10 || question.minValue >= question.maxValue)) {
      return `${index + 1}번 평점 문항은 0~10 사이에서 최솟값이 최댓값보다 작아야 합니다.`;
    }
  }
  return null;
}

export function serializeQuestionDrafts(questions: ParticipationQuestionDraft[]) {
  return questions.map((question, position) => ({
    id: question.id,
    prompt: question.prompt.trim(),
    type: question.type,
    is_required: question.isRequired,
    position,
    min_value: question.type === "rating" ? question.minValue : null,
    max_value: question.type === "rating" ? question.maxValue : null,
    options: question.options.map((option, optionPosition) => ({
      id: option.id,
      label: option.label.trim(),
      position: optionPosition,
    })),
  }));
}

export function requiresResponseImpactConfirmation(original: ParticipationQuestion[], drafts: ParticipationQuestionDraft[]) {
  const draftById = new Map(drafts.filter((draft) => draft.id).map((draft) => [draft.id, draft]));
  return original.some((question) => {
    const draft = draftById.get(question.id);
    return !draft || draft.prompt.trim() !== question.prompt.trim();
  });
}

export function answeredFormPolicyViolation(original: ParticipationQuestion[], drafts: ParticipationQuestionDraft[]) {
  const draftById = new Map(drafts.filter((draft) => draft.id).map((draft) => [draft.id, draft]));
  for (const question of original) {
    const draft = draftById.get(question.id);
    if (!draft) return "응답이 있는 문항은 삭제할 수 없습니다. 새 문항을 추가하거나 기존 문항의 순서만 바꿔 주세요.";
    if (draft.type !== question.type) return "응답이 있는 문항의 답변 형식은 바꿀 수 없습니다.";
    if (!question.is_required && draft.isRequired) return "기존 응답이 누락 상태가 될 수 있어 선택 문항을 필수로 바꿀 수 없습니다.";
    if (question.type === "rating" && (draft.minValue !== question.min_value || draft.maxValue !== question.max_value)) return "응답이 있는 평점 문항의 점수 범위는 바꿀 수 없습니다.";
    const draftOptions = new Map(draft.options.filter((option) => option.id).map((option) => [option.id, option]));
    for (const option of question.participation_options) {
      const draftOption = draftOptions.get(option.id);
      if (!draftOption) return "응답에 사용된 기존 선택지는 삭제할 수 없습니다.";
      if (draftOption.label.trim() !== option.label.trim()) return "응답에 사용된 기존 선택지 문구는 바꿀 수 없습니다. 필요한 경우 새 선택지를 추가해 주세요.";
    }
  }
  if (drafts.some((draft) => !draft.id && draft.isRequired)) return "이미 응답한 회원에게 누락 문항이 생기므로 새 문항은 선택 문항으로만 추가할 수 있습니다.";
  return null;
}
