import { createMobileUpdatesHandler } from "@/supabase/functions/_shared/mobile-updates";

export const dynamic = "force-dynamic";
/** Reuse the mobile release validator; the web never proxies APK binaries. */
const metadata = createMobileUpdatesHandler({ fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) });
export async function GET(request: Request) {
  if (new URL(request.url).search) return Response.json({ error: "invalid_request" }, { status: 400 });
  return metadata(new Request(request.url, { signal: request.signal }));
}
