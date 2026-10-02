import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Only the public VAPID point is returned; subscriptions and private keys stay server-side. */
export async function GET() {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("configuration_unavailable");
    const database = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) }) },
    });
    const { data: publicKey, error } = await database.rpc("get_web_push_public_key");
    const decoded = typeof publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(publicKey) ? Buffer.from(publicKey, "base64url") : null;
    if (error || !decoded || decoded.length !== 65 || decoded[0] !== 4) throw new Error("configuration_unavailable");
    return Response.json({ publicKey }, { headers });
  } catch {
    return Response.json({ error: "web_push_unavailable" }, { status: 503, headers });
  }
}
