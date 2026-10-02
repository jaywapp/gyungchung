/* Push delivery only. Authenticated pages and API responses are never cached. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = {
  attendance_added: ["event", "attendance"], attendance_declined: ["event", "attendance"],
  schedule_changed: ["event", "schedule"], event_cancelled: ["event", "schedule"],
  notice_created: ["notice", "notices"], event_reminder: ["event", "event_reminders"],
  rsvp_reminder: ["event", "rsvp_reminders"], participation_reminder: ["participation_form", "participation"],
  feedback_updated: ["feedback", "feedback"], web_push_test: ["test", "test"],
};
function payload(value) {
  if (!value || value.version !== 1 || !Object.hasOwn(SOURCES, value.kind)) return null;
  const [source, category] = SOURCES[value.kind];
  if (value.source_type !== source || value.category !== category || !["notification_id", "source_id", "recipient_user_id", "installation_id"].every((key) => typeof value[key] === "string" && UUID.test(value[key])) ||
    !Number.isSafeInteger(value.binding_revision) || value.binding_revision < 1 || !Number.isSafeInteger(value.transition_epoch) || value.transition_epoch < 1) return null;
  if (!value.display || !["title", "body"].every((key) => typeof value.display[key] === "string" && value.display[key].trim() && !/[\u0000-\u001f\u007f]/.test(value.display[key])) || value.display.title.length > 160 || value.display.body.length > 240) return null;
  return value;
}
function readBinding() {
  return new Promise((resolve) => {
    const request = indexedDB.open("gc-web-push", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction("state", "readonly");
        const read = transaction.objectStore("state").get("binding");
        read.onsuccess = () => resolve(read.result || null);
        read.onerror = () => resolve(null);
        transaction.oncomplete = () => db.close();
        transaction.onerror = transaction.onabort = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  }).catch(() => null);
}
function owned(value, binding) {
  return Boolean(binding && binding.enabled && binding.preferences?.enabled && binding.owner === value.recipient_user_id &&
    binding.id === value.installation_id && binding.epoch === value.transition_epoch && binding.revision === value.binding_revision &&
    (value.category === "test" || binding.preferences[`${value.category}_enabled`] === true));
}
function destination(value) {
  if (value.source_type === "test") return "/";
  const paths = { event: "/events", notice: "/notices", participation_form: "/participation", feedback: "/feedback" };
  return `${paths[value.source_type]}?gc_source=${encodeURIComponent(value.source_id)}&gc_owner=${encodeURIComponent(value.recipient_user_id)}`;
}
async function showFallback() {
  await self.registration.showNotification("경충FC 알림", { body: "앱을 열어 알림 설정을 확인해 주세요.", icon: "/icons/icon-192.png", tag: "gc-push-connection", data: { generic: true } });
}
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let value;
    try { value = payload(event.data?.json()); } catch { await showFallback(); return; }
    if (!value || !owned(value, await readBinding())) { await showFallback(); return; }
    await self.registration.showNotification(value.display.title, { body: value.display.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
      tag: value.notification_id, data: value });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const value = payload(event.notification.data);
    const valid = value && owned(value, await readBinding());
    const url = new URL(valid ? destination(value) : "/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) {
      const navigated = await client.navigate(url);
      if (navigated) await navigated.focus();
    } else await self.clients.openWindow(url);
  })());
});
