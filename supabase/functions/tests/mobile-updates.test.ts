import assert from "node:assert/strict";
import test from "node:test";
import { APPLICATION_ID, createMobileUpdatesHandler, type MobileAuth } from "../_shared/mobile-updates.ts";

const sha = "a".repeat(64);
const filename = (code: number) => `gyungchung-1.0.0-android-${code}.apk`;
const publicUrl = (code: number, name: string) => `https://github.com/jaywapp/gyungchung-releases/releases/download/v1.0.0-android-${code}/${name}`;
function assertPublicCall(call: { url: string; init?: RequestInit }) {
  const url = new URL(call.url);
  if (url.hostname === "api.github.com") assert.equal(call.url, "https://api.github.com/repos/jaywapp/gyungchung-releases/releases?per_page=20");
  else {
    assert.equal(url.hostname, "github.com");
    assert.ok(url.pathname.startsWith("/jaywapp/gyungchung-releases/releases/download/"));
  }
}
function release(code = 100016, options: Record<string, unknown> = {}) {
  return { draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z", body: "private commit and PR details", assets: [
    { id: code, name: filename(code), size: 4, state: "uploaded", digest: `sha256:${sha}`, browser_download_url: publicUrl(code, filename(code)) },
    { id: code + 1, name: "checksums.sha256", size: 120, state: "uploaded", browser_download_url: publicUrl(code, "checksums.sha256") },
  ], ...options };
}
function member(status: string | null = "active", valid = true, lookupError: unknown = null): MobileAuth {
  return {
    auth: { getUser: async token => ({ data: { user: valid && token === "user-jwt" ? { id: "auth-id" } : null }, error: null }) },
    from(table) { assert.equal(table, "profiles"); return { select(columns) { assert.equal(columns, "status"); return { eq(column, value) { assert.equal(column, "auth_user_id"); assert.equal(value, "auth-id"); return { maybeSingle: async () => ({ data: status === null ? null : { status }, error: lookupError }) }; } }; } }; },
  };
}
function fakeGithub(items: ReturnType<typeof release>[], extra: Record<string, string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("releases?per_page=20")) return Response.json(items);
    for (const item of items) {
      const apk = item.assets[0];
      for (const candidate of item.assets) {
        if (url !== candidate.browser_download_url) continue;
        if (extra[candidate.id] !== undefined) return new Response(extra[candidate.id]);
        if (candidate.name === "checksums.sha256") return new Response(`${sha}  ${apk.name}\n`);
        if (candidate.id === apk.id) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } });
      }
    }
    return new Response(null, { status: 404 });
  };
  return { calls, fetcher };
}
function completeGithub(codes: number[]) {
  const items = codes.map(code => release(code));
  const extra: Record<string, string> = {};
  for (const item of items) {
    const apk = item.assets[0];
    item.assets.push({ id: apk.id + 2, name: "update.json", size: 500, state: "uploaded", digest: undefined, browser_download_url: publicUrl(apk.id, "update.json") });
    extra[apk.id + 2] = JSON.stringify({ schemaVersion: 1, platform: "android", applicationId: APPLICATION_ID, versionName: "1.0.0", versionCode: apk.id, assetName: apk.name, sha256: sha, sizeBytes: apk.size, notes: ["앱 안정성을 개선했습니다."] });
  }
  return { items, ...fakeGithub(items, extra) };
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
const request = (query = "", authorized = false) => new Request(`https://example.test/functions/v1/mobile-updates${query}`, { headers: authorized ? { authorization: "Bearer user-jwt" } : {} });

test("public metadata sanitizes release bodies and selects greatest code despite older latest", async () => {
  const upstream = fakeGithub([release(100016), release(100018, { published_at: "2026-09-01T00:00:00Z" }), release(100020, { draft: true }), release(100030, { prerelease: true })]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.versionCode, 100018);
  assert.deepEqual(Object.keys(metadata).sort(), ["schemaVersion", "platform", "applicationId", "versionName", "versionCode", "assetName", "sha256", "sizeBytes", "notes", "publishedAt", "downloadUrl"].sort());
  assert.equal(metadata.applicationId, APPLICATION_ID);
  assert.equal(metadata.downloadUrl, publicUrl(metadata.versionCode, metadata.assetName));
  assert.doesNotMatch(JSON.stringify(metadata), /private|server-only|gyungchung-mobile|commit|pull/);
});

test("partial upload is skipped and absent digest uses checksum for legacy release", async () => {
  const incomplete = release(100100); incomplete.assets.pop();
  const legacy = release(); delete legacy.assets[0].digest;
  const upstream = fakeGithub([incomplete, legacy]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
  assert.equal((await (await handler(request())).json()).versionCode, 100016);
});

test("manifest must match APK contract and notes must contain only curated public plain text", async () => {
  const item = release(); item.assets.push({ id: 9, name: "update.json", size: 500, state: "uploaded", digest: undefined, browser_download_url: publicUrl(100016, "update.json") });
  const manifest = { schemaVersion: 1, platform: "android", applicationId: APPLICATION_ID, versionName: "1.0.0", versionCode: 100016, assetName: filename(100016), sha256: sha, sizeBytes: 4, notes: ["앱 안정성을 개선했습니다."] };
  for (const mutation of [{}, { sha256: "b".repeat(64) }, { sizeBytes: 5 }, { applicationId: "other.app" }, { versionCode: 100017 }, { assetName: "other.apk" }, { notes: ["https://github.com/private/pull/1"] }]) {
    const upstream = fakeGithub([item], { 9: JSON.stringify({ ...manifest, ...mutation }) });
    const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
    const response = await handler(request());
    assert.equal(response.status, Object.keys(mutation).length ? 502 : 200);
  }
});

test("cache merges requests, expires, and never bypasses member checks for APK", async () => {
  const upstream = fakeGithub([release()]); let current = 0;
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: upstream.fetcher, now: () => current });
  await Promise.all([handler(request()), handler(request()), handler(request())]);
  assert.equal(upstream.calls.filter(call => call.url.includes("per_page")).length, 1);
  assert.equal((await handler(request("?versionCode=100016&download=1"))).status, 401);
  const downloaded = await handler(request("?versionCode=100016&download=1", true));
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  current = 120001; await handler(request());
  assert.equal(upstream.calls.filter(call => call.url.includes("per_page")).length, 2);
});

