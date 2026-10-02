import { buildPushMessage, type WorkerDatabase } from "./push-worker.ts";

export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export type RequestDetails = { endpoint: string; method: string; headers: Record<string, string>; body: Uint8Array };
type Outcome = { outcome: "accepted" | "retry" | "failed" | "unknown"; code?: string };
export type WebPushSender = {
  prepare(subscription: WebSubscription, payload: string, ttl?: number): RequestDetails;
  send(details: RequestDetails): Promise<Outcome>;
};
type Claim = { id: string; lease_token: string };
type Delivery = { subscription: WebSubscription; expires_at: string; data: Record<string, unknown>; snapshot: Record<string, unknown> };
type Dependencies = {
  database?: WorkerDatabase; workerSecret?: string; enabled?: boolean;
  loadSender: () => Promise<WebPushSender>; now?: () => number; dispatchBudgetMs?: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories: Record<string, [string, string]> = {
  attendance_added: ["attendance", "event"], attendance_declined: ["attendance", "event"], schedule_changed: ["schedule", "event"],
  event_cancelled: ["schedule", "event"], notice_created: ["notices", "notice"], event_reminder: ["event_reminders", "event"],
  rsvp_reminder: ["rsvp_reminders", "event"], participation_reminder: ["participation", "participation_form"],
  feedback_updated: ["feedback", "feedback"], web_push_test: ["test", "test"],
};
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function allowedWebPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048 || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(endpoint)) return false;
  if (!/^https:\/\/(web\.push\.apple\.com|[A-Za-z0-9-]+\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)\/[A-Za-z0-9_./~%+=-]+$/.test(endpoint)) return false;
  const url = new URL(endpoint);
  return !url.username && !url.password && !url.port && !url.search && !url.hash;
}
export function validWebSubscription(value: unknown): value is WebSubscription {
  if (!object(value) || !allowedWebPushEndpoint(value.endpoint) || !object(value.keys) ||
    typeof value.keys.p256dh !== "string" || typeof value.keys.auth !== "string" ||
    !/^B[A-Za-z0-9_-]{86}=?$/.test(value.keys.p256dh) || !/^[A-Za-z0-9_-]{22}(==)?$/.test(value.keys.auth)) return false;
  try {
    const key = atob(value.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/"));
    const auth = atob(value.keys.auth.replace(/-/g, "+").replace(/_/g, "/"));
    return key.length === 65 && key.charCodeAt(0) === 4 && auth.length === 16 &&
      (value.expirationTime === undefined || value.expirationTime === null || typeof value.expirationTime === "number" && Number.isFinite(value.expirationTime));
  } catch { return false; }
}
function prepared(value: unknown): Delivery | null {
  if (value === null) return null;
  if (!object(value) || !object(value.data) || !object(value.snapshot) || !validWebSubscription(value.subscription) ||
    typeof value.expires_at !== "string" || !Number.isFinite(Date.parse(value.expires_at))) throw new Error("invalid_delivery");
  const d = value.data;
  const contract = categories[String(d.kind)];
  if (!contract || d.version !== 1 || d.category !== contract[0] || d.source_type !== contract[1] ||
    ["notification_id", "source_id", "recipient_user_id", "installation_id"].some(key => !uuid.test(String(d[key]))) ||
    !Number.isSafeInteger(d.binding_revision) || Number(d.binding_revision) <= 0 ||
    !Number.isSafeInteger(d.transition_epoch) || Number(d.transition_epoch) < 0) throw new Error("invalid_payload");
  return value as Delivery;
}
function sameSecret(actual: string, expected: string) {
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) difference |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  return difference === 0;
}
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
async function smallBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new Error("invalid_request"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export function createWebPushSender(config: VapidConfig,
  generateRequest: (subscription: WebSubscription, payload: string, options: Record<string, unknown>) => RequestDetails,
  fetcher: typeof fetch = fetch, timeoutMs = 12000): WebPushSender {
  return {
    prepare(subscription, payload, ttl = 300) {
      if (!validWebSubscription(subscription)) throw new Error("invalid_subscription");
      const details = generateRequest(subscription, payload, {
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        TTL: Math.max(1, Math.min(86400, Math.floor(ttl))), contentEncoding: "aes128gcm", urgency: "normal",
      });
      if (details.endpoint !== subscription.endpoint || !allowedWebPushEndpoint(details.endpoint) || details.method !== "POST" ||
        !details.body || details.body.byteLength > 4096) throw new Error("invalid_provider_request");
      return details;
    },
    async send(details) {
      // An independent allowlist check protects callers even if the preparation port changes.
      if (!allowedWebPushEndpoint(details.endpoint) || details.method !== "POST") return { outcome: "failed", code: "invalid_endpoint" };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(details.endpoint, { method: "POST", headers: details.headers,
          body: details.body as BodyInit, redirect: "error", signal: controller.signal });
        // No provider body is needed or logged. Cancel it to bound buffering and discard diagnostics containing endpoints.
        await response.body?.cancel();
        if (response.status === 201 || response.status === 202) return { outcome: "accepted" };
        if (response.status === 404 || response.status === 410) return { outcome: "failed", code: "subscription_expired" };
        if (response.status === 401 || response.status === 403) return { outcome: "failed", code: "provider_credentials" };
        if (response.status === 429 || response.status >= 500) return { outcome: "retry", code: "provider_unavailable" };
        return { outcome: "failed", code: "provider_rejected" };
      } catch {
        // Timeout, redirects and disconnected responses can be ambiguous after submission. Do not resend automatically.
        return { outcome: "unknown", code: "provider_response_unknown" };
      } finally { clearTimeout(timer); }
    },
  };
}

