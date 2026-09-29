"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CalendarDays, ChevronRight, CircleDollarSign, House, LogIn, Megaphone, Menu, MessageSquareText, Shield, Sparkles, Trophy, UserRound, Users, Vote, X, Youtube } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Profile } from "@/lib/types";
import { nameInitials, positionChipLabel, positionOf } from "@/lib/member-directory";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import ThemeSwitch from "@/components/theme-switch";

export type Tab = "home" | "members" | "fees" | "notices" | "events" | "rankings" | "feedback" | "participation" | "updates" | "admin";

export const tabPaths: Record<Tab, string> = { home: "/", members: "/members", fees: "/fees", notices: "/notices", events: "/events", rankings: "/rankings", feedback: "/feedback", participation: "/participation", updates: "/updates", admin: "/admin" };

const YOUTUBE_URL = "https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ";

type NavItem = { tab: Tab; label: string; icon: LucideIcon };

/** Five destinations members reach every week; club business sits one level down. */
const mainItems: NavItem[] = [
  { tab: "home", label: "홈", icon: House },
  { tab: "events", label: "일정", icon: CalendarDays },
  { tab: "members", label: "회원", icon: Users },
  { tab: "notices", label: "공지", icon: Megaphone },
  { tab: "rankings", label: "랭킹", icon: Trophy },
];
const clubItems: NavItem[] = [
  { tab: "fees", label: "회비", icon: CircleDollarSign },
  { tab: "participation", label: "참여", icon: Vote },
  { tab: "feedback", label: "의견", icon: MessageSquareText },
];
const adminItem: NavItem = { tab: "admin", label: "관리", icon: Shield };
/** The bottom bar keeps four of the five; 공지 and the club pages live behind 더보기. */
const tabBarItems = mainItems.filter((item) => item.tab !== "notices");

export type AccountSummary = {
  loading: boolean;
  state: "signed-out" | "member" | "unlinked";
  profile: Profile | null;
};

type NavProps = {
  tab: Tab;
  pathname: string;
  isOfficer: boolean;
  account: AccountSummary;
  onLogin: () => void;
  onAccount: () => void;
};

function NavLinks({ items, tab, pathname, onNavigate }: { items: NavItem[]; tab: Tab; pathname: string; onNavigate?: () => void }) {
  return <ul>{items.map(({ tab: key, label, icon: Icon }) => <li key={key}><Link href={tabPaths[key]} aria-current={pathname === tabPaths[key] ? "page" : tab === key ? "true" : undefined} onClick={onNavigate}><Icon size={18} aria-hidden="true" />{label}</Link></li>)}</ul>;
}

export function MemberAvatar({ profile, size = "md" }: { profile: Pick<Profile, "name" | "position">; size?: "sm" | "md" | "lg" }) {
  return <span className={`member-avatar ${size} pos-${positionOf(profile)}`} aria-hidden="true">{nameInitials(profile.name)}</span>;
}

function AccountButton({ account, onLogin, onAccount, variant }: { account: AccountSummary; onLogin: () => void; onAccount: () => void; variant: "side" | "bar" }) {
  if (account.loading) return <span className={`account-skeleton ${variant}`} role="status" aria-label="로그인 상태 확인 중" />;
  if (account.state === "signed-out") return <button type="button" className={`account-login ${variant}`} onClick={onLogin}><LogIn size={17} aria-hidden="true" /> 로그인</button>;
  const profile = account.profile;
  if (variant === "bar") return <button type="button" className="account-avatar-button" onClick={onAccount} aria-label={profile ? `${profile.name} · 마이페이지` : "계정 연결 필요"}>{profile ? <MemberAvatar profile={profile} size="sm" /> : <UserRound size={20} aria-hidden="true" />}</button>;
  return <button type="button" className="side-account" onClick={onAccount} aria-label={profile ? `${profile.name} · 마이페이지` : "계정 연결 필요"}>
    {profile ? <MemberAvatar profile={profile} /> : <span className="member-avatar md pos-ANY" aria-hidden="true"><UserRound size={18} /></span>}
    <span><b>{profile?.name ?? "계정 연결 필요"}</b>{profile && <small>{positionChipLabel(profile)}{profile.jersey_number != null ? ` · No. ${profile.jersey_number}` : ""}</small>}</span>
    <ChevronRight size={16} aria-hidden="true" />
  </button>;
}

function Crest() {
  return <Link className="club-crest" href="/" aria-label="경충FC 홈"><span aria-hidden="true">GC</span>경충FC</Link>;
}

