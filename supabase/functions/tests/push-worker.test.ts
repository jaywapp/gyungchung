import assert from "node:assert/strict";
import test from "node:test";
import { buildPushMessage, createPushWorkerHandler } from "../_shared/push-worker.ts";

const id = "a0000000-0000-0000-0000-000000000001";
const lease = "a0000000-0000-0000-0000-000000000002";
const secret = "test-worker-secret-with-at-least-thirty-two-characters";
const delivery = { delivery_id: id, lease_token: lease, to: "ExpoPushToken[test-token]", snapshot: { title: "Test event", member_name: "Test member" }, data: {
  version: 1, notification_id: id, kind: "attendance_added", category: "attendance", source_type: "event", source_id: id,
  recipient_user_id: id, installation_id: id, binding_revision: 1, transition_epoch: 0,
} };
function request(action = "dispatch", authentication = secret) {
  return new Request("https://example.test/push-worker", { method: "POST", headers: { "x-push-worker-secret": authentication }, body: JSON.stringify({ action }) });
}
function harness(options: { enabled?: boolean; prepared?: unknown; valid?: boolean; fetcher?: typeof fetch; receipt?: boolean } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const sent: { url: string; body: unknown }[] = [];
  const database = { async rpc(name: string, args?: Record<string, unknown>) {
    calls.push({ name, args });
    const result = name === "claim_notification_deliveries" ? [{ id, lease_token: lease }] :
      name === "prepare_notification_delivery" ? ("prepared" in options ? options.prepared : delivery) :
      name === "validate_notification_delivery" ? options.valid !== false :
      name === "claim_notification_receipts" ? [{ id, lease_token: lease, ticket_id: "test-ticket" }] : true;
    return { data: result, error: null };
  } };
  const fetcher: typeof fetch = options.fetcher ?? (async (input, init) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: options.receipt ? { "test-ticket": { status: "ok" } } : [{ status: "ok", id: "test-ticket" }] }), { status: 200 });
  });
  const handler = createPushWorkerHandler({ database, enabled: options.enabled !== false, workerSecret: secret, fetcher });
  return { handler, calls, sent };
}
test("disabled and unauthenticated workers never claim or contact Expo", async () => {
  const off = harness({ enabled: false });
  assert.equal((await off.handler(request())).status, 503);
  assert.equal(off.calls.length, 0);
  assert.equal(off.sent.length, 0);
  const unauthorized = harness();
  assert.equal((await unauthorized.handler(request("dispatch", "wrong"))).status, 401);
  assert.equal(unauthorized.calls.length, 0);
});
test("binding eligibility is rechecked immediately before provider dispatch", async () => {
  for (const options of [{ prepared: null }, { valid: false }]) {
    const h = harness(options);
    assert.equal((await h.handler(request())).status, 200);
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.some(call => call.name === "finish_notification_delivery"), false);
  }
});
test("Bearer worker authentication accepts only the worker secret and rejects ambiguous credentials", async () => {
  const h = harness({ prepared: null });
  const bearerRequest = (authorization: string, legacySecret?: string) => new Request("https://example.test/push-worker", {
    method: "POST", headers: { Authorization: authorization, ...(legacySecret ? { "x-push-worker-secret": legacySecret } : {}) },
    body: JSON.stringify({ action: "dispatch" }),
  });
  assert.equal((await h.handler(bearerRequest("Bearer " + secret))).status, 200);
  const authorizedCalls = h.calls.length;
  for (const authorization of ["Bearer wrong", "Bearer public-client-key", "Basic " + secret, "Bearer", "Bearer " + secret + " extra"]) {
    assert.equal((await h.handler(bearerRequest(authorization))).status, 401);
  }
  assert.equal((await h.handler(bearerRequest("Bearer wrong", secret))).status, 401);
  assert.equal((await h.handler(bearerRequest("Bearer " + secret, "wrong"))).status, 401);
  assert.equal(h.calls.length, authorizedCalls);
  assert.equal(h.sent.length, 0);
});
test("a ticket is persisted separately from actual provider receipt", async () => {
  const h = harness();
  assert.equal((await h.handler(request())).status, 200);
  assert.equal(h.sent.length, 1);
  const message = (h.sent[0].body as unknown[])[0] as Record<string, unknown>;
  assert.equal(message.channelId, "attendance");
  assert.equal(message.sound, "default");
  assert.equal((message.data as Record<string, unknown>).binding_revision, 1);
  const outcome = h.calls.find(call => call.name === "finish_notification_delivery")!;
  assert.equal(outcome.args?.target_outcome, "ticket");
  assert.equal(outcome.args?.target_ticket_id, "test-ticket");
  assert.equal(h.calls.some(call => call.name === "finish_notification_receipt"), false);
});
test("unknown network acceptance does not become an automatic retry", async () => {
  const h = harness({ fetcher: async () => { throw new Error("private provider response"); } });
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  assert.equal(h.calls.find(call => call.name === "finish_notification_delivery")?.args?.target_outcome, "unknown");
  assert.doesNotMatch(await response.text(), /private|token|secret/);
});
test("explicit provider rate limits allow bounded database retries", async () => {
  const h = harness({ fetcher: async () => new Response("", { status: 429 }) });
  await h.handler(request());
  assert.equal(h.calls.find(call => call.name === "finish_notification_delivery")?.args?.target_outcome, "retry");
});
test("invalid account or source payloads never reach Expo", async () => {
  const h = harness({ prepared: { ...delivery, data: { ...delivery.data, source_type: "feedback" } } });
  assert.equal((await h.handler(request())).status, 503);
  assert.equal(h.sent.length, 0);
});
test("receipt polling records provider acceptance without sending again", async () => {
  const h = harness({ receipt: true });
  await h.handler(request("receipts"));
  assert.match(h.sent[0].url, /getReceipts$/);
  assert.equal(h.calls.some(call => call.name === "claim_notification_deliveries"), false);
  assert.equal(h.calls.find(call => call.name === "finish_notification_receipt")?.args?.target_outcome, "delivered");
});
test("missing receipts remain pending and do not resend", async () => {
  const h = harness({ fetcher: async () => new Response(JSON.stringify({ data: {} })) });
  await h.handler(request("receipts"));
  assert.equal(h.calls.find(call => call.name === "finish_notification_receipt")?.args?.target_outcome, "pending");
});
test("feedback push text excludes the private response body", () => {
  const message = buildPushMessage({ ...delivery, snapshot: { title: "My feedback", officer_response: "private response text", has_response: true }, data: { ...delivery.data, kind: "feedback_updated", category: "feedback", source_type: "feedback" } });
  assert.doesNotMatch(JSON.stringify(message), /private response text/);
});


