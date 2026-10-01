import assert from "node:assert/strict";
import test from "node:test";
import { APPLICATION_ID, createMobileUpdatesHandler, type MobileAuth } from "../_shared/mobile-updates.ts";

const sha = "a".repeat(64);
const filename = (code: number) => `gyungchung-1.0.0-android-${code}.apk`;
function release(code = 100016, options: Record<string, unknown> = {}) {
  return { draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z", body: "private commit and PR details", assets: [
    { id: code, name: filename(code), size: 4, state: "uploaded", digest: `sha256:${sha}` },
    { id: code + 1, name: "checksums.sha256", size: 120, state: "uploaded" },
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
    const id = Number(url.split("/").at(-1));
    if (extra[id] !== undefined) return new Response(extra[id]);
    for (const item of items) {
      const apk = item.assets[0];
      if (id === apk.id + 1) return new Response(`${sha}  ${apk.name}\n`);
      if (id === apk.id) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } });
    }
    return new Response(null, { status: 404 });
  };
  return { calls, fetcher };
}
const request = (query = "", authorized = false) => new Request(`https://example.test/functions/v1/mobile-updates${query}`, { headers: authorized ? { authorization: "Bearer user-jwt" } : {} });

test("public metadata sanitizes private releases and selects greatest code despite older latest", async () => {
  const upstream = fakeGithub([release(100016), release(100018, { published_at: "2026-09-01T00:00:00Z" }), release(100020, { draft: true }), release(100030, { prerelease: true })]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.versionCode, 100018);
  assert.deepEqual(Object.keys(metadata).sort(), ["schemaVersion", "platform", "applicationId", "versionName", "versionCode", "assetName", "sha256", "sizeBytes", "notes", "publishedAt"].sort());
  assert.equal(metadata.applicationId, APPLICATION_ID);
  assert.doesNotMatch(JSON.stringify(metadata), /private|server-only|github|commit/);
});

test("partial upload is skipped and absent digest uses checksum for legacy release", async () => {
  const incomplete = release(100100); incomplete.assets.pop();
  const legacy = release(); delete legacy.assets[0].digest;
  const upstream = fakeGithub([incomplete, legacy]);
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher });
  assert.equal((await (await handler(request())).json()).versionCode, 100016);
});

test("manifest must match APK contract and notes must contain only curated public plain text", async () => {
  const item = release(); item.assets.push({ id: 9, name: "update.json", size: 500, state: "uploaded", digest: undefined });
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
  for (const location of ["https://release-assets.githubusercontent.com/private.apk?sig=hidden", "https://evil.test/file", "http://release-assets.githubusercontent.com/file", "https://release-assets.githubusercontent.com.evil.test/file", "https://user:pass@release-assets.githubusercontent.com/file"]) {
    const upstream = fakeGithub([release()]); let redirected = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/100016")) return new Response(null, { status: 302, headers: { location } });
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
    if (String(input).endsWith("/100016")) {
      downloadSignal = init!.signal as AbortSignal;
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { canceled = true; } }));
    }
    return upstream.fetcher(input, init);
  };
  const handler = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: fetcher });
  const response = await handler(request("?versionCode=100016&download=1", true));
  const reader = response.body!.getReader(); assert.equal((await reader.read()).value!.byteLength, 1); await reader.cancel();
  assert.equal(canceled, true); assert.equal(downloadSignal!.aborted, true);
  const truncated: typeof fetch = async (input, init) => String(input).endsWith("/100016") ? new Response(new Uint8Array([1])) : upstream.fetcher(input, init);
  const broken = createMobileUpdatesHandler({ githubToken: "server-only", authClient: member(), fetch: truncated });
  await assert.rejects((await broken(request("?versionCode=100016&download=1", true))).arrayBuffer(), /download_interrupted/);
});

test("invalid input, upstream errors, missing configuration, oversized/corrupt metadata are safe", async () => {
  const missing = createMobileUpdatesHandler({ githubToken: "" });
  assert.equal((await missing(request())).status, 503);
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
      if (String(input).endsWith("/100016")) return new Promise((_resolve, reject) => {
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

test("download authentication precedes missing GitHub configuration and APK limit is 250MiB", async () => {
  const unconfigured = createMobileUpdatesHandler({ githubToken: "", authClient: member() });
  assert.equal((await unconfigured(request())).status, 503);
  assert.equal((await unconfigured(request("?download=1&versionCode=100016"))).status, 401);
  assert.equal((await unconfigured(request("?download=1&versionCode=100016", true))).status, 503);
  const oversized = release(); oversized.assets[0].size = 250 * 1024 * 1024 + 1;
  const upstream = fakeGithub([oversized]);
  assert.equal((await createMobileUpdatesHandler({ githubToken: "server-only", fetch: upstream.fetcher })(request())).status, 404);
});
