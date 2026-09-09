"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";

/**
 * The four states every section renders in order: loading → error → empty →
 * data. Sharing them keeps a half-loaded screen from reading as "no records".
 */

export function SectionSkeleton({ label = "불러오는 중" }: { label?: string }) {
  return <div className="list-loading" role="status" aria-label={label}><span /><span /><span /></div>;
}

export function AccountConnectionNotice() {
  return <div className="form-lock-notice" role="note">
    <p><strong>운영진에게 계정 등록·연결을 요청해 주세요.</strong></p>
    <p>회원 프로필에 연결되기 전에는 이 사이트에서 의견을 접수할 수 없습니다. 운영진에게 직접 이름과 전화번호를 알려 주시고, 이미 등록된 회원이라면 계정 연결 확인을 요청해 주세요.</p>
    <p>운영진에게 받은 전화번호 계정이 있다면 로그아웃한 뒤 해당 계정으로 다시 로그인해 주세요.</p>
  </div>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return <div className="empty error">
    <AlertCircle />
    <h2>정보를 불러오지 못했습니다</h2>
    <p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
    <button type="button" className="text-link" onClick={onRetry}>다시 시도</button>
  </div>;
}

export function Empty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="empty">{icon}<h2>{title}</h2><p>{description}</p></div>;
}

export function LoginGate({ icon, title, description, onLogin }: { icon: React.ReactNode; title: string; description: string; onLogin: () => void }) {
  return <div className="login-gate">
    <Empty icon={icon} title={title} description={description} />
    <button className="cta" onClick={onLogin}>로그인하고 확인하기 <ChevronRight /></button>
  </div>;
}

/** Form-level errors take focus so the member is moved to the problem, not just told about it. */
export function FormError({ id, message }: { id: string; message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [message]);
  return <p ref={ref} id={id} tabIndex={-1} className="form-error" role="alert">{message}</p>;
}
