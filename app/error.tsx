"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return <main className="password-page">
    <section className="password-card">
      <h1>화면을<br />불러오지 못했습니다.</h1>
      <p>일시적인 문제일 수 있습니다. 다시 시도하거나 홈으로 돌아가 주세요.</p>
      <button className="cta" type="button" onClick={reset}>다시 시도</button>
      <Link className="text-link" href="/">홈으로 돌아가기</Link>
    </section>
  </main>;
}
