"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createPhoneLoginCredentials, getPhoneLoginError } from "@/lib/phone-login";

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

function OAuthConsentContent() {
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id") ?? "";
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const loadDetails = useCallback(async () => {
    if (!authorizationId || !supabase) {
      setState({ status: "error", message: "유효한 OAuth 승인 요청을 확인할 수 없습니다." });
      return;
    }
    try {
      const userResult = await supabase.auth.getUser();
      if (!userResult.data.user) {
        setState({ status: "login" });
        return;
      }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("must_change_password").eq("auth_user_id", userResult.data.user.id).maybeSingle();
      if (profileError || !profile) {
        setState({ status: "error", message: "회원 계정 정보를 확인하지 못했습니다. 운영진에게 계정 연결을 확인해 주세요." });
        return;
      }
      if (profile.must_change_password) {
        window.location.assign("/auth/update-password");
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
    } catch {
      setState({ status: "error", message: "인증 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요." });
    }
  }, [authorizationId, supabase]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);

  const signInWithPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setLoginError(null);
    if (!supabase) return setLoginError("인증 연결을 준비 중입니다.");
    const credentials = createPhoneLoginCredentials(identifier, password);
    if (!credentials) return setLoginError("올바른 휴대전화번호를 입력해 주세요.");
    setBusy(true);
    try {
      const result = await supabase.auth.signInWithPassword(credentials);
      if (result.error) return setLoginError(getPhoneLoginError(result.error));
      await loadDetails();
    } catch {
      setLoginError("인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approve" | "deny") => {
    if (!supabase || !authorizationId) return;
    setBusy(true);
    try {
      const result = decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (result.error || !result.data?.redirect_url) {
        setState({ status: "error", message: "승인 결과를 처리하지 못했습니다. 요청을 다시 시작해 주세요." });
        return;
      }
      window.location.assign(result.data.redirect_url);
    } catch {
      setState({ status: "error", message: "승인 결과를 처리하지 못했습니다. 요청을 다시 시작해 주세요." });
    } finally {
      setBusy(false);
    }
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
            <label>전화번호<input type="tel" inputMode="tel" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder="010-1234-5678" aria-describedby={loginError ? "oauth-login-error" : undefined} required /></label>
            <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            {loginError && <p id="oauth-login-error" role="alert">{loginError}</p>}
            <button className="cta" type="submit" disabled={busy}>{busy ? "로그인 중…" : "전화번호로 로그인"}</button>
          </form>
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
