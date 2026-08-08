import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://gyungchung.vercel.app"),
  title: "경충FC | 우리의 주말, 우리의 풋살",
  description: "경충FC 회원, 회비, 공지와 주말 풋살 일정을 한곳에서 확인하세요.",
  openGraph: {
    title: "경충FC | 우리의 주말, 우리의 풋살",
    description: "주말마다 함께 뛰는 경충FC의 공식 클럽하우스",
    type: "website",
    locale: "ko_KR",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
