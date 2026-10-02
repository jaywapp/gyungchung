import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const webPushPreferenceLabels = {
  attendance_enabled: "참석 응답 변경", schedule_enabled: "일정 변경·취소", notices_enabled: "새 공지",
  event_reminders_enabled: "경기 전날 안내", rsvp_reminders_enabled: "참석 응답 안내",
  participation_enabled: "참여 마감 안내", feedback_enabled: "내 의견 처리 안내",
} as const;
export type WebPushPreferences = Record<keyof typeof webPushPreferenceLabels, boolean> & { enabled: boolean };
export type WebPushSupport = "supported" | "install" | "unsupported";
export interface WebPushRecord {
  id: string; proof: string; owner: string | null; epoch: number; revision: number;
  revocationProof: string | null; bindingPending: boolean; optedIn: boolean;
  pendingRevocation: { epoch: number; revision: number; proof: string } | null;
}
export interface WebPushBinding { id: string; owner: string | null; epoch: number; revision: number; enabled: boolean; preferences: WebPushPreferences | null }
export interface WebPushState {
  owner: string | null; support: WebPushSupport; permission: NotificationPermission; preferences: WebPushPreferences | null;
  loading: boolean; busy: boolean; connected: boolean; error: string | null; message: string | null;
}
interface WebPushPorts {
  read(): WebPushRecord; write(record: WebPushRecord): void;
  lock<T>(operation: () => Promise<T>): Promise<T>;
  binding(value: WebPushBinding | null): Promise<void>;
  randomProof(): string;
  support(): WebPushSupport; permission(): NotificationPermission; requestPermission(): Promise<NotificationPermission>;
  subscription(create: boolean): Promise<PushSubscriptionJSON | null>; unsubscribe(): Promise<void>;
  rpc(name: string, args: Record<string, unknown>, owner?: string): Promise<unknown>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const proof = /^[a-f0-9]{64}$/;
const counter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function parseWebPushRecord(value: unknown): WebPushRecord {
  const record = value as WebPushRecord;
  if (!record || !uuid.test(record.id) || !proof.test(record.proof) || !(record.owner === null || uuid.test(record.owner)) ||
    !counter(record.epoch) || !counter(record.revision) || !(record.revocationProof === null || proof.test(record.revocationProof)) ||
    typeof record.bindingPending !== "boolean" || typeof record.optedIn !== "boolean" ||
    !(record.pendingRevocation === null || (record.pendingRevocation && counter(record.pendingRevocation.epoch) && counter(record.pendingRevocation.revision) && proof.test(record.pendingRevocation.proof)))) {
    throw new Error("알림 연결 정보를 읽지 못했습니다. 이 기기의 사이트 저장 공간을 확인해 주세요.");
  }
  return record;
}
export function parseWebPushPreferences(value: unknown): WebPushPreferences {
  const preferences = (value as { preferences?: WebPushPreferences })?.preferences;
  if (!preferences || !["enabled", ...Object.keys(webPushPreferenceLabels)].every((key) => typeof preferences[key as keyof WebPushPreferences] === "boolean")) throw new Error("알림 설정을 확인하지 못했습니다.");
  return { ...preferences };
}
function resultRecord(value: unknown, id: string) {
  const result = value as Record<string, unknown>;
  if (!result || result.installation_id !== id || !counter(result.transition_epoch) || !counter(result.binding_revision)) throw new Error("알림 연결 결과를 확인하지 못했습니다.");
  return result as Record<string, unknown> & { transition_epoch: number; binding_revision: number };
}
function installationArgs(record: WebPushRecord) {
  return { target_installation_id: record.id, target_installation_proof: record.proof, target_revocation_proof: record.revocationProof,
    target_transition_epoch: record.epoch, target_binding_revision: record.revision };
}

/** Keep durable ownership intent ahead of network effects; discard responses from older identities. */
export class WebPushController {
  private generation = 0;
  private knownOwner = false;
  private loadVersion = 0;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private connectQueue: Promise<unknown> = Promise.resolve();
  private state: WebPushState;
  constructor(private ports: WebPushPorts) {
    this.state = { owner: null, support: ports.support(), permission: ports.permission(), preferences: null, loading: false, busy: false, connected: false, error: null, message: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<WebPushState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((listener) => listener()); }
  private current(owner: string | null, generation: number) { return this.state.owner === owner && this.generation === generation; }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(() => this.ports.lock(operation));
    this.queue = next;
    return next;
  }
  private async mirror(record: WebPushRecord, enabled = false) {
    await this.ports.binding({ id: record.id, owner: record.owner, epoch: record.epoch, revision: record.revision,
      enabled: enabled && !record.bindingPending && !record.pendingRevocation, preferences: this.state.preferences });
  }
  private async transition(owner: string | null, generation: number, force = false) {
    await this.serial(async () => {
      if (!this.current(owner, generation)) return;
      const record = this.ports.read();
      if (record.owner === owner && !force) return;
      const next = { ...record, owner, epoch: record.epoch + 1, optedIn: false, bindingPending: false, revocationProof: null,
        pendingRevocation: record.revocationProof ? { epoch: record.epoch + 1, revision: record.bindingPending ? 0 : record.revision, proof: record.revocationProof } : record.pendingRevocation };
      this.ports.write(next);
      await this.mirror(next);
    });
  }
  async setOwner(owner: string | null) {
    if (this.knownOwner && this.state.owner === owner) return;
    this.knownOwner = true;
    const generation = ++this.generation;
    this.loadVersion++;
    this.patch({ owner, connected: false, preferences: null, loading: Boolean(owner), busy: false, error: null, message: null });
    try {
      await this.transition(owner, generation);
      await this.drainRevocation();
      if (this.current(owner, generation) && owner) await this.reload();
    } catch { if (this.current(owner, generation)) this.patch({ loading: false, error: "알림 연결 정보를 저장하지 못했습니다. 사이트 저장 공간을 확인한 뒤 다시 시도해 주세요." }); }
  }
  private async drainRevocation() {
    const record = await this.serial(async () => this.ports.read());
    const pending = record.pendingRevocation;
    if (!pending) return;
    try {
      const result = resultRecord(await this.ports.rpc("revoke_web_push_installation", { target_installation_id: record.id,
        target_binding_revision: pending.revision, target_transition_epoch: pending.epoch, target_revocation_proof: pending.proof }), record.id);
      if (result.terminal !== true || typeof result.revoked !== "boolean") throw new Error("Revocation not confirmed");
      await this.serial(async () => {
        const latest = this.ports.read();
        if (latest.pendingRevocation?.proof !== pending.proof || latest.pendingRevocation.epoch !== pending.epoch) return;
        const next = { ...latest, epoch: Math.max(latest.epoch, result.transition_epoch), revision: Math.max(latest.revision, result.binding_revision), pendingRevocation: null };
        this.ports.write(next); await this.mirror(next);
      });
    } catch { /* A proof-scoped revocation remains durable until connectivity returns. */ }
  }
  async beforeLogout() {
    const generation = ++this.generation;
    this.loadVersion++;
    this.patch({ owner: null, preferences: null, connected: false, busy: false, loading: false });
    // Independent local cleanup must still work when one browser store is unavailable.
    let cleared = false, unsubscribed = false;
    try { await this.ports.binding(null); cleared = true; } catch { /* Try the other local cleanup paths. */ }
    try { await this.transition(null, generation, true); cleared = true; } catch { /* Preserve any successfully written revocation intent. */ }
    try {
      await this.serial(async () => { if (this.current(null, generation)) { await this.ports.unsubscribe(); unsubscribed = true; } });
    } catch { /* A cleared worker binding already prevents private notification display. */ }
    void this.drainRevocation().catch(() => undefined);
    if (this.current(null, generation) && !cleared && !unsubscribed) throw new Error("이 기기의 알림 연결을 해제하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.");
  }
  async reload() {
    const owner = this.state.owner, generation = this.generation, version = ++this.loadVersion;
    this.patch({ support: this.ports.support(), permission: this.ports.permission() });
    await this.drainRevocation();
    if (!owner || !this.current(owner, generation)) return;
    this.patch({ loading: true, error: null });
    try {
      const preferences = parseWebPushPreferences(await this.ports.rpc("get_notification_settings", {}, owner));
      if (!this.current(owner, generation) || version !== this.loadVersion) return;
      this.patch({ preferences, loading: false, connected: false });
      const record = await this.serial(async () => this.ports.read());
      if (!this.current(owner, generation)) return;
      if (!preferences.enabled || this.ports.permission() !== "granted") {
        this.patch({ connected: false }); await this.mirror(record); return;
      }
      if (record.owner === owner && record.optedIn && this.ports.support() === "supported") await this.connect(owner, generation, false);
    } catch { if (this.current(owner, generation) && version === this.loadVersion) this.patch({ loading: false, error: "알림 설정을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요." }); }
  }
  /** Call directly from the button handler: permission must begin before any awaited work. */
  enable() {
    const owner = this.state.owner, generation = this.generation;
    if (!owner || this.state.busy || this.state.loading || this.ports.support() !== "supported") return Promise.resolve();
    let permission: Promise<NotificationPermission>;
    try { permission = this.ports.requestPermission(); }
    catch { this.patch({ error: "알림 권한을 요청하지 못했습니다. 홈 화면 앱에서 다시 시도해 주세요." }); return Promise.resolve(); }
    this.loadVersion++;
    this.patch({ busy: true, error: null, message: null });
    return this.enableAfterPermission(owner, generation, permission);
  }
  private async enableAfterPermission(owner: string, generation: number, requested: Promise<NotificationPermission>) {
    try {
      const permission = await requested;
      if (!this.current(owner, generation)) return;
      this.patch({ permission });
      if (permission !== "granted") return;
      if (!this.state.preferences?.enabled) {
        const preferences = parseWebPushPreferences(await this.ports.rpc("save_notification_preferences", { target_preferences: { enabled: true } }, owner));
        if (!this.current(owner, generation)) return;
        this.patch({ preferences });
      }
      await this.connect(owner, generation, true);
    } catch { if (this.current(owner, generation)) this.patch({ error: "이 기기의 알림을 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요." }); }
    finally { if (this.current(owner, generation)) this.patch({ busy: false }); }
  }
  private connect(owner: string, generation: number, create: boolean) {
    const operation = this.connectQueue.catch(() => undefined).then(() => this.registerDevice(owner, generation, create));
    this.connectQueue = operation;
    return operation;
  }
  private async stale(intent: WebPushRecord, result: { transition_epoch: number; binding_revision: number }, owner: string, generation: number) {
    await this.serial(async () => {
      const record = this.ports.read();
      if (!this.current(owner, generation) || record.epoch !== intent.epoch || record.revocationProof !== intent.revocationProof) return;
      const next = { ...record, epoch: Math.max(record.epoch, result.transition_epoch) + 1, revision: result.binding_revision, revocationProof: null, bindingPending: false };
      this.ports.write(next); await this.mirror(next);
    });
    throw new Error("알림 연결이 변경되었습니다. 다시 연결해 주세요.");
  }
  private async registerDevice(owner: string, generation: number, create: boolean) {
    if (!this.current(owner, generation)) return;
    await this.drainRevocation();
    if (!this.current(owner, generation)) return;
    const subscription = await this.ports.subscription(create);
    if (!subscription || !this.current(owner, generation)) { if (this.current(owner, generation)) this.patch({ connected: false }); return; }
    const intent = await this.serial(async () => {
      const record = this.ports.read();
      if (!this.current(owner, generation) || record.owner !== owner) return null;
      if (record.pendingRevocation) throw new Error("Pending revocation");
      const next = record.revocationProof ? { ...record, optedIn: true } : { ...record, optedIn: true, epoch: record.epoch + 1, revocationProof: this.ports.randomProof(), bindingPending: true };
      this.ports.write(next); await this.mirror(next); return next;
    });
    if (!intent || !this.current(owner, generation)) return;
    if (intent.bindingPending) {
      const reservation = resultRecord(await this.ports.rpc("reserve_web_push_installation", installationArgs(intent), owner), intent.id);
      if (!this.current(owner, generation)) return;
      if (reservation.stale === true) return this.stale(intent, reservation, owner, generation);
      if (reservation.stale !== false || reservation.reserved !== true || reservation.transition_epoch !== intent.epoch || reservation.binding_revision !== intent.revision) throw new Error("Reservation changed");
    }
    if (!this.current(owner, generation)) return;
    const result = resultRecord(await this.ports.rpc("register_web_push_installation", { ...installationArgs(intent), target_subscription: subscription, target_permission_state: "granted" }, owner), intent.id);
    if (result.stale === true) return this.stale(intent, result, owner, generation);
    await this.serial(async () => {
      const record = this.ports.read();
      if (!this.current(owner, generation) || record.owner !== owner || record.epoch !== intent.epoch || record.revocationProof !== intent.revocationProof) return;
      if (result.stale !== false || result.transition_epoch !== intent.epoch || result.binding_revision < 1 || typeof result.enabled !== "boolean") throw new Error("Registration changed");
      const next = { ...record, revision: result.binding_revision, bindingPending: false };
      const connected = result.enabled && Boolean(this.state.preferences?.enabled);
      this.ports.write(next); await this.mirror(next, connected);
      this.patch({ connected, error: null });
    });
  }
  async disable() {
    if (!this.state.owner || this.state.busy) return;
    const owner = this.state.owner, generation = ++this.generation;
    this.patch({ busy: true, connected: false, error: null, message: null });
    try {
      await this.ports.binding(null); await this.transition(owner, generation, true);
      await this.serial(async () => { if (this.current(owner, generation)) await this.ports.unsubscribe(); });
      await this.drainRevocation();
      if (this.current(owner, generation)) this.patch({ message: "이 기기의 알림을 껐습니다." });
    } catch { if (this.current(owner, generation)) this.patch({ error: "알림 해제를 마무리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요." }); }
    finally { if (this.current(owner, generation)) this.patch({ busy: false }); }
  }
  async savePreferences(changes: Partial<WebPushPreferences>) {
    const owner = this.state.owner, generation = this.generation;
    if (!owner || this.state.busy) return;
    this.loadVersion++;
    this.patch({ busy: true, error: null, message: null });
    try {
      const preferences = parseWebPushPreferences(await this.ports.rpc("save_notification_preferences", { target_preferences: changes }, owner));
      if (!this.current(owner, generation)) return;
      this.patch({ preferences, connected: preferences.enabled && this.state.connected });
      await this.serial(async () => { if (this.current(owner, generation)) await this.mirror(this.ports.read(), this.state.connected); });
      if (changes.enabled === true && preferences.enabled && this.current(owner, generation)) {
        const record = await this.serial(async () => this.ports.read());
        if (record.owner === owner && record.optedIn && this.ports.permission() === "granted" && this.ports.support() === "supported") await this.connect(owner, generation, false);
      }
    } catch { if (this.current(owner, generation)) this.patch({ error: "알림 설정을 저장하지 못했습니다. 다시 시도해 주세요." }); }
    finally { if (this.current(owner, generation)) this.patch({ busy: false }); }
  }
  async test() {
    const owner = this.state.owner, generation = this.generation;
    if (!owner || !this.state.connected || this.state.busy) return;
    this.patch({ busy: true, error: null, message: null });
    try {
      const record = this.ports.read();
      await this.ports.rpc("request_web_push_test", { target_installation_id: record.id, target_installation_proof: record.proof }, owner);
      if (this.current(owner, generation)) this.patch({ message: "테스트 알림을 요청했습니다. 잠시 후 이 기기에서 확인해 주세요." });
    } catch { if (this.current(owner, generation)) this.patch({ error: "테스트 알림을 요청하지 못했습니다. 연결과 전체 알림 설정을 확인하고 1분 뒤 다시 시도해 주세요." }); }
    finally { if (this.current(owner, generation)) this.patch({ busy: false }); }
  }
}

export const WEB_PUSH_STORAGE_KEY = "gc.web-push.v1";
export function readWebPushSource(owner: string | null, search: string) {
  const params = new URLSearchParams(search), source = params.get("gc_source"), recipient = params.get("gc_owner");
  return owner && recipient === owner && source && uuid.test(source) ? source : null;
}
export function clearWebPushSource() {
  const url = new URL(window.location.href);
  url.searchParams.delete("gc_source"); url.searchParams.delete("gc_owner");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
function randomProof() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
export function getWebPushSupport(): WebPushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  if (ios && !standalone) return "install";
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported";
}
let registration: Promise<ServiceWorkerRegistration> | null = null;
export function prepareWebPushWorker() {
  if (typeof window === "undefined" || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registration) registration = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(() => navigator.serviceWorker.ready).catch((error) => { registration = null; throw error; });
  return registration;
}
async function writeWorkerBinding(value: WebPushBinding | null) {
  if (typeof indexedDB === "undefined") throw new Error("기기 저장 공간을 사용할 수 없습니다.");
  await new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("gc-web-push", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("state");
    opening.onerror = () => reject(new Error("알림 저장 공간을 열지 못했습니다."));
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction("state", "readwrite");
      transaction.objectStore("state").put(value, "binding");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("알림 연결 정보를 저장하지 못했습니다.")); };
    };
  });
}
function decodePublicKey(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("알림 서버 설정을 확인하지 못했습니다.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("알림 서버 설정을 확인하지 못했습니다.");
  return bytes;
}
export function createWebPushController(client: SupabaseClient): WebPushController {
  return new WebPushController({
    read() {
      const raw = localStorage.getItem(WEB_PUSH_STORAGE_KEY);
      if (raw) return parseWebPushRecord(JSON.parse(raw));
      const record: WebPushRecord = { id: crypto.randomUUID(), proof: randomProof(), owner: null, epoch: 0, revision: 0, revocationProof: null, bindingPending: false, pendingRevocation: null, optedIn: false };
      localStorage.setItem(WEB_PUSH_STORAGE_KEY, JSON.stringify(record)); return record;
    },
    write: (record) => localStorage.setItem(WEB_PUSH_STORAGE_KEY, JSON.stringify(record)),
    lock: async (operation) => { if (navigator.locks) return await navigator.locks.request("gc-web-push-state", () => operation()); return await operation(); },
    binding: writeWorkerBinding, randomProof, support: getWebPushSupport,
    permission: () => typeof Notification === "undefined" ? "default" : Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async subscription(create) {
      const worker = await prepareWebPushWorker();
      if (!worker) throw new Error("홈 화면 앱에서 알림을 연결해 주세요.");
      const existing = await worker.pushManager.getSubscription();
      if (existing || !create) return existing?.toJSON() ?? null;
      const response = await fetch("/api/web-push/config", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("알림 서버가 준비되지 않았습니다.");
      const config = await response.json();
      return (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePublicKey(config.publicKey) })).toJSON();
    },
    async unsubscribe() {
      if (!("serviceWorker" in navigator)) return;
      const worker = await navigator.serviceWorker.getRegistration("/");
      const subscription = await worker?.pushManager?.getSubscription();
      if (subscription) await subscription.unsubscribe();
      const notifications = await worker?.getNotifications();
      notifications?.forEach((notification) => notification.close());
    },
    async rpc(name, args, owner) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("알림 서버 연결을 준비하지 못했습니다.");
      let token: string | undefined;
      if (owner) {
        const { data, error } = await client.auth.getSession();
        if (error || data.session?.user.id !== owner) throw new Error("로그인 상태가 바뀌었습니다.");
        token = data.session.access_token;
      }
      const isolated = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) });
      const { data, error } = await isolated.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
      if (error) throw new Error("알림 요청을 완료하지 못했습니다.");
      return data;
    },
  });
}

/** Password changes have their own auth page outside the persistent clubhouse tree. */
export async function disconnectWebPushBeforeLogout(client: SupabaseClient) {
  await createWebPushController(client).beforeLogout();
}
