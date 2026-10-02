import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import webPush from "npm:web-push@3.6.7";
import { createWebPushWorkerHandler, createWebPushSender, type RequestDetails } from "../_shared/web-push-worker.ts";
import type { WorkerDatabase } from "../_shared/push-worker.ts";
import { loadWebPushConfig } from "../_shared/web-push-config.ts";

function databaseSecret() {
  const explicit = Deno.env.get("SUPABASE_SECRET_KEY");
  if (explicit) return explicit;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string") return keys.default;
  } catch { /* Legacy hosted projects expose a single service role key. */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = databaseSecret();
const database = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : undefined;
Deno.serve(createWebPushWorkerHandler({
  database: database as WorkerDatabase | undefined,
  enabled: Deno.env.get("PUSH_DELIVERY_ENABLED") === "true",
  workerSecret: Deno.env.get("PUSH_WORKER_SECRET"),
  async loadSender() {
    if (!database) throw new Error("configuration_unavailable");
    const config = await loadWebPushConfig(database as WorkerDatabase, () => webPush.generateVAPIDKeys());
    return createWebPushSender(config, (subscription, payload, options) =>
      webPush.generateRequestDetails(subscription, payload, options) as RequestDetails);
  },
}));
