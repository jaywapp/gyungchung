import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { allowedWebPushEndpoint, validWebSubscription, createWebPushSender, createWebPushWorkerHandler, type WebPushSender } from "../_shared/web-push-worker.ts";

const id = "e0000000-0000-0000-0000-000000000001";
const lease = "e0000000-0000-0000-0000-000000000002";
const subscription = {
  endpoint: "https://web.push.apple.com/fixture", expirationTime: null,
  keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") },
};
const delivery = () => ({ subscription, expires_at: new Date(Date.now() + 600000).toISOString(), snapshot: {}, data: {
  version: 1, notification_id: id, source_id: id, recipient_user_id: id, installation_id: id,
  kind: "web_push_test", category: "test", source_type: "test", binding_revision: 1, transition_epoch: 0,
} });
const details = { endpoint: subscription.endpoint, method: "POST", headers: {}, body: new Uint8Array([1]) };
const request = (headers = { Authorization: "Bearer fixture-secret" }, body = '{"action":"dispatch"}') =>
  new Request("https://worker.test", { method: "POST", headers, body });
function fixture(options: { valid?: boolean; enabled?: boolean; malformed?: boolean; sendCode?: string; loadFails?: boolean } = {}) {
  const calls: string[] = [];
  const finishes: Record<string, unknown>[] = [];
  let payload = "";
  let ttl = 0;
  const sender: WebPushSender = {
    prepare(_s, text, time) { calls.push("encrypt"); payload = text; ttl = time ?? 0; return details; },
    async send() { calls.push("send"); return options.sendCode ? { outcome: "failed", code: options.sendCode } : { outcome: "accepted" }; },
  };
  const handler = createWebPushWorkerHandler({
    enabled: options.enabled ?? true, workerSecret: "fixture-secret",
    async loadSender() { calls.push("load"); if (options.loadFails) throw new Error("sensitive-config-error"); return sender; },
    database: { async rpc(name, args) {
      calls.push(name);
      if (name === "claim_web_notification_deliveries") return { data: [{ id, lease_token: lease }], error: null };
      if (name === "prepare_web_notification_delivery") return { data: options.malformed ? { ...delivery(), subscription: { ...subscription, endpoint: "https://localhost/private" } } : delivery(), error: null };
      if (name === "validate_web_notification_delivery") return { data: options.valid ?? true, error: null };
      if (name === "finish_web_notification_delivery") finishes.push(args ?? {});
      return { data: true, error: null };
    } },
  });
  return { handler, calls, finishes, payload: () => JSON.parse(payload), ttl: () => ttl };
}
test("allowlist accepts browser push providers and rejects SSRF and URL aliases", () => {
  for (const endpoint of [subscription.endpoint, "https://eu1.push.apple.com/abc", "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x"]) assert.equal(allowedWebPushEndpoint(endpoint), true);
  for (const endpoint of ["http://web.push.apple.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://web.push.apple.com.evil/x", "https://user@web.push.apple.com/x", "https://web.push.apple.com:443/x", "https://web.push.apple.com/x?next=1", "https://web.push.apple.com/x#hash", "https://web.push.apple.com/%0a"]) assert.equal(allowedWebPushEndpoint(endpoint), false);
});
test("subscription checks P256 65-byte public key and 16-byte auth secret", () => {
  assert.equal(validWebSubscription(subscription), true);
  assert.equal(validWebSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: "A".repeat(87) } }), false);
  assert.equal(validWebSubscription({ ...subscription, keys: { ...subscription.keys, auth: "a".repeat(21) } }), false);
});
test("unauthorized or conflicting secret never initializes keys or touches database", async () => {
  const f = fixture();
  assert.equal((await f.handler(request({ Authorization: "Bearer wrong" }))).status, 401);
  assert.equal((await f.handler(request({ Authorization: "Bearer fixture-secret", "x-push-worker-secret": "wrong" }))).status, 401);
  assert.deepEqual(f.calls, []);
});
test("authenticated disabled worker can initialize VAPID once without dispatch", async () => {
  const f = fixture({ enabled: false });
  assert.deepEqual(await (await f.handler(request())).json(), { action: "dispatch", processed: 0 });
  assert.deepEqual(f.calls, ["load"]);
});
test("configuration failure remains generic and does not claim", async () => {
  const f = fixture({ loadFails: true });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "worker_unavailable" });
  assert.deepEqual(f.calls, ["load"]);
});
test("secret-gated streaming request is bounded even without Content-Length", async () => {
  const f = fixture();
  assert.equal((await f.handler(request(undefined, "x".repeat(1025)))).status, 400);
  assert.deepEqual(f.calls, []);
});
test("dispatch encrypts before final eligibility validation then sends only once", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.handler(request())).json(), { action: "dispatch", processed: 1 });
  assert.deepEqual(f.calls, ["load", "claim_web_notification_deliveries", "prepare_web_notification_delivery", "encrypt", "validate_web_notification_delivery", "send", "finish_web_notification_delivery"]);
  assert.equal(f.payload().display.title, "경충FC 알림 테스트");
  assert.equal(f.finishes[0].target_outcome, "accepted");
  assert.ok(f.ttl() >= 598 && f.ttl() <= 600);
});
test("revoked eligibility after preparation never invokes provider", async () => {
  const f = fixture({ valid: false });
  await f.handler(request());
  assert.equal(f.calls.includes("send"), false);
  assert.equal(f.finishes.length, 0);
});
test("malformed stored subscription never becomes a network request", async () => {
  const f = fixture({ malformed: true });
  await f.handler(request());
  assert.equal(f.calls.includes("encrypt"), false);
  assert.equal(f.calls.includes("send"), false);
  assert.equal(f.finishes[0].target_outcome, "unknown");
});
test("sender blocks redirects, aborts uncertain transport and discards provider diagnostics", async () => {
  let options: RequestInit | undefined;
  const sender = createWebPushSender({ publicKey: "fixture", privateKey: "fixture", subject: "https://gyungchung.vercel.app" }, () => details,
    async (_url, init) => { options = init; throw new Error("secret endpoint body"); });
  assert.deepEqual(await sender.send(details), { outcome: "unknown", code: "provider_response_unknown" });
  assert.equal(options?.redirect, "error");
  assert.ok(options?.signal instanceof AbortSignal);
  assert.deepEqual(await sender.send({ ...details, endpoint: "https://127.0.0.1/private" }), { outcome: "failed", code: "invalid_endpoint" });
});
test("provider classifications preserve accepted, expired and safe retry semantics", async () => {
  for (const [status, outcome, code] of [[201, "accepted", undefined], [202, "accepted", undefined], [410, "failed", "subscription_expired"], [404, "failed", "subscription_expired"], [403, "failed", "provider_credentials"], [429, "retry", "provider_unavailable"], [503, "retry", "provider_unavailable"], [400, "failed", "provider_rejected"]]) {
    const sender = createWebPushSender({ publicKey: "fixture", privateKey: "fixture", subject: "https://gyungchung.vercel.app" }, () => details,
      async () => new Response("provider body", { status: Number(status) }));
    assert.deepEqual(await sender.send(details), code ? { outcome, code } : { outcome });
  }
});
test("abort timeout is unknown and cannot trigger automatic resubmission", async () => {
  const sender = createWebPushSender({ publicKey: "fixture", privateKey: "fixture", subject: "https://gyungchung.vercel.app" }, () => details,
    async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))), 5);
  assert.equal((await sender.send(details)).outcome, "unknown");
});
test("pinned web-push builds actual encrypted body and VAPID header without network", { skip: !process.env.WEB_PUSH_MODULE }, () => {
  const webPush = createRequire(import.meta.url)(process.env.WEB_PUSH_MODULE!);
  const vapid = webPush.generateVAPIDKeys();
  const client = webPush.generateVAPIDKeys();
  const config = { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "https://gyungchung.vercel.app" };
  const sender = createWebPushSender(config, (sub, payload, opts) => webPush.generateRequestDetails(sub, payload, opts));
  const encrypted = sender.prepare({ ...subscription, keys: { p256dh: client.publicKey, auth: subscription.keys.auth } }, JSON.stringify(delivery().data), 1800);
  assert.equal(encrypted.endpoint, subscription.endpoint);
  assert.equal(encrypted.method, "POST");
  assert.ok(encrypted.body.byteLength > 100 && encrypted.body.byteLength < 4096);
  assert.ok(String(encrypted.headers.Authorization).startsWith("vapid t="));
  assert.equal(encrypted.headers["Content-Encoding"], "aes128gcm");
  assert.equal(Number(encrypted.headers.TTL), 1800);
});
