import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("./welcome-content.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { DEFAULT_WELCOME_CONTENT, validateWelcomeContent, isWelcomeContent, isApprovedIosUrl, isPublicAndroidUrl } = compiledModule.exports;
const draft = () => structuredClone(DEFAULT_WELCOME_CONTENT);

test("initial content contains onboarding without invented officers or removed rules", () => {
  const content = draft();
  assert.deepEqual(validateWelcomeContent(content, true), []);
  assert.deepEqual(content.officers, []);
  assert.equal("rules" in content, false);
});

test("unknown/private fields, removed rules and invalid JSON types are rejected", () => {
  const cases = [null, [], { ...draft(), auth_user_id: "private" }, { ...draft(), rules: {} }, { ...draft(), android: { ...draft().android, enabled: "true" } }];
  for (const value of cases) {
    assert.equal(isWelcomeContent(value), false);
    assert.ok(validateWelcomeContent(value).length);
  }
  const content = draft();
  content.officers = [{ id: "officer1", name: "", role: "", bio: "", phone: "private" }];
  assert.equal(isWelcomeContent(content), false);
  assert.ok(validateWelcomeContent(content, true).length);
});

test("unfinished drafts save but cannot publish missing titles or entered officer details", () => {
  const content = draft();
  content.title = "";
  content.officers = [{ id: "officer1", name: "", role: "", bio: "" }];
  assert.deepEqual(validateWelcomeContent(content), []);
  assert.ok(validateWelcomeContent(content, true).length >= 3);
  content.title = "안내";
  content.officers[0].name = "<script>plain text</script>";
  content.officers[0].role = "운영진";
  assert.deepEqual(validateWelcomeContent(content, true), []);
});

test("duplicate or reserved IDs and oversized text cannot be published", () => {
  const content = draft();
  content.officers = [{ id: "staff", name: "운영진", role: "회장", bio: "" }, { id: "staff", name: "운영진", role: "총무", bio: "" }];
  content.introduction = "가".repeat(1001);
  assert.ok(validateWelcomeContent(content).length >= 2);
  content.officers[0].id = "officer1\n";
  assert.ok(validateWelcomeContent(content).length);
  content.officers[0].id = "account-guide";
  assert.ok(validateWelcomeContent(content).length);
});

test("iOS distribution only enables official HTTPS addresses using the DB ASCII policy", () => {
  const valid = ["https://apps.apple.com/kr/app/club/id1234", "https://testflight.apple.com/join/abc123", "https://apps.apple.com/a/../b", "https://apps.apple.com/kr/app/id1234?l=ko&source=welcome"];
  valid.forEach((url) => assert.equal(isApprovedIosUrl(url), true));
  const invalid = ["javascript:alert(1)", "http://apps.apple.com/kr/app/id1234", "https://apps.apple.com.evil.test/club", "https://someone@apps.apple.com/club", "https://apps.apple.com:444/club", "https://example.test/club", "https://apps.apple.com/", "https://apps.apple.com/가", "https://apps.apple.com/a\\b", "https://apps.apple.com/app/id1\n", "https://apps.apple.com/app/id1\r"];
  invalid.forEach((url) => assert.equal(isApprovedIosUrl(url), false, url));
  const content = draft(); content.ios.status = "released";
  assert.deepEqual(validateWelcomeContent(content), []);
  assert.ok(validateWelcomeContent(content, true).length);
  content.ios.url = valid[0];
  assert.deepEqual(validateWelcomeContent(content, true), []);
});

test("Android metadata may only target an APK in the pinned public repository", () => {
  assert.equal(isPublicAndroidUrl("https://github.com/jaywapp/gyungchung-releases/releases/download/build.10/gyungchung-0.1.0-android-200010.apk"), true);
  for (const url of ["https://github.com/jaywapp/gyungchung-mobile/releases/download/v1/app.apk", "https://github.com/jaywapp/gyungchung-releases/releases/download/v1/app.exe", "https://github.com/jaywapp/gyungchung-releases/releases/download/v1/app.apk?secret=token", "https://other.test/app.apk"]) assert.equal(isPublicAndroidUrl(url), false);
});
