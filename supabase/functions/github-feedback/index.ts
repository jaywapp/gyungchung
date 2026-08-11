import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_ISSUES_TOKEN") ?? "";
const GITHUB_REPOSITORY = "jaywapp/gyungchung";
const GITHUB_LABEL = "제보";
const MAX_PUBLISHED_REPORTS_PER_HOUR = 5;

const categoryLabels: Record<string, string> = {
  operation: "팀 운영",
  system: "시스템",
  facility: "구장·시설",
  finance: "회비·재정",
  safety: "안전",
  other: "기타",
};

function allowedOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "*";
  if (origin === "*" || origin === "https://gyungchung.vercel.app") return origin;
  if (/^http:\/\/localhost(?::[0-9]+)?$/.test(origin)) return origin;
  if (/^https:\/\/gyungchung-[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
  return null;
}

function corsHeaders(request: Request) {
  const origin = allowedOrigin(request) ?? "https://gyungchung.vercel.app";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function github(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "gyungchung-feedback",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style)\b[^>]*>/gi, "")
    .trim();
}

Deno.serve(async (request: Request) => {
  if (!allowedOrigin(request)) return json(request, { error: "허용되지 않은 요청입니다." }, 403);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY || !GITHUB_TOKEN) {
    return json(request, { error: "제보 연동이 아직 설정되지 않았습니다." }, 503);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) return json(request, { error: "로그인이 필요합니다." }, 401);

  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json(request, { error: "로그인이 필요합니다." }, 401);

    const payload = await request.json();
    const feedbackId = typeof payload?.feedbackId === "string" ? payload.feedbackId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(feedbackId)) {
      return json(request, { error: "올바른 제보를 선택해 주세요." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: feedback, error: feedbackError } = await admin
      .from("feedback")
      .select("id,author_id,category,title,body,publish_to_github,github_issue_number,github_issue_url,created_at")
      .eq("id", feedbackId)
      .eq("author_id", user.id)
      .single();
    if (feedbackError || !feedback) return json(request, { error: "제보를 찾을 수 없습니다." }, 404);
    if (!feedback.publish_to_github) return json(request, { error: "GitHub 공개 등록에 동의하지 않은 제보입니다." }, 403);
    if (feedback.github_issue_number && feedback.github_issue_url) {
      return json(request, { issueNumber: feedback.github_issue_number, issueUrl: feedback.github_issue_url });
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("author_id", user.id)
      .eq("publish_to_github", true)
      .gte("created_at", oneHourAgo);
    if (countError) throw countError;
    if ((count ?? 0) > MAX_PUBLISHED_REPORTS_PER_HOUR) {
      return json(request, { error: "GitHub 제보는 한 시간에 5건까지 등록할 수 있습니다." }, 429);
    }

    const labelResponse = await github(`/repos/${GITHUB_REPOSITORY}/labels/${encodeURIComponent(GITHUB_LABEL)}`);
    if (labelResponse.status === 404) {
      const createLabelResponse = await github(`/repos/${GITHUB_REPOSITORY}/labels`, {
        method: "POST",
        body: JSON.stringify({ name: GITHUB_LABEL, color: "1F883D", description: "경충FC 앱에서 공개 등록된 사용자 제보" }),
      });
      if (!createLabelResponse.ok && createLabelResponse.status !== 422) throw new Error(`GitHub label error: ${createLabelResponse.status}`);
    } else if (!labelResponse.ok) {
      throw new Error(`GitHub label error: ${labelResponse.status}`);
    }

    const category = categoryLabels[feedback.category] ?? "기타";
    const title = normalizeText(String(feedback.title)).replace(/\s+/g, " ").slice(0, 120);
    const body = normalizeText(String(feedback.body)).slice(0, 5000);
    const issueResponse = await github(`/repos/${GITHUB_REPOSITORY}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `[제보][${category}] ${title}`,
        body: [
          `## ${category} 제보`,
          "",
          body,
          "",
          "---",
          "",
          `<!-- gyungchung-feedback:${feedback.id} -->`,
          "> 경충FC 클럽하우스에서 작성자가 공개 등록에 동의해 생성된 이슈입니다. 작성자 정보는 포함하지 않습니다.",
        ].join("\n"),
        labels: [GITHUB_LABEL],
      }),
    });
    if (!issueResponse.ok) throw new Error(`GitHub issue error: ${issueResponse.status}`);

    const issue = await issueResponse.json() as { number?: unknown; html_url?: unknown };
    if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
      throw new Error("GitHub issue response was invalid");
    }
    const { error: updateError } = await admin
      .from("feedback")
      .update({ github_issue_number: issue.number, github_issue_url: issue.html_url })
      .eq("id", feedback.id)
      .eq("author_id", user.id)
      .is("github_issue_url", null);
    if (updateError) throw updateError;

    return json(request, { issueNumber: issue.number, issueUrl: issue.html_url }, 201);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return json(request, { error: "GitHub 이슈를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
