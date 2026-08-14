import type { Metadata } from "next";

/** The page itself is a client component, so its metadata lives here. */
export const metadata: Metadata = {
  title: "새 비밀번호 설정 | 경충FC",
  description: "경충FC 로그인에 사용할 새 비밀번호를 설정합니다.",
  alternates: { canonical: "/auth/update-password" },
  robots: { index: false, follow: false },
};

export default function UpdatePasswordLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
