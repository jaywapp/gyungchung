"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { getMembershipRestrictionCopy } from "@/lib/account-state";
import type { EventCapacity } from "@/lib/event-capacity";
import { getRsvpViewModel, type RsvpStatus } from "@/lib/rsvp";
import type { Attendance, Profile } from "@/lib/types";

type RsvpControlsProps = {
  variant?: "standard" | "detail";
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

export function RsvpControls({ variant = "standard", eventTitle, startsAt, status, isAuthenticated, memberStatus, isLoading, isSaving, onChange, onLogin }: RsvpControlsProps) {
  const stateId = useId();
  const membershipRestrictionCopy = memberStatus && memberStatus !== "active" ? getMembershipRestrictionCopy(memberStatus) : undefined;
  const view = getRsvpViewModel({ isAuthenticated, memberStatus, startsAt, status, isLoading, isSaving, membershipRestrictionCopy });
  const showActions = variant === "detail" ? (view.state === "ready" || view.state === "saving") : view.state !== "loading" && view.state !== "signed_out";
  const actionsDisabled = !view.canRespond;
  const isDetail = variant === "detail";
  const detailStatusLabel = view.state === "loading" ? "확인 중" : view.state === "signed_out" ? "로그인 필요" : view.state === "unavailable" ? view.label : status === "going" ? "참석 예정" : status === "not_going" ? "불참" : "응답 없음";

  return <div className={`rsvp-control${isDetail ? " detail-mode" : ""} ${view.state}`} aria-busy={isSaving}>
    <p id={stateId} className="rsvp-state" role="status" aria-live="polite" aria-atomic="true"><b>{isDetail && status === "going" && <Check size={18} aria-hidden="true" />}{isDetail ? detailStatusLabel : `현재 응답 · ${view.label}`}</b><span>{view.message}</span></p>
    {view.state === "signed_out" && <button type="button" className="cta small rsvp-login" onClick={onLogin}>로그인하고 응답하기</button>}
    {showActions && <div className="rsvp-actions" role="group" aria-label={`${eventTitle} 참석 여부`} aria-describedby={stateId}>
      {isDetail ? <>
        {status === "going" ? <button type="button" className="secondary" disabled={actionsDisabled} onClick={() => onChange("not_going")}>{isSaving ? "변경 저장 중" : "불참으로 변경"}</button> : <button type="button" className="primary" disabled={actionsDisabled} onClick={() => onChange("going")}>{isSaving ? "변경 저장 중" : status === "not_going" ? "참석으로 변경" : "참석"}</button>}
        {status === "not_going" || status === "going" ? <button type="button" className="cancel" disabled={actionsDisabled} onClick={() => onChange("undecided")}>응답 취소</button> : <button type="button" className="secondary" disabled={actionsDisabled} onClick={() => onChange("not_going")}>{isSaving ? "변경 저장 중" : "불참"}</button>}
      </> : <>
        <button type="button" className={status === "going" ? "selected" : undefined} aria-pressed={status === "going"} disabled={actionsDisabled || status === "going"} onClick={() => onChange("going")}>{isSaving && status === "going" ? "참석 저장 중" : "참석"}</button>
        <button type="button" className={status === "not_going" ? "selected no" : undefined} aria-pressed={status === "not_going"} disabled={actionsDisabled || status === "not_going"} onClick={() => onChange("not_going")}>{isSaving && status === "not_going" ? "불참 저장 중" : "불참"}</button>
        <button type="button" className="cancel" disabled={actionsDisabled || status === null || status === "undecided"} onClick={() => onChange("undecided")}>응답 취소</button>
      </>}
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
