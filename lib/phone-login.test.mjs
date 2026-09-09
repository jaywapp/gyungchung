import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./phone-login.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exports = {};
new Function("exports", outputText)(exports);
const { createPhoneLoginCredentials, getPhoneLoginError } = exports;

test("phone login normalizes local and international numbers without altering passwords", () => {
  for (const phone of ["010-1234-5678", "010 1234 5678", "+82 10-1234-5678", "821012345678"]) {
    assert.deepEqual(createPhoneLoginCredentials(phone, "keep-this-password"), { phone: "+821012345678", password: "keep-this-password" });
  }
  assert.notEqual(createPhoneLoginCredentials("01012345678", "1234").password, "1234");
});

test("phone login rejects email addresses, malformed numbers, and text with embedded digits", () => {
  for (const phone of ["member@example.com", "01012345678@example.com", "call01012345678", "1234", "", "+12025550123"]) {
    assert.equal(createPhoneLoginCredentials(phone, "password"), null);
  }
});

test("login errors provide recovery without exposing whether a phone number is registered", () => {
  assert.match(getPhoneLoginError({ code: "invalid_credentials" }), /전화번호와 비밀번호/);
  assert.match(getPhoneLoginError({ code: "over_request_rate_limit" }), /잠시 후/);
  assert.match(getPhoneLoginError({ code: "phone_not_confirmed" }), /운영진/);
});

test("all login surfaces are phone-only while tool authorization remains available", () => {
  const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
  const consent = readFileSync("app/oauth/consent/page.tsx", "utf8");
  const callback = readFileSync("app/auth/callback/route.ts", "utf8");
  for (const source of [clubhouse, consent]) {
    assert.doesNotMatch(source, /signInWithOAuth|linkIdentity|legacyEmail|email: identifier/);
    assert.match(source, /createPhoneLoginCredentials/);
  }
  assert.doesNotMatch(callback, /exchangeCodeForSession|searchParams\.get\("next"\)/);
  assert.match(callback, /auth=phone-only/);
  assert.match(consent, /approveAuthorization\(authorizationId\)/);
  assert.match(consent, /denyAuthorization\(authorizationId\)/);
});
