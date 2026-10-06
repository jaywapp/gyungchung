"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ContactRound, Download, MoreHorizontal, Pencil, Phone, UserMinus, X } from "lucide-react";
import type { OfficerTitle, Profile } from "@/lib/types";
import { countByPosition, positionChipLabel, positionKeys, positionLabels, positionOf, sortDirectory, type PositionKey } from "@/lib/member-directory";
import { MemberPhoneError, openMemberPhone } from "@/lib/member-phone";
import { downloadMemberContact } from "@/lib/member-contact";
import { useDialogFocus } from "@/lib/use-dialog-focus";
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

type ContactAction = "dial" | "save";
type PreparedPhone = { memberId: string; uri: string; action: ContactAction; isCurrent: () => boolean };

/** Small two-up cards with one full-card trigger for member details and actions. */
export default function MemberDirectory({ profiles, currentUserId, canManage, phoneScope, isPhoneCurrent, onPhoneLookup, onEdit, onKick }: DirectoryProps) {
  const [phonePending, setPhonePending] = useState<string | null>(null);
  const [preparedPhone, setPreparedPhone] = useState<PreparedPhone | null>(null);
  const [phoneNotice, setPhoneNotice] = useState<{ memberId: string; text: string; error: boolean; isCurrent: () => boolean } | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const phonePendingRef = useRef<object | null>(null);
  const preparedPhoneRef = useRef<PreparedPhone | null>(null);
  const contactCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const scopeRef = useRef({ value: phoneScope, generation: 0 });
  const menuActorRef = useRef({ owner: currentUserId, canManage, generation: 0 });
  const menuRef = useRef({ memberId: null as string | null, targetScope: "", generation: 0, actorGeneration: 0 });
  const profilesRef = useRef(profiles);
  const accessRef = useRef({ currentUserId, canManage, isPhoneCurrent });
  profilesRef.current = profiles;
  accessRef.current = { currentUserId, canManage, isPhoneCurrent };
  const syncMenuActor = () => {
    if (menuActorRef.current.owner === currentUserId && menuActorRef.current.canManage === canManage) return;
    menuActorRef.current = { owner: currentUserId, canManage, generation: menuActorRef.current.generation + 1 };
    menuRef.current = { ...menuRef.current, generation: menuRef.current.generation + 1 };
  };
  syncMenuActor();
  if (scopeRef.current.value !== phoneScope) scopeRef.current = { value: phoneScope, generation: scopeRef.current.generation + 1 };
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId && profile.status === "active" && !profile.is_test_account) ?? null;
  const targetScope = selectedProfile ? JSON.stringify([selectedProfile.id, selectedProfile.auth_user_id, selectedProfile.status, selectedProfile.is_test_account]) : "";
  if (menuRef.current.targetScope !== targetScope) menuRef.current = { ...menuRef.current, targetScope, generation: menuRef.current.generation + 1 };
  const menuGeneration = menuRef.current.generation;
  const clearContact = () => {
    phonePendingRef.current = null;
    preparedPhoneRef.current = null;
    contactCleanupRef.current?.(); contactCleanupRef.current = null;
    setPhonePending(null); setPreparedPhone(null); setPhoneNotice(null);
  };
  const closeMenu = () => {
    menuRef.current = { memberId: null, targetScope: "", generation: menuRef.current.generation + 1, actorGeneration: menuActorRef.current.generation };
    clearContact(); setSelectedProfileId(null);
  };
  const openMenu = (profile: Profile) => {
    const latest = profilesRef.current.find((row) => row.id === profile.id && row.status === "active" && !row.is_test_account);
    if (!latest) return;
    menuRef.current = { memberId: latest.id, targetScope: JSON.stringify([latest.id, latest.auth_user_id, latest.status, latest.is_test_account]), generation: menuRef.current.generation + 1, actorGeneration: menuActorRef.current.generation };
    clearContact(); setSelectedProfileId(latest.id);
  };
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; phonePendingRef.current = null; preparedPhoneRef.current = null; contactCleanupRef.current?.(); }; }, []);
  useEffect(() => { closeMenu(); }, [phoneScope, currentUserId, canManage]);
  useEffect(() => { clearContact(); if (selectedProfileId && !selectedProfile) closeMenu(); }, [menuGeneration]);
  const requestPhone = async (profile: Profile, action: ContactAction = "dial") => {
    if (!scopeRef.current.value || !accessRef.current.isPhoneCurrent() || phonePendingRef.current) return;
    const generation = scopeRef.current.generation;
    const menuGeneration = menuRef.current.generation;
    const targetScope = menuRef.current.targetScope;
    const current = () => mountedRef.current && generation === scopeRef.current.generation && menuGeneration === menuRef.current.generation && menuRef.current.memberId === profile.id && accessRef.current.isPhoneCurrent() && profilesRef.current.some((row) => row.id === profile.id && row.status === "active" && !row.is_test_account && JSON.stringify([row.id, row.auth_user_id, row.status, row.is_test_account]) === targetScope);
    if (!current()) return;
    clearContact();
    const request = {};
    phonePendingRef.current = request; setPhonePending(profile.id);
    try {
      const uri = await onPhoneLookup(profile.id, current);
      if (!current() || phonePendingRef.current !== request) return;
      if (!uri) setPhoneNotice({ memberId: profile.id, text: "등록된 전화번호가 없습니다. 운영진에게 연락처 확인을 요청해 주세요.", error: false, isCurrent: current });
      else {
        const prepared = { memberId: profile.id, uri, action, isCurrent: current };
        preparedPhoneRef.current = prepared; setPreparedPhone(prepared);
      }
    } catch (cause) {
      if (!current() || phonePendingRef.current !== request) return;
      setPhoneNotice({ memberId: profile.id, text: cause instanceof MemberPhoneError ? cause.message : "전화번호를 불러오지 못했습니다. 다시 시도해 주세요.", error: true, isCurrent: current });
    } finally {
      if (phonePendingRef.current === request) { phonePendingRef.current = null; if (mountedRef.current) setPhonePending(null); }
    }
  };
  const dialPhone = () => {
    if (!preparedPhone || preparedPhone.action !== "dial" || preparedPhoneRef.current !== preparedPhone || !preparedPhone.isCurrent()) return;
    preparedPhoneRef.current = null; setPreparedPhone(null);
    try {
      openMemberPhone(preparedPhone.uri);
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "전화 앱에서 발신을 선택해 주세요. 앱이 열리지 않으면 이 기기의 전화 앱 연결을 확인해 주세요.", error: false, isCurrent: preparedPhone.isCurrent });
    } catch {
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "전화 앱을 열지 못했습니다. 이 기기의 전화 앱 연결을 확인한 뒤 다시 시도해 주세요.", error: true, isCurrent: preparedPhone.isCurrent });
    }
  };
  const saveContact = () => {
    if (!preparedPhone || preparedPhone.action !== "save" || preparedPhoneRef.current !== preparedPhone || !preparedPhone.isCurrent()) return;
    const latest = profilesRef.current.find((row) => row.id === preparedPhone.memberId && row.status === "active" && !row.is_test_account);
    if (!latest) return;
    preparedPhoneRef.current = null; setPreparedPhone(null);
    try {
      contactCleanupRef.current?.();
      contactCleanupRef.current = downloadMemberContact(latest.name, preparedPhone.uri);
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "연락처 파일 내려받기를 요청했습니다. 내려받은 파일을 연락처 앱에서 열어 저장해 주세요.", error: false, isCurrent: preparedPhone.isCurrent });
    } catch {
      if (preparedPhone.isCurrent()) setPhoneNotice({ memberId: preparedPhone.memberId, text: "연락처 파일을 내려받지 못했습니다. 브라우저의 다운로드 설정을 확인한 뒤 다시 시도해 주세요.", error: true, isCurrent: preparedPhone.isCurrent });
    }
  };
  const manageMember = (action: "edit" | "kick") => {
    if (!mountedRef.current || menuRef.current.generation !== menuGeneration || menuRef.current.actorGeneration !== menuActorRef.current.generation || !accessRef.current.currentUserId || accessRef.current.currentUserId !== menuActorRef.current.owner || !accessRef.current.canManage) return;
    const latest = profilesRef.current.find((row) => row.id === menuRef.current.memberId && row.status === "active" && !row.is_test_account);
    if (!latest) return;
    if (action === "kick" && (latest.auth_user_id === accessRef.current.currentUserId || latest.is_system_admin)) return;
    closeMenu();
    if (action === "edit") onEdit(latest); else onKick(latest);
  };
  const [filter, setFilter] = useState<PositionKey | "ALL">("ALL");
  const sorted = useMemo(() => sortDirectory(profiles), [profiles]);
  const counts = useMemo(() => countByPosition(profiles), [profiles]);
  const visible = filter === "ALL" ? sorted : sorted.filter((profile) => positionOf(profile) === filter);
  const detailRef = useDialogFocus<HTMLDivElement>({ onRequestClose: closeMenu, active: Boolean(selectedProfile) });
  const readyPhone = preparedPhone && preparedPhone.memberId === selectedProfile?.id && preparedPhone.isCurrent() ? preparedPhone : null;
  const currentNotice = phoneNotice && phoneNotice.memberId === selectedProfile?.id && phoneNotice.isCurrent() ? phoneNotice : null;
  const options: [PositionKey | "ALL", string][] = [["ALL", "전체"], ...positionKeys.map((key) => [key, positionLabels[key]] as [PositionKey, string])];
  return <>
    <div className="position-filter" role="group" aria-label="포지션으로 거르기">
      {options.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<small>{counts[key]}</small></button>)}
    </div>
    {visible.length === 0 ? <p className="panel-empty directory-empty">이 포지션의 회원이 없습니다.</p> : <div className="directory-grid" aria-live="polite">{visible.map((profile) => {
      const isMe = profile.auth_user_id === currentUserId;
      const title = profile.role === "manager" ? (profile.officer_title ? officerTitleLabels[profile.officer_title] : "관리자") : null;
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
        <button type="button" className="directory-card-trigger" onClick={() => openMenu(profile)} aria-label={`${profile.name} 회원 메뉴 및 상세 정보 보기`} aria-haspopup="dialog" aria-expanded={selectedProfileId === profile.id}><span className="directory-more" aria-hidden="true"><MoreHorizontal size={18} /></span></button>
      </article>;
    })}</div>}
    {selectedProfile && <div className="modal-backdrop" onClick={closeMenu}>
      <div ref={detailRef} tabIndex={-1} className="editor directory-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="member-detail-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="닫기" onClick={closeMenu}><X size={20} /></button>
        <MemberAvatar profile={selectedProfile} size="lg" />
        <h2 id="member-detail-title">{selectedProfile.name}</h2>
        <dl>
          <div><dt>포지션</dt><dd>{positionChipLabel(selectedProfile)}{selectedProfile.position_detail ? ` · ${selectedProfile.position_detail}` : ""}</dd></div>
          <div><dt>등번호</dt><dd>{selectedProfile.jersey_number != null ? `No. ${selectedProfile.jersey_number}` : "미정"}</dd></div>
          <div><dt>회원 유형</dt><dd>{selectedProfile.role === "manager" ? (selectedProfile.officer_title ? officerTitleLabels[selectedProfile.officer_title] : "관리자") : "일반 회원"}</dd></div>
          <div><dt>가입일</dt><dd>{new Date(selectedProfile.joined_at).toLocaleDateString("ko-KR")}</dd></div>
        </dl>
        {phoneScope && <div className="directory-contact-actions" aria-busy={phonePending === selectedProfile.id}>
          {readyPhone?.action === "dial" ? <button type="button" className="cta secondary" onClick={dialPhone}><Phone size={17} /> 전화 앱 열기</button> : <button type="button" className="cta secondary" disabled={phonePending !== null} onClick={() => void requestPhone(selectedProfile, "dial")}><Phone size={17} /> {phonePending === selectedProfile.id ? "연락처 확인 중…" : "전화걸기"}</button>}
          {readyPhone?.action === "save" ? <button type="button" className="cta secondary" onClick={saveContact}><Download size={17} /> 연락처 파일 내려받기</button> : <button type="button" className="cta secondary" disabled={phonePending !== null} onClick={() => void requestPhone(selectedProfile, "save")}><ContactRound size={17} /> 연락처 저장</button>}
          {readyPhone?.action === "save" && <p className="form-description" role="status">내려받은 연락처 파일을 연락처 앱에서 열어 저장해 주세요.</p>}
          {currentNotice && <p className={currentNotice.error ? "form-error" : "form-description"} role={currentNotice.error ? "alert" : "status"}>{currentNotice.text}</p>}
        </div>}
        {canManage && <div className="directory-management-actions">
          <button type="button" className="cta secondary" onClick={() => manageMember("edit")}><Pencil size={17} /> 정보 수정</button>
          {selectedProfile.auth_user_id !== currentUserId && !selectedProfile.is_system_admin && <button type="button" className="cta danger" onClick={() => manageMember("kick")}><UserMinus size={17} /> 회원 강퇴</button>}
        </div>}
      </div>
    </div>}
  </>;
}
