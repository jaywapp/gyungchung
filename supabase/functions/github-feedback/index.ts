import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import {
  buildGithubIssue,
  GITHUB_FEEDBACK_LABEL,
  GITHUB_FEEDBACK_REPOSITORY,
  githubFeedbackMarker,
  hasGithubPublicationConsent,
} from "../_shared/feedback-publication.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_ISSUES_TOKEN") ?? "";
const MAX_PUBLISHED_REPORTS_PER_HOUR = 5;
const PUBLICATION_FAILURE_MESSAGE = "GitHub 공개 등록에 실패했습니다. 원본 제보는 접수되었으며 다시 시도할 수 있습니다.";

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

type AdminClient = ReturnType<typeof createClient>;

type GithubIssue = {
  number: number;
  html_url: string;
  body?: string | null;
};

async function findExistingGithubIssue(feedbackId: string) {
  const response = await github(
    `/repos/${GITHUB_FEEDBACK_REPOSITORY}/issues?state=all&labels=${encodeURIComponent(GITHUB_FEEDBACK_LABEL)}&per_page=100`,
  );
  if (!response.ok) throw new Error(`GitHub issue lookup error: ${response.status}`);

  const marker = githubFeedbackMarker(feedbackId);
  const issues = await response.json() as GithubIssue[];
  return issues.find((issue) => typeof issue.body === "string" && issue.body.includes(marker)) ?? null;
}

async function storePublishedIssue(admin: AdminClient, feedbackId: string, authorId: string, issue: GithubIssue, attemptedAt: string) {
  const { error } = await admin
    .from("feedback")
    .update({
      github_issue_number: issue.number,
      github_issue_url: issue.html_url,
      github_issue_state: "open",
      github_issue_closed_at: null,
      github_publication_status: "published",
      github_publication_error: null,
      github_publication_attempted_at: attemptedAt,
    })
    .eq("id", feedbackId)
    .eq("author_id", authorId)
    .is("github_issue_url", null);
  if (error) throw error;
}

