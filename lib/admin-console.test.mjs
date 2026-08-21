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
