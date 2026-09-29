"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, CircleDollarSign, Clock3, MapPin, Megaphone, Trophy, Vote } from "lucide-react";
import type { Attendance, Event, Notice, ParticipationForm, Profile } from "@/lib/types";
import { getEventCapacity } from "@/lib/event-capacity";
import { eventDatePath } from "@/lib/event-date";
import { formatDeadline, isParticipationClosed } from "@/lib/participation-deadline";
import { nameInitials } from "@/lib/member-directory";
import type { SeasonRank } from "@/lib/season-rankings";
import { RsvpControls } from "@/components/rsvp-controls";
import { MemberAvatar, tabPaths } from "@/components/club-nav";
import { LoadError, SectionSkeleton } from "@/components/section-states";

export type HomeFeeStanding = { unpaidCount: number; unpaidTotal: number; paidCount: number };

type MemberHomeProps = {
  profile: Profile | null;
  upcoming?: Event;
  attendance: Attendance[];
  profiles: Profile[];
  notices: Notice[];
  forms: ParticipationForm[];
  feeStanding: HomeFeeStanding | null;
  rankings: { goals: SeasonRank[]; wins: SeasonRank[] };
  publicLoading: boolean;
  sessionPending: boolean;
  eventLoadError: boolean;
  noticeLoadError: boolean;
  feeLoadError: boolean;
  rsvpPending: boolean;
  onAttendance: (status: Attendance["status"]) => void;
  onLogin: () => void;
  onRetry: () => void;
};

const kindLabels: Record<ParticipationForm["kind"], string> = { election: "회장단 선거", poll: "의사 결정 투표", survey: "회원 설문" };

