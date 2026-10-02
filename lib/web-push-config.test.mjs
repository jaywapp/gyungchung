import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/api/web-push/config/route.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const point = Buffer.alloc(65, 1); point[0] = 4;
const publicKey = point.toString("base64url");
function route(result, environment = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key" }) {
  const calls = [];
  const compiled = { exports: {} };
  const sdk = { createClient(url, key, options) {
    calls.push({ url, key, options });
    return { async rpc(name) { calls.push(name); if (result instanceof Error) throw result; return result; } };
  } };
  new Function("require", "exports", "module", "process", "fetch", "Buffer", output)(() => sdk, compiled.exports, compiled, { env: environment }, fetch, Buffer);
  return { ...compiled.exports, calls };
}

test("web configuration uses the public RPC and returns only its public point without caching", async () => {
  const handler = route({ data: publicKey, error: null });
  const response = await handler.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { publicKey });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(handler.calls[1], "get_web_push_public_key");
  assert.equal(handler.calls[0].key, "fixture-public-key");
  assert.equal(handler.calls[0].options.auth.persistSession, false);
});

test("missing deployment, malformed points and private RPC errors produce a redacted unavailable response", async () => {
  const invalidPoint = Buffer.alloc(65, 1).toString("base64url");
  for (const result of [
    { data: null, error: null }, { data: "B".repeat(86), error: null },
    { data: invalidPoint, error: null }, { data: { private_key: "secret-fixture" }, error: null },
    { data: publicKey, error: { message: "secret-fixture" } }, new Error("secret-fixture"),
  ]) {
    const response = await route(result).GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "web_push_unavailable" });
  }
  const handler = route(null, {});
  assert.equal((await handler.GET()).status, 503);
  assert.equal(handler.calls.length, 0);
});
