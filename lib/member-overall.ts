import type { EventTeam, Profile } from "./types";

export const overallAxes = [
  { key: "pace", label: "속도" },
  { key: "shooting", label: "슈팅" },
  { key: "passing", label: "패스" },
  { key: "dribbling", label: "드리블" },
  { key: "defending", label: "수비" },
  { key: "physical", label: "피지컬" },
] as const;
export type OverallAxis = typeof overallAxes[number]["key"];
export type MemberOverallScores = Record<OverallAxis, number>;
export type MemberOverall = MemberOverallScores & { member_id: string; revision: number; updated_at: string };
export type OverallAccess = {
  scope: string;
  version: number;
  isCurrent: () => boolean;
  read: (ids: string[], current: () => boolean) => Promise<MemberOverall[]>;
  save: (id: string, scores: MemberOverallScores, expectedRevision: number, current: () => boolean) => Promise<MemberOverall>;
};
export type MemberOverallErrorKind = "forbidden" | "invalid" | "conflict" | "unknown" | "unavailable";
const errorMessages: Record<MemberOverallErrorKind, string> = {
  forbidden: "능력치 접근 권한이 없습니다. 권한을 확인한 뒤 다시 열어 주세요.",
  invalid: "6개 능력치를 모두 1~100 사이의 정수로 입력해 주세요.",
  conflict: "다른 운영진이 능력치를 수정했습니다. 최신 값을 확인한 뒤 다시 입력해 주세요.",
  unknown: "저장 결과를 확인하지 못했습니다. 최신 값을 다시 불러와 확인해 주세요.",
  unavailable: "능력치를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
};
export class MemberOverallError extends Error {
  constructor(public readonly kind: MemberOverallErrorKind, message = errorMessages[kind]) { super(message); this.name = "MemberOverallError"; }
}
export function isOverallScores(value: unknown): value is MemberOverallScores {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scores = value as Record<string, unknown>;
  return Object.keys(scores).length === overallAxes.length && overallAxes.every(({ key }) => typeof scores[key] === "number" && Number.isInteger(scores[key]) && Number(scores[key]) >= 1 && Number(scores[key]) <= 100);
}
export function parseOverallInputs(inputs: Record<OverallAxis, string>): MemberOverallScores {
  const scores = Object.fromEntries(overallAxes.map(({ key }) => [key, /^\d{1,3}$/.test(inputs[key]) ? Number(inputs[key]) : NaN]));
  if (!isOverallScores(scores)) throw new MemberOverallError("invalid");
  return scores;
}
export function parseMemberOverall(value: unknown): MemberOverall {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberOverallError("unknown");
  const row = value as Record<string, unknown>;
  const scores = Object.fromEntries(overallAxes.map(({ key }) => [key, row[key]]));
  if (!isOverallScores(scores) || typeof row.member_id !== "string" || !row.member_id.trim() || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.updated_at) || !Number.isFinite(Date.parse(row.updated_at))) throw new MemberOverallError("unknown");
  return { ...scores, member_id: row.member_id, revision: Number(row.revision), updated_at: row.updated_at };
}
export function parseMemberOverallRows(value: unknown, ids?: readonly string[]): MemberOverall[] {
  if (!Array.isArray(value)) throw new MemberOverallError("unknown");
  const rows = value.map(parseMemberOverall);
  if (new Set(rows.map((row) => row.member_id)).size !== rows.length || (ids && rows.some((row) => !ids.includes(row.member_id)))) throw new MemberOverallError("unknown");
  return rows;
}
export function memberOverall(scores: MemberOverallScores): number {
  return Math.round(overallAxes.reduce((sum, { key }) => sum + scores[key], 0) / overallAxes.length);
}
export function overallTargetSignature(member: Profile): string {
  return JSON.stringify([member.id, member.auth_user_id, member.status, member.is_test_account]);
}
export function overallTargetsSignature(ids: readonly string[], profiles: readonly Profile[]): string {
  const index = new Map(profiles.map((profile) => [profile.id, profile]));
  return JSON.stringify(ids.map((id) => { const member = index.get(id); return member ? [id, overallTargetSignature(member)] : [id, "missing"]; }));
}
export function radarPoint(index: number, value: number, radius = 80): { x: number; y: number } {
  const angle = index * Math.PI / 3 - Math.PI / 2;
  return { x: 130 + Math.cos(angle) * radius * value / 100, y: 130 + Math.sin(angle) * radius * value / 100 };
}
export function radarPolygon(scores: MemberOverallScores): string {
  return overallAxes.map(({ key }, index) => { const { x, y } = radarPoint(index, scores[key]); return `${x.toFixed(2)},${y.toFixed(2)}`; }).join(" ");
}
export function summarizeTeamOverall(team: EventTeam, rows: readonly MemberOverall[]) {
  const index = new Map(rows.map((row) => [row.member_id, row]));
  const members = team.event_team_members.map((member) => ({ member, overall: member.profile_id && !member.guest_player_id ? index.get(member.profile_id) ?? null : null }));
  const rated = members.flatMap(({ overall }) => overall ? [memberOverall(overall)] : []);
  return { members, total: members.length, rated: rated.length, unrated: members.length - rated.length, average: rated.length ? Math.round(rated.reduce((sum, value) => sum + value, 0) / rated.length * 10) / 10 : null };
}
