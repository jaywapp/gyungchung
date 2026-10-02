"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Apple, Download, ExternalLink, LoaderCircle, TriangleAlert } from "lucide-react";
import appIcon from "@/app/icon.png";
import { ANDROID_DOWNLOAD_URL, isApprovedIosUrl, isPublicAndroidUrl, type WelcomeContent, type WelcomeStep } from "@/lib/welcome-content";

interface AndroidRelease {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  publishedAt: string;
  notes: string[];
  downloadUrl: string;
}
type AndroidState = { status: "loading" | "error"; release: null } | { status: "ready"; release: AndroidRelease };
interface DownloadContextValue { enabled: boolean; state: AndroidState; retry: () => void }
const DownloadContext = createContext<DownloadContextValue | null>(null);

function readRelease(value: unknown): AndroidRelease | null {
  if (!value || typeof value !== "object") return null;
  const release = value as Partial<AndroidRelease>;
  if (typeof release.versionName !== "string" || !release.versionName.trim() || release.versionName.length > 100 ||
    !Number.isSafeInteger(release.versionCode) || (release.versionCode ?? 0) <= 0 ||
    typeof release.sizeBytes !== "number" || !Number.isFinite(release.sizeBytes) || release.sizeBytes <= 0 ||
    typeof release.publishedAt !== "string" || Number.isNaN(Date.parse(release.publishedAt)) ||
    typeof release.downloadUrl !== "string" || !isPublicAndroidUrl(release.downloadUrl) ||
    !Array.isArray(release.notes) || !release.notes.every((note) => typeof note === "string")) return null;
  return release as AndroidRelease;
}

export function WelcomeDownloadsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<AndroidState>({ status: "loading", release: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setState({ status: "loading", release: null });
    async function load() {
      try {
        const response = await fetch("/api/welcome/android", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Android metadata unavailable");
        const release = readRelease(await response.json());
        if (!release) throw new Error("Android metadata invalid");
        if (!disposed) setState({ status: "ready", release });
      } catch {
        if (!disposed) setState({ status: "error", release: null });
      } finally { window.clearTimeout(timeout); }
    }
    void load();
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [enabled, attempt]);
  return <DownloadContext.Provider value={{ enabled, state, retry: () => setAttempt((value) => value + 1) }}>{children}</DownloadContext.Provider>;
}

function useDownloads() {
  const context = useContext(DownloadContext);
  if (!context) throw new Error("WelcomeDownloadsProvider is required");
  return context;
}

export function WelcomeDownloadButton() {
  const { enabled, state } = useDownloads();
  if (!enabled) return null;
  return <a className="cta secondary" href={state.release?.downloadUrl ?? ANDROID_DOWNLOAD_URL}><Download size={20} aria-hidden="true" />Android 앱 다운로드</a>;
}

function Guide({ title, steps, id }: { title: string; steps: WelcomeStep[]; id?: string }) {
  return <div id={id}><h3>{title}</h3><ol>{steps.map((step, index) => <li key={index}><span><b>{step.title}</b>{step.body}</span></li>)}</ol></div>;
}

export default function WelcomeDownloads({ content }: { content: WelcomeContent }) {
  const { enabled, state, retry } = useDownloads();
  const { ios } = content;
  const pwaIos = ios.status === "pwa" || ios.status === "preparing";
  const activeIos = (ios.status === "testflight" || ios.status === "released") && isApprovedIosUrl(ios.url);
  const iosTitle = pwaIos ? "iPhone 홈 화면 앱" : activeIos ? (ios.status === "testflight" ? "iOS 테스트 참여" : "iOS 앱") : "iPhone 이용 안내";
  return <section className="welcome-section welcome-kickoff" id="download" aria-labelledby="welcome-download-title">
    <div className="welcome-kickoff-grid">
      <div className="welcome-kickoff-app">
        <Image src={appIcon} alt="" width={84} height={84} />
        <h2 id="welcome-download-title">앱으로 함께 시작하세요</h2>
        <p className="welcome-kickoff-lead">앱 설치는 필수입니다. 안내받은 계정으로 로그인해 주세요.</p>
        {enabled && state.status === "ready" && <dl className="welcome-app-meta">
          <div><dt>버전</dt><dd>{state.release.versionName}</dd></div>
          <div><dt>크기</dt><dd>{(state.release.sizeBytes / (1024 * 1024)).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} MB</dd></div>
          <div><dt>배포일</dt><dd><time dateTime={state.release.publishedAt}>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(state.release.publishedAt))}</time></dd></div>
        </dl>}
        {enabled && state.status === "loading" && <p className="welcome-app-msg" role="status"><LoaderCircle size={18} aria-hidden="true" /><span>버전 정보를 확인하는 중입니다.</span></p>}
        {enabled && state.status === "error" && <div className="welcome-app-msg" role="status"><TriangleAlert size={18} aria-hidden="true" /><span>버전 정보를 불러오지 못했습니다. 최신 설치 파일은 그대로 받을 수 있습니다.<br /><button type="button" className="text-link welcome-on-dark" onClick={retry}>다시 확인</button></span></div>}
        <div className="welcome-kickoff-actions">
          <WelcomeDownloadButton />
          {!enabled && <a className="cta ghost welcome-on-dark" href="#account-guide">계정 이용 안내</a>}
          <Link className="cta ghost welcome-on-dark" href="/">웹으로 이용하기</Link>
        </div>
        {enabled && state.status === "ready" && state.release.notes.length > 0 && <details className="welcome-release-notes"><summary>최근 변경사항</summary><ul>{state.release.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
        {ios.status !== "hidden" && <div className="welcome-ios-line"><Apple size={18} aria-hidden="true" /><span><b>{iosTitle}</b> {pwaIos ? "별도 앱 스토어 가입 없이 홈 화면에 추가해 이용하세요." : ios.message}</span>
          {pwaIos && <a className="text-link welcome-on-dark" href="#iphone-install">설치 방법 보기</a>}
          {activeIos && <a className="text-link welcome-on-dark" href={ios.url}>{ios.status === "testflight" ? "TestFlight에서 참여" : "App Store에서 받기"}<ExternalLink size={15} aria-hidden="true" /></a>}
        </div>}
      </div>
      <div className={"welcome-guides" + (!enabled ? " welcome-single" : "")}>
        {enabled && <Guide title="설치 방법" steps={content.android.installSteps} />}
        {pwaIos && <Guide id="iphone-install" title="iPhone 설치 방법" steps={[
          { title: "Safari에서 열기", body: "이 페이지를 Safari에서 여세요. 카카오톡 안에서 열었다면 외부 브라우저로 이동해 주세요." },
          { title: "홈 화면에 추가", body: "공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요. ‘앱으로 열기’가 보이면 켜고 추가를 눌러 주세요." },
          { title: "아이콘에서 로그인", body: "홈 화면의 경충FC 아이콘을 열고 기존 계정으로 로그인하세요." },
          { title: "알림 켜기", body: "마이페이지에서 ‘이 기기 알림 켜기’를 눌러 허용하세요. 알림은 iOS 16.4 이상에서 사용할 수 있습니다." },
        ]} />}
        <Guide id="account-guide" title="계정 안내" steps={content.accountSteps} />
      </div>
    </div>
  </section>;
}
