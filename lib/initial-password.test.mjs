import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
const passwordPage = readFileSync("app/auth/update-password/page.tsx", "utf8");
const provisionFunction = readFileSync("supabase/functions/provision-member-account/index.ts", "utf8");
const passwordFunction = readFileSync("supabase/functions/change-member-password/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260822100217_require_initial_password_change.sql", "utf8");

test("does not reveal the shared initial password on the public login form", () => {
  assert.doesNotMatch(clubhouse, /placeholder=\{legacyEmail \? "비밀번호 입력" : "초기 비밀번호 1234"\}/);
  assert.doesNotMatch(clubhouse, /초기 비밀번호는 1234입니다/);
});

test("requires linked members to replace administrator-issued passwords", () => {
  assert.match(migration, /add column must_change_password boolean not null default false/);
  assert.match(migration, /where auth_user_id is not null/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /before update of must_change_password on public\.profiles/);
  assert.match(provisionFunction, /update\(\{ must_change_password: true \}\)/);
  assert.match(clubhouse, /me\?\.must_change_password/);
  assert.match(clubhouse, /router\.replace\("\/auth\/update-password"\)/);
  assert.match(clubhouse, /pathname !== "\/auth\/update-password"/);
});

test("changes the password before clearing the forced-change flag", () => {
  const passwordUpdate = passwordFunction.indexOf("adminClient.auth.admin.updateUserById(userData.user.id, { password })");
  const flagUpdate = passwordFunction.indexOf("update({ must_change_password: false })");
  assert.ok(passwordUpdate >= 0);
  assert.ok(flagUpdate > passwordUpdate);
  assert.match(passwordPage, /functions\.invoke\("change-member-password"/);
  assert.match(passwordPage, /error instanceof FunctionsHttpError/);
  assert.match(passwordPage, /error\.context\.json\(\)/);
});
