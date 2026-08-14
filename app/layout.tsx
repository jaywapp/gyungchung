import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

/**
 * The identity-carrying type in this design — crest, eyebrows, date numerals,
 * uppercase labels — is all Latin, so that role gets a self-hosted face.
 * Korean body text stays on an explicit platform stack: a Korean webfont's
 * unicode-range split costs ~96kB of gzipped CSS on every first paint, which
 * is not worth it for glyphs every target device already renders well.
 */
const display = Archivo({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-display",
  display: "swap",
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