/** Desktop navigation: a navy rail that stays in view while the page scrolls. */
export function ClubSidebar({ tab, pathname, isOfficer, account, onLogin, onAccount }: NavProps) {
  return <aside className="club-sidebar">
    <Crest />
    <nav aria-label="주 메뉴">
      <NavLinks items={mainItems} tab={tab} pathname={pathname} />
      <h2>클럽</h2>
      <NavLinks items={clubItems} tab={tab} pathname={pathname} />
      {isOfficer && <><h2>운영진</h2><NavLinks items={[adminItem]} tab={tab} pathname={pathname} /></>}
    </nav>
    <div className="club-sidebar-foot">
      <AccountButton account={account} onLogin={onLogin} onAccount={onAccount} variant="side" />
      <ThemeSwitch compact />
      <div className="club-sidebar-links"><Link href={tabPaths.updates} aria-current={tab === "updates" ? "page" : undefined}>업데이트 노트</Link><a href={YOUTUBE_URL} target="_blank" rel="noreferrer">유튜브</a></div>
    </div>
  </aside>;
}

/** Phone header: the crest and the account, nothing else. Navigation lives in the bottom bar. */
export function ClubMobileBar({ account, onLogin, onAccount }: Pick<NavProps, "account" | "onLogin" | "onAccount">) {
  return <header className="club-mobile-bar"><Crest /><AccountButton account={account} onLogin={onLogin} onAccount={onAccount} variant="bar" /></header>;
}

/** Phone navigation: four destinations and 더보기, which lights up for anything in the sheet. */
export function ClubTabBar({ tab, pathname, sheetOpen, onOpenSheet }: { tab: Tab; pathname: string; sheetOpen: boolean; onOpenSheet: () => void }) {
  const inSheet = !tabBarItems.some((item) => item.tab === tab);
  return <nav className="club-tab-bar" aria-label="하단 메뉴">
    {tabBarItems.map(({ tab: key, label, icon: Icon }) => <Link key={key} href={tabPaths[key]} aria-current={pathname === tabPaths[key] ? "page" : tab === key ? "true" : undefined}><span className="tab-icon"><Icon size={20} aria-hidden="true" /></span>{label}</Link>)}
    <button type="button" className={inSheet ? "in-sheet" : undefined} aria-expanded={sheetOpen} aria-haspopup="dialog" aria-controls="more-sheet" onClick={onOpenSheet}><span className="tab-icon"><Menu size={20} aria-hidden="true" /></span>더보기</button>
  </nav>;
}

/** 더보기: one close control, Escape and the backdrop also close it. */
export function MoreSheet({ open, tab, pathname, isOfficer, account, onClose, onLogin, onAccount }: NavProps & { open: boolean; onClose: () => void }) {
  const sheetRef = useDialogFocus<HTMLDivElement>({ onRequestClose: onClose, active: open });
  useEffect(() => { if (open) onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps -- close only when the route changes
  if (!open) return null;
  return <div className="more-sheet-layer">
    <div className="more-sheet-backdrop" onClick={onClose} aria-hidden="true" />
    <div ref={sheetRef} tabIndex={-1} id="more-sheet" className="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-sheet-title">
      <div className="more-sheet-head"><h2 id="more-sheet-title">더보기</h2><button type="button" className="more-sheet-close" onClick={onClose} aria-label="더보기 닫기"><X size={20} /></button></div>
      <NavLinks items={[mainItems[3]]} tab={tab} pathname={pathname} onNavigate={onClose} />
      <h3>클럽</h3>
      <NavLinks items={clubItems} tab={tab} pathname={pathname} onNavigate={onClose} />
      {isOfficer && <><h3>운영진</h3><NavLinks items={[adminItem]} tab={tab} pathname={pathname} onNavigate={onClose} /></>}
      <h3>계정</h3>
      <ul>
        <li>{account.state === "signed-out" ? <button type="button" onClick={() => { onClose(); onLogin(); }}><LogIn size={18} aria-hidden="true" />로그인</button> : <button type="button" onClick={() => { onClose(); onAccount(); }}><UserRound size={18} aria-hidden="true" />{account.profile ? "마이페이지" : "계정 연결 필요"}</button>}</li>
        <li><Link href={tabPaths.updates} aria-current={tab === "updates" ? "page" : undefined} onClick={onClose}><Sparkles size={18} aria-hidden="true" />업데이트 노트</Link></li>
        <li><a href={YOUTUBE_URL} target="_blank" rel="noreferrer"><Youtube size={18} aria-hidden="true" />유튜브</a></li>
      </ul>
      <ThemeSwitch />
    </div>
  </div>;
}
