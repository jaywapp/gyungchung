"use client";

import { useId } from "react";
import { getMembershipRestrictionCopy } from "@/lib/account-state";
import type { EventCapacity } from "@/lib/event-capacity";
import { getRsvpViewModel, type RsvpStatus } from "@/lib/rsvp";
import type { Attendance, Profile } from "@/lib/types";

type RsvpControlsProps = {
  eventTitle: string;
  startsAt: string;
  status: RsvpStatus;
  isAuthenticated: boolean;
  memberStatus: Profile["status"] | null;
  isLoading: boolean;
  isSaving: boolean;
  onChange: (status: Attendance["status"]) => void;
  onLogin: () => void;
};

export function RsvpControls({ eventTitle, startsAt, status, isAuthenticated, memberStatus, isLoading, isSaving, onChange, onLogin }: RsvpControlsProps) {
  const stateId = useId();
  const membershipRestrictionCopy = memberStatus && memberStatus !== "active" ? getMembershipRestrictionCopy(memberStatus) : undefined;
  const view = getRsvpViewModel({ isAuthenticated, memberStatus, startsAt, status, isLoading, isSaving, membershipRestrictionCopy });
  const showActions = view.state !== "loading" && view.state !== "signed_out";
  const actionsDisabled = !view.canRespond;

  return <div className={`rsvp-control ${view.state}`} aria-busy={isSaving}>
    <p id={stateId} className="rsvp-state" role="status" aria-live="polite" aria-atomic="true"><b>현재 응답 · {view.label}</b><span>{view.message}</span></p>
    {view.state === "signed_out" && <button type="button" className="cta small rsvp-login" onClick={onLogin}>로그인하고 응답하기</button>}
    {showActions && <div className="rsvp-actions" role="group" aria-label={`${eventTitle} 참석 여부`} aria-describedby={stateId}>
      <button type="button" className={status === "going" ? "selected" : undefined} aria-pressed={status === "going"} disabled={actionsDisabled || status === "going"} onClick={() => onChange("going")}>{isSaving && status === "going" ? "참석 저장 중" : "참석"}</button>
      <button type="button" className={status === "not_going" ? "selected no" : undefined} aria-pressed={status === "not_going"} disabled={actionsDisabled || status === "not_going"} onClick={() => onChange("not_going")}>{isSaving && status === "not_going" ? "불참 저장 중" : "불참"}</button>
      <button type="button" className="cancel" disabled={actionsDisabled || status === null || status === "undecided"} onClick={() => onChange("undecided")}>응답 취소</button>
    </div>}
  </div>;
}

export function CapacityStatus({ capacity, detail = false }: { capacity: EventCapacity; detail?: boolean }) {
  const description = capacity.status === "unlimited"
    ? `현재 ${capacity.totalCount}명 · 용병 포함`
    : capacity.status === "over_capacity"
      ? `정원 ${Math.abs(capacity.remaining ?? 0)}명 초과 · 용병 포함`
      : capacity.status === "full"
        ? "정원 도달 · 용병 포함"
        : `${capacity.status === "nearly_full" ? "임박 · " : ""}잔여 ${capacity.remaining}자리 · 용병 포함`;
  return <span className={`capacity-status ${capacity.status}${detail ? " detail" : ""}`}><b>{capacity.capacity === null ? "정원 제한 없음" : `참석 ${capacity.totalCount} / 정원 ${capacity.capacity}명`}</b><small>{description}</small></span>;
}
