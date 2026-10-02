import { createClient } from "@supabase/supabase-js";
import { DEFAULT_WELCOME_CONTENT, isWelcomeContent, validateWelcomeContent, type WelcomeContent, type WelcomePageState } from "@/lib/welcome-content";

/** Anonymous server read never inherits a visitor's cookies or member session. */
export async function readWelcomePublication(): Promise<{ content: WelcomeContent; state: WelcomePageState; publishedAt: string | null }> {
  const fallback = { content: DEFAULT_WELCOME_CONTENT, state: "error" as const, publishedAt: null };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: controller.signal }) },
    });
    const { data, error } = await client.from("welcome_page_publications")
      .select("content, revision, published_at").eq("id", true).maybeSingle();
    if (error) return fallback;
    if (!data) return { content: DEFAULT_WELCOME_CONTENT, state: "unpublished", publishedAt: null };
    if (!isWelcomeContent(data.content) || validateWelcomeContent(data.content, true).length || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Number.isFinite(Date.parse(data.published_at))) return fallback;
    return { content: data.content, state: "published", publishedAt: data.published_at };
  } catch { return fallback; }
  finally { clearTimeout(timeout); }
}
