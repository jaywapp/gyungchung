import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000001", installation = "00000000-0000-4000-8000-000000000010", notification = "00000000-0000-4000-8000-000000000020";
const message = () => ({ version: 1, notification_id: notification, kind: "notice_created", category: "notices", source_type: "notice", source_id: notification, recipient_user_id: owner, installation_id: installation, transition_epoch: 3, binding_revision: 2, display: { title: "경충FC 새 공지", body: "합성 테스트 공지" }, url: "https://outside.test" });
function harness(initial, storageFails = false) {
  let binding = initial;
  const events = {}, notifications = [], opened = [];
  const indexedDB = { open() {
    if (storageFails) throw new Error("Storage unavailable");
    const request = {};
    request.result = { close() {}, transaction() { return { objectStore() { return { get() { const result = {}; queueMicrotask(() => { result.result = binding; result.onsuccess(); }); return result; } }; } }; } };
    queueMicrotask(() => request.onsuccess()); return request;
  } };
  const self = { location: { origin: "https://club.test" }, addEventListener: (name, handler) => { events[name] = handler; }, skipWaiting: async () => {},
    registration: { showNotification: async (title, options) => { notifications.push({ title, ...options }); } },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url) => { opened.push(url); } } };
  vm.runInNewContext(source, { self, indexedDB, URL, console });
  async function fire(name, value) { let work; events[name]({ ...value, waitUntil: (promise) => { work = promise; } }); await work; }
  return { notifications, opened, setBinding: (next) => { binding = next; },
    push: (value) => fire("push", { data: { json: () => value } }), click: (value) => fire("notificationclick", { notification: { data: value, close() {} } }) };
}
const binding = () => ({ id: installation, owner, epoch: 3, revision: 2, enabled: true, preferences: { enabled: true, notices_enabled: true } });
test("valid bound push shows the business copy and click constructs an internal route", async () => {
  const h = harness(binding()); await h.push(message()); await h.click(message());
  assert.equal(h.notifications[0].body, "합성 테스트 공지");
  assert.equal(h.opened[0], `https://club.test/notices?gc_source=${notification}&gc_owner=${owner}`);
});
test("old ownership, preferences off, storage eviction and malformed payload show only a generic visible fallback", async () => {
  for (const current of [null, { ...binding(), owner: "different" }, { ...binding(), epoch: 4 }, { ...binding(), preferences: { enabled: false } }]) {
    const h = harness(current); await h.push(message());
    assert.equal(h.notifications[0].title, "경충FC 알림"); assert.equal(h.notifications[0].body.includes("합성"), false);
    assert.deepEqual(Object.keys(h.notifications[0].data), ["generic"]);
  }
  const h = harness(binding()); await h.push({ url: "https://outside.test" });
  assert.equal(h.notifications[0].data.generic, true);
});
test("logout between delivery and click removes the source destination", async () => {
  const h = harness(binding()); await h.push(message()); h.setBinding(null); await h.click(message());
  assert.equal(h.opened[0], "https://club.test/");
});
test("unavailable worker storage still shows a generic notification and opens home", async () => {
  const h = harness(binding(), true); await h.push(message()); await h.click(message());
  assert.equal(h.notifications[0].data.generic, true);
  assert.equal(h.opened[0], "https://club.test/");
});
test("service worker does not register a fetch handler or cache member data", () => {
  assert.doesNotMatch(source, /addEventListener\(["']fetch|caches\./);
});
