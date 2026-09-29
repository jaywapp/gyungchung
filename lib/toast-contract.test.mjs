import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
const feedback = readFileSync("components/feedback-hub.tsx", "utf8");
const participation = readFileSync("components/participation-hub.tsx", "utf8");
const feedbackTypes = readFileSync("lib/ui-feedback.ts", "utf8");

test("failure and partial-success messages use accessible toast kinds", () => {
  assert.match(feedbackTypes, /ToastKind = "success" \| "warning" \| "error"/);
  assert.match(feedback, /비공개로 접수했습니다\. 내 제보에서 진행 상황을 확인할 수 있습니다\./);
  assert.match(feedback, /showError\(toast, "회원 승인이 완료된 뒤 의견을 등록할 수 있습니다\./);
  assert.match(participation, /showError\(toast, "회원 승인 후 참여할 수 있습니다\./);
  assert.match(clubhouse, /showError\(showToast, getMembershipRestrictionCopy\(membershipRestriction\)\.action\)/);
  assert.match(clubhouse, /return "로그인 연결을 준비 중입니다\./);
  assert.match(clubhouse, /toast warning.*role="status".*aria-live="polite"/);
  assert.match(clubhouse, /toast error.*role="alert".*aria-live="assertive"/);
});
