import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

export function getAccountState(user: User | null, profile: Profile | null) {
  if (!user) return "signed-out";
  return profile ? "member" : "unlinked";
}

export type MembershipRestriction = "pending" | "inactive";

export function getMembershipRestriction(profile: Profile | null): MembershipRestriction | null {
  if (!profile || profile.status === "active") return null;
  return profile.status;
}

export function getMembershipRestrictionCopy(restriction: MembershipRestriction) {
  return restriction === "pending"
    ? {
      label: "승인 대기",
      title: "회원 승인을 기다리고 있습니다",
      description: "승인 전에는 참석 등록, 참여 응답, 의견 작성과 활동 랭킹을 이용할 수 없습니다. 승인 상태는 운영진에게 문의해 주세요.",
      action: "운영진에게 승인 상태를 문의해 주세요.",
    }
    : {
      label: "활동 중단",
      title: "현재 회원 활동이 중단된 상태입니다",
      description: "활동 중단 중에는 참석 등록, 참여 응답, 의견 작성과 활동 랭킹을 이용할 수 없습니다. 활동 재개는 운영진에게 문의해 주세요.",
      action: "활동 재개를 원하면 운영진에게 문의해 주세요.",
    };
}
