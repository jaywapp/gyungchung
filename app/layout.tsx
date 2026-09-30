import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { themeInitScript } from "@/lib/theme";
import { splashInitScript } from "@/lib/splash-motion";
import AppSplash from "@/components/app-splash";

/**
 * Korean text runs on Pretendard Variable, self-hosted through its dynamic
 * subset: the stylesheet is ~13kB gzipped and the browser only fetches the
 * unicode-range slices a page actually renders, instead of the 2MB full face.
 * Archivo stays the display face, and only for uppercase Latin labels and
 * numerals — see the label rules at the top of globals.css.
 */
const display = Archivo({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-display",
  display: "swap",
});

/** The launch splash wordmark only: expanded black italic, never preloaded. */
const wordmark = Archivo({
  subsets: ["latin"],
  style: ["italic"],
  axes: ["wdth"],
  variable: "--font-wordmark",
  display: "block",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://gyungchung.vercel.app"),
  alternates: { canonical: "/" },
  title: "경충FC | 우리의 주말, 우리의 풋살",
  description: "경충FC 회원, 회비, 공지와 주말 풋살 일정을 한곳에서 확인하세요.",
  openGraph: {
    title: "경충FC | 우리의 주말, 우리의 풋살",
    description: "주말마다 함께 뛰는 경충FC의 공식 클럽하우스",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "경충FC 공식 클럽하우스" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  appleWebApp: { capable: true, title: "경충FC", statusBarStyle: "default" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // data-theme and data-splash are set by the inline scripts before hydration, so the server markup never matches them.
  return (
    <html lang="ko" className={`${display.variable} ${wordmark.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: splashInitScript }} />
      </head>
      <body>
        <AppSplash />
        {children}
      </body>
    </html>
  );
}
