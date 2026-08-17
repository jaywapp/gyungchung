import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatEventDateKey, parseEventDateKey } from "@/lib/event-date";

type EventDateParams = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: EventDateParams): Promise<Metadata> {
  const { date } = await params;
  if (!parseEventDateKey(date)) return { title: "일정 | 경충FC", robots: { index: false, follow: false } };
  const label = formatEventDateKey(date);
  return {
    title: `${label} 일정 | 경충FC`,
    description: `경충FC ${label} 주말 풋살 일정의 시간, 장소, 참석 현황과 경기 결과를 확인합니다.`,
    alternates: { canonical: `/events/${date}` },
  };
}

/**
 * The clubhouse shell owns the loaded event data, so this route only validates
 * the date key and hands rendering to Clubhouse — the same contract every other
 * section page follows.
 */
export default async function EventDatePage({ params }: EventDateParams) {
  const { date } = await params;
  if (!parseEventDateKey(date)) notFound();
  return null;
}
