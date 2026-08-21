export const GITHUB_FEEDBACK_REPOSITORY = "jaywapp/gyungchung";
export const GITHUB_FEEDBACK_LABEL = "제보";

export type FeedbackPublicationInput = {
  category: string;
  title: string;
  body: string;
  isAnonymous: boolean;
  authorName: string;
};

export type FeedbackPublicationConsent = {
  category: string;
  publishToGithub: boolean;
  consentedAt: string | null;
};

export function normalizeGithubText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style)\b[^>]*>/gi, "")
    .trim();
}

export function hasGithubPublicationConsent(input: FeedbackPublicationConsent) {
  return input.category === "system" && input.publishToGithub && Boolean(input.consentedAt);
}

export function githubFeedbackMarker(feedbackId: string) {
  return `<!-- gyungchung-feedback:${feedbackId} -->`;
}

export function buildGithubPublicationPreview(input: FeedbackPublicationInput) {
  if (input.category !== "system") {
    throw new Error("Only system feedback can be published to GitHub");
  }

  const title = normalizeGithubText(input.title).replace(/\s+/g, " ").slice(0, 120);
  const body = normalizeGithubText(input.body).slice(0, 5000);

  return {
    repository: GITHUB_FEEDBACK_REPOSITORY,
    label: GITHUB_FEEDBACK_LABEL,
    title: `[제보][시스템] ${title}`,
    reporter: input.isAnonymous ? "익명" : normalizeGithubText(input.authorName),
    body,
  };
}

export function buildGithubIssue(input: FeedbackPublicationInput & { feedbackId: string }) {
  const preview = buildGithubPublicationPreview(input);

  return {
    title: preview.title,
    body: [
      "## 시스템 제보",
      "",
      `- 제보자: ${preview.reporter}`,
      "",
      preview.body,
      "",
      "---",
      "",
      githubFeedbackMarker(input.feedbackId),
      "> 경충FC 클럽하우스에서 명시적 공개 동의를 받고 생성된 이슈입니다.",
    ].join("\n"),
    labels: [preview.label],
  };
}
