import Image from "next/image";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import ThemeSwitch from "@/components/theme-switch";
import WelcomeDownloads, { WelcomeAppButtons, WelcomeDownloadsProvider } from "@/components/welcome-downloads";
import type { WelcomeContent, WelcomePageState } from "@/lib/welcome-content";
import "./welcome-page.css";

interface WelcomePageProps {
  content: WelcomeContent;
  state?: WelcomePageState;
  preview?: boolean;
  publishedAt?: string | null;
}

function PublicationError({ label }: { label: string }) {
  return <div className="welcome-blank welcome-fail" role="alert"><b>{label}을 불러오지 못했습니다</b><p>잠시 후 다시 시도해 주세요. 앱 설치 안내는 그대로 볼 수 있습니다.</p><a className="cta small" href="/welcome"><RefreshCw size={16} aria-hidden="true" />다시 시도</a></div>;
}

function Court() {
  return <div className="welcome-court" aria-hidden="true">
    <svg className="welcome-court-lines" viewBox="0 0 600 372">
      <path pathLength="1" d="M8 8H592V364H8Z" />
      <path pathLength="1" d="M300 8V364" />
      <circle pathLength="1" cx="300" cy="186" r="62" />
      <path pathLength="1" d="M8 96A90 90 0 0 1 8 276" />
      <path pathLength="1" d="M592 96A90 90 0 0 0 592 276" />
    </svg>
    <div className="welcome-wordmark">
      <svg viewBox="0 0 436 96" role="img" aria-label="GCFC"><path fill="#ffffff" d="M51.6 83.2Q32.4 83.2 22.75 76.4Q13.1 69.6 13.1 55.8Q13.1 46.9 15.6 39.65Q18.1 32.4 22.7 27.1Q27.2 22 33.5 18.65Q39.8 15.3 47.8 13.65Q55.8 12 65.1 12Q73.7 12 81.05 13.4Q88.4 14.8 94 17.6Q99.6 20.4 102.7 24.55Q105.8 28.7 105.8 34.3Q105.8 35.2 105.7 36.15Q105.6 37.1 105.4 38.1H81.4Q81.4 37.9 81.45 37.6Q81.5 37.3 81.5 37.1Q81.5 35.2 80.25 33.7Q79 32.2 76.75 31.2Q74.5 30.2 71.55 29.65Q68.6 29.1 65.2 29.1Q59.5 29.1 55.1 30.3Q50.7 31.5 47.5 33.7Q44.3 35.9 42.35 39.1Q40.4 42.3 39.5 46.4Q39.2 47.9 39 48.9Q38.8 49.9 38.75 50.65Q38.7 51.4 38.65 52Q38.6 52.6 38.6 53.1Q38.6 57.6 40.65 60.45Q42.7 63.3 46.85 64.7Q51 66.1 57.2 66.1Q62.3 66.1 66.85 65.2Q71.4 64.3 74.4 62.45Q77.4 60.6 77.8 58L77.9 57.6H57L59.5 43.6H104.6L97.8 82H83.8L82.9 74.4Q78.7 77.3 73.85 79.3Q69 81.3 63.5 82.25Q58 83.2 51.6 83.2Z"/><path fill="#ffffff" d="M155.1 83.2Q134.6 83.2 124.5 76.1Q114.4 69 114.4 55.3Q114.4 46.2 117.05 38.8Q119.7 31.4 124.6 26Q128.9 21.4 134.7 18.3Q140.5 15.2 147.85 13.6Q155.2 12 163.8 12Q175.3 12 183.75 15.1Q192.2 18.2 196.85 23.8Q201.5 29.4 201.5 36.9Q201.5 38 201.4 39.15Q201.3 40.3 201.1 41.5H177.1Q177.2 41 177.25 40.5Q177.3 40 177.3 39.6Q177.3 36.5 175.5 34.15Q173.7 31.8 170.35 30.45Q167 29.1 162.4 29.1Q157.5 29.1 153.75 30.45Q150 31.8 147.35 34.2Q144.7 36.6 143.1 39.7Q141.5 42.8 140.8 46.3Q140.5 47.7 140.35 48.65Q140.2 49.6 140.15 50.3Q140.1 51 140.05 51.45Q140 51.9 140 52.4Q140 56.2 141.6 59.35Q143.2 62.5 146.6 64.3Q150 66.1 155.4 66.1Q161.1 66.1 165.4 64.6Q169.7 63.1 172.35 60.4Q175 57.7 175.6 54.1H198.9Q197.5 62.5 191.75 69.1Q186 75.7 176.65 79.45Q167.3 83.2 155.1 83.2Z"/><path fill="#b8f27c" d="M221.9 82 234 13.2H303.6L300.6 30.3H255.7L253.7 41.9H293L289.9 59H250.6L246.6 82Z"/><path fill="#ffffff" d="M345.7 83.2Q325.2 83.2 315.1 76.1Q305 69 305 55.3Q305 46.2 307.65 38.8Q310.3 31.4 315.2 26Q319.5 21.4 325.3 18.3Q331.1 15.2 338.45 13.6Q345.8 12 354.4 12Q365.9 12 374.35 15.1Q382.8 18.2 387.45 23.8Q392.1 29.4 392.1 36.9Q392.1 38 392 39.15Q391.9 40.3 391.7 41.5H367.7Q367.8 41 367.85 40.5Q367.9 40 367.9 39.6Q367.9 36.5 366.1 34.15Q364.3 31.8 360.95 30.45Q357.6 29.1 353 29.1Q348.1 29.1 344.35 30.45Q340.6 31.8 337.95 34.2Q335.3 36.6 333.7 39.7Q332.1 42.8 331.4 46.3Q331.1 47.7 330.95 48.65Q330.8 49.6 330.75 50.3Q330.7 51 330.65 51.45Q330.6 51.9 330.6 52.4Q330.6 56.2 332.2 59.35Q333.8 62.5 337.2 64.3Q340.6 66.1 346 66.1Q351.7 66.1 356 64.6Q360.3 63.1 362.95 60.4Q365.6 57.7 366.2 54.1H389.5Q388.1 62.5 382.35 69.1Q376.6 75.7 367.25 79.45Q357.9 83.2 345.7 83.2Z"/></svg>
      <span className="welcome-ball" />
    </div>
  </div>;
}

