import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { createPushWorkerHandler, type WorkerDatabase } from "../_shared/push-worker.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const database = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : undefined;
Deno.serve(createPushWorkerHandler({
  database: database as WorkerDatabase | undefined,
  enabled: Deno.env.get("PUSH_DELIVERY_ENABLED") === "true",
  workerSecret: Deno.env.get("PUSH_WORKER_SECRET"),
  expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN"),
}));