async function markPublicationFailed(admin: AdminClient, feedbackId: string, authorId: string, attemptedAt: string, message = PUBLICATION_FAILURE_MESSAGE) {
  const { error } = await admin
    .from("feedback")
    .update({
      github_publication_status: "failed",
      github_publication_error: message,
      github_publication_attempted_at: attemptedAt,
    })
    .eq("id", feedbackId)
    .eq("author_id", authorId)
    .is("github_issue_url", null);
  if (error) console.error(`GitHub publication status error: ${error.message}`);
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

    const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: member, error: memberError } = await admin
      .from("profiles")
      .select("id,name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (memberError || !member) return json(request, { error: "연결된 회원을 찾을 수 없습니다." }, 403);
    const payload = await request.json();
    if (payload?.action === "sync") {
      const { data: linkedFeedback, error: linkedFeedbackError } = await userClient
        .from("feedback")
        .select("id,github_issue_number,github_issue_state,github_issue_closed_at")
        .not("github_issue_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (linkedFeedbackError) throw linkedFeedbackError;

      let changed = 0;
      await Promise.all((linkedFeedback ?? []).map(async (item) => {
        const issueResponse = await github(`/repos/${GITHUB_FEEDBACK_REPOSITORY}/issues/${item.github_issue_number}`);
        if (!issueResponse.ok) return;
        const issue = await issueResponse.json() as { state?: unknown; closed_at?: unknown };
        if (issue.state !== "open" && issue.state !== "closed") return;
        const closedAt = issue.state === "closed" && typeof issue.closed_at === "string" ? issue.closed_at : null;
        if (item.github_issue_state === issue.state && item.github_issue_closed_at === closedAt) return;
        const { error: updateError } = await admin
          .from("feedback")
          .update({ github_issue_state: issue.state, github_issue_closed_at: closedAt })
          .eq("id", item.id)
          .eq("github_issue_number", item.github_issue_number);
        if (updateError) throw updateError;
        changed += 1;
      }));

      return json(request, { synced: linkedFeedback?.length ?? 0, changed });
    }

    const feedbackId = typeof payload?.feedbackId === "string" ? payload.feedbackId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(feedbackId)) {
      return json(request, { error: "올바른 제보를 선택해 주세요." }, 400);
    }

    const { data: feedback, error: feedbackError } = await admin
      .from("feedback")
      .select("id,author_id,category,title,body,is_anonymous,publish_to_github,github_publication_consented_at,github_issue_number,github_issue_url,created_at")
      .eq("id", feedbackId)
      .eq("author_id", member.id)
      .single();
    if (feedbackError || !feedback) return json(request, { error: "제보를 찾을 수 없습니다." }, 404);
    if (feedback.github_issue_number && feedback.github_issue_url) {
      return json(request, { issueNumber: feedback.github_issue_number, issueUrl: feedback.github_issue_url });
    }
    if (!hasGithubPublicationConsent({
      category: feedback.category,
      publishToGithub: feedback.publish_to_github,
      consentedAt: feedback.github_publication_consented_at,
    })) {
      return json(request, { error: "명시적으로 공개에 동의한 시스템 제보만 GitHub에 등록할 수 있습니다." }, 403);
    }

    const attemptedAt = new Date().toISOString();
    const { error: pendingError } = await admin
      .from("feedback")
      .update({
        github_publication_status: "pending",
        github_publication_error: null,
        github_publication_attempted_at: attemptedAt,
      })
      .eq("id", feedback.id)
      .eq("author_id", member.id)
      .is("github_issue_url", null);
    if (pendingError) throw pendingError;

    try {
      const existingIssue = await findExistingGithubIssue(feedback.id);
      if (existingIssue) {
        await storePublishedIssue(admin, feedback.id, member.id, existingIssue, attemptedAt);
        return json(request, { issueNumber: existingIssue.number, issueUrl: existingIssue.html_url });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: countError } = await admin
        .from("feedback")
        .select("id", { count: "exact", head: true })
        .eq("author_id", member.id)
        .eq("publish_to_github", true)
        .gte("created_at", oneHourAgo);
      if (countError) throw countError;
      if ((count ?? 0) > MAX_PUBLISHED_REPORTS_PER_HOUR) {
        const message = "GitHub 공개 제보는 한 시간에 5건까지 등록할 수 있습니다. 원본 제보에서 나중에 다시 시도해 주세요.";
        await markPublicationFailed(admin, feedback.id, member.id, attemptedAt, message);
        return json(request, { error: message }, 429);
      }

      const labelResponse = await github(`/repos/${GITHUB_FEEDBACK_REPOSITORY}/labels/${encodeURIComponent(GITHUB_FEEDBACK_LABEL)}`);
      if (labelResponse.status === 404) {
        const createLabelResponse = await github(`/repos/${GITHUB_FEEDBACK_REPOSITORY}/labels`, {
          method: "POST",
          body: JSON.stringify({ name: GITHUB_FEEDBACK_LABEL, color: "1F883D", description: "경충FC 앱에서 공개 등록된 사용자 제보" }),
        });
        if (!createLabelResponse.ok && createLabelResponse.status !== 422) throw new Error(`GitHub label error: ${createLabelResponse.status}`);
      } else if (!labelResponse.ok) {
        throw new Error(`GitHub label error: ${labelResponse.status}`);
      }

      const issueDraft = buildGithubIssue({
        feedbackId: feedback.id,
        category: feedback.category,
        title: String(feedback.title),
        body: String(feedback.body),
        isAnonymous: feedback.is_anonymous,
        authorName: member.name,
      });
      const issueResponse = await github(`/repos/${GITHUB_FEEDBACK_REPOSITORY}/issues`, {
        method: "POST",
        body: JSON.stringify(issueDraft),
      });
      if (!issueResponse.ok) throw new Error(`GitHub issue error: ${issueResponse.status}`);

      const issue = await issueResponse.json() as Partial<GithubIssue>;
      if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
        throw new Error("GitHub issue response was invalid");
      }
      await storePublishedIssue(admin, feedback.id, member.id, issue as GithubIssue, attemptedAt);

      return json(request, { issueNumber: issue.number, issueUrl: issue.html_url }, 201);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await markPublicationFailed(admin, feedback.id, member.id, attemptedAt);
      return json(request, { error: PUBLICATION_FAILURE_MESSAGE }, 502);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return json(request, { error: "GitHub 이슈를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