export default function WelcomePage({ content, state = "published", preview = false, publishedAt }: WelcomePageProps) {
  const showStaff = content.officers.length > 0 || state === "error";
  const [lead, ...officers] = content.officers;
  const titleLines = content.title.split("\n");
  const Main = preview ? "div" : "main";
  const publicationDate = publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(publishedAt)) : null;
  return <WelcomeDownloadsProvider enabled={content.android.enabled}>
    <div className="welcome-page" id="welcome-top">
      {preview && <div className="welcome-preview-note" role="status">초안 미리보기입니다. 아직 게시되지 않은 내용입니다.</div>}
      <a className="welcome-skip-link" href="#welcome-main">본문으로 건너뛰기</a>
      <header className="welcome-hero">
        <div className="welcome-hero-top">
          <a className="welcome-crest" href="#welcome-top" aria-label="경충FC 웰컴 페이지 처음으로"><span aria-hidden="true">GC</span>경충FC</a>
          <nav className="welcome-hero-nav" aria-label="이 페이지 안에서 이동">
            {showStaff && <a href="#staff">운영진</a>}
            <a href="#download">앱 설치</a>
            <a href="#account-guide">계정 안내</a>
          </nav>
        </div>
        <div className="welcome-hero-body">
          <div>
            <h1>{titleLines.map((line, index) => index === 0 ? <span key={index}>{line}</span> : <em key={index}>{line}</em>)}</h1>
            <p className="welcome-hero-lead">{content.introduction}</p>
            <div className="welcome-hero-actions">
              <WelcomeAppButtons ios={content.ios} />
              <a className="cta ghost welcome-on-dark" href="#account-guide">계정 이용 안내</a>
              <Link className="text-link welcome-on-dark" href="/">웹으로 이용하기</Link>
            </div>
            {state === "unpublished" && <p className="welcome-publication-note" role="status">공개 안내를 준비하고 있습니다. 운영진 소개는 등록 후 볼 수 있습니다.</p>}
          </div>
          <Court />
        </div>
      </header>
      <Main id="welcome-main" tabIndex={-1}>
        {showStaff && <section className="welcome-section" id="staff" aria-labelledby="welcome-staff-title">
          <div className="welcome-section-head"><h2 id="welcome-staff-title">모임을 운영하는 사람들</h2><p>궁금한 점은 운영진에게 물어보세요.</p></div>
          {state === "error" ? <PublicationError label="운영진 소개" /> : lead && <div className={"welcome-people" + (!officers.length ? " welcome-lead-only" : "")}>
            <div className="welcome-lead-card" id={lead.id}><span className="welcome-role">{lead.role}</span><b>{lead.name}</b>{lead.bio && <p>{lead.bio}</p>}</div>
            {!!officers.length && <ul className={"welcome-sheet-list" + (officers.length < 3 ? " welcome-single" : "")}>{officers.map((officer) => <li key={officer.id} id={officer.id}><span className="welcome-role">{officer.role}</span><b>{officer.name}</b>{officer.bio && <p>{officer.bio}</p>}</li>)}</ul>}
          </div>}
        </section>}
        <WelcomeDownloads content={content} />
      </Main>
      <footer className="welcome-foot">
        <a className="welcome-footer-logo" href="#welcome-top" aria-label="경충FC 처음으로"><Image src="/brand/gcfc-logo-horizontal-dark.svg" alt="경충FC" width={436} height={132} style={{ width: 104, height: "auto" }} /></a>
        <span>경충FC{publicationDate && <> · 안내 게시 <time dateTime={publishedAt ?? undefined}>{publicationDate}</time></>}</span>
        <div className="welcome-footer-tools"><ThemeSwitch compact /><a href="#welcome-top">맨 위로</a></div>
      </footer>
    </div>
  </WelcomeDownloadsProvider>;
}