export function createWebPushWorkerHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? Date.now;
  async function rpc(name: string, args?: Record<string, unknown>) {
    const result = await dependencies.database!.rpc(name, args);
    if (result.error) throw new Error("database_unavailable");
    return result.data;
  }
  return async (request: Request) => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!dependencies.database || !dependencies.workerSecret) return json({ error: "worker_unavailable" }, 503);
    const authorization = request.headers.get("Authorization");
    const legacy = request.headers.get("x-push-worker-secret");
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if ((!bearer && !legacy) || (authorization && !bearer) || (bearer && !sameSecret(bearer, dependencies.workerSecret)) ||
      (legacy && !sameSecret(legacy, dependencies.workerSecret))) return json({ error: "unauthorized" }, 401);
    try {
      if (Number(request.headers.get("Content-Length") ?? "0") > 1024) return json({ error: "invalid_request" }, 400);
      const text = await smallBody(request);
      const body: unknown = JSON.parse(text);
      if (!object(body) || body.action !== "dispatch" || Object.keys(body).some(key => key !== "action")) return json({ error: "invalid_action" }, 400);
    } catch { return json({ error: "invalid_request" }, 400); }
    try {
      // Authorized initialization runs while delivery is disabled. The loader never replaces a persisted key pair.
      const sender = await dependencies.loadSender();
      if (!dependencies.enabled) return json({ action: "dispatch", processed: 0 });
      const start = now();
      const rows = await rpc("claim_web_notification_deliveries", { target_limit: 20 });
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !object(row) || !uuid.test(String(row.id)) || !uuid.test(String(row.lease_token)))) throw new Error("invalid_claim");
      let processed = 0;
      for (const claim of rows as Claim[]) {
        if (now() - start >= (dependencies.dispatchBudgetMs ?? 40000)) break;
        const args = { target_delivery_id: claim.id, target_lease_token: claim.lease_token };
        let outcome: Outcome;
        try {
          const delivery = prepared(await rpc("prepare_web_notification_delivery", args));
          if (!delivery) continue;
          const payload = delivery.data.kind === "web_push_test"
            ? { ...delivery.data, display: { title: "경충FC 알림 테스트", body: "이 기기로 알림을 받을 수 있습니다." } }
            : buildPushMessage({ ...delivery, delivery_id: claim.id, lease_token: claim.lease_token, to: "" }).data;
          const details = sender.prepare(delivery.subscription, JSON.stringify(payload), Math.floor((Date.parse(delivery.expires_at) - now()) / 1000));
          if (await rpc("validate_web_notification_delivery", args) !== true) continue;
          outcome = await sender.send(details);
        } catch { outcome = { outcome: "unknown", code: "preparation_or_response_unknown" }; }
        await rpc("finish_web_notification_delivery", { ...args, target_outcome: outcome.outcome, target_error_code: outcome.code ?? null });
        processed++;
        if (outcome.code === "provider_credentials") break;
      }
      return json({ action: "dispatch", processed });
    } catch { return json({ error: "worker_unavailable" }, 503); }
  };
}