function dayDiff(date: Date, from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function relativeDay(date: Date) {
  const days = dayDiff(date);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  if (days > 1 && days < 7) return `이번 주 ${date.toLocaleDateString("ko-KR", { weekday: "long" })}`;
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

const formatTime = (value: string) => new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const shortDate = (value: string) => new Date(value).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const naverMapUrl = (event: Pick<Event, "venue" | "address">) => `https://map.naver.com/p/search/${encodeURIComponent([event.venue, event.address].filter(Boolean).join(" "))}`;

/** The signed-in home: the next match to answer first, then what else needs a look this week. */
export default function MemberHome(props: MemberHomeProps) {
  const { profile, upcoming, publicLoading, eventLoadError, onRetry } = props;
  const greetingName = profile ? `${nameInitials(profile.name)}님, ` : "";
  const date = upcoming ? new Date(upcoming.starts_at) : null;
  return <section className="content member-home" aria-labelledby="member-home-title">
    <div className="member-home-greet">
      <h1 id="member-home-title">{date && upcoming ? `${greetingName}${relativeDay(date)} 경기예요` : `${greetingName}다음 경기를 기다리고 있어요`}</h1>
      {upcoming && <p>{formatTime(upcoming.starts_at)} 시작 · {upcoming.venue}</p>}
    </div>
    {publicLoading ? <div className="console console-loading" role="status" aria-label="다음 일정을 불러오는 중"><span /><span /></div>
      : eventLoadError ? <div className="console"><LoadError onRetry={onRetry} /></div>
      : upcoming && date ? <MatchConsole {...props} upcoming={upcoming} date={date} />
      : <div className="console console-empty"><CalendarDays aria-hidden="true" /><div><h2>새 일정을 준비 중입니다</h2><p>다음 주말 일정이 확정되면 이곳에서 바로 참석을 응답할 수 있습니다.</p></div><Link className="text-link" href={tabPaths.events}>전체 일정 <ChevronRight size={16} /></Link></div>}
    <div className="home-modules">
      <NoticeModule {...props} />
      <FeeModule {...props} />
      <ParticipationModule {...props} />
      <RankingModule {...props} />
    </div>
  </section>;
}

function MatchConsole({ upcoming, date, attendance, profiles, profile, sessionPending, rsvpPending, onAttendance, onLogin }: MemberHomeProps & { upcoming: Event; date: Date }) {
  const eventAttendance = attendance.filter((row) => row.event_id === upcoming.id);
  const goingIds = new Set(eventAttendance.filter((row) => row.status === "going").map((row) => row.member_id));
  const going = profiles.filter((member) => goingIds.has(member.id));
  const guestCount = upcoming.event_guest_players?.length ?? 0;
  const capacity = getEventCapacity(upcoming.capacity, goingIds.size, guestCount);
  const myStatus = eventAttendance.find((row) => row.member_id === profile?.id)?.status ?? null;
  const days = dayDiff(date);
  const seatCount = capacity.capacity === null ? 0 : Math.max(capacity.capacity, capacity.totalCount);
  const left = capacity.remaining ?? 0;
  return <section className="console" aria-labelledby="console-title">
    <div className="console-date">
      <small>{date.getMonth() + 1}월</small>
      <b>{String(date.getDate()).padStart(2, "0")}</b>
      <span>{date.toLocaleDateString("ko-KR", { weekday: "long" })}</span>
      {days >= 0 && <em>{days === 0 ? "D-DAY" : `D-${days}`}</em>}
    </div>
    <div className="console-event">
      <h2 id="console-title">{upcoming.title}</h2>
      <dl>
        <div><dt><Clock3 size={16} aria-hidden="true" />시간</dt><dd>{formatTime(upcoming.starts_at)} 시작</dd></div>
        <div><dt><MapPin size={16} aria-hidden="true" />장소</dt><dd>{upcoming.venue}<a href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer">네이버 지도</a></dd></div>
      </dl>
    </div>
    <div className="console-response">
      <RsvpControls variant="console" eventTitle={upcoming.title} startsAt={upcoming.starts_at} status={myStatus} isAuthenticated memberStatus={profile?.status ?? null} isLoading={sessionPending} isSaving={rsvpPending} onChange={onAttendance} onLogin={onLogin} />
    </div>
    <div className="console-attend">
      <div className="console-count">
        <b>{capacity.capacity === null ? `참석 ${capacity.totalCount}명` : `참석 ${capacity.totalCount} / 정원 ${capacity.capacity}명`}</b>
        <small>회원 {goingIds.size} · 용병 {guestCount}{capacity.capacity === null ? "" : left >= 0 ? ` · ${left}자리 남음` : ` · 정원 ${Math.abs(left)}명 초과`}</small>
      </div>
      {seatCount > 0 && <div className="seat-bar" aria-hidden="true">{Array.from({ length: seatCount }, (_, index) => <i key={index} className={index < goingIds.size ? "member" : index < capacity.totalCount ? "guest" : undefined} />)}</div>}
      <div className="console-faces">
        {going.length > 0 && <span className="face-stack">{going.slice(0, 6).map((member) => <span key={member.id} title={member.name}><MemberAvatar profile={member} size="sm" /></span>)}{going.length > 6 && <span className="member-avatar sm pos-ANY face-more" aria-hidden="true">+{going.length - 6}</span>}</span>}
        <Link className="text-link" href={eventDatePath(upcoming.starts_at)}>명단 보기 <ChevronRight size={16} /></Link>
      </div>
    </div>
  </section>;
}

function NoticeModule({ notices, publicLoading, noticeLoadError, onRetry }: MemberHomeProps) {
  return <section className="home-module module-notice" aria-labelledby="module-notice">
    <div className="module-head"><h2 id="module-notice"><Megaphone size={18} aria-hidden="true" />공지</h2><Link className="text-link" href={tabPaths.notices}>전체 보기 <ChevronRight size={16} /></Link></div>
    {publicLoading ? <SectionSkeleton label="공지를 불러오는 중" /> : noticeLoadError ? <LoadError onRetry={onRetry} /> : notices.length === 0 ? <p className="panel-empty">등록된 공지가 없습니다.</p> : <ol className="module-notices">{notices.slice(0, 3).map((notice, index) => <li key={notice.id}>
      <b>{notice.is_pinned && <span className="pin">고정</span>}{notice.title}</b>
      {index === 0 && notice.body && <p>{notice.body}</p>}
      <small>{shortDate(notice.created_at)}</small>
    </li>)}</ol>}
  </section>;
}

function FeeModule({ feeStanding, feeLoadError, sessionPending, onRetry }: MemberHomeProps) {
  return <section className="home-module module-fee" aria-labelledby="module-fee">
    <div className="module-head"><h2 id="module-fee"><CircleDollarSign size={18} aria-hidden="true" />내 회비</h2></div>
    {sessionPending ? <SectionSkeleton label="회비 정보를 불러오는 중" /> : feeLoadError ? <LoadError onRetry={onRetry} /> : !feeStanding ? <p className="panel-empty">아직 등록된 회비 내역이 없습니다.</p> : feeStanding.unpaidCount > 0 ? <>
      <div className="module-amount">{feeStanding.unpaidTotal.toLocaleString()}<small>원</small></div>
      <span className="status unpaid">미납 {feeStanding.unpaidCount}건</span>
      <p className="module-note">납부 계좌와 방법은 총무가 안내합니다.</p>
    </> : <>
      <div className="module-amount settled">미납 없음</div>
      <span className="status paid">납부 완료 {feeStanding.paidCount}건</span>
    </>}
    <Link className="text-link module-foot" href={tabPaths.fees}>회비 보기 <ChevronRight size={16} /></Link>
  </section>;
}

function ParticipationModule({ forms, publicLoading }: MemberHomeProps) {
  const open = forms.find((form) => form.status === "open" && !isParticipationClosed(form));
  return <section className="home-module module-poll" aria-labelledby="module-poll">
    <div className="module-head"><h2 id="module-poll"><Vote size={18} aria-hidden="true" />참여</h2>{open?.ends_at && <span className="status reviewing">{formatDeadline(open.ends_at).split(" · ").pop()}</span>}</div>
    {publicLoading ? <SectionSkeleton label="참여 항목을 불러오는 중" /> : open ? <>
      <small className="module-kicker">{kindLabels[open.kind]}</small>
      <b className="module-title">{open.title}</b>
      {open.ends_at && <p className="module-note">{formatDeadline(open.ends_at)}</p>}
      <Link className="module-action" href={tabPaths.participation}>참여하기</Link>
    </> : <p className="panel-empty">지금 진행 중인 투표나 설문이 없습니다.</p>}
  </section>;
}

function RankList({ title, rows, unit }: { title: string; rows: SeasonRank[]; unit: string }) {
  return <div><h3>{title}</h3>{rows.length === 0 ? <p className="panel-empty">아직 기록이 없습니다.</p> : <ol>{rows.slice(0, 3).map((row) => {
    const tied = rows.filter((other) => other.rank === row.rank).length > 1;
    return <li key={row.member_id}><span className={row.rank === 1 ? "rank top" : "rank"} aria-label={tied ? `공동 ${row.rank}위` : `${row.rank}위`}>{tied ? `T${row.rank}` : row.rank}</span><span className="rank-name">{row.member_name}</span><b>{row.count}{unit}</b></li>;
  })}</ol>}</div>;
}

function RankingModule({ rankings, profile, sessionPending }: MemberHomeProps) {
  const year = new Date().getFullYear();
  return <section className="home-module module-rank" aria-labelledby="module-rank">
    <div className="module-head"><h2 id="module-rank"><Trophy size={18} aria-hidden="true" />{year} 시즌 랭킹</h2><Link className="text-link" href={tabPaths.rankings}>전체 랭킹 <ChevronRight size={16} /></Link></div>
    {sessionPending ? <SectionSkeleton label="랭킹을 불러오는 중" /> : profile?.status !== "active" ? <p className="panel-empty">활동 랭킹은 활동 회원에게 공개됩니다.</p> : <div className="module-rank-cols"><RankList title="득점" rows={rankings.goals} unit="골" /><RankList title="MVP" rows={rankings.wins} unit="회" /></div>}
  </section>;
}
