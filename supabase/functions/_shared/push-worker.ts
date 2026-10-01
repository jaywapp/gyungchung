export type WorkerDatabase = { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };
type Claim = { id: string; lease_token: string };
type ReceiptClaim = Claim & { ticket_id: string };
type Prepared = { delivery_id: string; lease_token: string; to: string; snapshot: Record<string, unknown>; data: Record<string, unknown> };
type Dependencies = { database?: WorkerDatabase; enabled?: boolean; workerSecret?: string; expoAccessToken?: string; fetcher?: typeof fetch; providerTimeoutMs?: number; now?: () => number; dispatchBudgetMs?: number };
const categories: Record<string, [string, string]> = {
  attendance_added: ["attendance", "event"], attendance_declined: ["attendance", "event"],
  schedule_changed: ["schedule", "event"], event_cancelled: ["schedule", "event"],
  notice_created: ["notices", "notice"], event_reminder: ["event_reminders", "event"],
  rsvp_reminder: ["rsvp_reminders", "event"], participation_reminder: ["participation", "participation_form"],
  feedback_updated: ["feedback", "feedback"],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const copy = (value: unknown, fallback: string, limit = 120) => typeof value === "string" ? value.trim().slice(0, limit) || fallback : fallback;
function sameSecret(actual: string, expected: string) {
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) difference |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  return difference === 0;
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function claims(value: unknown): Claim[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(row => !object(row) || !uuid.test(String(row.id)) || !uuid.test(String(row.lease_token)))) throw new Error("invalid_claim");
  return value as Claim[];
}
function prepared(value: unknown): Prepared | null {
  if (value === null) return null;
  if (!object(value) || !object(value.data) || !object(value.snapshot) || typeof value.to !== "string" ||
    !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(value.to)) throw new Error("invalid_delivery");
  const d = value.data;
  const contract = categories[String(d.kind)];
  if (!contract || d.version !== 1 || d.category !== contract[0] || d.source_type !== contract[1] ||
    ["notification_id", "source_id", "recipient_user_id", "installation_id"].some(key => !uuid.test(String(d[key]))) ||
    !Number.isSafeInteger(d.binding_revision) || Number(d.binding_revision) <= 0 ||
    !Number.isSafeInteger(d.transition_epoch) || Number(d.transition_epoch) < 0) throw new Error("invalid_payload");
  return value as Prepared;
}
function date(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function buildPushMessage(delivery: Prepared) {
  const kind = delivery.data.kind;
  const s = delivery.snapshot;
  const eventTitle = copy(s.title, "경충FC 일정");
  let title = "경충FC";
  let body = eventTitle;
  if (kind === "attendance_added") { title = "참석자가 추가되었습니다"; body = copy(s.member_name, "회원") + "님 · " + eventTitle; }
  if (kind === "attendance_declined") { title = "불참으로 변경되었습니다"; body = copy(s.member_name, "회원") + "님 · " + eventTitle; }
  if (kind === "schedule_changed") {
    title = "일정이 변경되었습니다";
    const before = object(s.before) ? s.before : {};
    const after = object(s.after) ? s.after : {};
    const changes = [];
    if (before.starts_at !== after.starts_at) changes.push(date(before.starts_at) + " → " + date(after.starts_at));
    if (before.venue !== after.venue || before.address !== after.address) changes.push(copy(before.venue, "기존 장소") + " → " + copy(after.venue, "새 장소"));
    body = eventTitle + (changes.length ? " · " + changes.join(" · ") : "");
  }
  if (kind === "notice_created") { title = "새 공지가 등록되었습니다"; body = copy(s.title, "공지"); }
  if (kind === "event_cancelled") { title = "일정이 취소되었습니다"; body = eventTitle + " · " + date(s.starts_at); }
  if (kind === "event_reminder") { title = "내일 경기 안내"; body = eventTitle + " · " + date(s.starts_at) + " · " + copy(s.venue, "일정에서 장소 확인"); }
  if (kind === "rsvp_reminder") { title = "참석 여부를 알려 주세요"; body = eventTitle + " · " + date(s.deadline) + "까지 응답할 수 있습니다."; }
  if (kind === "participation_reminder") { title = "참여 마감이 다가옵니다"; body = copy(s.title, "참여") + " · " + date(s.deadline) + " 마감"; }
  if (kind === "feedback_updated") { title = s.has_response ? "의견에 답변이 등록되었습니다" : "의견 처리 상태가 변경되었습니다"; body = copy(s.title, "내 의견"); }
  return { to: delivery.to, title, body: body.slice(0, 240), data: delivery.data, sound: "default", channelId: delivery.data.category };
}
export function createPushWorkerHandler(dependencies: Dependencies) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  async function rpc(name: string, args?: Record<string, unknown>) {
    const result = await dependencies.database!.rpc(name, args);
    if (result.error) throw new Error("database_unavailable");
    return result.data;
  }
  async function provider(path: "send" | "getReceipts", body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.providerTimeoutMs ?? 12000);
    try {
      const response = await fetcher("https://exp.host/--/api/v2/push/" + path, {
        method: "POST", headers: { "Content-Type": "application/json", ...(dependencies.expoAccessToken ? { Authorization: "Bearer " + dependencies.expoAccessToken } : {}) },
        body: JSON.stringify(body), signal: controller.signal, redirect: "error",
      });
      if (response.status !== 200) { await response.body?.cancel(); return { status: response.status, data: null }; }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("missing_provider_body");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 262144 || controller.signal.aborted) throw new Error("provider_body_unavailable");
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { status: response.status, data: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } finally { clearTimeout(timeout); }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const legacySecret = request.headers.get("x-push-worker-secret");
    const authorization = request.headers.get("authorization");
    const bearerSecret = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    const suppliedSecret = legacySecret ?? bearerSecret ?? "";
    if (!dependencies.workerSecret || dependencies.workerSecret.length < 32 ||
      !sameSecret(suppliedSecret, dependencies.workerSecret) ||
      (authorization !== null && (!bearerSecret || !sameSecret(bearerSecret, dependencies.workerSecret)))) return json({ error: "authentication_required" }, 401);
    if (!dependencies.enabled || !dependencies.database) return json({ error: "delivery_disabled" }, 503);
    let action: "dispatch" | "receipts";
    try {
      const input: unknown = await request.json();
      if (!object(input) || Object.keys(input).some(key => key !== "action") || !["dispatch", "receipts"].includes(String(input.action))) return json({ error: "invalid_request" }, 400);
      action = input.action as typeof action;
    } catch { return json({ error: "invalid_request" }, 400); }
    let processed = 0;
    try {
      if (action === "dispatch") {
        const deadline = now() + (dependencies.dispatchBudgetMs ?? 40000);
        for (const claim of claims(await rpc("claim_notification_deliveries", { target_limit: 20 }))) {
          if (now() >= deadline) break;
          const args = { target_delivery_id: claim.id, target_lease_token: claim.lease_token };
          const delivery = prepared(await rpc("prepare_notification_delivery", args));
          if (!delivery || await rpc("validate_notification_delivery", args) !== true) continue;
          let outcome = "unknown";
          let ticketId: string | null = null;
          let code: string | null = "provider_response_unknown";
          try {
            const response = await provider("send", [buildPushMessage(delivery)]);
            if (response.status === 429 || response.status >= 500) {
              outcome = "retry"; code = "provider_unavailable";
            } else if (response.status !== 200) {
              outcome = "failed"; code = response.status === 401 || response.status === 403 ? "provider_credentials" : "provider_rejected";
            } else {
              const body: unknown = response.data;
              const item = object(body) && Array.isArray(body.data) && body.data.length === 1 ? body.data[0] : null;
              if (object(item) && item.status === "ok" && typeof item.id === "string" && item.id.length <= 200) { outcome = "ticket"; ticketId = item.id; code = null; }
              else if (object(item) && item.status === "error") {
                code = object(item.details) ? copy(item.details.error, "provider_rejected", 80) : "provider_rejected";
                outcome = code === "MessageRateExceeded" ? "retry" : "failed";
              }
            }
          } catch { /* A timeout or malformed response may follow provider acceptance. */ }
          await rpc("finish_notification_delivery", { ...args, target_outcome: outcome, target_ticket_id: ticketId, target_error_code: code });
          processed++;
          if (code === "provider_credentials") break;
        }
      } else {
        const value = await rpc("claim_notification_receipts", { target_limit: 100 });
        const receiptClaims = claims(value) as ReceiptClaim[];
        if (receiptClaims.some(claim => typeof claim.ticket_id !== "string" || claim.ticket_id.length > 200)) throw new Error("invalid_receipts");
        if (receiptClaims.length) {
          let receipts: Record<string, unknown> = {};
          try {
            const response = await provider("getReceipts", { ids: receiptClaims.map(claim => claim.ticket_id) });
            if (response.status === 200) { const body: unknown = response.data; if (object(body) && object(body.data)) receipts = body.data; }

          } catch { /* Receipt polling is safe to retry and never resends a message. */ }
          for (const claim of receiptClaims) {
            const receipt = receipts[claim.ticket_id];
            const status = object(receipt) ? receipt.status : null;
            const code = object(receipt) && object(receipt.details) ? copy(receipt.details.error, "receipt_rejected", 80) : null;
            await rpc("finish_notification_receipt", { target_delivery_id: claim.id, target_lease_token: claim.lease_token, target_outcome: status === "ok" ? "delivered" : status === "error" ? "failed" : "pending", target_error_code: code });
            processed++;
          }
        }
      }
      return json({ processed, action });
    } catch { return json({ error: "worker_unavailable" }, 503); }
  };
}
