"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface AuthorizationDetails {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { name?: string };
}

type ViewState =
  | { status: "loading" }
  | { status: "login" }
  | { status: "ready"; details: AuthorizationDetails }
  | { status: "error"; message: string };

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return `+82${digits.slice(1)}`;
  return value.trim();
}

function OAuthConsentContent() {
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id") ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const supabase = useMemo(() => createClient(), []);

  const loadDetails = useCallback(async () => {
    if (!authorizationId || !supabase) {
      setState({ status: "error", message: "유효한 OAuth 승인 요청을 확인할 수 없습니다." });
      return;
    }
    const userResult = await supabase.auth.getUser();
    if (!userResult.data.user) {
      setState({ status: "login" });
      return;
    }
    const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (result.error || !result.data) {
      setState({ status: "error", message: "OAuth 승인 요청이 만료되었거나 올바르지 않습니다." });
      return;
    }
    const details = result.data as AuthorizationDetails;
    if (!details.authorization_id && details.redirect_url) {
      window.location.assign(details.redirect_url);
      return;
    }
    setState({ status: "ready", details });
  }, [authorizationId, supabase]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const startSocialLogin = async (provider: "google" | "kakao") => {
    if (!supabase) return;
    setBusy(true);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    const result = await supabase.auth.signInWithOAuth({
      provider: provider === "kakao" ? "custom:kakao" : provider,
      options: { redirectTo: callbackUrl.toString() },
    });
    if (result.error) {
      setState({ status: "error", message: "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      setBusy(false);
    }
  };

  const signInWithPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const result = identifier.includes("@")
      ? await supabase.auth.signInWithPassword({ email: identifier.trim().toLowerCase(), password })
      : await supabase.auth.signInWithPassword({ phone: normalizePhone(identifier), password: password === "1234" ? "gyungchung-1234" : password });
    if (result.error) {
      setState({ status: "error", message: "로그인 정보를 확인하거나 운영진에게 문의해 주세요." });
      setBusy(false);
      return;
    }
    setBusy(false);
    await loadDetails();
  };

  const decide = async (decision: "approve" | "deny") => {
    if (!supabase || !authorizationId) return;
    setBusy(true);
    const result = decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (result.error || !result.data?.redirect_url) {
      setState({ status: "error", message: "승인 결과를 처리하지 못했습니다. 요청을 다시 시작해 주세요." });
      setBusy(false);
      return;
    }
    window.location.assign(result.data.redirect_url);
  };

  return (
    <main className="oauth-consent-page">
      <section className="oauth-consent-card" aria-live="polite">
        <div className="crest" aria-hidden="true">경</div>
        <p className="eyebrow">GYUNGCHUNG FC · SECURE CONNECTION</p>
        <h1>관리자 도구 연결</h1>

        {state.status === "loading" && <p>승인 요청을 확인하고 있습니다.</p>}

        {state.status === "login" && <>
          <p>경충FC 운영 계정으로 로그인한 뒤 관리자 조회 권한을 승인할 수 있습니다.</p>
          <form className="oauth-login-form" onSubmit={signInWithPassword}>
            <label>이메일 또는 휴대전화<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required /></label>
            <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            <button className="cta" type="submit" disabled={busy}>계정으로 로그인</button>
          </form>
          <div className="auth-divider">또는</div>
          <button className="social google" type="button" disabled={busy} onClick={() => void startSocialLogin("google")}>Google로 로그인</button>
          <button className="social kakao" type="button" disabled={busy} onClick={() => void startSocialLogin("kakao")}>카카오로 로그인</button>
        </>}

        {state.status === "ready" && <>
          <p><b>{state.details.client?.name ?? "AI 관리자 도구"}</b>에서 경충FC 관리자 조회 도구를 사용하려고 합니다.</p>
          <div className="oauth-request-details">
            <span>요청 권한</span>
            <ul>{(state.details.scope ?? "openid email profile").split(" ").filter(Boolean).map((scope) => <li key={scope}>{scope}</li>)}</ul>
            <small>승인 후에도 현재 경충FC 직책과 운영 권한 안에서만 조회됩니다. 변경·삭제 도구는 제공하지 않습니다.</small>
          </div>
          <div className="oauth-consent-actions">
            <button className="cta" type="button" disabled={busy} onClick={() => void decide("approve")}>연결 승인</button>
            <button className="secondary" type="button" disabled={busy} onClick={() => void decide("deny")}>거부</button>
          </div>
        </>}

        {state.status === "error" && <>
          <p role="alert">{state.message}</p>
          <button className="secondary" type="button" onClick={() => void loadDetails()}>다시 확인</button>
        </>}
      </section>
    </main>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<main className="oauth-consent-page"><section className="oauth-consent-card"><p>승인 요청을 확인하고 있습니다.</p></section></main>}>
      <OAuthConsentContent />
    </Suspense>
  );
}