test("authentication validates JWT and profile linking/status before contacting GitHub", async () => {
  for (const [status, valid, expected] of [["active", false, 401], [null, true, 403], ["inactive", true, 403], ["unknown", true, 403]] as const) {
    const upstream = fakeGithub([release()]);
    const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(status, valid), fetch: upstream.fetcher });
    assert.equal((await handler(request("?versionCode=100016&download=1", true))).status, expected);
    assert.equal(upstream.calls.length, 0);
  }
  const upstream = fakeGithub([release()]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member("pending"), fetch: upstream.fetcher });
  const pendingDownload = await handler(request("?versionCode=100016&download=1", true));
  assert.equal(pendingDownload.status, 200); await pendingDownload.arrayBuffer();
});

test("private asset redirect strips credentials and rejects any unsafe redirect", async () => {
  for (const location of ["https://release-assets.githubusercontent.com/private.apk?sig=hidden", "https://evil.test/file", "http://release-assets.githubusercontent.com/file", "https://release-assets.githubusercontent.com.evil.test/file", "https://user:pass@release-assets.githubusercontent.com/file", "https://release-assets.githubusercontent.com:443/file", "https://release-assets.githubusercontent.com:8443/file"]) {
    const upstream = fakeGithub([release()]); let redirected = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/${filename(100016)}`)) { assert.equal(new Headers(init?.headers).has("authorization"), false); return new Response(null, { status: 302, headers: { location } }); }
      if (url.startsWith("https://release-assets.githubusercontent.com/private.apk")) {
        redirected = true; assert.equal(new Headers(init?.headers).has("authorization"), false);
        return new Response(new Uint8Array([1, 2, 3, 4]));
      }
      return upstream.fetcher(input, init);
    };
    const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: fetcher });
    const response = await handler(request("?versionCode=100016&download=1", true));
    assert.equal(response.status, location.includes("private.apk") ? 200 : 502);
    assert.equal(redirected, location.includes("private.apk"));
    if (response.status === 200) await response.arrayBuffer();
  }
});

test("APK streams incrementally, cancellation aborts upstream, and truncated body fails", async () => {
  const upstream = fakeGithub([release()]); let canceled = false; let downloadSignal: AbortSignal | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith(`/${filename(100016)}`)) {
      downloadSignal = init!.signal as AbortSignal;
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { canceled = true; } }));
    }
    return upstream.fetcher(input, init);
  };
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: fetcher });
  const response = await handler(request("?versionCode=100016&download=1", true));
  const reader = response.body!.getReader(); assert.equal((await reader.read()).value!.byteLength, 1); await reader.cancel();
  assert.equal(canceled, true); assert.equal(downloadSignal!.aborted, true);
  const truncated: typeof fetch = async (input, init) => String(input).endsWith(`/${filename(100016)}`) ? new Response(new Uint8Array([1])) : upstream.fetcher(input, init);
  const broken = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: truncated });
  await assert.rejects((await broken(request("?versionCode=100016&download=1", true))).arrayBuffer(), /download_interrupted/);
});

test("invalid input, upstream errors, oversized/corrupt metadata are safe", async () => {
  const upstream = fakeGithub([release()]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: upstream.fetcher });
  for (const query of ["?repository=other", "?asset=https://evil.test", "?download=1&versionCode=-1", "?download=2", "?download=1&versionCode=1&versionCode=2", "?versionCode=100016"]) assert.equal((await handler(request(query, true))).status, 400);
  for (const response of [new Response("private details", { status: 403 }), new Response("private details", { status: 404 }), new Response("x".repeat(1024 * 1024 + 1)), new Response("not-json")]) {
    const broken = createMobileUpdatesHandler({ githubToken: "server-only", fetch: async () => response });
    const result = await broken(request()); assert.equal(result.status, 502); assert.doesNotMatch(await result.text(), /private|server-only/);
  }
  const corrupt = release(); corrupt.assets[0].digest = `sha256:${"b".repeat(64)}`;
  const invalid = fakeGithub([corrupt]);
  assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: invalid.fetcher })(request())).status, 502);
});

test("metadata deadline aborts upstream and failed cache refresh retries", async () => {
  let aborted = false;
  const blocked: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("internal private URL")); });
  });
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: blocked, metadataTimeoutMs: 5 });
  assert.equal((await handler(request())).status, 502); assert.equal(aborted, true);
  const upstream = fakeGithub([release()]); let attempts = 0;
  const retry = createMobileUpdatesHandler({ githubToken: "server-only", fetch: async (input, init) => { if (++attempts === 1) return new Response(null, { status: 403 }); return upstream.fetcher(input, init); } });
  assert.equal((await retry(request())).status, 502); assert.equal((await retry(request())).status, 200);
});


test("checksum bounds, duplicate version codes and empty/unfinished releases fail safely", async () => {
  const oversized = release(); oversized.assets[1].size = 16385;
  const upstream = fakeGithub([oversized]);
  assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher })(request())).status, 502);
  const duplicate = fakeGithub([release(), release()]);
  assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: duplicate.fetcher })(request())).status, 502);
  const unfinished = release(); unfinished.assets[1].state = "new";
  for (const items of [[], [unfinished]]) {
    const absent = fakeGithub(items);
    assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: absent.fetcher })(request())).status, 404);
  }
});

test("download deadline and request cancellation abort private asset fetch", async () => {
  for (const externalCancellation of [false, true]) {
    const upstream = fakeGithub([release()]); let aborted = false;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith(`/${filename(100016)}`)) return new Promise((_resolve, reject) => {
        const abort = () => { aborted = true; reject(new Error("private asset failed")); };
        if (init!.signal!.aborted) abort(); else init!.signal!.addEventListener("abort", abort);
      });
      return upstream.fetcher(input, init);
    };
    const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: fetcher, downloadTimeoutMs: externalCancellation ? 1000 : 5 });
    await handler(request());
    const controller = new AbortController();
    const download = handler(new Request("https://example.test/mobile-updates?download=1&versionCode=100016", { headers: { authorization: "Bearer user-jwt" }, signal: controller.signal }));
    if (externalCancellation) controller.abort();
    const response = await download;
    assert.equal(response.status, 502); assert.equal(aborted, true);
    assert.doesNotMatch(await response.text(), /private asset/);
  }
});

test("download authentication precedes GitHub fetch and APK limit is 250MiB", async () => {
  const upstreamWithoutToken = fakeGithub([release()]);
  const unconfigured = createMobileUpdatesHandler({ fetch: upstreamWithoutToken.fetcher });
  assert.equal((await unconfigured(request("?download=1&versionCode=100016"))).status, 401);
  assert.equal((await unconfigured(request("?download=1&versionCode=100016", true))).status, 503);
  assert.equal(upstreamWithoutToken.calls.length, 0);
  assert.equal((await unconfigured(request())).status, 200);
  const oversized = release(); oversized.assets[0].size = 250 * 1024 * 1024 + 1;
  const upstream = fakeGithub([oversized]);
  assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher })(request())).status, 404);
});

test("public repository metadata and member downloads work without a GitHub token", async () => {
  for (const githubToken of [undefined, "", "   "]) {
    const upstream = fakeGithub([release()]);
    const handler = createMobileUpdatesHandler({ githubToken, authClient: member(), fetch: upstream.fetcher });
    assert.equal((await handler(request("?download=1&versionCode=100016"))).status, 401);
    assert.equal(upstream.calls.length, 0);
    assert.equal((await handler(request())).status, 200);
    const response = await handler(request("?download=1&versionCode=100016", true));
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(upstream.calls.length, 3);
    for (const call of upstream.calls) {
      assertPublicCall(call);
      assert.equal(new Headers(call.init?.headers).has("authorization"), false);
      assert.equal(call.init?.redirect, "manual");
    }
    const before = upstream.calls.length;
    assert.equal((await handler(request("?repository=jaywapp/gyungchung-mobile"))).status, 400);
    assert.equal((await handler(request("?asset=https://evil.test/file"))).status, 400);
    assert.equal(upstream.calls.length, before);
  }
});

test("optional GitHub token is sent only to the fixed public API repository", async () => {
  const upstream = fakeGithub([release()]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: upstream.fetcher });
  const response = await handler(request("?download=1&versionCode=100016", true));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  for (const call of upstream.calls) {
    assertPublicCall(call);
    assert.equal(new Headers(call.init?.headers).get("authorization"), new URL(call.url).hostname === "api.github.com" ? "Bearer server-only" : null);
  }
});

test("anonymous success cache merges calls for ten minutes and refreshes at expiry", async () => {
  const upstream = fakeGithub([release()]); let current = 0;
  const handler = createMobileUpdatesHandler({ fetch: upstream.fetcher, now: () => current });
  const responses = await Promise.all([handler(request()), handler(request()), handler(request())]);
  assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
  assert.equal(upstream.calls.length, 2);
  current = 120001;
  assert.equal((await handler(request())).status, 200);
  current = 599999;
  assert.equal((await handler(request())).status, 200);
  assert.equal(upstream.calls.length, 2);
  current = 600000;
  assert.equal((await handler(request())).status, 200);
  assert.equal(upstream.calls.length, 4);
});

test("anonymous upstream failure remains safe and is retried without caching an error", async () => {
  const upstream = fakeGithub([release()]); let attempts = 0;
  const handler = createMobileUpdatesHandler({ fetch: async (input, init) => {
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    if (++attempts === 1) return new Response("upstream details", { status: 403 });
    return upstream.fetcher(input, init);
  } });
  const failed = await handler(request());
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "upstream_unavailable" });
  assert.equal((await handler(request())).status, 200);
  assert.equal(attempts, 3);
});


test("twenty complete releases use one REST API listing and public assets without credentials", async () => {
  for (const githubToken of [undefined, "server-only"]) {
    const items = Array.from({ length: 20 }, (_, index) => release(100000 + index * 10));
    const extra: Record<string, string> = {};
    for (const item of items) {
      const apk = item.assets[0];
      const code = apk.id;
      item.assets.push({ id: code + 2, name: "update.json", size: 500, state: "uploaded", digest: undefined, browser_download_url: publicUrl(code, "update.json") });
      extra[code + 2] = JSON.stringify({ schemaVersion: 1, platform: "android", applicationId: APPLICATION_ID, versionName: "1.0.0", versionCode: code, assetName: apk.name, sha256: sha, sizeBytes: 4, notes: ["앱 안정성을 개선했습니다."] });
    }
    const withManifest = fakeGithub(items, extra);
    const handler = createMobileUpdatesHandler({ githubToken, authClient: member(), fetch: withManifest.fetcher });
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).versionCode, 100190);
    assert.equal(withManifest.calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 1);
    assert.equal(withManifest.calls.filter(call => new URL(call.url).hostname === "github.com").length, 40);
    for (const call of withManifest.calls) {
      assertPublicCall(call);
      assert.equal(new Headers(call.init?.headers).get("authorization"), new URL(call.url).hostname === "api.github.com" && githubToken ? "Bearer server-only" : null);
    }
    const download = await handler(request("?download=1&versionCode=100190", true));
    assert.equal(download.status, 200);
    await download.arrayBuffer();
    assert.equal(withManifest.calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 1);
    assert.equal(withManifest.calls.at(-1)?.url, publicUrl(100190, filename(100190)));
    assert.equal(new Headers(withManifest.calls.at(-1)?.init?.headers).has("authorization"), false);
  }
});

test("public asset URLs reject other repositories, credentials, ports, queries and malformed paths", async () => {
  const valid = publicUrl(100016, filename(100016));
  const invalid = [undefined, null, "https://evil.test/file", valid.replace("https:", "http:"), valid.replace("github.com/", "github.com.evil.test/"), valid.replace("gyungchung-releases/", "gyungchung-mobile/"), valid.replace("https://", "https://user:pass@"), valid.replace("github.com/", "github.com:443/"), valid.replace("github.com/", "github.com:8443/"), `${valid}?download=1`, `${valid}?`, `${valid}#fragment`, `${valid}#`, valid.replace("v1.0.0-android-100016/", "tag/extra/"), valid.replace("v1.0.0-android-100016/", "tag%2Fextra/"), valid.replace("v1.0.0-android-100016/", "tag%5Cextra/"), valid.replace(filename(100016), "other.apk")];
  for (const raw of invalid) {
    const item = release();
    (item.assets[0] as { browser_download_url?: unknown }).browser_download_url = raw;
    const upstream = fakeGithub([item]);
    const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
    assert.equal((await handler(request())).status, 502);
    assert.equal(upstream.calls.length, 1);
    assert.equal(new URL(upstream.calls[0].url).hostname, "api.github.com");
  }
  const item = release();
  item.assets[1].browser_download_url = publicUrl(100016, "wrong-checksum.sha256");
  const upstream = fakeGithub([item]);
  assert.equal((await createMobileUpdatesHandler({ fetch: upstream.fetcher })(request())).status, 502);
  assert.equal(upstream.calls.length, 1);
});

test("release validation bounds active reads and starts checksum and manifest together", async () => {
  const codes = [100000, 100010, 100020, 100030, 100040, 100050, 100060];
  const upstream = completeGithub(codes);
  const waiting: { url: string; resolve: () => void }[] = [];
  let active = 0;
  let peak = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).hostname === "api.github.com") return upstream.fetcher(input, init);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise<void>(resolve => waiting.push({ url: String(input), resolve }));
      return await upstream.fetcher(input, init);
    } finally { active--; }
  };
  const handler = createMobileUpdatesHandler({ fetch: fetcher });
  const response = handler(request());
  await nextTurn();
  assert.equal(waiting.length, 6);
  for (const code of codes.slice(0, 3)) {
    assert.ok(waiting.some(item => item.url === publicUrl(code, "checksums.sha256")));
    assert.ok(waiting.some(item => item.url === publicUrl(code, "update.json")));
  }
  waiting[0].resolve();
  await nextTurn();
  assert.equal(waiting.length, 6, "a release keeps its slot until both files finish");
  for (let round = 0; round < 4; round++) {
    for (const item of waiting) item.resolve();
    await nextTurn();
  }
  assert.equal((await (await response).json()).versionCode, codes.at(-1));
  assert.equal(waiting.length, 14);
  assert.equal(peak, 6);
  assert.equal(active, 0);
  const before = upstream.calls.length;
  assert.equal((await handler(request())).status, 200);
  assert.equal(upstream.calls.length, before, "warm cache makes no upstream requests");
});

