export const MOBILE_REPOSITORY = "jaywapp/gyungchung-releases";
export const APPLICATION_ID = "com.jaywapp.gyungchung";
const API = `https://api.github.com/repos/${MOBILE_REPOSITORY}`;
const APK_NAME = /^gyungchung-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-android-([1-9]\d*)\.apk$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_APK_BYTES = 250 * 1024 * 1024;
const MAX_SMALL_BYTES = 16 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_NOTES = ["앱의 안정성과 사용성을 개선했습니다."];

export type MobileMetadata = {
  schemaVersion: 1;
  platform: "android";
  applicationId: string;
  versionName: string;
  versionCode: number;
  assetName: string;
  sha256: string;
  sizeBytes: number;
  notes: string[];
  publishedAt: string;
  downloadUrl: string;
};
type Asset = { id: number; name: string; state: string; size: number; digest?: unknown; browser_download_url?: unknown };
type Release = { draft: boolean; prerelease: boolean; published_at: string; assets: Asset[] };
type ValidatedRelease = { metadata: MobileMetadata; assetUrl: string };
export type MobileAuth = {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { maybeSingle(): Promise<{ data: { status: string } | null; error: unknown }> } };
  };
};
export type MobileDependencies = {
  githubToken?: string;
  authClient?: MobileAuth;
  fetch?: typeof fetch;
  now?: () => number;
  metadataTimeoutMs?: number;
  downloadTimeoutMs?: number;
};
class MobileError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
}
function asset(value: unknown): value is Asset {
  return object(value) && positive(value.id) && typeof value.name === "string" && value.state === "uploaded" && positive(value.size, MAX_APK_BYTES);
}
function publicAssetUrl(value: Asset): string {
  const raw = value.browser_download_url;
  if (typeof raw !== "string" || !raw.startsWith(`https://github.com/${MOBILE_REPOSITORY}/releases/download/`) || raw.includes("?") || raw.includes("#")) throw new MobileError(502, "invalid_release");
  let url: URL;
  try { url = new URL(raw); } catch { throw new MobileError(502, "invalid_release"); }
  const prefix = `/${MOBILE_REPOSITORY}/releases/download/`;
  const parts = url.pathname.slice(prefix.length).split("/");
  if (url.href !== raw || url.origin !== "https://github.com" || url.username || url.password || url.port || !url.pathname.startsWith(prefix) || parts.length !== 2 || !parts[0] || parts[1] !== encodeURIComponent(value.name)) throw new MobileError(502, "invalid_release");
  let tag: string;
  try { tag = decodeURIComponent(parts[0]); } catch { throw new MobileError(502, "invalid_release"); }
  if (!tag || tag === "." || tag === ".." || /[/\\\u0000-\u0020\u007f]/.test(tag)) throw new MobileError(502, "invalid_release");
  return url.href;
}
function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Length, Content-Disposition",
    "X-Content-Type-Options": "nosniff",
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function timer(milliseconds: number, external?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  if (external?.aborted) controller.abort();
  const timeout = setTimeout(onAbort, milliseconds);
  return { signal: controller.signal, abort: onAbort, cleanup: () => { clearTimeout(timeout); external?.removeEventListener("abort", onAbort); } };
}
async function limitedText(response: Response, limit: number) {
  if (!response.body) throw new MobileError(502, "invalid_release");
  const length = Number(response.headers.get("content-length"));
  if (length > limit) { await response.body.cancel(); throw new MobileError(502, "invalid_release"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new MobileError(502, "invalid_release"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function safeNotes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new MobileError(502, "invalid_release");
  const notes: string[] = [];
  for (const note of value) {
    // Only curated plain text is public; raw release bodies never enter this path.
    if (typeof note !== "string" || !note.trim() || note.length > 240 || /[\u0000-\u001f\u007f]|https?:\/\/|github\.|gh[pousr]_|github_pat_|\b[0-9a-f]{40}\b|#\d+/i.test(note)) {
      throw new MobileError(502, "invalid_release");
    }
    notes.push(note.trim());
  }
  return notes;
}

export function createMobileUpdatesHandler(dependencies: MobileDependencies) {
  const upstreamFetch = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const githubToken = dependencies.githubToken?.trim();
  const cacheTtlMs = githubToken ? 120000 : 600000;
  let cached: { expires: number; releases: ValidatedRelease[] } | undefined;
  let pending: Promise<ValidatedRelease[]> | undefined;
  async function githubListing(signal: AbortSignal): Promise<Response> {
    const response = await upstreamFetch(`${API}/releases?per_page=20`, { signal, redirect: "manual", headers: {
      ...(githubToken ? { "Authorization": `Bearer ${githubToken}` } : {}),
      "Accept": "application/vnd.github+json",
      "User-Agent": "gyungchung-mobile-updates",
      "X-GitHub-Api-Version": "2022-11-28",
    } });
    if (response.status !== 200) { await response.body?.cancel(); throw new MobileError(502, "upstream_unavailable"); }
    return response;
  }
  async function publicAsset(url: string, signal: AbortSignal): Promise<Response> {
    const response = await upstreamFetch(url, { signal, redirect: "manual" });
    if (response.status === 302) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || !location.startsWith("https://release-assets.githubusercontent.com/")) throw new MobileError(502, "invalid_release");
      const target = new URL(location);
      if (target.protocol !== "https:" || target.hostname !== "release-assets.githubusercontent.com" || target.port || target.username || target.password) throw new MobileError(502, "invalid_release");
      const redirected = await upstreamFetch(target.href, { signal, redirect: "manual" });
      if (redirected.status !== 200) { await redirected.body?.cancel(); throw new MobileError(502, "upstream_unavailable"); }
      return redirected;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw new MobileError(502, "upstream_unavailable"); }
    return response;
  }
  async function smallAsset(value: Asset, signal: AbortSignal) {
    if (value.size > MAX_SMALL_BYTES) throw new MobileError(502, "invalid_release");
    return limitedText(await publicAsset(publicAssetUrl(value), signal), MAX_SMALL_BYTES);
  }
  async function loadReleases(): Promise<ValidatedRelease[]> {
    const deadline = timer(dependencies.metadataTimeoutMs ?? 15000);
    try {
      const payload: unknown = JSON.parse(await limitedText(await githubListing(deadline.signal), MAX_JSON_BYTES));
      if (!Array.isArray(payload) || payload.length > 20) throw new MobileError(502, "invalid_release");
      const result: ValidatedRelease[] = [];
      let corrupt = false;
      for (const value of payload) {
        if (!object(value) || value.draft !== false || value.prerelease !== false) continue;
        if (!Array.isArray(value.assets) || typeof value.published_at !== "string" || !Number.isFinite(Date.parse(value.published_at))) { corrupt = true; continue; }
        const release = value as unknown as Release;
        const apks = release.assets.filter(item => asset(item) && APK_NAME.test(item.name));
        if (!apks.length) continue;
        const checksumCandidates = release.assets.filter(item => object(item) && item.name === "checksums.sha256");
        // The checksum asset is the release uploader's final completion marker.
        if (checksumCandidates.length === 0 || checksumCandidates.some(item => !asset(item))) continue;
        if (checksumCandidates.length !== 1) { corrupt = true; continue; }
        try {
          const apksWithUrls = apks.map(apk => ({ apk, url: publicAssetUrl(apk) }));
          const checksums = await smallAsset(checksumCandidates[0], deadline.signal);
          const manifestCandidates = release.assets.filter(item => object(item) && item.name === "update.json");
          if (manifestCandidates.length > 1 || manifestCandidates.some(item => !asset(item))) throw new MobileError(502, "invalid_release");
          const manifest: unknown = manifestCandidates.length ? JSON.parse(await smallAsset(manifestCandidates[0], deadline.signal)) : undefined;
          const validated: ValidatedRelease[] = [];
          for (const { apk, url } of apksWithUrls) {
            const match = APK_NAME.exec(apk.name)!;
            const versionCode = Number(match[2]);
            if (!positive(versionCode, 2100000000)) throw new MobileError(502, "invalid_release");
            const entries = checksums.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line.trim())).filter(entry => entry?.[2] === apk.name);
            if (entries.length !== 1) throw new MobileError(502, "invalid_release");
            const checksum = entries[0]![1].toLowerCase();
            if (!SHA.test(checksum)) throw new MobileError(502, "invalid_release");
            if (apk.digest !== undefined && apk.digest !== null && apk.digest !== "" && apk.digest !== `sha256:${checksum}`) throw new MobileError(502, "invalid_release");
            let notes = DEFAULT_NOTES;
            if (manifest !== undefined) {
              if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.platform !== "android" || manifest.applicationId !== APPLICATION_ID || manifest.versionName !== match[1] || manifest.versionCode !== versionCode || manifest.assetName !== apk.name || manifest.sha256 !== checksum || manifest.sizeBytes !== apk.size) throw new MobileError(502, "invalid_release");
              notes = safeNotes(manifest.notes);
            }
            validated.push({ assetUrl: url, metadata: { schemaVersion: 1, platform: "android", applicationId: APPLICATION_ID, versionName: match[1], versionCode, assetName: apk.name, sha256: checksum, sizeBytes: apk.size, notes, publishedAt: new Date(release.published_at).toISOString(), downloadUrl: url } });
          }
          result.push(...validated);
        } catch (error) {
          if (!(error instanceof MobileError) || error.message !== "invalid_release") throw error;
          corrupt = true;
        }
      }
      result.sort((a, b) => b.metadata.versionCode - a.metadata.versionCode);
      // Conflicting releases must never pick an arbitrary APK for the same code.
      for (let index = 1; index < result.length; index++) if (result[index].metadata.versionCode === result[index - 1].metadata.versionCode) throw new MobileError(502, "invalid_release");
      if (!result.length) throw new MobileError(corrupt ? 502 : 404, corrupt ? "invalid_release" : "no_release");
      return result;
    } finally { deadline.cleanup(); }
  }
  function releases() {
    if (cached && cached.expires > now()) return Promise.resolve(cached.releases);
    if (!pending) pending = loadReleases().then(result => { cached = { expires: now() + cacheTtlMs, releases: result }; return result; }).finally(() => { pending = undefined; });
    return pending;
  }
  async function authenticate(request: Request) {
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new MobileError(401, "authentication_required");
    if (!dependencies.authClient) throw new MobileError(503, "not_configured");
    const { data, error } = await dependencies.authClient.auth.getUser(authorization.slice(7));
    if (error || !data.user) throw new MobileError(401, "authentication_required");
    const { data: profile, error: profileError } = await dependencies.authClient.from("profiles").select("status").eq("auth_user_id", data.user.id).maybeSingle();
    if (profileError) throw new MobileError(503, "membership_unavailable");
    if (!profile || (profile.status !== "active" && profile.status !== "pending")) throw new MobileError(403, "membership_required");
  }
  async function download(request: Request, release: ValidatedRelease) {
    const deadline = timer(dependencies.downloadTimeoutMs ?? 120000, request.signal);
    try {
      const response = await publicAsset(release.assetUrl, deadline.signal);
      if (!response.body) throw new MobileError(502, "invalid_download");
      const length = response.headers.get("content-length");
      if (length !== null && Number(length) !== release.metadata.sizeBytes) { await response.body.cancel(); throw new MobileError(502, "invalid_download"); }
      const reader = response.body.getReader();
      let transferred = 0;
      let closed = false;
      const cleanup = () => { closed = true; deadline.cleanup(); reader.releaseLock(); };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await reader.read();
            if (done) {
              if (transferred !== release.metadata.sizeBytes) throw new Error("invalid_download");
              cleanup(); controller.close(); return;
            }
            transferred += value.byteLength;
            if (transferred > release.metadata.sizeBytes) throw new Error("invalid_download");
            controller.enqueue(value);
          } catch {
            deadline.abort();
            await reader.cancel().catch(() => undefined);
            if (!closed) cleanup();
            controller.error(new Error("download_interrupted"));
          }
        },
        async cancel() { deadline.abort(); await reader.cancel().catch(() => undefined); if (!closed) cleanup(); },
      });
      return new Response(stream, { headers: { ...headers(), "Content-Type": "application/vnd.android.package-archive", "Content-Disposition": `attachment; filename="${release.metadata.assetName}"`, "Content-Length": String(release.metadata.sizeBytes), "Cache-Control": "private, no-store" } });
    } catch (error) { deadline.abort(); deadline.cleanup(); throw error; }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try {
      const url = new URL(request.url);
      for (const key of url.searchParams.keys()) if (key !== "download" && key !== "versionCode") throw new MobileError(400, "invalid_request");
      if (url.searchParams.getAll("download").length > 1 || url.searchParams.getAll("versionCode").length > 1) throw new MobileError(400, "invalid_request");
      const isDownload = url.searchParams.get("download") === "1";
      if ((url.searchParams.has("download") && !isDownload) || (!isDownload && url.searchParams.has("versionCode"))) throw new MobileError(400, "invalid_request");
      const code = url.searchParams.get("versionCode");
      if (isDownload && (!code || !/^[1-9]\d*$/.test(code) || !positive(Number(code), 2100000000))) throw new MobileError(400, "invalid_request");
      if (isDownload) await authenticate(request);
      const available = await releases();
      if (!isDownload) return json(available[0].metadata);
      const selected = available.find(value => value.metadata.versionCode === Number(code));
      if (!selected) throw new MobileError(404, "no_release");
      return await download(request, selected);
    } catch (error) {
      // Never log upstream bodies, URLs, credentials, or account details.
      return error instanceof MobileError ? json({ error: error.message }, error.status) : json({ error: "upstream_unavailable" }, 502);
    }
  };
}
