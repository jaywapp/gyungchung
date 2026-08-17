import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Supabase requires at least six characters; the client maps the member-facing 1234 to this value.
const INITIAL_PASSWORD = "gyungchung-1234";

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

  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(request, { error: "로그인이 만료되었습니다." }, 401);

  const { data: operator } = await adminClient
    .from("profiles")
    .select("id, role, officer_title, is_system_admin, status")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (!operator || operator.status !== "active") return json(request, { error: "회원 관리 권한이 없습니다." }, 403);

  let canManageMembers = Boolean(operator.is_system_admin);
  if (!canManageMembers && operator.role === "manager" && operator.officer_title) {
    const { data: permission } = await adminClient
      .from("officer_permissions")
      .select("permission")
      .eq("officer_title", operator.officer_title)
      .eq("permission", "members.manage")
      .maybeSingle();
    canManageMembers = Boolean(permission);
  }
  if (!canManageMembers) return json(request, { error: "회원 관리 권한이 없습니다." }, 403);

  let memberId = "";
  try {
    const body = await request.json() as { member_id?: unknown };
    memberId = typeof body.member_id === "string" ? body.member_id : "";
  } catch {
    return json(request, { error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) {
    return json(request, { error: "회원 정보가 올바르지 않습니다." }, 400);
  }

  const { data: member, error: memberError } = await adminClient
    .from("profiles")
    .select("id, name, phone, auth_user_id, status")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError || !member) return json(request, { error: "회원을 찾을 수 없습니다." }, 404);
  if (!member.phone) return json(request, { error: "전화번호를 먼저 등록해 주세요." }, 400);

  if (member.auth_user_id) {
    const { error } = await adminClient.auth.admin.updateUserById(member.auth_user_id, { password: INITIAL_PASSWORD });
    if (error) return json(request, { error: "비밀번호를 변경하지 못했습니다." }, 500);
    return json(request, { member_id: member.id, auth_user_id: member.auth_user_id, password_updated: true });
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    phone: member.phone,
    phone_confirm: true,
    password: INITIAL_PASSWORD,
    user_metadata: { member_id: member.id, full_name: member.name },
  });
  if (error || !data.user) {
    const duplicate = error?.message.toLowerCase().includes("already") || error?.status === 422;
    return json(request, { error: duplicate ? "이미 다른 계정에서 사용하는 전화번호입니다." : "계정을 준비하지 못했습니다." }, duplicate ? 409 : 500);
  }

  return json(request, { member_id: member.id, auth_user_id: data.user.id });
});