test("parallel metadata redirects stay manual and never forward credentials", async () => {
  const upstream = completeGithub([100000, 100010, 100020, 100030]);
  const calls: { url: string; init?: RequestInit }[] = [];
  const redirectedAssets = new Map<string, string>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (new URL(url).hostname === "github.com") {
      const redirected = "https://release-assets.githubusercontent.com/" + encodeURIComponent(url) + "?signature=fixture";
      redirectedAssets.set(redirected, url);
      return new Response(null, { status: 302, headers: { location: redirected } });
    }
    return upstream.fetcher(redirectedAssets.get(url) ?? url, init);
  };
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: fetcher });
  const responses = await Promise.all([handler(request()), handler(request()), handler(request())]);
  assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
  assert.equal((await responses[0].json()).versionCode, 100030);
  assert.equal(calls.length, 17);
  assert.equal(calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 1);
  for (const call of calls) {
    assert.equal(call.init?.redirect, "manual");
    assert.equal(new Headers(call.init?.headers).get("authorization"), new URL(call.url).hostname === "api.github.com" ? "Bearer server-only" : null);
  }
});

test("one metadata deadline aborts all active reads without starting queued releases", async () => {
  const upstream = completeGithub([100000, 100010, 100020, 100030, 100040, 100050]);
  let blocked = true;
  const signals: AbortSignal[] = [];
  let aborted = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (!blocked || new URL(String(input)).hostname === "api.github.com") return upstream.fetcher(input, init);
    const signal = init!.signal!;
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      const onAbort = () => { aborted++; reject(new Error("private upstream timeout")); };
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const handler = createMobileUpdatesHandler({ fetch: fetcher, metadataTimeoutMs: 20 });
  const responses = await Promise.all([handler(request()), handler(request()), handler(request())]);
  assert.deepEqual(responses.map(response => response.status), [502, 502, 502]);
  assert.equal(signals.length, 6);
  assert.equal(new Set(signals).size, 1);
  assert.equal(aborted, 6);
  assert.deepEqual(await responses[0].json(), { error: "upstream_unavailable" });
  blocked = false;
  assert.equal((await handler(request())).status, 200, "a failed single flight is cleared for retry");
  assert.equal(upstream.calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 2);
});

