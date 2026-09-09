import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBrowserClient } from "@supabase/ssr";
import ts from "typescript";

const factorySource = ts.transpileModule(readFileSync(new URL("./supabase/client.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", phone: "821012345678", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const phone = "+821012345678";
const password = "synthetic-test-password";

function session(version) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expires, aud: "authenticated", version })}.synthetic-signature`,
    refresh_token: `synthetic-refresh-${version}`, token_type: "bearer", expires_in: 3600, expires_at: expires, user,
  };
}

function harness(t) {
  const jar = new Map();
  const writes = [];
  const calls = [];
  const clients = [];
  let version = 0;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ pathname: url.pathname, search: url.search, method: init.method });
    assert.equal(url.origin, "https://auth-session-test.supabase.co");
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      assert.equal(body.phone, phone);
      if (body.password !== password) return Response.json({ code: "invalid_credentials", msg: "Invalid credentials" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } });
      return Response.json(session(++version));
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      assert.equal(body.refresh_token, `synthetic-refresh-${version}`);
      return Response.json(session(++version));
    }
    if (url.pathname === "/auth/v1/logout") {
      assert.equal(url.searchParams.get("scope"), "local");
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  };
  const makeClient = () => {
    const exports = {};
    const require = (name) => {
      assert.equal(name, "@supabase/ssr");
      return { createBrowserClient: (url, key, options) => {
        assert.equal(options.cookieOptions.maxAge, 400 * 24 * 60 * 60);
        assert.equal(options.cookieOptions.path, "/");
        assert.equal(options.cookieOptions.sameSite, "lax");
        return createBrowserClient(url, key, {
          ...options, isSingleton: false, global: { fetch },
          cookies: {
            getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
            setAll: (cookies) => cookies.forEach((cookie) => {
              writes.push(cookie);
              if (cookie.options.maxAge === 0) jar.delete(cookie.name);
              else jar.set(cookie.name, cookie.value);
            }),
          },
        });
      } };
    };
    // Inject isolated public configuration instead of reading the machine's environment.
    new Function("require", "exports", "process", factorySource)(require, exports, {
      env: { NEXT_PUBLIC_SUPABASE_URL: "https://auth-session-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key" },
    });
    const client = exports.createClient();
    clients.push(client);
    return client;
  };
  t.after(async () => {
    for (const client of clients) {
      await client.auth.stopAutoRefresh();
      client.auth.broadcastChannel?.close();
    }
  });
  return { makeClient, jar, writes, calls };
}

test("phone login persists cookies and a new client restores the session without another login", async (t) => {
  const { makeClient, jar, writes, calls } = harness(t);
  const first = makeClient();
  const result = await first.auth.signInWithPassword({ phone, password });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, user.id);
  assert.ok(jar.size > 0);
  assert.ok(writes.some((cookie) => cookie.value && cookie.options.maxAge === 400 * 24 * 60 * 60));
  const second = makeClient();
  const recovered = await second.auth.getSession();
  assert.equal(recovered.error, null);
  assert.equal(recovered.data.session.refresh_token, result.data.session.refresh_token);
  assert.equal(calls.length, 1);
});

test("refresh rotates persisted credentials and local sign-out prevents restoration", async (t) => {
  const { makeClient, jar, calls } = harness(t);
  const first = makeClient();
  await first.auth.signInWithPassword({ phone, password });
  const second = makeClient();
  await second.auth.getSession();
  const refreshed = await second.auth.refreshSession();
  assert.equal(refreshed.error, null);
  assert.equal(refreshed.data.session.refresh_token, "synthetic-refresh-2");
  const third = makeClient();
  assert.equal((await third.auth.getSession()).data.session.refresh_token, "synthetic-refresh-2");
  assert.equal((await third.auth.signOut({ scope: "local" })).error, null);
  assert.equal(jar.size, 0);
  assert.equal((await makeClient().auth.getSession()).data.session, null);
  assert.ok(calls.some((call) => call.pathname.endsWith("/logout") && call.search === "?scope=local"));
});

test("incorrect phone credentials never create a recoverable session", async (t) => {
  const { makeClient, jar } = harness(t);
  const result = await makeClient().auth.signInWithPassword({ phone, password: "incorrect-password" });
  assert.equal(result.error.code, "invalid_credentials");
  assert.equal(jar.size, 0);
  assert.equal((await makeClient().auth.getSession()).data.session, null);
});
