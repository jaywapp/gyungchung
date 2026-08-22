import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INITIAL_PASSWORDS = new Set(["1234", "gyungchung-1234"]);

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "*";
  if (origin === "*" || origin === "https://gyungchung.vercel.app") return origin;
  if (/^http:\/\/localhost(?::[0-9]+)?$/.test(origin)) return origin;
  if (/^https:\/\/gyungchung-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return null;
}

function headers(request: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request) ?? "https://gyungchung.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

Deno.serve(async (request: Request) => {
  if (!allowedOrigin(request)) return json(request, { error: "허용되지 않은 요청입니다." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
    return json(request, { error: "서버 설정이 완료되지 않았습니다." }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, { error: "로그인이 필요합니다." }, 401);

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return json(request, { error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  if (password.length < 8) return json(request, { error: "비밀번호를 8자 이상 입력해 주세요." }, 400);
  if (INITIAL_PASSWORDS.has(password)) return json(request, { error: "초기 비밀번호와 다른 비밀번호를 사용해 주세요." }, 400);

  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(request, { error: "로그인이 만료되었습니다." }, 401);

  const { data: profile, error: profileLookupError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (profileLookupError || !profile) return json(request, { error: "연결된 회원 계정을 찾을 수 없습니다." }, 404);

  // The caller was verified above with their bearer token. updateUser() cannot
  // be used by this stateless server client because it requires a persisted
  // Auth session, so update only that verified user through the admin API.
  const { error: passwordError } = await adminClient.auth.admin.updateUserById(userData.user.id, { password });
  if (passwordError) {
    if (passwordError.code === "weak_password") return json(request, { error: "더 안전한 비밀번호를 사용해 주세요." }, 400);
    return json(request, { error: "비밀번호를 변경하지 못했습니다." }, 400);
  }

  const { data: updatedProfile, error: profileError } = await adminClient
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profile.id)
    .select("id")
    .maybeSingle();
  if (profileError || !updatedProfile) return json(request, { error: "비밀번호 변경 상태를 저장하지 못했습니다. 다시 시도해 주세요." }, 500);

  return json(request, { password_updated: true });
});