test("metadata deadline cancels unfinished bodies after response headers arrive", async () => {
  const upstream = completeGithub([100000, 100010, 100020, 100030]);
  let bodies = 0;
  let canceled = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).hostname === "api.github.com") return upstream.fetcher(input, init);
    bodies++;
    return new Response(new ReadableStream({ cancel() { canceled++; } }));
  };
  const handler = createMobileUpdatesHandler({ fetch: fetcher, metadataTimeoutMs: 20 });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
  assert.equal(bodies, 6);
  assert.equal(canceled, 6);
});

test("a corrupt last release cannot mask the shared deadline and cache a partial success", async () => {
  const upstream = completeGithub([100000, 100010]);
  let blocked = true;
  let canceled = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (blocked && url === publicUrl(100010, "checksums.sha256")) return new Response("x".repeat(16385));
    if (blocked && url === publicUrl(100010, "update.json")) return new Response(new ReadableStream({ cancel() { canceled = true; } }));
    return upstream.fetcher(input, init);
  };
  const handler = createMobileUpdatesHandler({ fetch: fetcher, metadataTimeoutMs: 20 });
  const timedOut = await handler(request());
  assert.equal(timedOut.status, 502);
  assert.deepEqual(await timedOut.json(), { error: "upstream_unavailable" });
  assert.equal(canceled, true);
  blocked = false;
  assert.equal((await (await handler(request())).json()).versionCode, 100010);
  assert.equal(upstream.calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 2);
});

