import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
const accountState = readFileSync("lib/account-state.ts", "utf8");
const readme = readFileSync("README.md", "utf8");

test("admin-managed onboarding explains new, pending, inactive, and active account paths", () => {
  assert.match(clubhouse, /운영진이 회원 프로필과 로그인 계정을 직접 등록합니다/);
  assert.match(clubhouse, /회원 프로필을 찾지 못했습니다/);
  assert.match(clubhouse, /MemberRestrictionNotice/);
  assert.match(accountState, /profile\.status === "active"/);
  assert.match(accountState, /승인 대기/);
  assert.match(accountState, /활동 재개/);
  assert.match(readme, /공개 회원가입, 가입 신청, 거절, 재신청 화면은 제공하지 않습니다/);
});
