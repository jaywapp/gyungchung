import type { Event, Profile } from "./types";

export type MomVoteMemberStatus = "active" | "inactive" | "pending" | null;
export type MomVoteCheckInStatus = "present" | "late" | "absent" | null;
export type MomVotingWindow = { state: "unknown" | "waiting" | "open" | "closed"; opensAt: number | null; closesAt: number | null; days: number | null; defaultEnd: boolean };
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export function getMomVotingWindow(event: Pick<Event, "starts_at" | "ends_at" | "mom_voting_days">, now = Date.now()): MomVotingWindow {
  const unknown: MomVotingWindow = { state: "unknown", opensAt: null, closesAt: null, days: null, defaultEnd: false };
  const startsAt = Date.parse(event.starts_at);
  const days = event.mom_voting_days;
  if (!Number.isFinite(startsAt) || !Number.isInteger(days) || (days ?? 0) < 1 || (days ?? 31) > 30 || (event.ends_at !== null && typeof event.ends_at !== "string")) return unknown;
  const opensAt = event.ends_at === null ? startsAt + DEFAULT_EVENT_DURATION_MS : Date.parse(event.ends_at!);
  const closesAt = opensAt + days! * DAY_MS;
  if (!Number.isFinite(opensAt) || opensAt <= startsAt || !Number.isFinite(closesAt) || !Number.isFinite(now)) return unknown;
  return { state: now < opensAt ? "waiting" : now < closesAt ? "open" : "closed", opensAt, closesAt, days: days!, defaultEnd: event.ends_at === null };
}

export function getMomClockDelay(events: readonly Event[], now: number): number {
  let delay = 60_000;
  for (const event of events) {
    const window = getMomVotingWindow(event, now);
    for (const boundary of [window.opensAt, window.closesAt]) if (boundary !== null && boundary > now) delay = Math.min(delay, boundary - now);
  }
  return Math.max(1, delay);
}

export function getMomVoteScope(owner: string | null, profile: Profile | null, permissions: Iterable<string>, epoch: number): string {
  return owner && profile?.auth_user_id === owner && profile.status === "active" && !profile.must_change_password && !profile.is_test_account
    ? JSON.stringify([owner, epoch, profile.id, profile.role, profile.officer_title, profile.is_system_admin, [...permissions].sort()]) : "";
}

type MomVoteEligibilityInput = {
  isAuthenticated: boolean; isLinked: boolean; mustChangePassword: boolean; isTestAccount: boolean;
  memberStatus: MomVoteMemberStatus; window: MomVotingWindow; checkInStatus: MomVoteCheckInStatus;
};
export type MomVoteEligibility = { canVote: boolean; reason: string | null; action: "login" | null };
export function getMomVoteEligibility({ isAuthenticated, isLinked, mustChangePassword, isTestAccount, memberStatus, window, checkInStatus }: MomVoteEligibilityInput): MomVoteEligibility {
  if (!isAuthenticated) return { canVote: false, reason: "Player of the Match 투표는 로그인 후 참여할 수 있습니다.", action: "login" };
  if (!isLinked || memberStatus !== "active" || mustChangePassword || isTestAccount) return { canVote: false, reason: "활동 회원이 초기 비밀번호를 변경한 뒤 투표할 수 있습니다. 계정 상태는 운영진에게 문의해 주세요.", action: null };
  if (window.state === "unknown") return { canVote: false, reason: "투표 기간을 확인하지 못했습니다. 일정을 다시 불러와 주세요.", action: null };
  if (window.state === "waiting") return { canVote: false, reason: "투표는 일정이 종료된 후 시작됩니다.", action: null };
  if (window.state === "closed") return { canVote: false, reason: "투표가 마감되었습니다. 현재 선택을 변경할 수 없습니다.", action: null };
  if (checkInStatus === "absent") return { canVote: false, reason: "결석으로 기록되어 투표에 참여할 수 없습니다. 기록이 잘못됐다면 운영진에게 문의해 주세요.", action: null };
  if (checkInStatus !== "present" && checkInStatus !== "late") return { canVote: false, reason: "출석이 아직 기록되지 않았습니다. 운영진에게 출석 체크를 요청해 주세요.", action: null };
  return { canVote: true, reason: null, action: null };
}

type MomVoteCandidateInput = { candidateProfileId: string; candidateStatus: MomVoteMemberStatus; candidateIsTest?: boolean; voterProfileId: string | null; checkInStatus: MomVoteCheckInStatus };
export function isMomVoteCandidate({ candidateProfileId, candidateStatus, candidateIsTest, voterProfileId, checkInStatus }: MomVoteCandidateInput) {
  return candidateProfileId !== voterProfileId && candidateStatus === "active" && !candidateIsTest && (checkInStatus === "present" || checkInStatus === "late");
}

export function getEventTimingPayload(startsInput: string, endsInput: string, daysInput: string) {
  const starts = new Date(startsInput);
  const ends = endsInput ? new Date(endsInput) : null;
  const days = Number(daysInput);
  if (!Number.isFinite(starts.getTime())) throw new Error("유효한 시작 시간을 선택해 주세요.");
  if (ends && (!Number.isFinite(ends.getTime()) || ends.getTime() <= starts.getTime())) throw new Error("종료 시간은 시작 시간보다 뒤여야 합니다.");
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("POTM 투표 기간은 1~30일의 정수로 입력해 주세요.");
  return { starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null, mom_voting_days: days };
}

export function shiftEventTiming<T extends { starts_at: string; ends_at: string | null }>(event: T, startsAt: Date): T {
  const offset = startsAt.getTime() - Date.parse(event.starts_at);
  return { ...event, starts_at: startsAt.toISOString(), ends_at: event.ends_at === null ? null : new Date(Date.parse(event.ends_at) + offset).toISOString() };
}

export function momVoteErrorMessage(cause: unknown): string {
  const value = (cause ?? {}) as { code?: string; message?: string };
  const message = String(value.message ?? "").toLowerCase();
  if (value.code === "40001" || /voting.*(?:closed|window|period)|(?:potm|mom).*closed/.test(message)) return "투표 기간이 변경되었거나 마감되었습니다. 일정을 다시 불러온 뒤 확인해 주세요.";
  if (value.code === "42501") return "투표 자격 또는 관리 권한이 변경되었습니다. 계정과 출석 정보를 다시 불러온 뒤 확인해 주세요.";
  if (["23502", "23503", "23505", "23514", "22007", "22008", "22023", "22P02", "42703", "42P01", "PGRST202", "PGRST204"].includes(value.code ?? "")) return "투표가 저장되지 않았습니다. 계정·출석·투표 기간을 다시 불러온 뒤 확인해 주세요.";
  return "저장 결과를 확인하지 못했습니다. 투표 정보를 다시 불러와 현재 선택을 확인해 주세요.";
}
