import type { ParticipationQuestion, ParticipationSubmission } from "@/lib/types";

export function indexOwnSubmissions(
  submissions: ParticipationSubmission[],
  profileId?: string,
) {
  if (!profileId) return new Map<string, ParticipationSubmission>();
  return new Map(
    submissions
      .filter((submission) => submission.participant_id === profileId)
      .map((submission) => [submission.form_id, submission]),
  );
}

export function canReviewParticipationAnswers(secretBallot: boolean) {
  return !secretBallot;
}

export function formatParticipationAnswer(
  question: ParticipationQuestion,
  answer: ParticipationSubmission["participation_answers"][number]["answer"] | undefined,
) {
  if (answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0)) {
    return "응답하지 않음";
  }

  if (question.type === "single_choice" || question.type === "yes_no") {
    return question.participation_options.find((option) => option.id === answer)?.label ?? "선택 항목을 확인할 수 없음";
  }

  if (question.type === "multiple_choice") {
    if (!Array.isArray(answer)) return "선택 항목을 확인할 수 없음";
    const labels = answer.flatMap((optionId) => {
      const option = question.participation_options.find((item) => item.id === optionId);
      return option ? [option.label] : [];
    });
    return labels.length > 0 ? labels.join(", ") : "선택 항목을 확인할 수 없음";
  }

  if (question.type === "rating" && typeof answer === "number") return `${answer}점`;
  return String(answer);
}
