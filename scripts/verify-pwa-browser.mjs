import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const modulePath = process.env.PWA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const base = process.env.PWA_TEST_BASE_URL ?? "http://127.0.0.1:3107";
const output = path.resolve(".ux-review/pwa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const owner = "10000000-0000-4000-8000-000000000001";
const profile = { id: "10000000-0000-4000-8000-000000000101", auth_user_id: owner, name: "검증 회원", phone: "010-1000-0000", status: "active", role: "member", position: "MF", is_system_admin: false, is_test_account: false, must_change_password: false };
const preferences = { enabled: true, attendance_enabled: true, schedule_enabled: true, notices_enabled: true, event_reminders_enabled: true, rsvp_reminders_enabled: true, participation_enabled: true, feedback_enabled: true };
const point = Buffer.alloc(65, 1); point[0] = 4;
const subscription = { endpoint: "https://web.push.apple.com/QFixture", expirationTime: null, keys: { p256dh: point.toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.synthetic-signature`, refresh_token: "synthetic-refresh-token", token_type: "bearer", expires_in: 3600, user: { id: owner, aud: "authenticated", role: "authenticated", phone: "821010000000", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
let checks = 0;
const summary = [];
try {
  for (const [label, viewport, userAgent] of [
    ["desktop", { width: 1440, height: 1100 }, undefined],
    ["iphone", { width: 390, height: 844 }, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"],
  ]) {
    const context = await browser.newContext({ viewport, userAgent });
    await context.grantPermissions(["notifications"], { origin: base });
    const page = await context.newPage();
    const errors = [], calls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*.supabase.co/**", async (route) => {
      const request = route.request(), url = new URL(request.url());
      const body = request.postDataJSON();
      const name = url.pathname.split("/").at(-1);
      let data = [];
      if (url.pathname === "/auth/v1/token") data = session;
      else if (url.pathname === "/auth/v1/user") data = session.user;
      else if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204 });
      else if (name === "profiles" || name === "get_member_directory") data = [profile];
      else if (name === "get_notification_settings") data = { preferences };
      else if (name === "save_notification_preferences") data = { preferences: Object.assign(preferences, body.target_preferences) };
      else if (name === "reserve_web_push_installation") data = { installation_id: body.target_installation_id, transition_epoch: body.target_transition_epoch, binding_revision: body.target_binding_revision, reserved: true, stale: false };
      else if (name === "register_web_push_installation") data = { installation_id: body.target_installation_id, transition_epoch: body.target_transition_epoch, binding_revision: 1, enabled: true, stale: false };
      else if (name === "revoke_web_push_installation") data = { installation_id: body.target_installation_id, transition_epoch: body.target_transition_epoch, binding_revision: body.target_binding_revision || 1, enabled: false, revoked: true, terminal: true };
      else if (name === "request_web_push_test") data = { notification_id: "10000000-0000-4000-8000-000000000301", queued: true };
      calls.push(name);
      await route.fulfill({ json: data, headers: { "access-control-allow-origin": "*" } });
    });
    await context.route("**/api/web-push/config", (route) => route.fulfill({ json: { publicKey: point.toString("base64url") } }));
    await page.addInitScript(({ subscription, label }) => {
      let subscribed = false;
      // Headless Chromium denies notifications in this runtime; the OS boundary is a fixture.
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async () => "granted";
      if (label === "iphone") Object.defineProperty(navigator, "standalone", { get: () => true });
      PushManager.prototype.getSubscription = async () => subscribed ? { toJSON: () => subscription, unsubscribe: async () => { subscribed = false; return true; } } : null;
      PushManager.prototype.subscribe = async () => { subscribed = true; return { toJSON: () => subscription, unsubscribe: async () => { subscribed = false; return true; } }; };
    }, { subscription, label });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "로그인", exact: true }).first().click();
    await page.getByLabel("전화번호", { exact: true }).fill("010-1000-0000");
    await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-test-password");
    await page.getByRole("button", { name: "전화번호로 로그인", exact: true }).click();
    await page.getByRole("button", { name: /검증 회원.*마이페이지/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "마이페이지", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "이 기기 알림 켜기", exact: true }).click();
    await dialog.getByText("이 기기에서 알림을 받고 있습니다.", { exact: true }).waitFor(); checks++;
    await dialog.getByRole("button", { name: "테스트 알림 받기", exact: true }).click();
    await dialog.getByText("테스트 알림을 요청했습니다.", { exact: false }).waitFor();
    await dialog.getByRole("button", { name: "테스트 알림 받기", exact: true }).waitFor({ state: "visible" });
    assert.ok(calls.includes("request_web_push_test")); checks++;
    assert.ok(calls.indexOf("reserve_web_push_installation") < calls.indexOf("register_web_push_installation")); checks++;
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
    await page.screenshot({ path: path.join(output, `${label}-light.png`), fullPage: false });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(output, `${label}-dark.png`), fullPage: false });
    await dialog.getByRole("checkbox").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${label}-settings-dark.png`), fullPage: false });
    await dialog.getByRole("button", { name: "로그아웃", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForTimeout(250);
    assert.ok(calls.includes("revoke_web_push_installation")); checks++;
    assert.deepEqual(errors, []); checks++;
    summary.push({ label, checks: 6, rpcFlow: calls.filter((name) => /web_push/.test(name)), pageErrors: errors.length });
    await context.close();
  }
  const safari = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  const guide = await safari.newPage();
  await guide.goto(`${base}/welcome#iphone-install`, { waitUntil: "networkidle" });
  await guide.getByRole("heading", { name: "iPhone 설치 방법", exact: true }).waitFor();
  assert.match(await guide.locator("#iphone-install").innerText(), /앱으로 열기/); checks++;
  assert.equal(await guide.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks++;
  await guide.screenshot({ path: path.join(output, "iphone-install-light.png"), fullPage: false });
  await safari.close();
} finally { await browser.close(); }
await writeFile(path.join(output, "summary.json"), JSON.stringify({ checks, summary, limits: "Synthetic browser subscription and backend; actual iPhone OS delivery needs a real device." }, null, 2));
console.log(`PWA browser verification: ${checks} checks passed. Evidence: ${output}`);
