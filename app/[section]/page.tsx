import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Clubhouse from "@/components/clubhouse";

const sections = new Set(["members", "fees", "notices", "events", "rankings", "feedback", "participation", "admin"]);
const sectionMeta: Record<string, { title: string; description: string }> = {
  members: { title: "회원 | 경충FC", description: "승인된 경충FC 회원 명단을 확인합니다." },
  fees: { title: "회비 | 경충FC", description: "경충FC 회원의 월별 회비 납부 현황을 확인합니다." },
  notices: { title: "공지사항 | 경충FC", description: "경충FC의 최신 운영 공지를 확인합니다." },
  events: { title: "일정 | 경충FC", description: "경충FC의 주말 풋살 일정과 참석 정보를 확인합니다." },
  rankings: { title: "랭킹 | 경충FC", description: "출석, 회비 및 MOM 기록으로 집계한 경충FC 활동 랭킹입니다." },
  feedback: { title: "사용자 의견 | 경충FC", description: "경충FC 운영과 시스템에 관한 의견을 전달합니다." },
  participation: { title: "투표·설문 | 경충FC", description: "경충FC 선거, 의사결정 투표와 설문에 참여합니다." },
  admin: { title: "운영 관리 | 경충FC", description: "경충FC 운영진 전용 관리 화면입니다." },
};

type SectionProps = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: SectionProps): Promise<Metadata> {
  const { section } = await params;
  const page = sectionMeta[section];
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${section}` },
    ...(section === "admin" ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function SectionPage({ params }: SectionProps) {
  const { section } = await params;
  if (!sections.has(section)) notFound();
  return <Clubhouse />;
}
