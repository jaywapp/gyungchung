"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ClipboardCheck, MapPin, Pencil, Shield, Trash2, Trophy, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Profile } from "@/lib/types";
import { getCheckInStatus, isCheckedIn } from "@/lib/attendance";
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
  onManageMatch: (event: Event) => void;
  onManageAttendance: (event: Event) => void;
  onDelete: (id: string, label: string) => void;
  onAttendance: (status: Attendance["status"], eventId?: string) => void;
  onLogin: () => void;
  onRetry: () => void;
  reload: () => void;
  toast: ToastHandler;
};

const checkInLabels: Record<NonNullable<Attendance["check_in_status"]>, string> = { present: "출석", late: "지각", absent: "결석" };

/**
 * One calendar day, in full. The `/events` list stays a scannable index of
 * dates, so everything that describes a single outing — roster, teams, match
 * results, MOM — is read here instead of being stacked into every list row.
 */
export default function EventDetail({ dateKey, events, profiles, attendance, momVotes, momResults, user, profile, supabase, loading, loadError, sessionPending, canManage, onEdit, onManageMatch, onManageAttendance, onDelete, onAttendance, onLogin, onRetry, reload, toast }: EventDetailProps) {
  const [votingEvent, setVotingEvent] = useState<Event | null>(null);
  const momDialogRef = useDialogFocus<HTMLDivElement>(() => setVotingEvent(null), Boolean(votingEvent));
  const date = parseEventDateKey(dateKey);
  const dayEvents = useMemo(
    () => events.filter((event) => toEventDateKey(event.starts_at) === dateKey).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [dateKey, events],
  );

  useEffect(() => {
    if (loading || dayEvents.length === 0 || new URLSearchParams(window.location.search).get("section") !== "teams") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("teams")?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [dateKey, dayEvents.length, loading]);

  const submitMomVote = async (candidateProfileId: string) => {
    if (!user || !profile || !votingEvent || !supabase) return;
    const { error } = await supabase.from("event_mom_votes").upsert({ event_id: votingEvent.id, voter_id: profile.id, candidate_profile_id: candidateProfileId }, { onConflict: "event_id,voter_id" });
    if (error) return toast(toErrorMessage(error), "error");
    setVotingEvent(null); toast("MOM 투표를 저장했습니다."); reload();
  };

  const back = <Link className="detail-back" href="/events"><ChevronLeft size={16} /> 일정 목록</Link>;
  if (loading) return <section className="content event-detail-page">{back}<SectionSkeleton label="일정을 불러오는 중" /></section>;
  if (loadError) return <section className="content event-detail-page">{back}<LoadError onRetry={onRetry} /></section>;
  if (!date || dayEvents.length === 0) return <section className="content event-detail-page">{back}<Empty icon={<CalendarDays />} title="이 날짜에는 등록된 일정이 없습니다" description="주소를 다시 확인하거나 일정 목록에서 원하는 날짜를 선택해 주세요." /></section>;

  const dayAttendance = attendance.filter((row) => dayEvents.some((event) => event.id === row.event_id));
  const totalGoing = dayAttendance.filter((row) => row.status === "going").length;
  const totalPresent = dayAttendance.filter((row) => getCheckInStatus(row) === "present").length;
  const totalGuests = dayEvents.reduce((sum, event) => sum + (event.event_guest_players?.length ?? 0), 0);
  const dayIsPast = dayEvents.every((event) => new Date(event.starts_at) < new Date());

  return <section className="content event-detail-page">
    {back}
    <header className="detail-headline">
      <span className="eyebrow">WEEKEND SCHEDULE</span>
      <h1><time dateTime={`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`}>{date.getMonth() + 1}월 {date.getDate()}일</time> <span>{date.toLocaleDateString("ko-KR", { weekday: "long" })}</span></h1>
      <p>{date.getFullYear()}년 · 일정 {dayEvents.length}개 · {dayIsPast ? `출석 ${totalPresent}명` : `참석 예정 ${totalGoing}명`} · 용병 {totalGuests}명</p>
    </header>

    {dayEvents.map((event) => {
      const guests = event.event_guest_players ?? [];
      const teams = [...(event.event_teams ?? [])].sort((a, b) => a.team_number - b.team_number);
      const matches = [...(event.event_matches ?? [])].sort((a, b) => a.match_number - b.match_number);
      const teamNameById = new Map(teams.map((team) => [team.id, team.team_name]));
      const eventResults = momResults.filter((result) => result.event_id === event.id);
      const isPast = new Date(event.starts_at) < new Date();
      const myAttendance = attendance.find((row) => row.event_id === event.id && row.member_id === profile?.id);
      const canVote = Boolean(user && profile?.status === "active" && isPast && isCheckedIn(myAttendance));
      const ownVote = momVotes.find((vote) => vote.event_id === event.id);
      const eventAttendance = attendance.filter((row) => row.event_id === event.id);
      /** A member who never RSVPed can still be checked in on the day, so the
          roster is everyone with an RSVP of 참석 or any recorded check-in. */
      const roster = eventAttendance
        .filter((row) => row.status === "going" || getCheckInStatus(row) !== null)
        .map((row) => ({ attendance: row, profile: profiles.find((item) => item.id === row.member_id) }))
        .filter((row): row is { attendance: Attendance; profile: Profile } => Boolean(row.profile))
        .sort((a, b) => a.profile.name.localeCompare(b.profile.name, "ko"));
      const goingCount = eventAttendance.filter((row) => row.status === "going").length;
      const presentCount = eventAttendance.filter((row) => getCheckInStatus(row) === "present").length;
      const lateCount = eventAttendance.filter((row) => getCheckInStatus(row) === "late").length;
      const absentCount = eventAttendance.filter((row) => getCheckInStatus(row) === "absent").length;
      const checkedCount = roster.filter((row) => getCheckInStatus(row.attendance) !== null).length;
      const scoredTeams = teams.filter((team) => team.score !== null);
      const maxScore = scoredTeams.length ? Math.max(...scoredTeams.map((team) => team.score ?? 0)) : null;
      const winnerCount = maxScore === null ? 0 : scoredTeams.filter((team) => team.score === maxScore).length;
      const rosterVisible = Boolean(user && profile?.status === "active");
      const teamMemberCount = teams.reduce((sum, team) => sum + team.event_team_members.length, 0);

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
          <div><dt>{isPast ? "출석" : "참석 예정"}</dt><dd>{isPast ? `${presentCount}명 · 지각 ${lateCount}명 · 결석 ${absentCount}명` : `회원 ${goingCount}명 · 용병 ${guests.length}명`}</dd></div>
        </dl>
        {event.address && <p className="event-detail-address">{event.address}</p>}
        {event.note && <p className="event-detail-note">{event.note}</p>}

        {(!isPast || canVote || canManage) && <div className="event-detail-actions">
          {!isPast && <button type="button" className="cta" onClick={() => user ? onAttendance("going", event.id) : onLogin()}>{myAttendance?.status === "going" ? "참석 유지하기" : "참석하기"}</button>}
          {canManage && <div className="officer-menu" role="group" aria-label={`${event.title} 운영 메뉴`}><button type="button" className="officer-menu-item" aria-label={`출석 체크 · ${event.title}`} onClick={() => onManageAttendance(event)}><ClipboardCheck size={17} /> 출석 체크</button><button type="button" className="officer-menu-item" aria-label={`팀·경기 기록 · ${event.title}`} onClick={() => onManageMatch(event)}><Trophy size={17} /> 팀·경기 기록</button></div>}
          {canVote && <button type="button" className="text-link" onClick={() => setVotingEvent(event)}>{ownVote ? "MOM 재투표" : "MOM 투표"}</button>}
        </div>}

        <section className="event-detail-block">
          <h3>참석 명단</h3>
          {!user ? <p className="event-detail-gate"><Shield size={15} /> 참석 명단은 회원에게만 공개합니다. <button type="button" className="text-link" onClick={onLogin}>로그인</button></p>
            : sessionPending ? <SectionSkeleton label="참석 명단을 불러오는 중" />
            : roster.length === 0 && guests.length === 0 ? <p className="event-detail-gate">아직 참석을 등록한 인원이 없습니다.</p>
            : <>
              {isPast && roster.length > 0 && <p className="attendee-meter"><span><b>{checkedCount}</b> / {roster.length}명 출석 확인</span><span className="attendee-meter-track" aria-hidden="true"><span style={{ width: `${Math.round((checkedCount / roster.length) * 100)}%` }} /></span></p>}
              {roster.length > 0 && <ul className="attendee-roster">{roster.map(({ attendance: row, profile: member }) => {
                const status = getCheckInStatus(row);
                return <li key={member.id} className={status ? `checked ${status}` : ""}>
                  <span className="attendee-mark" aria-hidden="true">{member.name.slice(0, 1)}</span>
                  <span className="attendee-name"><b>{member.name}</b></span>
                  <span className="attendee-state">{status ? checkInLabels[status] : row.status === "going" ? "참석 예정" : "미확인"}</span>
                </li>;
              })}</ul>}
              {guests.length > 0 && <div className="guest-roster"><b>참여 용병</b>{guests.map((guest) => <span key={guest.guest_player_id}>{guest.guest_name}</span>)}</div>}
            </>}
        </section>

        {teams.length > 0 && <section id="teams" className="event-detail-block event-team-roster-block">
          <h3>팀 구성{event.is_competitive ? " 및 결과" : ""}<span className="detail-block-count">{teams.length}개 팀{rosterVisible && teamMemberCount > 0 ? ` · ${teamMemberCount}명` : ""}</span></h3>
          {!rosterVisible ? <p className="event-detail-gate"><Shield size={15} /> 팀 명단은 활동 회원에게만 공개합니다. {!user && <button type="button" className="text-link" onClick={onLogin}>로그인</button>}</p>
            : sessionPending ? <SectionSkeleton label="팀 명단을 불러오는 중" />
            : teamMemberCount === 0 ? <p className="event-detail-gate">팀은 편성됐지만 명단을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</p>
            : <div className="detail-team-grid">{teams.map((team) => {
            const result = team.score === null || maxScore === null ? null : team.score === maxScore ? winnerCount > 1 ? "무승부" : "승리" : "패배";
            /* Own team is marked with a border, a label and a row flag rather
               than colour alone, so the cue survives colour vision deficiency. */
            const isMine = Boolean(profile && team.event_team_members.some((member) => member.profile_id === profile.id));
            return <div className={`detail-team${isMine ? " is-mine" : ""}`} key={team.id}>
              <div className="detail-team-head"><b>{team.team_name}</b>{isMine && <em className="mine-flag">내 팀</em>}{event.is_competitive && (team.score === null ? <small>점수 기록 전</small> : <span>{team.score}<small>{result}</small></span>)}</div>
              <ul>{team.event_team_members.map((member) => <li className={profile && member.profile_id === profile.id ? "is-me" : undefined} key={member.id}>
                <b>{member.participant_name}</b>
                <span>{member.participant_position ?? "ANY"}</span>
                <small>{[member.goals ? `${member.goals}골` : null, member.rating !== null ? `${member.rating}점` : null].filter(Boolean).join(" · ") || "기록 없음"}</small>
              </li>)}</ul>
            </div>;
          })}</div>}
        </section>}

        {matches.length > 0 && <section className="event-detail-block">
          <h3>경기 결과<span className="detail-block-count">{matches.length}경기</span></h3>
          <ol className="detail-match-list">{matches.map((match) => {
            const teamAName = teamNameById.get(match.team_a_id) ?? "팀 A";
            const teamBName = teamNameById.get(match.team_b_id) ?? "팀 B";
            const scorersFor = (teamId: string) => match.event_match_scorers.filter((scorer) => scorer.team_id === teamId);
            return <li key={match.id}>
              <div className="detail-match-score">
                <small>{match.match_number}경기</small>
                <span><b>{teamAName}</b> <strong>{match.team_a_score}:{match.team_b_score}</strong> <b>{teamBName}</b></span>
              </div>
              {[[match.team_a_id, teamAName] as const, [match.team_b_id, teamBName] as const].map(([teamId, teamName]) => {
                const scorers = scorersFor(teamId);
                if (scorers.length === 0) return null;
                return <p className="detail-match-scorers" key={teamId}><b>{teamName}</b>{scorers.map((scorer) => <span key={scorer.id}>{scorer.scorer_name}<em role="img" aria-label={`${scorer.goals}골`}>{"⚽️".repeat(scorer.goals)}</em></span>)}</p>;
              })}
            </li>;
          })}</ol>
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
        <div className="mom-candidates">{profiles.filter((candidate) => candidate.id !== profile?.id && candidate.status === "active" && attendance.some((row) => row.event_id === votingEvent.id && row.member_id === candidate.id && isCheckedIn(row))).map((candidate) => {
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
