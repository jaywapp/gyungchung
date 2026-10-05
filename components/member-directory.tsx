"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Phone, UserMinus } from "lucide-react";
import type { OfficerTitle, Profile } from "@/lib/types";
import { countByPosition, positionChipLabel, positionKeys, positionLabels, positionOf, sortDirectory, type PositionKey } from "@/lib/member-directory";
import { MemberPhoneError, openMemberPhone } from "@/lib/member-phone";
import { MemberAvatar } from "@/components/club-nav";

const officerTitleLabels: Record<OfficerTitle, string> = { president: "회장", vice_president: "부회장", treasurer: "총무" };

type DirectoryProps = {
  profiles: Profile[];
  currentUserId: string;
  canManage: boolean;
  phoneScope: string;
  isPhoneCurrent: () => boolean;
  onPhoneLookup: (memberId: string, isCurrent: () => boolean) => Promise<string | null>;
  onEdit: (profile: Profile) => void;
  onKick: (profile: Profile) => void;
};

/** Small two-up cards with a position filter: the whole squad fits in a few phone screens. */
export default function MemberDirectory({ profiles, currentUserId, canManage, phoneScope, isPhoneCurrent, onPhoneLookup, onEdit, onKick }: DirectoryProps) {
  const [phonePending, setPhonePending] = useState<string | null>(null);
  const [preparedPhone, setPreparedPhone] = useState<{ memberId: string; uri: string; isCurrent: () => boolean } | null>(null);
  const [phoneNotice, setPhoneNotice] = useState<{ memberId: string; text: string; error: boolean; isCurrent: () => boolean } | null>(null);
  const phonePendingRef = useRef<object | null>(null);
  const mountedRef = useRef(true);
  const scopeRef = useRef({ value: phoneScope, generation: 0 });
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  if (scopeRef.current.value !== phoneScope) scopeRef.current = { value: phoneScope, generation: scopeRef.current.generation + 1 };
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { phonePendingRef.current = null; setPhonePending(null); setPreparedPhone(null); setPhoneNotice(null); }, [phoneScope]);
  const requestPhone = async (profile: Profile) => {
    if (!phoneScope || !isPhoneCurrent() || phonePendingRef.current) return;
    const generation = scopeRef.current.generation;
    const current = () => mountedRef.current && generation === scopeRef.current.generation && isPhoneCurrent() && profilesRef.current.some((row) => row.id === profile.id && row.status === "active" && !row.is_test_account);
    if (!current()) return;
    const request = {};
    phonePendingRef.current = request; setPhonePending(profile.id); setPreparedPhone(null); setPhoneNotice(null);
    try {
      const uri = await onPhoneLookup(profile.id, current);
      if (!current()) return;
      if (!uri) setPhoneNotice({ memberId: profile.id, text: "등록된 전화번호가 없습니다. 운영진에게 연락처 확인을 요청해 주세요.", error: false, isCurrent: current });
      else setPreparedPhone({ memberId: profile.id, uri, isCurrent: current });
    } catch (cause) {
      if (!current()) return;
      setPhoneNotice({ memberId: profile.id, text: cause instanceof MemberPhoneError ? cause.message : "전화번호를 불러오지 못했습니다. 다시 시도해 주세요.", error: true, isCurrent: current });
    } finally {
      if (phonePendingRef.current === request) { phonePendingRef.current = null; if (mountedRef.current) setPhonePending(null); }
    }
  };
  const dialPhone = () => {
    if (!preparedPhone || !preparedPhone.isCurrent()) return;
    try {
      openMemberPhone(preparedPhone.uri);
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "전화 앱에서 발신을 선택해 주세요. 앱이 열리지 않으면 이 기기의 전화 앱 연결을 확인해 주세요.", error: false, isCurrent: preparedPhone.isCurrent });
    } catch {
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "전화 앱을 열지 못했습니다. 이 기기의 전화 앱 연결을 확인한 뒤 다시 시도해 주세요.", error: true, isCurrent: preparedPhone.isCurrent });
    }
  };
  const [filter, setFilter] = useState<PositionKey | "ALL">("ALL");
  const sorted = useMemo(() => sortDirectory(profiles), [profiles]);
  const counts = useMemo(() => countByPosition(profiles), [profiles]);
  const visible = filter === "ALL" ? sorted : sorted.filter((profile) => positionOf(profile) === filter);
  const options: [PositionKey | "ALL", string][] = [["ALL", "전체"], ...positionKeys.map((key) => [key, positionLabels[key]] as [PositionKey, string])];
  return <>
    <div className="position-filter" role="group" aria-label="포지션으로 거르기">
      {options.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<small>{counts[key]}</small></button>)}
    </div>
    {visible.length === 0 ? <p className="panel-empty directory-empty">이 포지션의 회원이 없습니다.</p> : <div className="directory-grid" aria-live="polite">{visible.map((profile) => {
      const isMe = profile.auth_user_id === currentUserId;
      const title = profile.role === "manager" ? (profile.officer_title ? officerTitleLabels[profile.officer_title] : "관리자") : null;
      const canKick = !isMe && !profile.is_system_admin;
      return <article key={profile.id} className={`directory-card${isMe ? " me" : ""}`}>
        {profile.jersey_number != null && <span className="directory-number" aria-hidden="true">{profile.jersey_number}</span>}
        <MemberAvatar profile={profile} size="lg" />
        <h2>{profile.name}{isMe && <em>나</em>}</h2>
        <div className="directory-tags">
          <span className={`pos-chip pos-${positionOf(profile)}`}>{positionChipLabel(profile)}</span>
          {title && <span className="role-badge">{title}</span>}
          {profile.is_system_admin && <span className="role-badge system">시스템 관리자</span>}
        </div>
        <small>{profile.jersey_number != null ? `No. ${profile.jersey_number} · ` : ""}{new Date(profile.joined_at).getFullYear()}년 가입</small>
        {phoneScope && <div className="directory-phone-actions" aria-busy={phonePending === profile.id}>
          {preparedPhone?.memberId === profile.id && preparedPhone.isCurrent() ? <button type="button" className="text-link" aria-label={`${profile.name} 전화 앱 열기`} onClick={dialPhone}><Phone size={15} /> 전화 앱 열기</button> : <button type="button" className="text-link" aria-label={`${profile.name}에게 전화걸기`} disabled={phonePending !== null} onClick={() => void requestPhone(profile)}><Phone size={15} /> {phonePending === profile.id ? "전화번호 확인 중…" : "전화걸기"}</button>}
          {phoneNotice?.memberId === profile.id && phoneNotice.isCurrent() && <p className={phoneNotice.error ? "form-error" : "form-description"} role={phoneNotice.error ? "alert" : "status"}>{phoneNotice.text}</p>}
        </div>}
        {canManage && <details className="event-management-menu directory-more">
          <summary className="event-management-trigger" aria-label={`${profile.name} 회원 메뉴`}><MoreHorizontal size={18} /></summary>
          <div className="event-management-popover" role="menu">
            <button type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onEdit(profile); }}><Pencil size={15} /> 정보 수정</button>
            {canKick && <button type="button" role="menuitem" className="danger" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onKick(profile); }}><UserMinus size={15} /> 회원 강퇴</button>}
          </div>
        </details>}
      </article>;
    })}</div>}
  </>;
}
