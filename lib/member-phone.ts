import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

export function getMemberPhoneScope(owner: string | null, profile: Profile | null, permissions: Iterable<string>, epoch: number): string {
  return owner && profile?.auth_user_id === owner && profile.status === "active" && !profile.must_change_password && !profile.is_test_account
    ? JSON.stringify([owner, epoch, profile.id, profile.role, profile.officer_title, profile.is_system_admin, [...permissions].sort()]) : "";
}

export function normalizeMemberPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  if (!phone || !/^\+?[0-9 ()-]+$/.test(phone)) return null;
  const compact = phone.replace(/[ ()-]/g, "");
  const normalized = compact.startsWith("82") ? `+${compact}` : compact;
  return /^\+?[0-9]{7,15}$/.test(normalized) ? `tel:${normalized}` : null;
}

export class MemberPhoneError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function lookupMemberPhone(client: SupabaseClient, memberId: string, isCurrent: () => boolean): Promise<string | null> {
  const check = () => { if (!isCurrent()) throw new MemberPhoneError("stale", "계정 상태가 변경되었습니다. 회원 목록에서 다시 시도해 주세요."); };
  check();
  let response;
  try { response = await client.rpc("get_member_phone", { p_member_id: memberId }); }
  catch { check(); throw new MemberPhoneError("network", "전화번호를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요."); }
  check();
  if (response.error) throw new MemberPhoneError("read", "전화번호를 불러오지 못했습니다. 계정 상태와 연결을 확인한 뒤 다시 시도해 주세요.");
  if (response.data === null || response.data === "") return null;
  const uri = normalizeMemberPhone(response.data);
  if (!uri) throw new MemberPhoneError("invalid", "등록된 전화번호를 사용할 수 없습니다. 운영진에게 연락처 확인을 요청해 주세요.");
  return uri;
}

/** The browser hands the URI to the operating system only from an explicit click. */
export function openMemberPhone(uri: string): void {
  if (!uri.startsWith("tel:") || normalizeMemberPhone(uri.slice(4)) !== uri) throw new MemberPhoneError("invalid", "전화번호를 사용할 수 없습니다. 다시 불러와 주세요.");
  window.location.assign(uri);
}
