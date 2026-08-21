import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGithubIssue,
  buildGithubPublicationPreview,
  hasGithubPublicationConsent,
} from "../_shared/feedback-publication.ts";

test("GitHub publication requires system feedback and explicit consent", () => {
  const cases = [
    { category: "system", publishToGithub: true, consentedAt: "2026-08-21T00:00:00.000Z", expected: true },
    { category: "system", publishToGithub: true, consentedAt: null, expected: false },
    { category: "system", publishToGithub: false, consentedAt: null, expected: false },
    { category: "operation", publishToGithub: true, consentedAt: "2026-08-21T00:00:00.000Z", expected: false },
  ];

  for (const item of cases) {
    assert.equal(hasGithubPublicationConsent(item), item.expected);
  }
});

test("anonymous system feedback never includes the member name", () => {
  const issue = buildGithubIssue({
    feedbackId: "00000000-0000-0000-0000-000000000001",
    category: "system",
    title: "로그인 오류",
    body: "카카오 로그인에서 오류가 발생합니다.",
    isAnonymous: true,
    authorName: "홍길동",
  });

  assert.match(issue.title, /^\[제보\]\[시스템\]/);
  assert.match(issue.body, /- 제보자: 익명/);
  assert.doesNotMatch(issue.body, /홍길동/);
});

test("identified system feedback previews and publishes the member name", () => {
  const input = {
    category: "system",
    title: "  화면   오류  ",
    body: "버튼이 보이지 않습니다.",
    isAnonymous: false,
    authorName: "홍길동",
  };
  const preview = buildGithubPublicationPreview(input);
  const issue = buildGithubIssue({ ...input, feedbackId: "00000000-0000-0000-0000-000000000002" });

  assert.equal(preview.title, "[제보][시스템] 화면 오류");
  assert.equal(preview.reporter, "홍길동");
  assert.match(issue.body, /- 제보자: 홍길동/);
  assert.match(issue.body, /gyungchung-feedback:00000000-0000-0000-0000-000000000002/);
});

test("general feedback cannot be rendered as a public GitHub issue", () => {
  assert.throws(() => buildGithubPublicationPreview({
    category: "operation",
    title: "운영 의견",
    body: "내부에서 검토해 주세요.",
    isAnonymous: false,
    authorName: "홍길동",
  }), /Only system feedback/);
});
