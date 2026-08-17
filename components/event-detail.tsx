"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, MapPin, Pencil, Shield, Trash2, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Profile } from "@/lib/types";
import { toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { parseEventDateKey, toEventDateKey } from "@/lib/event-date";
import { Empty, LoadError, SectionSkeleton } from "@/components/section-states";

type EventDetailProps = {
  dateKey: string;
  events: Event[];
  profiles: Profile[];
  attendance: Attendance[];
  momVotes: EventMomVote[];
  momResults: EventMomResult[];
  user: User | null;
  profile: Profile | null;
  supabase: ReturnType<typeof createClient>;
  loading: boolean;
  loadError: boolean;
  sessionPending: boolean;
  canManage: boolean;
  onEdit: (event: Event) => void;
  onDelete: (id: string, label: string) => void;
  onAttendance: (status: Attendance["status"], eventId?: string) => void;
  onLogin: () => void;
  onRetry: () => void;
  reload: () => void;
  toast: ToastHandler;
};

/**
 * One calendar day, in full. The `/events` list stays a scannable index of
 * dates, so everything that describes a single outing — roster, teams, score,
 * MOM — is read here instead of being stacked into every list row.
 */
export default function EventDetail({ dateKey, events, profiles, attendance, momVotes, momResults, user, profile, supabase, loading, loadError, sessionPending, canManage, onEdit, onDelete, onAttendance, onLogin, onRetry, reload, toast }: EventDetailProps) {
  const [votingEvent, setVotingEvent] = useState<Event | null>(null);
  const momDialogRef = useDialogFocus<HTMLDivElement>(() => setVotingEvent(null), Boolean(votingEvent));
  const date = parseEventDateKey(dateKey);
  const dayEvents = useMemo(
    () => events.filter((event) => toEventDateKey(event.starts_at) === dateKey).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [dateKey, events],
  );

  const submitMomVote = async (candidateProfileId: string) => {
    if (!user || !votingEvent || !supabase) return;
    const { error } = await supabase.from("event_mom_votes").upsert({ event_id: votingEvent.id, voter_id: user.id, candidate_profile_id: candidateProfileId }, { onConflict: "event_id,voter_id" });
    if (error) return toast(toErrorMessage(error), "error");
    setVotingEvent(null); toast("MOM 투표를 저장했습니다."); reload();
  };

  const back = <Link className="detail-back" href="/events"><ChevronLeft size={16} /> 일정 목록</Link>;
  if (loading) return <section className="content event-detail-page">{back}<SectionSkeleton label="일정을 불러오는 중" /></section>;
  if (loadError) return <section className="content event-detail-page">{back}<LoadError onRetry={onRetry} /></section>;
  if (!date || dayEvents.length === 0) return <section className="content event-detail-page">{back}<Empty icon={<CalendarDays />} title="이 날짜에는 등록된 일정이 없습니다" description="주소를 다시 확인하거나 일정 목록에서 원하는 날짜를 선택해 주세요." /></section>;

  const totalGoing = attendance.filter((row) => row.status === "going" && dayEvents.some((event) => event.id === row.event_id)).length;
  const totalGuests = dayEvents.reduce((sum, event) => sum + (event.event_guest_players?.length ?? 0), 0);

  return <section className="content event-detail-page">
    {back}
    <header className="detail-headline">
      <span className="eyebrow">WEEKEND SCHEDULE</span>
      <h1><time dateTime={`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`}>{date.getMonth() + 1}월 {date.getDate()}일</time> <span>{date.toLocaleDateString("ko-KR", { weekday: "long" })}</span></h1>
      <p>{date.getFullYear()}년 · 일정 {dayEvents.length}개 · 참석 회원 {totalGoing}명 · 용병 {totalGuests}명</p>
    </header>

    {dayEvents.map((event) => {
      const guests = event.event_guest_players ?? [];
      const teams = [...(event.event_teams ?? [])].sort((a, b) => a.team_number - b.team_number);
      const eventResults = momResults.filter((result) => result.event_id === event.id);
      const isPast = new Date(event.starts_at) < new Date();
      const myAttendance = attendance.find((row) => row.event_id === event.id && row.member_id === user?.id);
      const canVote = Boolean(user && profile?.status === "active" && isPast && myAttendance?.checked_in_at);
      const ownVote = momVotes.find((vote) => vote.event_id === event.id);
      const goingMembers = attendance
        .filter((row) => row.event_id === event.id && row.status === "going")
        .map((row) => ({ attendance: row, profile: profiles.find((item) => item.id === row.member_id) }))
        .filter((row): row is { attendance: Attendance; profile: Profile } => Boolean(row.profile))
        .sort((a, b) => a.profile.name.localeCompare(b.profile.name, "ko"));
      const goingCount = attendance.filter((row) => row.event_id === event.id && row.status === "going").length;
      const checkedInCount = goingMembers.filter((row) => row.attendance.checked_in_at).length;
      const scoredTeams = teams.filter((team) => team.score !== null);
      const maxScore = scoredTeams.length ? Math.max(...scoredTeams.map((team) => team.score ?? 0)) : null;
      const winnerCount = maxScore === null ? 0 : scoredTeams.filter((team) => team.score === maxScore).length;

      return <article key={event.id} className={`event-detail${isPast ? " past" : ""}`}>
        <div className="event-detail-head">
          <div>
            <span className={isPast ? "status closed" : "status paid"}>{isPast ? "지난 일정" : "예정된 일정"}{event.is_competitive ? " · 커피 내기" : ""}</span>
            <h2>{event.title}</h2>
          </div>
          {canManage && <div className="resource-actions">
            <button type="button" aria-label={`${event.title} 수정`} onClick={() => onEdit(event)}><Pencil size={16} /></button>
            <button type="button" aria-label={`${event.title} 삭제`} onClick={() => onDelete(event.id, `${date.getMonth() + 1}월 ${date.getDate()}일 · ${event.title}`)}><Trash2 size={16} /></button>
          </div>}
        </div>

        <dl className="event-detail-facts">
          <div><dt>시작 시간</dt><dd>{new Date(event.starts_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}</dd></div>
          <div><dt>장소</dt><dd><a className="inline-map-link" href={naverMapUrl(event)} target="_blank" rel="noreferrer"><MapPin size={15} /> {event.venue}</a></dd></div>
          <div><dt>정원</dt><dd>{event.capacity ? `${event.capacity}명` : "제한 없음"}</dd></div>
          <div><dt>참석</dt><dd>회원 {goingCount}명 · 용병 {guests.length}명</dd></div>
        </dl>
        {event.address && <p className="event-detail-address">{event.address}</p>}
        {event.note && <p className="event-detail-note">{event.note}</p>}

        {(!isPast || canVote) && <div className="event-detail-actions">
          {!isPast && <button type="button" className="cta" onClick={() => user ? onAttendance("going", event.id) : onLogin()}>{myAttendance?.status === "going" ? "참석 유지하기" : "참석하기"}</button>}
          {canVote && <button type="button" className="text-link" onClick={() => setVotingEvent(event)}>{ownVote ? "MOM 재투표" : "MOM 투표"}</button>}
        </div>}

        <section className="event-detail-block">
          <h3>참석 명단</h3>
          {!user ? <p className="event-detail-gate"><Shield size={15} /> 참석 명단은 회원에게만 공개합니다. <button type="button" className="text-link" onClick={onLogin}>로그인</button></p>
            : sessionPending ? <SectionSkeleton label="참석 명단을 불러오는 중" />
            : goingMembers.length === 0 && guests.length === 0 ? <p className="event-detail-gate">아직 참석을 등록한 인원이 없습니다.</p>
            : <>
              {isPast && goingMembers.length > 0 && <p className="attendee-meter"><span><b>{checkedInCount}</b> / {goingMembers.length}명 실제 출석</span><span className="attendee-meter-track" aria-hidden="true"><span style={{ width: `${Math.round((checkedInCount / goingMembers.length) * 100)}%` }} /></span></p>}
              {goingMembers.length > 0 && <ul className="attendee-roster">{goingMembers.map(({ attendance: row, profile: member }) => <li key={member.id} className={row.checked_in_at ? "checked" : ""}>
                <span className="attendee-mark" aria-hidden="true">{member.name.slice(0, 1)}</span>
                <span className="attendee-name"><b>{member.name}</b><small>{member.position ?? "PLAYER"}</small></span>
                <span className="attendee-state">{row.checked_in_at ? "출석 확인" : isPast ? "미확인" : "참석 예정"}</span>
              </li>)}</ul>}
              {guests.length > 0 && <div className="guest-roster"><b>참여 용병</b>{guests.map((guest) => <span key={guest.guest_player_id}>{guest.guest_name}{guest.guest_position ? ` · ${guest.guest_position}` : ""}</span>)}</div>}
            </>}
        </section>

        {teams.length > 0 && <section className="event-detail-block">
          <h3>팀 구성{event.is_competitive ? " 및 결과" : ""}</h3>
          <div className="detail-team-grid">{teams.map((team) => {
            const result = team.score === null || maxScore === null ? null : team.score === maxScore ? winnerCount > 1 ? "무승부" : "승리" : "패배";
            return <div className="detail-team" key={team.id}>
              <div className="detail-team-head"><b>{team.team_name}</b>{event.is_competitive && (team.score === null ? <small>점수 기록 전</small> : <span>{team.score}<small>{result}</small></span>)}</div>
              <ul>{team.event_team_members.map((member) => <li key={member.id}>
                <b>{member.participant_name}</b>
                <span>{member.participant_position ?? "ANY"}</span>
                <small>{[member.goals ? `${member.goals}골` : null, member.rating !== null ? `${member.rating}점` : null].filter(Boolean).join(" · ") || "기록 없음"}</small>
              </li>)}</ul>
            </div>;
          })}</div>
        </section>}

        {eventResults.length > 0 && <section className="event-detail-block">
          <h3>MOM 결과</h3>
          <ol className="mom-podium">{eventResults.map((result) => <li key={result.candidate_profile_id}><b>{result.mom_rank}위</b><span>{result.candidate_name}</span><small>{result.vote_count}표</small></li>)}</ol>
        </section>}
      </article>;
    })}

    {votingEvent && <div className="modal-backdrop" onClick={() => setVotingEvent(null)}>
      <div ref={momDialogRef} tabIndex={-1} className="editor mom-vote-modal" role="dialog" aria-modal="true" aria-label="MOM 투표" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="닫기" onClick={() => setVotingEvent(null)}><X /></button>
        <span className="eyebrow">MAN OF THE MATCH</span>
        <h2>MOM 투표</h2>
        <p className="form-description">MOM(Man of the Match)은 그날 경기의 최우수 선수입니다. 실제 출석한 회원 중 한 명을 선택해 주세요. 본인에게는 투표할 수 없고, 마감 전까지 다시 고를 수 있습니다.</p>
        <div className="mom-candidates">{profiles.filter((candidate) => candidate.id !== user?.id && candidate.status === "active" && attendance.some((row) => row.event_id === votingEvent.id && row.member_id === candidate.id && row.checked_in_at)).map((candidate) => {
          const selected = momVotes.find((vote) => vote.event_id === votingEvent.id)?.candidate_profile_id === candidate.id;
          return <button type="button" key={candidate.id} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => void submitMomVote(candidate.id)}><span>{candidate.position ?? "PLAYER"}</span><b>{candidate.name}</b></button>;
        })}</div>
      </div>
    </div>}
  </section>;
}

function naverMapUrl(event: Pick<Event, "venue" | "address">) {
  return `https://map.naver.com/p/search/${encodeURIComponent([event.venue, event.address].filter(Boolean).join(" "))}`;
}
