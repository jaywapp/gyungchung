import Link from "next/link";

export default function NotFound() {
  return <main className="password-page"><section className="password-card"><span className="eyebrow">404 · GYUNGCHUNG FC</span><h1>페이지를<br />찾을 수 없습니다.</h1><p>요청한 주소를 확인하거나 경충FC 홈으로 돌아가 주세요.</p><Link className="cta" href="/">홈으로 돌아가기</Link></section></main>;
}
