import type { Metadata } from "next";
import WelcomePage from "@/components/welcome-page";
import { readWelcomePublication } from "@/lib/welcome-publication";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "경충FC에 오신 것을 환영합니다 | 경충FC",
  description: "경충FC 운영진, 필수 앱 설치 및 계정 이용 안내를 확인하세요.",
  alternates: { canonical: "/welcome" },
  robots: { index: false, follow: false },
  openGraph: {
    title: "경충FC에 오신 것을 환영합니다",
    description: "운영진을 확인하고 앱을 설치해 함께 시작하세요.",
    url: "/welcome",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "경충FC 웰컴 페이지" }],
  },
};
export default async function Page() {
  const publication = await readWelcomePublication();
  return <WelcomePage {...publication} />;
}
