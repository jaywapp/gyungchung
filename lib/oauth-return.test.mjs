import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOAuthReturnPath, getSafeOAuthReturnUrl } from "./oauth-return.ts";

const callback = readFileSync("app/auth/callback/route.ts", "utf8");
const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
const consent = readFileSync("app/oauth/consent/page.tsx", "utf8");

test("OAuth returns preserve an allowed deep link and its context", () => {
  assert.equal(
    buildOAuthReturnPath("/events/20260816", "?section=teams&filter=mine", "#teams", "login"),
    "/events/20260816?section=teams&filter=mine&auth=login#teams",
  );
  assert.match(clubhouse, /buildOAuthReturnPath\(window\.location\.pathname, window\.location\.search, window\.location\.hash, "login"\)/);
});

test("OAuth callback only returns to allowed Clubhouse routes", () => {
  const origin = "https://gyungchung.example";
  assert.equal(getSafeOAuthReturnUrl("/events/20260816?section=teams#teams", origin).href, `${origin}/events/20260816?section=teams#teams`);
  assert.equal(getSafeOAuthReturnUrl("/oauth/consent?authorization_id=request-123", origin).href, `${origin}/oauth/consent?authorization_id=request-123`);
  assert.equal(getSafeOAuthReturnUrl("https://evil.example", origin).href, `${origin}/`);
  assert.equal(getSafeOAuthReturnUrl("//evil.example", origin).href, `${origin}/`);
  assert.equal(getSafeOAuthReturnUrl("/auth/callback", origin).href, `${origin}/`);
  assert.match(callback, /getSafeOAuthReturnUrl\(url\.searchParams\.get\("next"\), url\.origin\)/);
});

test("OAuth consent preserves the authorization request and redirects only to Supabase results", () => {
  assert.match(consent, /getAuthorizationDetails\(authorizationId\)/);
  assert.match(consent, /approveAuthorization\(authorizationId\)/);
  assert.match(consent, /denyAuthorization\(authorizationId\)/);
  assert.match(consent, /window\.location\.assign\(result\.data\.redirect_url\)/);
  assert.match(consent, /\/auth\/callback/);
});

test("OAuth feedback removal keeps the original query and hash", () => {
  assert.match(clubhouse, /params\.delete\("auth"\)/);
  assert.match(clubhouse, /\$\{window\.location\.hash\}/);
});
