import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
const feedback = readFileSync("components/feedback-hub.tsx", "utf8");
const participation = readFileSync("components/participation-hub.tsx", "utf8");
const feedbackTypes = readFileSync("lib/ui-feedback.ts", "utf8");

test("failure and partial-success messages use accessible toast kinds", () => {
  assert.match(feedbackTypes, /ToastKind = "success" \| "warning" \| "error"/);
  assert.match(feedback, /내부 접수는 완료했지만 GitHub 연결에 실패했습니다\.[\s\S]*"warning"/);
  assert.match(feedback, /showError\(toast, "GitHub 이슈를 연결하지 못했습니다\./);
  assert.match(feedback, /showError\(toast, "회원 승인이 완료된 뒤 의견을 등록할 수 있습니다\./);
  assert.match(participation, /showError\(toast, "회원 승인 후 참여할 수 있습니다\./);
  assert.match(clubhouse, /showError\(showToast, "회원 승인 후 참석 여부를 등록할 수 있습니다\./);
  assert.match(clubhouse, /showError\(showToast, "로그인 연결을 준비 중입니다\./);
  assert.match(clubhouse, /toast warning.*role="status".*aria-live="polite"/);
  assert.match(clubhouse, /toast error.*role="alert".*aria-live="assertive"/);
});
