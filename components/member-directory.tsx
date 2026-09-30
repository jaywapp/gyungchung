"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, UserMinus } from "lucide-react";
import type { OfficerTitle, Profile } from "@/lib/types";
import { countByPosition, positionChipLabel, positionKeys, positionLabels, positionOf, sortDirectory, type PositionKey } from "@/lib/member-directory";
import { MemberAvatar } from "@/components/club-nav";

const officerTitleLabels: Record<OfficerTitle, string> = { president: "회장", vice_president: "부회장", treasurer: "총무" };

type DirectoryProps = {
  profiles: Profile[];
  currentUserId: string;
  canManage: boolean;
  onEdit: (profile: Profile) => void;
  onKick: (profile: Profile) => void;
};

/** Small two-up cards with a position filter: the whole squad fits in a few phone screens. */
export default function MemberDirectory({ profiles, currentUserId, canManage, onEdit, onKick }: DirectoryProps) {
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
