import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildOAuthReturnPath, getSafeOAuthReturnUrl } from "@/lib/oauth-return";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeOAuthReturnUrl(url.searchParams.get("next"), url.origin);
  if (!code || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.redirect(new URL(buildOAuthReturnPath(next.pathname, next.search, next.hash, "error"), url.origin));
  }
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(buildOAuthReturnPath(next.pathname, next.search, next.hash, "error"), url.origin));

  return NextResponse.redirect(next);
}