test("dispatch budget leaves remaining claims unprepared for later lease recovery", async () => {
  let elapsed = 0;
  let prepares = 0;
  const handler = createPushWorkerHandler({ enabled: true, workerSecret: secret, now: () => elapsed, dispatchBudgetMs: 40,
    database: { async rpc(name) {
      if (name === "claim_notification_deliveries") return { data: [{ id, lease_token: lease }, { id: lease, lease_token: id }], error: null };
      if (name === "prepare_notification_delivery") { prepares++; return { data: delivery, error: null }; }
      return { data: true, error: null };
    } },
    fetcher: async () => { elapsed = 41; return new Response(JSON.stringify({ data: [{ status: "ok", id: "budget-ticket" }] })); },
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal(prepares, 1);
});
test("response bodies remain within the provider deadline", async () => {
  const handler = createPushWorkerHandler({ enabled: true, workerSecret: secret, providerTimeoutMs: 5,
    database: { async rpc(name) {
      const data = name === "claim_notification_deliveries" ? [{ id, lease_token: lease }] : name === "prepare_notification_delivery" ? delivery : true;
      if (name === "finish_notification_delivery") return { data: true, error: null };
      return { data, error: null };
    } },
    fetcher: async (_input, init) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new Error("deadline")), { once: true }); },
    })),
  });
  assert.equal((await handler(request())).status, 200);
});
