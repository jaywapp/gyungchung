import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { createMobileUpdatesHandler, type MobileAuth } from "../_shared/mobile-updates.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const secret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const client = url && secret ? createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : undefined;

Deno.serve(createMobileUpdatesHandler({
  githubToken: Deno.env.get("GITHUB_MOBILE_RELEASES_TOKEN"),
  authClient: client as MobileAuth | undefined,
}));
