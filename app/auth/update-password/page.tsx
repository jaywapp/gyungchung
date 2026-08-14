"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormError } from "@/components/section-states";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("password_confirm") ?? "")) {
      return setErrorMessage("비밀번호 확인이 일치하지 않습니다.");
    }
    if (!supabase) return setErrorMessage("인증 연결을 준비 중입니다.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (error.code === "weak_password") return setErrorMessage("더 안전한 비밀번호를 사용해 주세요.");
        return setErrorMessage("복구 링크가 만료되었거나 유효하지 않습니다. 로그인 화면에서 다시 요청해 주세요.");
      }
      router.replace("/");
    } catch {
      setErrorMessage("인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="password-page"><section className="password-card"><span className="eyebrow">ACCOUNT RECOVERY</span><h1>새 비밀번호 설정</h1><p>경충FC 로그인에 사용할 새 비밀번호를 입력해 주세요. 설정 후 바로 회원 계정으로 연결됩니다.</p><form onSubmit={submit}><label>새 비밀번호<input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="8자 이상 입력" aria-invalid={errorMessage ? true : undefined} aria-describedby={errorMessage ? "update-password-error" : undefined} /></label><label>새 비밀번호 확인<input name="password_confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="비밀번호를 다시 입력" aria-invalid={errorMessage ? true : undefined} aria-describedby={errorMessage ? "update-password-error" : undefined} /></label>{errorMessage && <FormError id="update-password-error" message={errorMessage} />}<button className="cta" disabled={busy}>{busy ? "설정 중…" : "비밀번호 저장"}</button></form><Link className="text-link" href="/">홈으로 돌아가기</Link></section></main>;
}
