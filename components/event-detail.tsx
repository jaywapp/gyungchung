"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, ChevronLeft, ClipboardCheck, Clock3, MapPin, MoreHorizontal, Pencil, Shield, Trash2, Trophy, Users, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Profile } from "@/lib/types";
import { getCheckInStatus } from "@/lib/attendance";
import { getEventCapacity } from "@/lib/event-capacity";
import { toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { parseEventDateKey, toEventDateKey } from "@/lib/event-date";
import { getMomVoteEligibility, isMomVoteCandidate } from "@/lib/mom-vote";
import { RsvpControls } from "@/components/rsvp-controls";
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
  rsvpPendingEventIds: Set<string>;
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
export default function EventDetail({ dateKey, events, profiles, attendance, momVotes, momResults, user, profile, supabase, loading, loadError, sessionPending, rsvpPendingEventIds, canManage, onEdit, onManageMatch, onManageAttendance, onDelete, onAttendance, onLogin, onRetry, reload, toast }: EventDetailProps) {
  const [votingEvent, setVotingEvent] = useState<Event | null>(null);
  const [openManagementMenuId, setOpenManagementMenuId] = useState<string | null>(null);
  const [submittingMomCandidateId, setSubmittingMomCandidateId] = useState<string | null>(null);
  const submittingMomVoteRef = useRef(false);
  const momDialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: () => setVotingEvent(null), active: Boolean(votingEvent) });
  const date = parseEventDateKey(dateKey);
  const dayEvents = useMemo(
    () => events.filter((event) => toEventDateKey(event.starts_at) === dateKey).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [dateKey, events],
  );

  useEffect(() => {
    if (!openManagementMenuId) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(".event-management-menu")) setOpenManagementMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenManagementMenuId(null);
    };
    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openManagementMenuId]);

  useEffect(() => {
    if (loading || dayEvents.length === 0 || new URLSearchParams(window.location.search).get("section") !== "teams") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("teams")?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [dateKey, dayEvents.length, loading]);

  const submitMomVote = async (candidateProfileId: string) => {
    if (!user || !profile || !votingEvent || !supabase || submittingMomVoteRef.current) return;
    submittingMomVoteRef.current = true;
    setSubmittingMomCandidateId(candidateProfileId);
    try {
      const { error } = await supabase.from("event_mom_votes").upsert({ event_id: votingEvent.id, voter_id: profile.id, candidate_profile_id: candidateProfileId }, { onConflict: "event_id,voter_id" });
      if (error) return toast(toErrorMessage(error), "error");
      setVotingEvent(null); toast("MOM 투표를 저장했습니다."); reload();
    } finally {
      submittingMomVoteRef.current = false;
      setSubmittingMomCandidateId(null);
    }
  };

  const back = <Link className="detail-back" href="/events"><ChevronLeft size={16} /> 일정 목록</Link>;
  if (loading) return <section className="content event-detail-page">{back}<SectionSkeleton label="일정을 불러오는 중" /></section>;
  if (loadError) return <section className="content event-detail-page">{back}<LoadError onRetry={onRetry} /></section>;
  if (!date || dayEvents.length === 0) return <section className="content event-detail-page">{back}<Empty icon={<CalendarDays />} title="이 날짜에는 등록된 일정이 없습니다" description="주소를 다시 확인하거나 일정 목록에서 원하는 날짜를 선택해 주세요." /></section>;

  const dayIsPast = dayEvents.every((event) => new Date(event.starts_at) < new Date());
  const votingCandidates = votingEvent ? profiles.filter((candidate) => isMomVoteCandidate({
    candidateProfileId: candidate.id,
    candidateStatus: candidate.status,
    voterProfileId: profile?.id ?? null,
    checkInStatus: getCheckInStatus(attendance.find((row) => row.event_id === votingEvent.id && row.member_id === candidate.id)),
  })) : [];

  return <section className="content event-detail-page">
    {back}
    <header className="detail-headline">
      <span className="eyebrow">{date.getFullYear()} · {date.getMonth() + 1}월 · WEEKLY FUTSAL</span>
      <h1><time dateTime={`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`}>{date.getMonth() + 1}월 {date.getDate()}일</time> <span>{date.toLocaleDateString("ko-KR", { weekday: "long" })}</span></h1>
      <p>일정 {dayEvents.length}개 · {dayIsPast ? "지난 일정" : "예정된 일정"}</p>
    </header>

    {dayEvents.map((event) => {
      const guests = event.event_guest_players ?? [];
      const teams = [...(event.event_teams ?? [])].sort((a, b) => a.team_number - b.team_number);
      const matches = [...(event.event_matches ?? [])].sort((a, b) => a.match_number - b.match_number);
      const teamNameById = new Map(teams.map((team) => [team.id, team.team_name]));
      const eventResults = momResults.filter((result) => result.event_id === event.id);
      const isPast = new Date(event.starts_at) < new Date();
      const myAttendance = attendance.find((row) => row.event_id === event.id && row.member_id === profile?.id);
      const momVoteEligibility = getMomVoteEligibility({
        isAuthenticated: Boolean(user),
        memberStatus: profile?.status ?? null,
        isPast,
        checkInStatus: getCheckInStatus(myAttendance),
      });
      const ownVote = momVotes.find((vote) => vote.event_id === event.id);
      const ownCandidate = ownVote ? profiles.find((candidate) => candidate.id === ownVote.candidate_profile_id) : null;
      const eventAttendance = attendance.filter((row) => row.event_id === event.id);
      /** A member who never RSVPed can still be checked in on the day, so the
          roster is everyone with an RSVP of 참석 or any recorded check-in. */
      const roster = eventAttendance
        .filter((row) => row.status === "going" || getCheckInStatus(row) !== null)
        .map((row) => ({ attendance: row, profile: profiles.find((item) => item.id === row.member_id) }))
        .filter((row): row is { attendance: Attendance; profile: Profile } => Boolean(row.profile))
        .sort((a, b) => a.profile.name.localeCompare(b.profile.name, "ko"));
      const goingCount = eventAttendance.filter((row) => row.status === "going").length;
      const capacity = getEventCapacity(event.capacity, goingCount, guests.length);
      const presentCount = eventAttendance.filter((row) => getCheckInStatus(row) === "present").length;
      const lateCount = eventAttendance.filter((row) => getCheckInStatus(row) === "late").length;
      const absentCount = eventAttendance.filter((row) => getCheckInStatus(row) === "absent").length;
      const checkedCount = roster.filter((row) => getCheckInStatus(row.attendance) !== null).length;
      const scoredTeams = teams.filter((team) => team.score !== null);
      const maxScore = scoredTeams.length ? Math.max(...scoredTeams.map((team) => team.score ?? 0)) : null;
      const winnerCount = maxScore === null ? 0 : scoredTeams.filter((team) => team.score === maxScore).length;
      const rosterVisible = Boolean(user && profile?.status === "active");
      const teamMemberCount = teams.reduce((sum, team) => sum + team.event_team_members.length, 0);
      const myTeamNames = profile ? teams.filter((team) => team.event_team_members.some((member) => member.profile_id === profile.id)).map((team) => team.team_name) : [];
      const eventDate = new Date(event.starts_at);
      const eventDateLabel = eventDate.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
      const eventTimeLabel = eventDate.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true });
      const minutesUntilStart = (eventDate.getTime() - Date.now()) / 60000;
      const isStartingSoon = minutesUntilStart > 0 && minutesUntilStart <= 120;
      const attendanceProgress = capacity.capacity === null ? 0 : Math.min(100, Math.max(0, Math.round((capacity.totalCount / capacity.capacity) * 100)));
      const remainingLabel = capacity.capacity === null
        ? "정원 제한 없음"
        : (capacity.remaining ?? 0) < 0
          ? `정원 ${Math.abs(capacity.remaining ?? 0)}명 초과`
          : `잔여 ${capacity.remaining ?? 0}자리`;
      const managementHint = isPast ? "경기 기록을 정리해 주세요." : isStartingSoon ? "경기 시작 전 출석을 확인해 주세요." : "참석 응답을 먼저 확인해 주세요.";

      return <article key={event.id} className={`event-detail${isPast ? " past" : ""}`}>
        <div className="event-detail-head">
          <div className="event-detail-title-group">
            <span className={isPast ? "status closed" : "status paid"}>{isPast ? "지난 일정" : "예정된 일정"}</span>
            <h2>{event.title}</h2>
            <div className="event-detail-schedule">
              <time dateTime={event.starts_at}><Clock3 size={16} /> {eventDateLabel} · {eventTimeLabel}</time>
              <a className="inline-map-link" href={naverMapUrl(event)} target="_blank" rel="noreferrer"><MapPin size={16} /> {event.venue}</a>
            </div>
            {(myTeamNames.length > 0 || teams.length > 0 || event.is_competitive) && <div className="event-detail-chips" aria-label="일정 특성">
              {myTeamNames.map((teamName) => <span key={teamName} className="mine">{teamName}</span>)}
              {teams.length > 0 && <span>{teams.length}팀 편성</span>}
              {event.is_competitive && <span>커피 내기</span>}
            </div>}
          </div>
          {canManage && <div className="event-management-menu">
            <button type="button" className="event-management-trigger" aria-label={`${event.title} 일정 메뉴`} aria-haspopup="menu" aria-expanded={openManagementMenuId === event.id} aria-controls={`event-management-${event.id}`} onClick={() => setOpenManagementMenuId((current) => current === event.id ? null : event.id)}><MoreHorizontal size={20} /></button>
            {openManagementMenuId === event.id && <div id={`event-management-${event.id}`} className="event-management-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpenManagementMenuId(null); onEdit(event); }}><Pencil size={15} /> 일정 수정</button>
              <button type="button" role="menuitem" onClick={() => { setOpenManagementMenuId(null); onDelete(event.id, `${date.getMonth() + 1}월 ${date.getDate()}일 · ${event.title}`); }}><Trash2 size={15} /> 일정 삭제</button>
            </div>}
          </div>}
        </div>

        {event.address && <p className="event-detail-address">{event.address}</p>}
        {event.note && <p className="event-detail-note">{event.note}</p>}

        <section className="event-detail-block event-attendance-block" aria-labelledby={`attendance-heading-${event.id}`}>
          <div className="event-section-heading">
            <div><h3 id={`attendance-heading-${event.id}`}>참석 현황</h3><p>현재 등록된 인원 기준</p></div>
            <Users size={19} aria-hidden="true" />
          </div>
          <div className="attendance-summary-figure">
            <div><strong>{capacity.totalCount}</strong>{capacity.capacity !== null && <span>/ {capacity.capacity}명</span>} {capacity.capacity === null && <span>명</span>}</div>
            <b>{remainingLabel}</b>
          </div>
          {capacity.capacity !== null && <div className="attendance-summary-progress" role="progressbar" aria-label={`참석 ${capacity.totalCount}명, 정원 ${capacity.capacity}명`} aria-valuemin={0} aria-valuemax={capacity.capacity} aria-valuenow={Math.min(capacity.totalCount, capacity.capacity)}><span style={{ width: `${attendanceProgress}%` }} /></div>}
          <div className="attendance-summary-meta"><span>참석 {goingCount}명 · 용병 {guests.length}명</span>{isPast && <span>출석 {presentCount}명 · 지각 {lateCount}명 · 결석 {absentCount}명</span>}</div>
        </section>

        <section className="event-detail-block event-response-block" aria-labelledby={`response-heading-${event.id}`}>
          <div className="event-section-heading"><div><h3 id={`response-heading-${event.id}`}>내 응답</h3><p>참석 여부를 현재 상태에 맞게 변경할 수 있습니다.</p></div><Check size={19} aria-hidden="true" /></div>
          <RsvpControls variant="detail" eventTitle={event.title} startsAt={event.starts_at} status={myAttendance?.status ?? null} isAuthenticated={Boolean(user)} memberStatus={profile?.status ?? null} isLoading={sessionPending} isSaving={rsvpPendingEventIds.has(event.id)} onChange={(status) => onAttendance(status, event.id)} onLogin={onLogin} />
        </section>

        {canManage && <section className={`event-detail-block event-management-block${isPast ? " past-priority" : isStartingSoon ? " attendance-priority" : ""}`} aria-labelledby={`management-heading-${event.id}`}>
          <div className="event-section-heading"><div><h3 id={`management-heading-${event.id}`}>경기 관리</h3><p>{managementHint}</p></div><Trophy size={19} aria-hidden="true" /></div>
          <div className="officer-menu" role="group" aria-label={`${event.title} 운영 메뉴`}><button type="button" className={`officer-menu-item${isStartingSoon ? " priority" : ""}`} aria-label={`출석 체크 · ${event.title}`} onClick={() => onManageAttendance(event)}><ClipboardCheck size={17} /> 출석 체크</button><button type="button" className={`officer-menu-item${isPast ? " priority" : ""}`} aria-label={`팀·경기 기록 · ${event.title}`} onClick={() => onManageMatch(event)}><Trophy size={17} /> 팀·경기 기록</button></div>
        </section>}

        {isPast && <section className="event-detail-block mom-vote-section">
          <h3>MOM 투표</h3>
          {sessionPending ? <SectionSkeleton label="MOM 투표 자격을 확인하는 중" /> : momVoteEligibility.canVote ? <>
            <p className="event-detail-gate">{ownVote ? <>현재 선택: <b>{ownCandidate?.name ?? "선택한 회원"}</b>. 별도 마감 없이 언제든 다시 선택할 수 있습니다.</> : "실제 출석한 활동 회원 중 본인을 제외한 한 명을 선택합니다. 투표 후에도 별도 마감 없이 다시 선택할 수 있습니다."}</p>
            <button type="button" className="text-link" onClick={() => setVotingEvent(event)}>{ownVote ? "MOM 다시 선택" : "MOM 투표하기"}</button>
          </> : <p className="event-detail-gate"><Shield size={15} /> {momVoteEligibility.reason} {momVoteEligibility.action === "login" && <button type="button" className="text-link" onClick={onLogin}>로그인</button>}</p>}
        </section>}

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
            const playersFor = (teamId: string) => (match.event_match_players ?? []).filter((player) => player.team_id === teamId);
            return <li key={match.id}>
              <div className="detail-match-score">
                <small>{match.match_number}경기</small>
                <span><b>{teamAName}</b> <strong>{match.team_a_score}:{match.team_b_score}</strong> <b>{teamBName}</b></span>
              </div>
              {[[match.team_a_id, teamAName] as const, [match.team_b_id, teamBName] as const].map(([teamId, teamName]) => {
                const scorers = scorersFor(teamId);
                const players = playersFor(teamId);
                return <div className="detail-match-team" key={teamId}>
                  {players.length > 0 && <p className="detail-match-lineup"><b>{teamName} 출전</b><span>{players.map((player) => player.player_name).join(" · ")}</span></p>}
                  {scorers.length > 0 && <p className="detail-match-scorers"><b>{teamName} 득점</b>{scorers.map((scorer) => <span key={scorer.id}>{scorer.scorer_name}<em role="img" aria-label={`${scorer.goals}골`}>{"⚽️".repeat(scorer.goals)}</em></span>)}</p>}
                </div>;
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

    {votingEvent && <div className="modal-backdrop" onClick={() => { if (!submittingMomCandidateId) setVotingEvent(null); }}>
      <div ref={momDialogRef} tabIndex={-1} className="editor mom-vote-modal" role="dialog" aria-modal="true" aria-label="MOM 투표" aria-busy={Boolean(submittingMomCandidateId)} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="닫기" disabled={Boolean(submittingMomCandidateId)} onClick={() => setVotingEvent(null)}><X /></button>
        <span className="eyebrow">MAN OF THE MATCH</span>
        <h2>MOM 투표</h2>
        <p className="form-description">MOM(Man of the Match)은 그날 경기의 최우수 선수입니다. 실제 출석한 회원 중 한 명을 선택해 주세요. 본인에게는 투표할 수 없고, 투표 후에도 별도 마감 없이 다시 선택할 수 있습니다.</p>
        {submittingMomCandidateId && <p className="form-description" role="status" aria-live="polite">MOM 투표를 저장하는 중입니다.</p>}
        {votingCandidates.length === 0 ? <p className="event-detail-gate">투표할 수 있는 다른 출석 회원이 없습니다.</p> : <div className="mom-candidates">{votingCandidates.map((candidate) => {
          const selected = momVotes.find((vote) => vote.event_id === votingEvent.id)?.candidate_profile_id === candidate.id;
          return <button type="button" key={candidate.id} className={selected ? "selected" : ""} aria-pressed={selected} disabled={Boolean(submittingMomCandidateId)} onClick={() => void submitMomVote(candidate.id)}><span>{candidate.position ?? "PLAYER"}</span><b>{candidate.name}{submittingMomCandidateId === candidate.id ? " · 저장 중" : ""}</b></button>;
        })}</div>}
      </div>
    </div>}
  </section>;
}

function naverMapUrl(event: Pick<Event, "venue" | "address">) {
  return `https://map.naver.com/p/search/${encodeURIComponent([event.venue, event.address].filter(Boolean).join(" "))}`;
}
