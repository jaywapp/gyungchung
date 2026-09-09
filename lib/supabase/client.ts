import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  // Keep the SDK's persistent cookie store and automatic refresh. Do not copy
  // credentials into sessionStorage or clear cookies during page navigation.
  return createBrowserClient(url, key, {
    cookieOptions: { path: "/", sameSite: "lax", maxAge: 400 * 24 * 60 * 60 },
  });
}
