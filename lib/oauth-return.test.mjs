import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOAuthReturnPath, getSafeOAuthReturnUrl } from "./oauth-return.ts";

const callback = readFileSync("app/auth/callback/route.ts", "utf8");
const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");

test("OAuth returns preserve shared event query and hash context", () => {
  assert.equal(
    buildOAuthReturnPath("/events/20260816", "?section=teams&filter=mine", "#teams", "login"),
    "/events/20260816?section=teams&filter=mine&auth=login#teams",
  );
  assert.match(clubhouse, /buildOAuthReturnPath\(window\.location\.pathname, window\.location\.search, window\.location\.hash, "login"\)/);
});

test("OAuth callback only returns to allowed internal Clubhouse routes", () => {
  const origin = "https://gyungchung.example";
  assert.equal(getSafeOAuthReturnUrl("/events/20260816?section=teams#teams", origin).href, `${origin}/events/20260816?section=teams#teams`);
  assert.equal(getSafeOAuthReturnUrl("https://evil.example", origin).href, `${origin}/`);
  assert.equal(getSafeOAuthReturnUrl("//evil.example", origin).href, `${origin}/`);
  assert.equal(getSafeOAuthReturnUrl("/\\\\evil.example", origin).href, `${origin}/`);
  assert.equal(getSafeOAuthReturnUrl("/auth/callback", origin).href, `${origin}/`);
  assert.match(callback, /getSafeOAuthReturnUrl\(url\.searchParams\.get\("next"\), url\.origin\)/);
});

test("OAuth failure keeps the original screen and removes only the auth result after display", () => {
  assert.equal(
    buildOAuthReturnPath("/events/20260816", "?section=teams&auth=login", "#teams", "error"),
    "/events/20260816?section=teams&auth=error#teams",
  );
  assert.match(callback, /buildOAuthReturnPath\(next\.pathname, next\.search, next\.hash, "error"\)/);
  assert.match(clubhouse, /params\.delete\("auth"\)/);
  assert.match(clubhouse, /window\.history\.replaceState/);
  assert.match(clubhouse, /\$\{window\.location\.hash\}/);
});
