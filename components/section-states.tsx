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
