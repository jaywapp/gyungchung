import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/admin-console.tsx", import.meta.url), "utf8");

test("keeps destructive member and team actions out of implicit form submission", () => {
  assert.doesNotMatch(source, /name="action" value="(?:password|generate|stats|matches)"/);
  assert.match(source, /if \(config\.type === "teams" && !submitAction\) return;/);
  assert.match(source, /<button type="button" className="cta" onClick=\{\(\) => onAction\("generate"\)\}/);
  assert.match(source, /<button type="button" className="cta secondary" onClick=\{\(\) => onAction\("stats"\)\}/);
  assert.match(source, /<button type="button" className="cta secondary" onClick=\{\(\) => onAction\("matches"\)\}/);
});

test("requires an accessible confirmation before resetting a member password", () => {
  assert.match(source, /<button type="button" className="cta secondary" disabled=\{saving\} onClick=\{\(\) => setPasswordResetOpen\(true\)\}>/);
  assert.match(source, /<ConfirmDialog title="비밀번호를 초기화할까요\?" target=\{String\(row\.name \?\? "이 회원"\)\} description="이 회원은 기존 비밀번호를 더 이상 사용할 수 없으며, 비밀번호가 1234로 변경됩니다\."/);
  assert.match(source, /onConfirm=\{\(\) => void confirmPasswordReset\(\)\}/);
});

test("requires confirmation before regenerating existing teams and preserves the Enter guard", () => {
  assert.match(source, /if \(config\.type === "teams" && !submitAction\) return;/);
  assert.match(source, /if \(config\.type === "teams" && submitAction === "generate" && \(teamEvent\.event_teams\?\.length \?\? 0\) > 0\)/);
  assert.match(source, /title="팀을 다시 만들까요\?"/);
  assert.match(source, /팀 편성 \$\{replacedTeams\.length\}개, 팀 스코어 \$\{replacedScores\}건, 선수 골 \$\{replacedGoals\}골, 평점 \$\{replacedRatings\}건, 경기 \$\{replacedMatches\.length\}경기와 득점자 \$\{replacedScorers\.length\}건/);
  assert.match(source, /onConfirm=\{confirmTeamRegeneration\}/);
  assert.match(source, /successMessage = `\$\{nextEvent\.event_teams\?\.length \?\? 0\}개 팀 · \$\{generatedParticipantCount\}명으로 팀 편성을 완료했습니다\.`/);
});

test("cancels regeneration without calling the RPC and preserves editing after a failure", () => {
  assert.match(source, /onCancel=\{\(\) => setPendingTeamRegeneration\(null\)\}/);
  assert.match(source, /setSaving\(false\); if \(error\) return onError\(toErrorMessage\(error\)\);/);
  assert.match(source, /if \(!error\) \{\s+const nextEvent = \{ \.\.\.teamEvent/);
});

test("blocks duplicate regeneration confirmation while the request is running", () => {
  assert.match(source, /if \(!pendingTeamRegeneration \|\| teamRegenerationInFlight\.current\) return;/);
  assert.match(source, /teamRegenerationInFlight\.current = true;/);
  assert.match(source, /finally\(\(\) => \{ teamRegenerationInFlight\.current = false; \}\)/);
});
