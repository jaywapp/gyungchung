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
    if (password === "1234" || password === "gyungchung-1234") {
      return setErrorMessage("초기 비밀번호와 다른 비밀번호를 사용해 주세요.");
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("change-member-password", { body: { password } });
      if (error) {
        return setErrorMessage("비밀번호를 저장하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.");
      }
      router.replace("/");
    } catch {
      setErrorMessage("인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="password-page"><section className="password-card"><span className="eyebrow">ACCOUNT SECURITY</span><h1>새 비밀번호 설정</h1><p>초기 비밀번호와 다른 8자 이상의 비밀번호를 입력해 주세요. 저장을 마쳐야 클럽하우스를 이용할 수 있습니다.</p><form onSubmit={submit}><label>새 비밀번호<input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="8자 이상 입력" aria-invalid={errorMessage ? true : undefined} aria-describedby={errorMessage ? "update-password-error" : undefined} /></label><label>새 비밀번호 확인<input name="password_confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="비밀번호를 다시 입력" aria-invalid={errorMessage ? true : undefined} aria-describedby={errorMessage ? "update-password-error" : undefined} /></label>{errorMessage && <FormError id="update-password-error" message={errorMessage} />}<button className="cta" disabled={busy}>{busy ? "설정 중…" : "비밀번호 저장"}</button></form><Link className="text-link" href="/">홈으로 돌아가기</Link></section></main>;
}
