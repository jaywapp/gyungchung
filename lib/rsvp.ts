import type { EventCapacity } from "@/lib/event-capacity";
import type { Attendance, Profile } from "@/lib/types";

export type RsvpStatus = Attendance["status"] | null;
export type RsvpViewState = "loading" | "signed_out" | "unavailable" | "closed" | "saving" | "ready";

type RsvpViewModelInput = {
  isAuthenticated: boolean;
  memberStatus: Profile["status"] | null;
  startsAt: string;
  status: RsvpStatus;
  isLoading?: boolean;
  isSaving?: boolean;
  now?: number;
  membershipRestrictionCopy?: {
    label: string;
    action: string;
  };
};

export type RsvpViewModel = {
  state: RsvpViewState;
  label: string;
  message: string;
  canRespond: boolean;
};

export function getRsvpStatusLabel(status: RsvpStatus) {
  if (status === "going") return "참석";
  if (status === "not_going") return "불참";
  return "응답 없음";
}

/** Every RSVP surface reads the same authentication, membership, and deadline states. */
export function getRsvpViewModel({ isAuthenticated, memberStatus, startsAt, status, isLoading = false, isSaving = false, now = Date.now(), membershipRestrictionCopy }: RsvpViewModelInput): RsvpViewModel {
  const label = getRsvpStatusLabel(status);
  if (isLoading) return { state: "loading", label: "확인 중", message: "참석 상태를 확인하고 있습니다.", canRespond: false };
  if (new Date(startsAt).getTime() <= now) return { state: "closed", label, message: "일정이 시작되어 참석 응답이 마감되었습니다.", canRespond: false };
  if (!isAuthenticated) return { state: "signed_out", label: "로그인 필요", message: "로그인 후 참석 여부를 등록할 수 있습니다.", canRespond: false };
  if (!memberStatus) return { state: "unavailable", label: "회원 연결 필요", message: "운영진에게 회원 프로필 연결을 요청해 주세요.", canRespond: false };
  if (memberStatus !== "active") {
    return {
      state: "unavailable",
      label: membershipRestrictionCopy?.label ?? "회원 이용 제한",
      message: membershipRestrictionCopy?.action ?? "운영진에게 회원 상태를 문의해 주세요.",
      canRespond: false,
    };
  }
  if (isSaving) return { state: "saving", label, message: "변경 내용을 저장하는 중입니다. 잠시 기다려 주세요.", canRespond: false };
  return { state: "ready", label, message: status === "going" ? "참석 예정으로 등록되어 있습니다." : status === "not_going" ? "불참으로 등록되어 있습니다." : "참석 또는 불참을 선택해 주세요.", canRespond: true };
}

/** A mutable ref uses this guard so two clicks in one render cannot start duplicate requests. */
export function beginRsvpSave(pendingEventIds: Set<string>, eventId: string) {
  if (pendingEventIds.has(eventId)) return false;
  pendingEventIds.add(eventId);
  return true;
}

export function getRsvpCapacityWarning(capacity: EventCapacity) {
  if (capacity.status === "full") return "현재 정원이 모두 찼습니다. 참석으로 등록하면 정원을 1명 초과하게 됩니다. 그래도 등록할까요?";
  if (capacity.status === "over_capacity") {
    const currentOverflow = Math.abs(capacity.remaining ?? 0);
    return `현재 정원을 ${currentOverflow}명 초과했습니다. 참석으로 등록하면 ${currentOverflow + 1}명 초과하게 됩니다. 그래도 등록할까요?`;
  }
  return null;
}

function replaceAttendanceRow(rows: Attendance[], eventId: string, memberId: string, replacement?: Attendance) {
  const remainingRows = rows.filter((row) => row.event_id !== eventId || row.member_id !== memberId);
  return replacement ? [...remainingRows, replacement] : remainingRows;
}

/** Optimistic changes preserve check-in metadata that an officer may already have recorded. */
export function applyRsvpStatus(rows: Attendance[], eventId: string, memberId: string, status: Attendance["status"]) {
  const existing = rows.find((row) => row.event_id === eventId && row.member_id === memberId);
  return replaceAttendanceRow(rows, eventId, memberId, {
    event_id: eventId,
    member_id: memberId,
    status,
    check_in_status: existing?.check_in_status ?? null,
    checked_in_at: existing?.checked_in_at ?? null,
    checked_in_by: existing?.checked_in_by ?? null,
  });
}

export function restoreRsvpStatus(rows: Attendance[], eventId: string, memberId: string, previous?: Attendance) {
  return replaceAttendanceRow(rows, eventId, memberId, previous);
}
