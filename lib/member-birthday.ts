import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

export type Birthday = { birthday_month: number | null; birthday_day: number | null; birthday_revision: number };
export type BirthdayState = "restricted" | "loading" | "error" | "unknown" | "missing" | "registered";

export function isBirthdayEligible(profile: Profile | null | undefined, owner?: string | null): boolean {
  return Boolean(profile?.auth_user_id && profile.status === "active" && !profile.must_change_password && !profile.is_test_account && (owner === undefined || profile.auth_user_id === owner));
}

export function birthdayDaysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function isValidBirthday(month: unknown, day: unknown): boolean {
  return typeof month === "number" && typeof day === "number" && Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= birthdayDaysInMonth(month);
}

export function hasBirthdayFields(profile: Partial<Profile> | undefined): boolean {
  return Boolean(profile && Object.hasOwn(profile, "birthday_month") && Object.hasOwn(profile, "birthday_day") && Object.hasOwn(profile, "birthday_revision") && Number.isSafeInteger(profile.birthday_revision) && (profile.birthday_revision ?? -1) >= 0 && ((profile.birthday_month === null && profile.birthday_day === null) || isValidBirthday(profile.birthday_month, profile.birthday_day)));
}

export function mergeOwnBirthday(profile: Profile | null, directory: readonly Profile[], owner: string): Profile | null {
  if (!profile) return null;
  const original = { ...profile };
  delete original.birthday_month; delete original.birthday_day; delete original.birthday_revision;
  const own = directory.find((row) => row.id === profile.id);
  return isBirthdayEligible(profile, owner) && own?.status === "active" && !own.is_test_account && !own.must_change_password && hasBirthdayFields(own)
    ? { ...original, birthday_month: own!.birthday_month, birthday_day: own!.birthday_day, birthday_revision: own!.birthday_revision }
    : original;
}

export function getBirthdayState(owner: string | null, profile: Profile | null, loading: boolean, failed: boolean): BirthdayState {
  if (!owner || !isBirthdayEligible(profile, owner)) return "restricted";
  if (loading) return "loading";
  if (failed) return "error";
  if (!hasBirthdayFields(profile ?? undefined)) return "unknown";
  return profile!.birthday_month === null ? "missing" : "registered";
}

export function buildBirthdayIndex(profiles: readonly Profile[], year: number): Map<string, Profile[]> {
  const result = new Map<string, Profile[]>();
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  for (const profile of profiles) {
    // The guarded directory projects no auth or password fields. Explicit private restrictions still win.
    if (profile.status !== "active" || profile.is_test_account || profile.must_change_password || profile.auth_user_id === null || !Object.hasOwn(profile, "birthday_revision") || !isValidBirthday(profile.birthday_month, profile.birthday_day)) continue;
    const day = profile.birthday_month === 2 && profile.birthday_day === 29 && !leap ? 28 : profile.birthday_day!;
    const key = `${year}${String(profile.birthday_month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
    const members = result.get(key) ?? [];
    members.push(profile); result.set(key, members);
  }
  for (const members of result.values()) members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return result;
}

export class BirthdayRequestError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function saveMyBirthday(client: SupabaseClient, options: {
  month: number | null; day: number | null; revision: number; isCurrent: () => boolean;
}): Promise<Birthday> {
  const check = () => { if (!options.isCurrent()) throw new BirthdayRequestError("stale", "계정 상태가 변경되었습니다. 다시 로그인해 주세요."); };
  check();
  if (!Number.isSafeInteger(options.revision) || options.revision < 0 || !((options.month === null && options.day === null) || isValidBirthday(options.month, options.day))) throw new BirthdayRequestError("input", "유효한 생일 월과 일을 선택해 주세요.");
  let response;
  try { response = await client.rpc("set_my_birthday", { p_month: options.month, p_day: options.day, p_expected_revision: options.revision }); }
  catch { check(); throw new BirthdayRequestError("unknown", "생일 저장 상태를 확인하지 못했습니다. 다시 불러온 뒤 확인해 주세요."); }
  check();
  if (response.error) throw new BirthdayRequestError(response.error.code ?? "unknown", response.error.code === "40001"
    ? "다른 곳에서 생일이 변경되었습니다. 다시 불러온 뒤 수정해 주세요."
    : "생일 저장 상태를 확인하지 못했습니다. 연결과 계정 상태를 확인한 뒤 다시 불러와 주세요.");
  const row = Array.isArray(response.data) && response.data.length === 1 ? response.data[0] : null;
  if (!hasBirthdayFields(row ?? undefined) || row.birthday_month !== options.month || row.birthday_day !== options.day || row.birthday_revision !== options.revision + 1) throw new BirthdayRequestError("unknown", "생일 저장 결과를 확인하지 못했습니다. 다시 불러온 뒤 확인해 주세요.");
  return row as Birthday;
}