test("a fatal refresh aborts sibling releases and never serves the expired success cache", async () => {
  const upstream = completeGithub([100000, 100010, 100020, 100030]);
  let current = 0;
  let failing = false;
  let started = 0;
  let aborted = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!failing || new URL(url).hostname === "api.github.com") return upstream.fetcher(input, init);
    started++;
    if (url === publicUrl(100000, "checksums.sha256")) return new Response("private upstream details", { status: 503 });
    if (url === publicUrl(100000, "update.json")) return upstream.fetcher(input, init);
    return new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      const onAbort = () => { aborted++; reject(new Error("private sibling details")); };
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  const handler = createMobileUpdatesHandler({ fetch: fetcher, now: () => current });
  assert.equal((await handler(request())).status, 200);
  current = 600000;
  failing = true;
  const responses = await Promise.all([handler(request()), handler(request())]);
  assert.deepEqual(responses.map(response => response.status), [502, 502]);
  assert.deepEqual(await responses[0].json(), { error: "upstream_unavailable" });
  assert.equal(started, 6);
  assert.equal(aborted, 4);
  failing = false;
  assert.equal((await handler(request())).status, 200);
  assert.equal(upstream.calls.filter(call => new URL(call.url).hostname === "api.github.com").length, 3);
});

test("all batches preserve incomplete/corrupt release handling and duplicate code rejection", async () => {
  const corrupt = release(100030);
  corrupt.assets[0].digest = `sha256:${"b".repeat(64)}`;
  const incomplete = release(100100);
  incomplete.assets[1].state = "new";
  const upstream = fakeGithub([release(100000), corrupt, incomplete, release(100020)]);
  const handler = createMobileUpdatesHandler({ fetch: upstream.fetcher });
  assert.equal((await (await handler(request())).json()).versionCode, 100020);
  const duplicate = fakeGithub([release(100000), release(100010), release(100020), release(100000)]);
  const rejected = await createMobileUpdatesHandler({ fetch: duplicate.fetcher })(request());
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: "invalid_release" });
});
