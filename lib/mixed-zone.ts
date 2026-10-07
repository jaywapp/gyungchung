import type { Attendance, Event, Profile } from "./types";
import { getCheckInStatus } from "./attendance";
import { overallAxes, type MemberOverallScores, type OverallAxis } from "./member-overall";

export type MixedZoneScores = MemberOverallScores;
export type MixedZoneInputs = Record<OverallAxis, number | null>;
export type MixedZoneEntry = MixedZoneScores & { event_id: string; member_id: string; revision: number; updated_at: string };
export type MixedZoneWindow = { state: "unknown" | "waiting" | "open" | "closed"; opensAt: number | null; closesAt: number | null; days: number | null };
export type MixedZoneAccess = {
  scope: string;
  version: number;
  isCurrent: () => boolean;
  refreshWindow: () => Promise<void>;
  read: (eventId: string, current: () => boolean) => Promise<MixedZoneEntry[]>;
  save: (eventId: string, memberId: string, scores: MixedZoneScores, revision: number, current: () => boolean) => Promise<MixedZoneEntry>;
};
export type MixedZoneErrorKind = "forbidden" | "invalid" | "conflict" | "unknown" | "unavailable";
const messages: Record<MixedZoneErrorKind, string> = {
  forbidden: "믹스트존 작성 자격이 변경되었습니다. 계정·출석 정보를 다시 불러와 주세요.",
  invalid: "여섯 항목을 모두 1~5점으로 선택해 주세요.",
  conflict: "작성 기간이나 저장 내용이 변경되었습니다. 최신 내용을 다시 불러온 뒤 확인해 주세요.",
  unknown: "저장 결과를 확인하지 못했습니다. 내가 작성한 내용을 다시 불러와 확인해 주세요.",
  unavailable: "내가 작성한 내용을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
export class MixedZoneError extends Error {
  constructor(public readonly kind: MixedZoneErrorKind, message = messages[kind]) { super(message); this.name = "MixedZoneError"; }
}
export function emptyMixedZoneInputs(): MixedZoneInputs {
  return Object.fromEntries(overallAxes.map(({ key }) => [key, null])) as MixedZoneInputs;
}
export function isMixedZoneScores(value: unknown): value is MixedZoneScores {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scores = value as Record<string, unknown>;
  return Object.keys(scores).length === 6 && overallAxes.every(({ key }) => typeof scores[key] === "number" && Number.isInteger(scores[key]) && Number(scores[key]) >= 1 && Number(scores[key]) <= 5);
}
export function parseMixedZoneEntry(value: unknown): MixedZoneEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MixedZoneError("unknown");
  const row = value as Record<string, unknown>;
  const scores = Object.fromEntries(overallAxes.map(({ key }) => [key, row[key]]));
  if (!isMixedZoneScores(scores) || typeof row.event_id !== "string" || !row.event_id.trim() || typeof row.member_id !== "string" || !row.member_id.trim() || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.updated_at) || !Number.isFinite(Date.parse(row.updated_at))) throw new MixedZoneError("unknown");
  return { ...scores, event_id: row.event_id, member_id: row.member_id, revision: Number(row.revision), updated_at: row.updated_at };
}
export function parseMixedZoneRows(value: unknown, eventId: string): MixedZoneEntry[] {
  if (!Array.isArray(value)) throw new MixedZoneError("unknown");
  const rows = value.map(parseMixedZoneEntry);
  if (rows.some((row) => row.event_id !== eventId) || new Set(rows.map((row) => row.member_id)).size !== rows.length) throw new MixedZoneError("unknown");
  return rows;
}
export function getMixedZoneWindow(event: Pick<Event, "starts_at" | "ends_at" | "mixed_zone_days">, now = Date.now()): MixedZoneWindow {
  const unknown: MixedZoneWindow = { state: "unknown", opensAt: null, closesAt: null, days: null };
  const startsAt = Date.parse(event.starts_at), days = event.mixed_zone_days;
  if (!Number.isFinite(startsAt) || !Number.isInteger(days) || (days ?? 0) < 1 || (days ?? 31) > 30 || (event.ends_at !== null && typeof event.ends_at !== "string")) return unknown;
  const opensAt = event.ends_at === null ? startsAt + 2 * 60 * 60 * 1000 : Date.parse(event.ends_at!);
  const closesAt = opensAt + days! * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(opensAt) || opensAt <= startsAt || !Number.isFinite(now) || !Number.isFinite(closesAt)) return unknown;
  return { state: now < opensAt ? "waiting" : now < closesAt ? "open" : "closed", opensAt, closesAt, days: days! };
}
export function mixedZoneMemberSignature(member: Profile | null): string {
  return JSON.stringify(member && [member.id, member.auth_user_id, member.status, member.must_change_password, member.is_test_account]);
}
export function mixedZoneEventSignature(event: Event): string {
  return JSON.stringify([event.id, event.starts_at, event.ends_at, event.mixed_zone_days]);
}
export function isMixedZoneActor(member: Profile | null, owner: string | null): boolean {
  return Boolean(owner && member?.auth_user_id === owner && member.status === "active" && !member.must_change_password && !member.is_test_account);
}
export function isMixedZoneTarget(member: Profile, actorId: string | null, eventId: string, attendance: readonly Attendance[]): boolean {
  const status = getCheckInStatus(attendance.find((row) => row.event_id === eventId && row.member_id === member.id));
  return member.id !== actorId && member.status === "active" && !member.is_test_account && (status === "present" || status === "late");
}
export function mixedZoneEligibility(member: Profile | null, owner: string | null, event: Event, attendance: readonly Attendance[], now: number): { canRead: boolean; canWrite: boolean; reason: string | null } {
  if (!isMixedZoneActor(member, owner)) return { canRead: false, canWrite: false, reason: "활동 회원이 로그인하고 초기 비밀번호를 변경한 뒤 작성할 수 있습니다." };
  const status = getCheckInStatus(attendance.find((row) => row.event_id === event.id && row.member_id === member!.id));
  if (status !== "present" && status !== "late") return { canRead: false, canWrite: false, reason: "이 일정에 출석·지각으로 기록된 회원만 작성할 수 있습니다. 기록이 잘못됐다면 운영진에게 문의해 주세요." };
  const window = getMixedZoneWindow(event, now);
  if (window.state === "unknown") return { canRead: true, canWrite: false, reason: "작성 기간을 확인하지 못했습니다. 일정을 다시 불러와 주세요." };
  if (window.state === "waiting") return { canRead: true, canWrite: false, reason: "일정 종료 후 믹스트존 작성이 시작됩니다." };
  if (window.state === "closed") return { canRead: true, canWrite: false, reason: "작성이 마감되었습니다. 내가 작성한 내용은 계속 확인할 수 있습니다." };
  return { canRead: true, canWrite: true, reason: null };
}
