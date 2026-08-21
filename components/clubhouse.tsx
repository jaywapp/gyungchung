"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardCheck, Link2, LogIn, LogOut, MapPin, Menu, Megaphone, Pencil, Plus, Shield, Trash2, Trophy, UserMinus, UserRound, X, Youtube } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Fee, Feedback, GuestFee, GuestPlayer, MemberRanking, MomLeaderboardEntry, Notice, OfficerPermission, OfficerTitle, ParticipationForm, ParticipationKind, ParticipationSubmission, Profile, RolePermission, Venue } from "@/lib/types";
import type { EditorConfig } from "@/components/admin-console";
import { editorScopes, showError, tableScopes, toErrorMessage, type ReloadScope, type ToastKind } from "@/lib/ui-feedback";
import { getCheckInStatus } from "@/lib/attendance";
import { getAccountState } from "@/lib/account-state";
import { eventDatePath, parseEventDateKey, toDateKey, toEventDateKey } from "@/lib/event-date";
import { buildOAuthReturnPath } from "@/lib/oauth-return";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { Empty, FormError, LoadError, LoginGate, SectionSkeleton } from "@/components/section-states";

const FeedbackHub = dynamic(() => import("@/components/feedback-hub"), { loading: () => <SectionSkeleton /> });
const ParticipationHub = dynamic(() => import("@/components/participation-hub"), { loading: () => <SectionSkeleton /> });
const AdminConsole = dynamic(() => import("@/components/admin-console"), { loading: () => <SectionSkeleton /> });
const AdminEditor = dynamic(() => import("@/components/admin-console").then((module) => module.AdminEditor));
const ConfirmDialog = dynamic(() => import("@/components/confirm-dialog"));
const EventDetail = dynamic(() => import("@/components/event-detail"), { loading: () => <SectionSkeleton /> });

type Tab = "home" | "members" | "fees" | "notices" | "events" | "rankings" | "feedback" | "participation" | "admin";
type RawGuestPlayer = Omit<GuestPlayer, "appearance_count">;
const roleLabels: Record<Profile["role"], string> = { member: "일반 회원", manager: "관리자" };
const officerTitleLabels: Record<OfficerTitle, string> = { president: "회장", vice_president: "부회장", treasurer: "총무" };
const systemAdminPermissions = ["roles.manage", "officers.manage", "members.manage", "fees.manage", "notices.manage", "events.manage", "feedback.manage", "elections.manage", "polls.manage", "surveys.manage"];
const navItems: [Tab, string][] = [["home", "홈"], ["members", "회원"], ["fees", "회비"], ["notices", "공지"], ["events", "일정"], ["rankings", "랭킹"], ["feedback", "의견"], ["participation", "참여"]];
const tabPaths: Record<Tab, string> = { home: "/", members: "/members", fees: "/fees", notices: "/notices", events: "/events", rankings: "/rankings", feedback: "/feedback", participation: "/participation", admin: "/admin" };
const pathTabs = new Map(Object.entries(tabPaths).map(([tab, path]) => [path, tab as Tab]));

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(digits)) return `+82${digits.slice(1)}`;
  return value.trim();
}

/** Results the auth callback and the OAuth redirect hand back on the URL. */
const authResults: Record<string, { message: string; kind: ToastKind }> = {
  error: { message: "로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", kind: "error" },
  linked: { message: "간편 로그인 계정을 연결했습니다.", kind: "success" },
  login: { message: "로그인했습니다.", kind: "success" },
};

export default function Clubhouse({ children }: { children?: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  /** `/events/20260816` keeps the 일정 tab lit while the leaf renders a single day. */
  const eventDateKey = pathname.startsWith(`${tabPaths.events}/`) ? pathname.slice(tabPaths.events.length + 1) : null;
  const tab: Tab = pathTabs.get(pathname) ?? (eventDateKey ? "events" : "home");
  /** Null on a detail route, so no section index renders behind the detail. */
  const view: Tab | null = eventDateKey ? null : tab;
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const accountState = getAccountState(user, me);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [rawGuestPlayers, setRawGuestPlayers] = useState<RawGuestPlayer[]>([]);
  const [rankings, setRankings] = useState<MemberRanking[]>([]);
  const [momVotes, setMomVotes] = useState<EventMomVote[]>([]);
  const [momResults, setMomResults] = useState<EventMomResult[]>([]);
  const [momLeaderboard, setMomLeaderboard] = useState<MomLeaderboardEntry[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [guestFees, setGuestFees] = useState<GuestFee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [forms, setForms] = useState<ParticipationForm[]>([]);
  const [submissions, setSubmissions] = useState<ParticipationSubmission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [officerPermissions, setOfficerPermissions] = useState<OfficerPermission[]>([]);
  /** Four-state contract: every section reads loading → error → empty → data. */
  const [publicLoading, setPublicLoading] = useState(true);
  const [eventLoadError, setEventLoadError] = useState(false);
  const [noticeLoadError, setNoticeLoadError] = useState(false);
  const [memberLoading, setMemberLoading] = useState(true);
  const [memberLoadError, setMemberLoadError] = useState(false);
  const [quickEditor, setQuickEditor] = useState<EditorConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ table: string; id: string; label: string } | null>(null);
  const [pendingKick, setPendingKick] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const authLoadKeyRef = useRef<string | undefined>(undefined);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const dismissToast = useCallback(() => { window.clearTimeout(toastTimerRef.current); setToast(null); }, []);
  const showToast = useCallback((message: string, kind: ToastKind = "success") => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = window.setTimeout(() => setToast(null), kind === "error" ? 8000 : 4000);
  }, []);

  const loadPublicData = useCallback(async (showSkeleton = false) => {
    if (!supabase) return;
    if (showSkeleton) setPublicLoading(true);
    const [eventRes, noticeRes, formRes, venueRes] = await Promise.all([
      supabase.from("events").select("id, title, starts_at, venue_id, venue, address, note, capacity, is_competitive, team_mode, event_guest_players(event_id, guest_player_id, guest_name, guest_position, created_at), event_teams(id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating)), event_matches(id, event_id, match_number, team_a_id, team_b_id, team_a_score, team_b_score, event_match_players(id, event_id, match_id, team_id, profile_id, guest_player_id, player_name), event_match_scorers(id, event_id, match_id, team_id, profile_id, guest_player_id, scorer_name, goals))").order("starts_at"),
      supabase.from("notices").select("id, title, body, is_pinned, created_at").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("participation_forms").select("*, participation_questions(*, participation_options(*))").order("created_at", { ascending: false }),
      supabase.from("venues").select("id, name, address, note, created_at, updated_at").order("name"),
    ]);
    /** Keep the app usable if the frontend deploy reaches production before its migration. */
    const resolvedEventRes = eventRes.error
      ? await supabase.from("events").select("id, title, starts_at, venue, address, note, capacity, is_competitive, team_mode, event_guest_players(event_id, guest_player_id, guest_name, guest_position, created_at), event_teams(id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating))").order("starts_at")
      : eventRes;
    setEvents(resolvedEventRes.error ? [] : ((resolvedEventRes.data as Event[] | null) ?? []).map((event) => ({ ...event, venue_id: event.venue_id ?? null })));
    setVenues(venueRes.error ? [] : (venueRes.data as Venue[] | null) ?? []);
    setNotices(noticeRes.error ? [] : (noticeRes.data as Notice[] | null) ?? []);
    setEventLoadError(Boolean(resolvedEventRes.error)); setNoticeLoadError(Boolean(noticeRes.error));
    if (formRes.data) setForms((formRes.data as ParticipationForm[]).map((form) => ({ ...form, participation_questions: [...(form.participation_questions ?? [])].sort((a, b) => a.position - b.position).map((question) => ({ ...question, participation_options: [...(question.participation_options ?? [])].sort((a, b) => a.position - b.position) })) })));
    setPublicLoading(false);
  }, [supabase]);

  const loadMemberData = useCallback(async (currentUser?: User | null, showSkeleton = false) => {
    if (!supabase) return;
    if (!currentUser) {
      setProfiles([]); setMe(null); setFees([]); setGuestFees([]); setAttendance([]); setFeedback([]); setSubmissions([]); setRolePermissions([]); setOfficerPermissions([]); setRawGuestPlayers([]); setRankings([]); setMomVotes([]); setMomResults([]); setMomLeaderboard([]);
      setMemberLoadError(false); setMemberLoading(false); return;
    }
    if (showSkeleton) setMemberLoading(true);
    const [profileRes, allProfileRes, feeRes, guestFeeRes, attendanceRes, feedbackRes, submissionRes, permissionRes, officerPermissionRes, guestRes, rankingRes, momVoteRes, momResultRes, momLeaderboardRes] = await Promise.all([
      supabase.rpc("get_member_directory"),
      supabase.from("profiles").select("*").order("name"),
      supabase.from("fees").select("*, profiles(name)").order("month", { ascending: false }),
      supabase.from("event_guest_fees").select("*, guest_players(name), events(title, starts_at)").order("created_at", { ascending: false }),
      supabase.from("attendance").select("*"),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      supabase.from("participation_submissions").select("id, form_id, participant_id, submitted_at"),
      supabase.from("role_permissions").select("role, permission"),
      supabase.from("officer_permissions").select("officer_title, permission"),
      supabase.from("guest_players").select("*"),
      supabase.rpc("get_member_rankings"),
      supabase.from("event_mom_votes").select("*"),
      supabase.rpc("get_event_mom_results"),
      supabase.rpc("get_mom_leaderboard"),
    ]);
    const privateProfiles = (allProfileRes.data as Profile[] | null) ?? [];
    const visibleProfiles = new Map(((profileRes.data as Profile[] | null) ?? []).map((profile) => [profile.id, profile]));
    privateProfiles.forEach((profile) => visibleProfiles.set(profile.id, { ...visibleProfiles.get(profile.id), ...profile }));
    const enrichedProfiles = Array.from(visibleProfiles.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const ownProfile = privateProfiles.find((profile) => profile.auth_user_id === currentUser.id) ?? null;
    setProfiles(enrichedProfiles);
    setMe(ownProfile);
    setFees((feeRes.data as unknown as Fee[]) ?? []); setGuestFees((guestFeeRes.data as unknown as GuestFee[]) ?? []); setAttendance((attendanceRes.data as Attendance[]) ?? []); setFeedback((feedbackRes.data as Feedback[]) ?? []); setSubmissions((submissionRes.data as ParticipationSubmission[]) ?? []); setRolePermissions((permissionRes.data as RolePermission[]) ?? []); setOfficerPermissions((officerPermissionRes.data as OfficerPermission[]) ?? []); setRawGuestPlayers((guestRes.data as RawGuestPlayer[]) ?? []); setRankings((rankingRes.data as MemberRanking[]) ?? []); setMomVotes((momVoteRes.data as EventMomVote[]) ?? []); setMomResults((momResultRes.data as EventMomResult[]) ?? []); setMomLeaderboard((momLeaderboardRes.data as MomLeaderboardEntry[]) ?? []);
    setMemberLoadError(Boolean(allProfileRes.error || feeRes.error || rankingRes.error || feedbackRes.error));
    setMemberLoading(false);
  }, [supabase]);

  const userRef = useRef<User | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  const reload = useCallback(async (scope: ReloadScope = "all") => {
    await Promise.all([
      scope === "member" ? null : loadPublicData(),
      scope === "public" ? null : loadMemberData(userRef.current),
    ]);
  }, [loadMemberData, loadPublicData]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      const authLoadKey = nextUser?.id ?? "anonymous";
      if (authLoadKeyRef.current === authLoadKey) return;
      authLoadKeyRef.current = authLoadKey;
      userRef.current = nextUser;
      setUser(nextUser);
      setAuthLoading(false);
      void Promise.all([loadPublicData(true), loadMemberData(nextUser, true)]);
    });
    return () => data.subscription.unsubscribe();
  }, [loadMemberData, loadPublicData, supabase]);

  /** The auth callback reports its outcome on the URL; report it to the member. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("auth");
    if (!result) return;
    params.delete("auth");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`);
    setLoginOpen(false);
    const outcome = authResults[result];
    if (outcome) showToast(outcome.message, outcome.kind);
  }, [showToast]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const permissions = useMemo(() => {
    if (me?.is_system_admin) return new Set([...systemAdminPermissions, ...rolePermissions.filter((row) => row.role === "admin").map((row) => row.permission)]);
    if (me?.role === "manager" && me.officer_title) return new Set(officerPermissions.filter((row) => row.officer_title === me.officer_title).map((row) => row.permission));
    return new Set<string>();
  }, [me?.is_system_admin, me?.officer_title, me?.role, officerPermissions, rolePermissions]);
  /** Appearance counts fall out of the loaded events, so guests and events can load in parallel. */
  const guestPlayers = useMemo(() => {
    const appearances = new Map<string, number>();
    events.flatMap((event) => event.event_guest_players ?? []).forEach((guest) => appearances.set(guest.guest_player_id, (appearances.get(guest.guest_player_id) ?? 0) + 1));
    return rawGuestPlayers
      .map((guest) => ({ ...guest, appearance_count: appearances.get(guest.id) ?? 0 }))
      .sort((a, b) => b.appearance_count - a.appearance_count || a.name.localeCompare(b.name, "ko"));
  }, [events, rawGuestPlayers]);
  const isOfficer = permissions.size > 0;
  const manageableParticipationKinds = (["election", "poll", "survey"] as ParticipationKind[]).filter((kind) => permissions.has(`${kind === "election" ? "elections" : kind === "poll" ? "polls" : "surveys"}.manage`));
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const upcoming = events.find((event) => new Date(event.starts_at) >= new Date());
  /** RLS already narrows a regular member to their own rows; an officer reads the club, so the home card still has to filter. */
  const myFees = useMemo(() => fees.filter((fee) => fee.member_id === me?.id), [fees, me?.id]);
  const myStanding = myFees.length > 0 ? summarizeFees(myFees) : null;
  const goingCount = upcoming ? attendance.filter((item) => item.event_id === upcoming.id && item.status === "going").length : 0;
  /** Sections gated behind a session must not flash their signed-out state first. */
  const sessionPending = authLoading || memberLoading;

  const navigate = useCallback((next: Tab) => { setMenuOpen(false); router.push(tabPaths[next]); }, [router]);
  const navRef = useDialogFocus<HTMLElement>(() => setMenuOpen(false), menuOpen);
  const confirmDelete = async () => {
    if (!supabase || !pendingDelete) return;
    setDeleting(true);
    const { error } = await supabase.from(pendingDelete.table).delete().eq("id", pendingDelete.id);
    const scope = tableScopes[pendingDelete.table] ?? "all";
    setDeleting(false); setPendingDelete(null);
    if (error) return showToast(toErrorMessage(error), "error");
    showToast("삭제했습니다.");
    await reload(scope);
  };
  const confirmKick = async () => {
    if (!supabase || !pendingKick || pendingKick.is_system_admin) return;
    const target = pendingKick;
    setDeleting(true);
    const { error } = await supabase.from("profiles").update({ status: "inactive" }).eq("id", target.id);
    setDeleting(false); setPendingKick(null);
    if (error) return showToast(toErrorMessage(error), "error");
    showToast(`${target.name} 회원을 강퇴했습니다.`);
    await reload("member");
  };
  const signIn = async (provider: "google" | "kakao") => {
    if (!supabase) return showError(showToast, "로그인 연결을 준비 중입니다.");
    setBusy(true);
    const oauthProvider = provider === "kakao" ? "custom:kakao" : provider;
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", buildOAuthReturnPath(window.location.pathname, window.location.search, window.location.hash, "login"));
    const { error } = await supabase.auth.signInWithOAuth({
      provider: oauthProvider,
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });
    if (error) { showToast("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", "error"); setBusy(false); }
  };
  const passwordAuth = async (identifier: string, password: string) => {
    if (!supabase) return "로그인 연결을 준비 중입니다.";
    setBusy(true);
    try {
      const result = identifier.includes("@")
        ? await supabase.auth.signInWithPassword({ email: identifier.trim().toLowerCase(), password })
        : await supabase.auth.signInWithPassword({ phone: normalizePhone(identifier), password: password === "1234" ? "gyungchung-1234" : password });
      if (result.error) {
        if (result.error.code === "invalid_credentials") return "로그인 정보를 확인하거나 운영진에게 문의해 주세요.";
        if (result.error.code === "weak_password") return "더 안전한 비밀번호를 사용해 주세요.";
        if (result.error.code?.includes("rate_limit")) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
        return "로그인하지 못했습니다. 입력 정보를 확인해 주세요.";
      }
      setLoginOpen(false);
      showToast("로그인했습니다.");
      return null;
    } catch {
      return "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      setBusy(false);
    }
  };
  const linkIdentity = async (provider: "google" | "kakao") => {
    if (!supabase) return;
    setBusy(true);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", buildOAuthReturnPath(window.location.pathname, window.location.search, window.location.hash, "linked"));
    const oauthProvider = provider === "kakao" ? "custom:kakao" : provider;
    const { error } = await supabase.auth.linkIdentity({ provider: oauthProvider, options: { redirectTo: callbackUrl.toString() } });
    if (error) { setBusy(false); showToast("간편 로그인 계정을 연결하지 못했습니다.", "error"); }
  };
  const signOut = async () => { await supabase?.auth.signOut(); navigate("home"); showToast("로그아웃했습니다."); };
  const setMyAttendance = async (status: Attendance["status"], eventId = upcoming?.id) => {
    if (!user || !eventId || !supabase) return setLoginOpen(true);
    if (me?.status !== "active") return showError(showToast, "회원 승인 후 참석 여부를 등록할 수 있습니다.");
    const { error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: me.id, status }, { onConflict: "event_id,member_id" });
    if (error) return showToast(toErrorMessage(error), "error");
    setAttendance((rows) => { const existing = rows.find((row) => row.event_id === eventId && row.member_id === me.id); return [...rows.filter((row) => row.event_id !== eventId || row.member_id !== me.id), { event_id: eventId, member_id: me.id, status, check_in_status: existing?.check_in_status ?? null, checked_in_at: existing?.checked_in_at ?? null, checked_in_by: existing?.checked_in_by ?? null }]; }); showToast("참석 여부를 저장했습니다.");
  };

  return <div className="page">
    <a className="skip-link" href="#main">본문 바로가기</a>
    <header className="topbar">
      <Link className="brand" href="/" onClick={() => setMenuOpen(false)} aria-label="경충FC 홈"><span className="crest"><span>GC</span></span><span className="brand-copy"><strong>경충FC</strong><small>WEEKEND FUTSAL CLUB</small></span></Link>
      <nav ref={navRef} tabIndex={-1} id="primary-navigation" className={menuOpen ? "nav open" : "nav"} aria-label="주 메뉴">{navItems.map(([key, label]) => <Link key={key} href={tabPaths[key]} className={tab === key ? "active" : ""} aria-current={pathname === tabPaths[key] ? "page" : tab === key ? "true" : undefined} onClick={() => setMenuOpen(false)}>{label}</Link>)}{isOfficer && <Link href={tabPaths.admin} className={tab === "admin" ? "active" : ""} aria-current={tab === "admin" ? "page" : undefined} onClick={() => setMenuOpen(false)}>관리</Link>}<button type="button" className="nav-close" onClick={() => setMenuOpen(false)}><X size={16} /> 메뉴 닫기</button></nav>
      <div className="account"><a className="youtube-link" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer" aria-label="경충FC 유튜브"><Youtube size={20} /></a>{authLoading ? <span className="auth-skeleton" role="status" aria-label="로그인 상태 확인 중" /> : accountState !== "signed-out" ? <button className="login-button" onClick={() => setAccountOpen(true)} aria-label={accountState === "member" ? `${me?.name} · 마이페이지` : "계정 연결 필요"}><UserRound size={16} /> {accountState === "member" ? me?.name : "계정 연결 필요"}</button> : <button className="login-button" onClick={() => setLoginOpen(true)}><LogIn size={16} /> 로그인</button>}<button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} aria-controls="primary-navigation">{menuOpen ? <X /> : <Menu />}</button></div>
    </header>

    <main id="main">
      {view === "home" && <Home upcoming={upcoming} notice={notices[0]} feeStanding={myStanding} goingCount={goingCount} memberCount={activeProfiles.length} user={user} publicLoading={publicLoading} eventLoadError={eventLoadError} noticeLoadError={noticeLoadError} onRetry={() => void reload("public")} onNavigate={navigate} onAttendance={setMyAttendance} myAttendance={attendance.find((row) => row.event_id === upcoming?.id && row.member_id === me?.id)?.status} />}
      {view === "members" && <Members profiles={activeProfiles} user={user} loading={sessionPending} loadError={memberLoadError} canManage={permissions.has("members.manage")} onEdit={(profile) => setQuickEditor({ type: "members", row: profile as unknown as Record<string, unknown> })} onKick={(profile) => setPendingKick(profile)} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} />}
      {view === "fees" && <Fees fees={fees} profiles={profiles} profile={me} events={events} user={user} loading={sessionPending} loadError={memberLoadError} onAsk={() => navigate("feedback")} canManage={permissions.has("fees.manage")} onCreate={() => setQuickEditor({ type: "fees" })} onEdit={(fee) => setQuickEditor({ type: "fees", row: fee as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "fees", id, label })} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} />}
      {view === "notices" && <Notices notices={notices} loading={publicLoading} loadError={noticeLoadError} canManage={permissions.has("notices.manage")} onCreate={() => setQuickEditor({ type: "notices" })} onEdit={(notice) => setQuickEditor({ type: "notices", row: notice as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "notices", id, label })} onRetry={() => void reload("public")} />}
      {view === "events" && <Events events={events} attendance={attendance} user={user} profile={me} loading={publicLoading} loadError={eventLoadError} canManage={permissions.has("events.manage")} onCreate={() => setQuickEditor({ type: "events" })} onEdit={(event) => setQuickEditor({ type: "events", row: event as unknown as Record<string, unknown> })} onManageMatch={(event) => setQuickEditor({ type: "teams", row: event as unknown as Record<string, unknown> })} onManageAttendance={(event) => setQuickEditor({ type: "attendance", row: event as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "events", id, label })} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("public")} />}
      {view === "rankings" && <Rankings rankings={rankings} goalEvents={events} momLeaderboard={momLeaderboard} user={user} profile={me} loading={sessionPending || publicLoading} loadError={memberLoadError || eventLoadError} onLogin={() => setLoginOpen(true)} onRetry={() => void reload()} />}
      {view === "feedback" && <FeedbackHub user={user} profile={me} feedback={feedback} supabase={supabase} loading={sessionPending} loadError={memberLoadError} canManage={permissions.has("feedback.manage")} onEdit={(item) => setQuickEditor({ type: "feedback", row: item as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "feedback", id, label })} reload={() => void reload("member")} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} toast={showToast} />}
      {view === "participation" && <ParticipationHub user={user} profile={me} forms={forms.filter((form) => form.status === "open" || form.status === "closed")} submissions={submissions} supabase={supabase} loading={publicLoading} manageableKinds={manageableParticipationKinds} onCreate={() => setQuickEditor({ type: "forms" })} onEdit={(form) => setQuickEditor({ type: "forms", row: form as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "participation_forms", id, label })} reload={() => void reload("member")} onLogin={() => setLoginOpen(true)} toast={showToast} />}
      {view === "admin" && sessionPending && <SectionSkeleton />}
      {view === "admin" && !sessionPending && isOfficer && supabase && <AdminConsole profiles={profiles} guestPlayers={guestPlayers} attendance={attendance} fees={fees} guestFees={guestFees} notices={notices} venues={venues} events={events} feedback={feedback} forms={forms} rolePermissions={rolePermissions} officerPermissions={officerPermissions} permissions={permissions} supabase={supabase} reload={(scope) => void reload(scope)} toast={showToast} />}
      {view === "admin" && !sessionPending && !isOfficer && <div className="content"><Empty icon={<Shield />} title="운영진 전용 공간입니다" description="시스템 관리자 또는 운영 권한이 있는 관리자 계정으로 로그인해 주세요." /></div>}
      {eventDateKey && <EventDetail dateKey={eventDateKey} events={events} profiles={profiles} attendance={attendance} momVotes={momVotes} momResults={momResults} user={user} profile={me} supabase={supabase} loading={publicLoading} loadError={eventLoadError} sessionPending={sessionPending} canManage={permissions.has("events.manage")} onEdit={(event) => setQuickEditor({ type: "events", row: event as unknown as Record<string, unknown> })} onManageMatch={(event) => setQuickEditor({ type: "teams", row: event as unknown as Record<string, unknown> })} onManageAttendance={(event) => setQuickEditor({ type: "attendance", row: event as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "events", id, label })} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("public")} reload={() => void reload("member")} toast={showToast} />}
      {children}
    </main>
    <div className="toast warning" role="status" aria-live="polite" aria-atomic="true">{toast?.kind === "warning" && <><AlertTriangle size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>

    <footer><span>경충FC · SINCE 2014</span><span>우리의 주말, 우리의 풋살.</span><a href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer">YOUTUBE <ChevronRight size={14} /></a></footer>
    {loginOpen && <LoginModal busy={busy} onClose={() => setLoginOpen(false)} onSignIn={signIn} onPasswordAuth={passwordAuth} />}
    {accountOpen && user && (accountState === "member" && me ? <AccountModal user={user} profile={me} busy={busy} onClose={() => setAccountOpen(false)} onLink={linkIdentity} onSignOut={async () => { setAccountOpen(false); await signOut(); }} /> : <UnlinkedAccountModal onClose={() => setAccountOpen(false)} onSignOut={async () => { setAccountOpen(false); await signOut(); }} />)}
    {quickEditor && supabase && <AdminEditor config={quickEditor} profiles={profiles} guestPlayers={guestPlayers} venues={venues} events={events} attendance={attendance} permissions={permissions} supabase={supabase} onClose={() => setQuickEditor(null)} onSaved={(result) => { const scope = editorScopes[quickEditor.type] ?? "all"; if (result?.close !== false) setQuickEditor(null); showToast(result?.message ?? "저장했습니다."); void reload(scope); }} onError={(message) => showToast(message, "error")} />}
    {pendingDelete && <ConfirmDialog title="삭제할까요?" target={pendingDelete.label} description="이 작업은 되돌릴 수 없습니다. 삭제한 항목은 복구할 수 없습니다." busy={deleting} onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} />}
    {pendingKick && <ConfirmDialog title="회원을 강퇴할까요?" target={pendingKick.name} description="회원 기능 이용이 즉시 중단됩니다. 다시 가입하려면 운영진이 상태를 변경해야 합니다." confirmLabel="강퇴하기" busy={deleting} onConfirm={() => void confirmKick()} onCancel={() => setPendingKick(null)} />}
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast?.kind === "success" && <><Check size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>
    <div className="toast error" role="alert" aria-live="assertive" aria-atomic="true">{toast?.kind === "error" && <><AlertCircle size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>
  </div>;
}

function LoginModal({ busy, onClose, onSignIn, onPasswordAuth }: { busy: boolean; onClose: () => void; onSignIn: (provider: "google" | "kakao") => void; onPasswordAuth: (phone: string, password: string) => Promise<string | null> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const [phone, setPhone] = useState("");
  const [legacyEmail, setLegacyEmail] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    const error = await onPasswordAuth(phone, String(form.get("password") ?? ""));
    if (error) setErrorMessage(error);
  };
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="회원 로그인"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">MEMBER ACCESS</span><h2>로그인</h2><p>등록된 전화번호와 운영진에게 받은 비밀번호로 로그인하세요.</p><form className="password-auth-form" onSubmit={submit}><label>{legacyEmail ? "기존 이메일" : "전화번호"}<input name="phone" type={legacyEmail ? "email" : "tel"} required inputMode={legacyEmail ? "email" : "tel"} autoComplete={legacyEmail ? "email" : "tel"} placeholder={legacyEmail ? "member@example.com" : "010-1234-5678"} pattern={legacyEmail ? undefined : "01[016789]-?[0-9]{3,4}-?[0-9]{4}"} value={phone} onChange={(event) => setPhone(event.target.value)} aria-invalid={errorMessage ? true : undefined} /></label><label>비밀번호<input name="password" type="password" required minLength={legacyEmail ? 6 : 4} autoComplete="current-password" placeholder={legacyEmail ? "비밀번호 입력" : "초기 비밀번호 1234"} /></label>{errorMessage && <FormError id="login-error" message={errorMessage} />}<button className="cta" disabled={busy}>{busy ? "처리 중…" : legacyEmail ? "이메일로 로그인" : "전화번호로 로그인"}</button><small>{legacyEmail ? "기존 이메일 계정의 비밀번호를 입력해 주세요." : "초기 비밀번호는 1234입니다. 로그인할 수 없으면 운영진에게 문의해 주세요."}</small><button type="button" className="password-reset-link" onClick={() => { setLegacyEmail((value) => !value); setPhone(""); setErrorMessage(null); }}>{legacyEmail ? "전화번호로 로그인" : "기존 이메일 계정 로그인"}</button></form><div className="auth-divider"><span>또는</span></div><button type="button" className="social kakao" disabled={busy} onClick={() => onSignIn("kakao")}><span>●</span> 카카오로 로그인</button><button type="button" className="social google" disabled={busy} onClick={() => onSignIn("google")}><span>G</span> Google로 로그인</button><small>카카오·Google 로그인은 마이페이지에서 미리 연결한 회원만 사용할 수 있습니다.</small></div></div>;
}

function AccountModal({ user, profile, busy, onClose, onLink, onSignOut }: { user: User; profile: Profile; busy: boolean; onClose: () => void; onLink: (provider: "google" | "kakao") => void; onSignOut: () => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const providers = new Set((user.identities ?? []).map((identity) => identity.provider));
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="마이페이지"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">MY ACCOUNT</span><h2>마이페이지</h2><div className="read-box"><b>{profile.name}</b><p>{profile.phone?.replace(/^\+82/, "0") ?? "전화번호 미등록"} · {profile.position ?? "포지션 미정"}</p></div><p className="form-description">간편 로그인 계정을 연결하면 다음부터 해당 계정으로도 로그인할 수 있습니다.</p><button type="button" className="social kakao" disabled={busy || providers.has("custom:kakao")} onClick={() => onLink("kakao")}><Link2 size={17} /> {providers.has("custom:kakao") ? "카카오 연결됨" : "카카오 계정 연결"}</button><button type="button" className="social google" disabled={busy || providers.has("google")} onClick={() => onLink("google")}><Link2 size={17} /> {providers.has("google") ? "Google 연결됨" : "Google 계정 연결"}</button><button type="button" className="cta secondary" onClick={() => void onSignOut()}><LogOut size={17} /> 로그아웃</button></div></div>;
}

function UnlinkedAccountModal({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="계정 연결 필요"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">ACCOUNT NOTICE</span><h2>계정 연결이 필요합니다</h2><div className="read-box"><b>회원 프로필을 찾지 못했습니다</b><p>로그인은 완료됐지만 이 계정은 아직 경충FC 회원 프로필에 연결되지 않았습니다.</p></div><p className="form-description">운영진에게 계정 연결을 문의해 주세요. 다른 계정으로 로그인하려면 먼저 로그아웃할 수 있습니다.</p><Link href={tabPaths.feedback} className="cta secondary" onClick={onClose}>운영진에게 문의하기 <ChevronRight size={17} /></Link><button type="button" className="cta secondary" onClick={() => void onSignOut()}><LogOut size={17} /> 로그아웃</button></div></div>;
}

function Home({ upcoming, notice, feeStanding, goingCount, memberCount, user, publicLoading, eventLoadError, noticeLoadError, onRetry, onNavigate, onAttendance, myAttendance }: { upcoming?: Event; notice?: Notice; feeStanding: FeeStanding | null; goingCount: number; memberCount: number; user: User | null; publicLoading: boolean; eventLoadError: boolean; noticeLoadError: boolean; onRetry: () => void; onNavigate: (tab: Tab) => void; onAttendance: (status: Attendance["status"]) => void; myAttendance?: Attendance["status"] }) {
  const date = upcoming ? new Date(upcoming.starts_at) : null;
  const now = new Date();
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow"><span /> EST. 2014 · SEOUL</span><h1>우리의 주말,<br /><em>우리의 풋살.</em></h1><div className="lead-row"><strong>2026<br />SEASON</strong><p>경쟁보다 함께 뛰는 즐거움. 경충FC는 주말마다 모여 공을 차고, 땀 흘리고, 오래 함께할 사람을 만듭니다.</p></div><div className="hero-actions"><button className="cta" onClick={() => onNavigate("events")}>다음 일정 참석하기 <ChevronRight /></button><button className="text-link" onClick={() => onNavigate("participation")}>팀 의사결정 참여</button></div></div>
    <div className="fixture-side"><span className="giant-number" aria-hidden="true">{date?.getDate().toString().padStart(2, "0") ?? "FC"}</span><span className="eyebrow light">NEXT SCHEDULE</span>{publicLoading ? <article className="schedule-card schedule-loading" role="status" aria-label="일정을 불러오는 중"><span /><span /><span /></article> : eventLoadError ? <article className="schedule-card schedule-empty schedule-error"><AlertCircle /><small>SCHEDULE ERROR</small><h2>일정을 불러오지 못했습니다.</h2><p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p><button type="button" onClick={onRetry}>다시 시도</button></article> : upcoming ? <article className="schedule-card"><header className="schedule-head"><span>다가오는 팀 일정</span><strong>{formatRelativeDate(upcoming.starts_at)}</strong></header><div className="schedule-main"><time className="schedule-date" dateTime={upcoming.starts_at}><small>{date?.toLocaleDateString("ko-KR", { month: "long" })}</small><b>{date?.getDate().toString().padStart(2, "0")}</b><span>{date?.toLocaleDateString("ko-KR", { weekday: "long" })}</span></time><div className="schedule-copy"><small>WEEKEND FUTSAL</small><h2>{upcoming.title}</h2><dl><div><dt>시간</dt><dd>{formatTime(upcoming.starts_at)}</dd></div><div><dt>장소</dt><dd>{upcoming.venue}</dd></div></dl><a className="map-link" href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={15} /><span>{upcoming.address || upcoming.venue}</span><small>네이버 지도</small></a></div></div><div className="schedule-foot"><div>{user && <span>참석 예정 <b>{goingCount}명</b>{goingCount === 0 && <small> · 첫 번째로 참석해 주세요</small>}</span>}<span>참여 용병 <b>{upcoming.event_guest_players?.length ?? 0}명</b></span></div><button type="button" onClick={() => onNavigate("events")}>일정 보기 <ChevronRight size={16} /></button></div></article> : <article className="schedule-card schedule-empty"><CalendarDays /><small>UPCOMING SCHEDULE</small><h2>새 일정을 준비 중입니다.</h2><p>다음 주말 풋살 일정이 확정되면 이곳에서 바로 알려드릴게요.</p><button type="button" onClick={() => onNavigate("events")}>전체 일정 보기 <ChevronRight size={16} /></button></article>}<div className="side-stats">{user && <span><b>{memberCount}</b> ACTIVE {memberCount === 1 ? "MEMBER" : "MEMBERS"}</span>}<span><b>WEEKLY</b> SAT / SUN</span></div></div></section>
    <section className="locker"><div className="section-heading"><div><span className="eyebrow">MEMBER LOCKER ROOM</span><h2>팀 클럽하우스</h2></div><span suppressHydrationWarning>{now.getFullYear()} · {String(now.getMonth() + 1).padStart(2, "0")}</span></div><div className="panel-grid">
      <article className="panel"><div className="panel-title"><CalendarDays /><span><small>NEXT SCHEDULE RSVP</small><h3>참석 여부</h3></span></div>{upcoming ? <div className="rsvp-schedule"><time dateTime={upcoming.starts_at}>{formatDate(upcoming.starts_at)} · {formatTime(upcoming.starts_at)}</time><a href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={16} /><span><b>{upcoming.venue}</b><small>{upcoming.address || "네이버 지도에서 위치 확인"}</small></span><ChevronRight size={16} /></a></div> : <p>아직 등록된 다음 일정이 없습니다.</p>}{upcoming && <div className="rsvp"><button className={myAttendance === "going" ? "selected" : ""} aria-pressed={myAttendance === "going"} onClick={() => onAttendance("going")}>{user ? "참석" : "로그인 후 참석"}</button><button className={myAttendance === "not_going" ? "selected no" : ""} aria-pressed={myAttendance === "not_going"} onClick={() => onAttendance("not_going")}>불참</button></div>}</article>
      <article className="panel green-top"><div className="panel-title"><Megaphone /><span><small>LATEST NOTICE</small><h3>팀 공지</h3></span></div>{publicLoading ? <div className="panel-loading" role="status" aria-label="공지를 불러오는 중"><span /><span /></div> : noticeLoadError ? <><p className="panel-headline">공지를 불러오지 못했습니다.</p><button className="panel-link" onClick={onRetry}>다시 시도 <ChevronRight /></button></> : <><p className="panel-headline">{notice?.title ?? "등록된 공지가 없습니다"}</p><p>{notice?.body}</p><button className="panel-link" onClick={() => onNavigate("notices")}>전체 공지 <ChevronRight /></button></>}</article>
      <article className="panel"><div className="panel-title"><CircleDollarSign /><span><small>MEMBERSHIP FEE</small><h3>회비 현황</h3></span></div><div className="fee-amount">{!user ? "로그인 필요" : !feeStanding ? "등록 내역 없음" : feeStanding.unpaidCount > 0 ? `${feeStanding.unpaidTotal.toLocaleString()}원` : "미납 없음"}</div>{feeStanding && <><FeeStatus status={feeStanding.unpaidCount > 0 ? "unpaid" : feeStanding.paidCount > 0 ? "paid" : "exempt"} /><p className="fee-panel-note">{feeStanding.unpaidCount > 0 ? `미납 ${feeStanding.unpaidCount}건 · 납부 완료 ${feeStanding.paidCount}건` : `납부 완료 ${feeStanding.paidCount}건 · 면제 ${feeStanding.exemptCount}건`}</p></>}<button className="panel-link" onClick={() => onNavigate("fees")}>상세 보기 <ChevronRight /></button></article>
    </div></section><a className="video-banner" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer"><span className="play"><Youtube /></span><span><small>GYUNGCHUNG FILM</small><b>구장에서 기록한 경충FC의 플레이를 만나보세요.</b></span><ChevronRight /></a></>;
}

function PageIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) { return <div className="page-intro"><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{description}</p></div>; }
function Members({ profiles, user, loading, loadError, canManage, onEdit, onKick, onLogin, onRetry }: { profiles: Profile[]; user: User | null; loading: boolean; loadError: boolean; canManage: boolean; onEdit: (profile: Profile) => void; onKick: (profile: Profile) => void; onLogin: () => void; onRetry: () => void }) {
  const intro = <PageIntro kicker="SQUAD" title="함께 뛰는 사람들" description={user ? "포지션보다 이름을 먼저 기억하는 경충FC의 회원입니다." : "회원 명단은 승인된 회원에게만 공개합니다."} />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="회원 명단을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<UserRound />} title="로그인 후 회원 명단을 확인하세요" description="회원 명단은 승인된 회원에게만 공개합니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  if (profiles.length === 0) return <section className="content">{intro}<Empty icon={<UserRound />} title="공개된 회원이 없습니다" description="가입 승인이 완료된 회원이 생기면 이곳에 표시됩니다." /></section>;
  return <section className="content">{intro}{canManage && <div className="inline-management-note"><Shield size={17} /> 회원 카드의 수정·강퇴 버튼으로 회원을 관리할 수 있습니다.</div>}<div className="member-grid">{profiles.map((profile, index) => <article className="member-card" key={profile.id}><span className="member-number" aria-hidden="true">{profile.jersey_number ?? String(index + 1).padStart(2, "0")}</span><div className="avatar"><UserRound /></div><small>{profile.position ?? "PLAYER"}</small><h2>{profile.name}</h2><p>{profile.jersey_number != null ? `NO. ${profile.jersey_number} · ` : ""}JOINED {new Date(profile.joined_at).getFullYear()}</p>{(canManage || profile.role === "manager" || profile.is_system_admin) && <div className="member-card-foot"><div className="member-badges">{profile.role === "manager" && <span className="admin-badge">{profile.officer_title ? officerTitleLabels[profile.officer_title] : roleLabels.manager}</span>}{profile.is_system_admin && <span className="admin-badge system">시스템 관리자</span>}</div>{canManage && <div className="member-management-actions"><button className="resource-icon-action" aria-label={`${profile.name} 회원 정보 수정`} onClick={() => onEdit(profile)}><Pencil size={16} /></button>{profile.auth_user_id !== user.id && !profile.is_system_admin && <button className="resource-icon-action" aria-label={`${profile.name} 회원 강퇴`} onClick={() => onKick(profile)}><UserMinus size={16} /></button>}</div>}</div>}</article>)}</div></section>;
}
/* `fees` row-level security hands a regular member only their own rows, so the
   old club-wide table degenerated into their own name repeated once per month.
   Each audience now gets the screen its data can actually answer. */
function Fees({ fees, profiles, profile, events, user, loading, loadError, canManage, onCreate, onEdit, onDelete, onLogin, onRetry, onAsk }: { fees: Fee[]; profiles: Profile[]; profile: Profile | null; events: Event[]; user: User | null; loading: boolean; loadError: boolean; canManage: boolean; onCreate: () => void; onEdit: (fee: Fee) => void; onDelete: (id: string, label: string) => void; onLogin: () => void; onRetry: () => void; onAsk: () => void }) {
  const myFees = useMemo(() => fees.filter((fee) => fee.member_id === profile?.id), [fees, profile?.id]);
  const intro = <PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description={!user ? "회원에게만 공개하는 정보입니다." : canManage ? "회원별 납부 상태를 확인하고 회비를 등록·수정합니다. 관리자 월 15,000원, 일반회원 월 30,000원 또는 참여 시 10,000원을 적용합니다." : "내가 낸 회비와 아직 남은 회비를 월별로 확인합니다."} />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="회비 내역을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<CircleDollarSign />} title="로그인 후 회비를 확인하세요" description="납부 내역은 본인과 회비 담당 운영진에게만 공개합니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  return <section className="content">{intro}{canManage ? <FeeLedger fees={fees} profiles={profiles} events={events} myFees={myFees} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} onAsk={onAsk} /> : <FeeMemberView fees={myFees} profile={profile} events={events} onAsk={onAsk} />}</section>;
}

/** One member reading their own ledger: what is owed, what it is based on, what the plan is. */
function FeeMemberView({ fees, profile, events, onAsk }: { fees: Fee[]; profile: Profile | null; events: Event[]; onAsk: () => void }) {
  const standing = summarizeFees(fees);
  const plan = feePlan(profile);
  /* Participation fees are raised per schedule, so one month can hold several
     rows. Grouping by month keeps that legible instead of flattening it. */
  const months = useMemo(() => {
    const buckets = new Map<string, Fee[]>();
    fees.forEach((fee) => { const key = fee.month.slice(0, 7); buckets.set(key, [...(buckets.get(key) ?? []), fee]); });
    return Array.from(buckets.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([key, rows]) => {
      const monthlyCount = rows.filter((row) => row.fee_type === "monthly").length;
      return { key, rows: [...rows].sort((a, b) => (a.fee_type === b.fee_type ? 0 : a.fee_type === "monthly" ? -1 : 1)), standing: summarizeFees(rows), composition: [monthlyCount > 0 ? `월회비 ${monthlyCount}건` : null, rows.length - monthlyCount > 0 ? `참여비 ${rows.length - monthlyCount}건` : null].filter(Boolean).join(" · ") };
    });
  }, [fees]);
  const ask = <button type="button" className="cta small" onClick={onAsk}>총무에게 문의 <ChevronRight size={16} /></button>;
  return <>
    <div className={standing.unpaidCount > 0 ? "fee-standing owing" : "fee-standing"}>
      <div className="fee-standing-figure"><small>{standing.unpaidCount > 0 ? "내야 할 회비" : "내야 할 회비 없음"}</small><b>{standing.unpaidTotal.toLocaleString()}원</b><span>{standing.unpaidCount > 0 ? `미납 ${standing.unpaidCount}건` : "지금까지 등록된 회비를 모두 정리했습니다"}</span></div>
      <dl className="fee-standing-facts"><div><dt>내 회비 기준</dt><dd>{plan ? `${plan.label} ${plan.amount.toLocaleString()}원` : "총무 확인 필요"}<small>{plan?.note ?? "회비 방식이 아직 지정되지 않았습니다"}</small></dd></div><div><dt>납부 완료</dt><dd>{standing.paidCount}건<small>{standing.paidTotal.toLocaleString()}원</small></dd></div><div><dt>면제</dt><dd>{standing.exemptCount}건<small>{standing.exemptCount > 0 ? "납부 의무가 없는 회비입니다" : "면제 처리된 회비가 없습니다"}</small></dd></div><div><dt>마지막 납부</dt><dd>{standing.lastPaidAt ? formatDate(standing.lastPaidAt) : "기록 없음"}<small>전체 {standing.total}건 등록됨</small></dd></div></dl>
    </div>
    {/* Knowing you owe money is a dead end without a way to settle it, so the escape hatch stays on both states. */}
    {standing.unpaidCount > 0 ? <div className="unpaid-callout"><CircleDollarSign size={20} /><span><b>납부 계좌와 방법은 총무가 안내합니다</b>이미 입금했는데 미납으로 남아 있으면 의견 보내기로 알려 주세요.</span>{ask}</div> : <div className="unpaid-callout settled"><Check size={20} /><span><b>확인이 필요한 회비가 없습니다</b>금액이나 기준이 실제와 다르면 의견 보내기로 알려 주세요.</span>{ask}</div>}
    {fees.length === 0 ? <Empty icon={<CircleDollarSign />} title="등록된 회비 내역이 없습니다" description="총무가 회비를 등록하면 월별 납부 내역이 이곳에 쌓입니다." /> : <ol className="fee-month-list">{months.map((group) => <li key={group.key}>
      <div className="fee-month-head"><b>{formatFeeMonth(group.key)}</b><small>{group.composition}</small><span className={group.standing.unpaidCount > 0 ? "owing" : undefined}>{group.standing.unpaidCount > 0 ? `미납 ${group.standing.unpaidCount}건 · ${group.standing.unpaidTotal.toLocaleString()}원` : "미납 없음"}</span></div>
      <ul className="fee-entry-list">{group.rows.map((fee) => <li key={fee.id} className={`fee-entry ${fee.fee_type} ${fee.status}`}><span className="fee-entry-kind">{fee.fee_type === "participation" ? "참여비" : "월회비"}</span><span className="fee-entry-basis"><b>{feeBasis(fee, events, false)}</b><small>{fee.status === "paid" && fee.paid_at ? `${formatDate(fee.paid_at)} 납부` : fee.status === "exempt" ? "총무가 면제 처리한 회비" : fee.fee_type === "participation" ? "참여한 일정에 대한 회비" : "해당 월의 정기 회비"}</small></span><span className="fee-entry-amount">{fee.amount.toLocaleString()}원</span><FeeStatus status={fee.status} /></li>)}</ul>
    </li>)}</ol>}
  </>;
}

/** The officer answer to "has 김OO paid?": one row group per member, unpaid members first. */
function FeeLedger({ fees, profiles, events, myFees, onCreate, onEdit, onDelete, onAsk }: { fees: Fee[]; profiles: Profile[]; events: Event[]; myFees: Fee[]; onCreate: () => void; onEdit: (fee: Fee) => void; onDelete: (id: string, label: string) => void; onAsk: () => void }) {
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const groups = useMemo(() => {
    const byMember = new Map<string, { id: string; name: string; plan: ReturnType<typeof feePlan>; rows: Fee[] }>();
    fees.forEach((fee) => {
      const owner = profiles.find((item) => item.id === fee.member_id);
      const group = byMember.get(fee.member_id) ?? { id: fee.member_id, name: fee.profiles?.name ?? owner?.name ?? "회원", plan: feePlan(owner), rows: [] };
      group.rows.push(fee);
      byMember.set(fee.member_id, group);
    });
    return Array.from(byMember.values()).map((group) => ({ ...group, standing: summarizeFees(group.rows) })).sort((a, b) => b.standing.unpaidTotal - a.standing.unpaidTotal || b.standing.unpaidCount - a.standing.unpaidCount || a.name.localeCompare(b.name, "ko"));
  }, [fees, profiles]);
  const owing = groups.filter((group) => group.standing.unpaidCount > 0);
  const owingTotal = owing.reduce((sum, group) => sum + group.standing.unpaidTotal, 0);
  const myUnpaidCount = myFees.filter((fee) => fee.status === "unpaid").length;
  const visible = unpaidOnly ? owing : groups;
  return <>
    {myUnpaidCount > 0 && <div className="unpaid-callout"><CircleDollarSign size={20} /><span><b>본인 회비도 {myUnpaidCount}건 미납입니다</b>아래 명단에서 본인 이름을 찾아 확인하거나, 의견 보내기로 문의해 주세요.</span><button type="button" className="cta small" onClick={onAsk}>총무에게 문의 <ChevronRight size={16} /></button></div>}
    <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 회비 등록</button></div>
    <div className="fee-ledger-head">
      <dl className="fee-ledger-summary"><div className={owing.length > 0 ? "owing" : undefined}><dt>미납 회원</dt><dd>{owing.length}명</dd></div><div className={owingTotal > 0 ? "owing" : undefined}><dt>미납 합계</dt><dd>{owingTotal.toLocaleString()}원</dd></div><div><dt>등록 회원</dt><dd>{groups.length}명</dd></div><div><dt>등록 건수</dt><dd>{fees.length}건</dd></div></dl>
      <div className="fee-filter" role="group" aria-label="표시할 회원 범위"><button type="button" className={unpaidOnly ? undefined : "selected"} aria-pressed={!unpaidOnly} onClick={() => setUnpaidOnly(false)}>전체 {groups.length}명</button><button type="button" className={unpaidOnly ? "selected" : undefined} aria-pressed={unpaidOnly} onClick={() => setUnpaidOnly(true)}>미납 {owing.length}명</button></div>
    </div>
    {visible.length === 0 ? <Empty icon={<CircleDollarSign />} title={fees.length === 0 ? "등록된 회비 내역이 없습니다" : "미납 회원이 없습니다"} description={fees.length === 0 ? "회비 등록으로 회원별 납부 상태를 만들어 주세요." : "등록된 회비가 모두 납부되었거나 면제 처리되었습니다."} /> : <div className="table-wrap fee-ledger scroll-region" tabIndex={0} role="region" aria-label="회원별 회비 납부 현황"><table><caption className="sr-only">회원별 회비 납부 현황. 회원 이름 행 아래에 그 회원의 회비 내역이 이어집니다.</caption><thead><tr><th scope="col">기준</th><th scope="col">구분</th><th scope="col">금액</th><th scope="col">상태</th><th scope="col">관리</th></tr></thead>{visible.map((group) => <tbody key={group.id}>
      <tr className={group.standing.unpaidCount > 0 ? "fee-member-row owing" : "fee-member-row"}><th scope="colgroup" colSpan={5}><div><span className="fee-member-mark" aria-hidden="true">{group.name.slice(0, 1)}</span><span className="fee-member-name"><b>{group.name}</b><small>{group.plan ? `${group.plan.label} ${group.plan.amount.toLocaleString()}원` : "회비 기준 미설정"}</small></span><span className="fee-member-standing">{group.standing.unpaidCount > 0 ? `미납 ${group.standing.unpaidCount}건 · ${group.standing.unpaidTotal.toLocaleString()}원` : `미납 없음 · 납부 ${group.standing.paidCount}건`}</span></div></th></tr>
      {group.rows.map((fee) => { const feeLabel = `${group.name} · ${fee.month.slice(0, 7)} ${fee.fee_type === "participation" ? "참여비" : "월회비"}`; return <tr key={fee.id}><th scope="row">{feeBasis(fee, events)}</th><td>{fee.fee_type === "participation" ? "참여비" : "월회비"}</td><td>{fee.amount.toLocaleString()}원</td><td><FeeStatus status={fee.status} /></td><td><div className="resource-actions"><button aria-label={`${feeLabel} 수정`} onClick={() => onEdit(fee)}><Pencil size={16} /></button><button aria-label={`${feeLabel} 삭제`} onClick={() => onDelete(fee.id, feeLabel)}><Trash2 size={16} /></button></div></td></tr>; })}
    </tbody>)}</table></div>}
  </>;
}
function FeeStatus({ status }: { status: Fee["status"] }) { return <span className={`status ${status}`}>{status === "paid" ? "납부 완료" : status === "exempt" ? "면제" : "미납"}</span>; }
type FeeStanding = { total: number; unpaidCount: number; unpaidTotal: number; paidCount: number; paidTotal: number; exemptCount: number; lastPaidAt: string | null };
/** `exempt` is neither paid nor unpaid, so it is counted on its own line everywhere it surfaces. */
function summarizeFees(rows: Fee[]): FeeStanding {
  const unpaid = rows.filter((row) => row.status === "unpaid");
  const paid = rows.filter((row) => row.status === "paid");
  const paidDates = paid.map((row) => row.paid_at).filter((value): value is string => Boolean(value)).sort();
  return { total: rows.length, unpaidCount: unpaid.length, unpaidTotal: unpaid.reduce((sum, row) => sum + row.amount, 0), paidCount: paid.length, paidTotal: paid.reduce((sum, row) => sum + row.amount, 0), exemptCount: rows.length - unpaid.length - paid.length, lastPaidAt: paidDates[paidDates.length - 1] ?? null };
}
/** Standard dues by account type, mirroring the amount the fee editor applies. */
function feePlan(profile: Profile | null | undefined) {
  if (!profile) return null;
  if (profile.role === "manager") return { label: "관리자 월회비", amount: 15000, note: "직책과 무관하게 매월 15,000원" };
  if (profile.fee_plan === "per_event") return { label: "참여비", amount: 10000, note: "참여한 일정마다 10,000원" };
  return { label: "월회비", amount: 30000, note: "매월 30,000원" };
}
function formatFeeMonth(month: string) { const [year, value] = month.slice(0, 7).split("-"); return `${year}년 ${Number(value)}월`; }
/** A participation fee belongs to a schedule, a monthly fee to a month — naming the source is what makes five rows in one month readable. */
function feeBasis(fee: Fee, events: Event[], withMonth = true) {
  if (fee.fee_type !== "participation") return withMonth ? `${formatFeeMonth(fee.month)} 정기 회비` : "정기 회비";
  const event = events.find((item) => item.id === fee.event_id);
  if (event) return `${new Date(event.starts_at).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} · ${event.title}`;
  return withMonth ? `${formatFeeMonth(fee.month)} 참여 일정` : "참여 일정";
}
function Notices({ notices, loading, loadError, canManage, onCreate, onEdit, onDelete, onRetry }: { notices: Notice[]; loading: boolean; loadError: boolean; canManage: boolean; onCreate: () => void; onEdit: (notice: Notice) => void; onDelete: (id: string, label: string) => void; onRetry: () => void }) {
  const intro = <PageIntro kicker="NOTICE BOARD" title="공지사항" description="놓치면 안 되는 클럽 소식을 전합니다." />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="공지를 불러오는 중" /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  return <section className="content">{intro}{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 공지 등록</button></div>}{notices.length === 0 ? <Empty icon={<Megaphone />} title="등록된 공지가 없습니다" description="운영진이 공지를 올리면 이곳에 표시됩니다." /> : <div className="notice-list">{notices.map((notice, index) => <article key={notice.id}><span className="notice-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div>{notice.is_pinned && <small className="pin">고정</small>}{isRecent(notice.created_at) && <small className="badge-new">새 공지</small>}<h2>{notice.title}</h2><p>{notice.body}</p><time dateTime={notice.created_at}>{formatDate(notice.created_at)}</time></div>{canManage && <div className="resource-actions"><button aria-label={`${notice.title} 수정`} onClick={() => onEdit(notice)}><Pencil size={16} /></button><button aria-label={`${notice.title} 삭제`} onClick={() => onDelete(notice.id, notice.title)}><Trash2 size={16} /></button></div>}</article>)}</div>}</section>;
}

/** The calendar owns day selection: each in-month day is one button, and the
    chips inside it are labels, so a day holding two events is still one pick. */
function MonthCalendar({ events, selectedKey, onSelect }: { events: Event[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const initialDate = (selectedKey ? parseEventDateKey(selectedKey) : null) ?? new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const days = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const eventsByDate = new Map<string, Event[]>();
    events.forEach((event) => {
      const key = toEventDateKey(event.starts_at);
      eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), event]);
    });
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = toDateKey(date);
      return { date, key, events: eventsByDate.get(key) ?? [] };
    });
  }, [events, visibleMonth]);
  const moveMonth = (offset: number) => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + offset, 1));
  const today = new Date();
  return <section className="month-calendar" aria-labelledby="month-calendar-title">
    <header><div><small>MONTHLY SCHEDULE</small><h2 id="month-calendar-title">{visibleMonth.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</h2></div><div className="month-calendar-controls"><button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeft /></button><button type="button" onClick={() => setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>이번 달</button><button type="button" onClick={() => moveMonth(1)} aria-label="다음 달"><ChevronRight /></button></div></header>
    <div className="month-calendar-scroll scroll-region" tabIndex={0} role="region" aria-label={`${visibleMonth.getFullYear()}년 ${visibleMonth.getMonth() + 1}월 일정 달력`}><div className="month-calendar-grid"><div className="month-calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div><div className="month-calendar-days">{days.map(({ date, key, events: dayEvents }) => {
      const isToday = date.toDateString() === today.toDateString();
      const marks = <><time dateTime={`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`}>{date.getDate()}</time>{dayEvents.map((event) => <span key={event.id} className="day-event"><b>{formatTime(event.starts_at)}</b><span>{event.title}</span></span>)}</>;
      if (date.getMonth() !== visibleMonth.getMonth()) return <div key={key} className="outside">{marks}</div>;
      const isSelected = selectedKey === key;
      return <button key={key} type="button" className={`${isToday ? "today " : ""}${isSelected ? "selected" : ""}`.trim() || undefined} aria-pressed={isSelected} aria-controls={events.length > 0 ? "event-focus" : undefined} aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 ${date.toLocaleDateString("ko-KR", { weekday: "long" })}${isToday ? " 오늘" : ""} · ${dayEvents.length > 0 ? `일정 ${dayEvents.length}개` : "일정 없음"}`} onClick={() => onSelect(key)}>{marks}</button>;
    })}</div></div></div>
  </section>;
}

function Events({ events, attendance, user, profile, loading, loadError, canManage, onCreate, onEdit, onManageMatch, onManageAttendance, onDelete, onAttendance, onLogin, onRetry }: { events: Event[]; attendance: Attendance[]; user: User | null; profile: Profile | null; loading: boolean; loadError: boolean; canManage: boolean; onCreate: () => void; onEdit: (event: Event) => void; onManageMatch: (event: Event) => void; onManageAttendance: (event: Event) => void; onDelete: (id: string, label: string) => void; onAttendance: (status: Attendance["status"], eventId?: string) => void; onLogin: () => void; onRetry: () => void }) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const focusRef = useRef<HTMLElement>(null);
  /** Events arrive after this component mounts, so the default day is derived
      instead of seeded into state: the next upcoming day, or — once the season
      has no dates left — the most recent past one. The summary is never blank. */
  const defaultKey = useMemo(() => {
    const now = Date.now();
    const fallback = events.find((event) => new Date(event.starts_at).getTime() >= now) ?? events[events.length - 1];
    return fallback ? toEventDateKey(fallback.starts_at) : null;
  }, [events]);
  const selectedKey = pickedKey ?? defaultKey;
  const selectedDate = selectedKey ? parseEventDateKey(selectedKey) : null;
  /** Events load ordered by start time, so a day holding two of them keeps that order. */
  const selectedEvents = useMemo(() => (selectedKey ? events.filter((event) => toEventDateKey(event.starts_at) === selectedKey) : []), [events, selectedKey]);
  /** `block: "nearest"` only scrolls when the summary is off screen — the common
      case on a phone, where the grid fills the viewport — and it inherits the
      reduced-motion scroll behaviour declared on `html`. */
  const selectDay = (key: string) => { setPickedKey(key); focusRef.current?.scrollIntoView({ block: "nearest" }); };
  const intro = <PageIntro kicker="WEEKEND SCHEDULE" title="우리의 일정" description="월간 달력에서 날짜를 선택하면 그날의 일정을 바로 확인하고, 상세 화면에서 참석 명단과 경기 기록을 볼 수 있습니다." />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="일정을 불러오는 중" /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  /* The calendar is the only index of dates; below it exactly one day is
     summarised. Roster, teams, match results and MOM stay on the day page at
     /events/YYYYMMDD so this panel keeps to what fits in a glance. */
  return <section className="content">{intro}{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 일정 등록</button></div>}<MonthCalendar events={events} selectedKey={selectedKey} onSelect={selectDay} />{events.length === 0 ? <Empty icon={<CalendarDays />} title="등록된 일정이 없습니다" description="운영진이 주말 일정을 등록하면 이곳에 표시됩니다." /> : <section ref={focusRef} id="event-focus" className="event-focus" aria-labelledby="event-focus-title">
    <header className="event-focus-head" aria-live="polite"><h2 id="event-focus-title">{selectedDate ? `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 ${selectedDate.toLocaleDateString("ko-KR", { weekday: "long" })}` : "날짜를 선택해 주세요"}</h2><span>{selectedEvents.length > 0 ? `일정 ${selectedEvents.length}개` : "일정 없음"}</span></header>
    {selectedEvents.length === 0 ? <Empty icon={<CalendarDays />} title="이 날짜에는 일정이 없습니다" description="달력에서 초록색 일정 표시가 있는 날짜를 선택해 주세요." /> : selectedEvents.map((event) => {
      const eventAttendance = attendance.filter((item) => item.event_id === event.id);
      const goingCount = eventAttendance.filter((item) => item.status === "going").length;
      const presentCount = eventAttendance.filter((item) => getCheckInStatus(item) === "present").length;
      const guestCount = event.event_guest_players?.length ?? 0;
      const isPast = new Date(event.starts_at) < new Date();
      const eventDate = new Date(event.starts_at);
      /* Teams themselves stay on the day page; the card only carries the
         signal that they exist and, for a signed-in member, which one is
         theirs — the question a member actually opens the card to answer. */
      const teams = event.event_teams ?? [];
      const hasTeams = teams.length > 0;
      const myTeam = profile ? teams.find((team) => team.event_team_members.some((member) => member.profile_id === profile.id)) : undefined;
      return <article key={event.id} className={`event-card${isPast ? " past" : ""}`}><time className="event-date" dateTime={event.starts_at}><small>{eventDate.getFullYear()} · {eventDate.toLocaleDateString("ko-KR", { month: "long" })}</small><b>{String(eventDate.getDate()).padStart(2, "0")}</b><span>{eventDate.toLocaleDateString("ko-KR", { weekday: "long" })}</span></time><div className="event-info"><small>{isPast ? "지난 일정" : "WEEKLY FUTSAL"}{event.is_competitive ? " · 커피 내기" : ""}</small><h2><Link className="event-card-link" href={eventDatePath(event.starts_at)}>{event.title}</Link></h2><p><MapPin size={16} /> {event.venue}<span className="event-meta-time">· {formatTime(event.starts_at)}</span></p>{hasTeams && (myTeam ? <span className="event-team-badge">내 팀 · {myTeam.team_name}</span> : <a className="event-team-badge unassigned" href={`${eventDatePath(event.starts_at)}?section=teams`}>팀 명단 보기</a>)}</div><div className="event-action"><b>{isPast ? `출석 ${presentCount}명` : `참석 예정 ${goingCount}명`} · 용병 {guestCount}명{hasTeams ? ` · ${teams.length}팀 편성` : ""}</b>{canManage && <div className="resource-actions"><button aria-label={`${event.title} 수정`} onClick={() => onEdit(event)}><Pencil size={16} /></button><button aria-label={`${event.title} 삭제`} onClick={() => onDelete(event.id, `${formatDate(event.starts_at)} · ${event.title}`)}><Trash2 size={16} /></button></div>}<button className="cta small" disabled={isPast} onClick={() => user ? onAttendance("going", event.id) : onLogin()}>{isPast ? "지난 일정" : "참석하기"}</button>{canManage && <div className="officer-menu" role="group" aria-label={`${event.title} 운영 메뉴`}><button type="button" className="officer-menu-item" aria-label={`출석 체크 · ${event.title}`} onClick={() => onManageAttendance(event)}><ClipboardCheck size={17} /> 출석 체크</button><button type="button" className="officer-menu-item" aria-label={`팀·경기 기록 · ${event.title}`} onClick={() => onManageMatch(event)}><Trophy size={17} /> 팀·경기 기록</button></div>}</div><ChevronRight className="event-open-cue" size={20} aria-hidden="true" /></article>;
    })}
  </section>}</section>;
}

function Rankings({ rankings, goalEvents, momLeaderboard, user, profile, loading, loadError, onLogin, onRetry }: { rankings: MemberRanking[]; goalEvents: Event[]; momLeaderboard: MomLeaderboardEntry[]; user: User | null; profile: Profile | null; loading: boolean; loadError: boolean; onLogin: () => void; onRetry: () => void }) {
  const goalRankings = useMemo(() => {
    const totals = new Map<string, { member_id: string; member_name: string; goals: number; scoring_event_ids: Set<string> }>();
    const addGoals = (eventId: string, memberId: string | null, memberName: string, goals: number) => {
      if (!memberId || goals <= 0) return;
      const current = totals.get(memberId) ?? { member_id: memberId, member_name: memberName, goals: 0, scoring_event_ids: new Set<string>() };
      current.member_name = memberName;
      current.goals += goals;
      current.scoring_event_ids.add(eventId);
      totals.set(memberId, current);
    };
    goalEvents.forEach((event) => {
      if (event.event_matches?.length) {
        event.event_matches.forEach((match) => match.event_match_scorers.forEach((scorer) => addGoals(event.id, scorer.profile_id, scorer.scorer_name, scorer.goals)));
        return;
      }
      event.event_teams?.forEach((team) => team.event_team_members.forEach((member) => addGoals(event.id, member.profile_id, member.participant_name, member.goals)));
    });
    return Array.from(totals.values()).map(({ scoring_event_ids, ...ranking }) => ({ ...ranking, scoring_event_count: scoring_event_ids.size })).sort((a, b) => b.goals - a.goals || b.scoring_event_count - a.scoring_event_count || a.member_name.localeCompare(b.member_name, "ko"));
  }, [goalEvents]);
  const intro = <PageIntro kicker="CLUB RANKING" title="클럽 랭킹" description="출석·회비 활동과 득점, MOM 기록을 한곳에서 확인합니다. 금액과 개인 연락처는 공개하지 않습니다." />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="활동 기록을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<Shield />} title="로그인 후 클럽 기록을 확인하세요" description="득점과 활동, MOM 기록을 모아 보여주는 회원 전용 대시보드입니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  if (profile?.status !== "active") return <section className="content">{intro}<Empty icon={<Shield />} title="회원 승인 후 확인할 수 있습니다" description="가입 승인이 완료되면 활동 랭킹이 공개됩니다." /></section>;
  return <section className="content">{intro}<div className="ranking-layout"><div><div className="section-heading compact"><div><span className="eyebrow">GOAL LEADERS</span><h2>득점 순위</h2></div></div><p className="section-note">경기별 득점 기록을 우선하고, 없는 일정은 팀 종합 기록을 사용해 전체 기간 득점을 합산합니다. 용병 기록은 회원 순위에서 제외합니다.</p><div className="table-wrap ranking-table scroll-region" tabIndex={0} role="region" aria-label="회원별 누적 득점 순위"><table><caption className="sr-only">회원별 누적 득점 순위</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">득점 일정</th><th scope="col">누적 득점</th></tr></thead><tbody>{goalRankings.map((ranking, index) => <tr key={ranking.member_id}><td><span className="rank-badge">{index + 1}</span></td><th scope="row">{ranking.member_name}</th><td>{ranking.scoring_event_count}회</td><td><b>{ranking.goals}골</b></td></tr>)}</tbody></table>{goalRankings.length === 0 && <Empty icon={<Shield />} title="아직 득점 기록이 없습니다" description="경기 결과에 회원 득점이 등록되면 순위가 표시됩니다." />}</div></div><div><div className="section-heading compact"><div><span className="eyebrow">ACTIVITY</span><h2>활동 순위</h2></div></div><p className="section-note">실제 출석 1회는 3점, 회비 납부 1개월은 1점으로 집계합니다.</p><div className="table-wrap ranking-table scroll-region" tabIndex={0} role="region" aria-label="회원별 출석 및 회비 납부 활동 순위"><table><caption className="sr-only">회원별 출석 및 회비 납부 활동 순위</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">실제 출석</th><th scope="col">회비 납부</th><th scope="col">종합 점수</th></tr></thead><tbody>{rankings.map((ranking, index) => <tr key={ranking.member_id}><td><span className="rank-badge">{index + 1}</span></td><th scope="row">{ranking.member_name}</th><td>{ranking.attendance_count}회</td><td>{ranking.paid_fee_count}개월</td><td><b>{ranking.total_score}점</b></td></tr>)}</tbody></table>{rankings.length === 0 && <Empty icon={<CalendarDays />} title="아직 집계된 기록이 없습니다" description="실제 출석이나 회비 납부 기록이 등록되면 순위가 표시됩니다." />}</div></div><div><div className="section-heading compact"><div><span className="eyebrow">MOM HALL OF FAME</span><h2>MOM 명예의 전당</h2></div></div><p className="section-note">MOM(Man of the Match)은 그날 경기의 최우수 선수입니다. 일정이 끝나면 실제 출석한 회원끼리 본인을 제외하고 한 명씩 투표해 상위 3명을 정합니다.</p><div className="table-wrap ranking-table scroll-region" tabIndex={0} role="region" aria-label="회원별 MOM 수상 및 득표 순위"><table><caption className="sr-only">회원별 MOM 수상 및 득표 순위</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">1위</th><th scope="col">2위</th><th scope="col">3위</th><th scope="col">득표</th></tr></thead><tbody>{momLeaderboard.map((ranking, index) => <tr key={ranking.member_id}><td><span className="rank-badge">{index + 1}</span></td><th scope="row">{ranking.member_name}</th><td>{ranking.first_place_count}회</td><td>{ranking.second_place_count}회</td><td>{ranking.third_place_count}회</td><td>{ranking.total_votes}표</td></tr>)}</tbody></table>{momLeaderboard.length === 0 && <Empty icon={<Shield />} title="아직 MOM 기록이 없습니다" description="지난 일정에서 MOM 투표가 진행되면 이곳에 집계됩니다." />}</div></div></div></section>;
}
function formatDate(value: string) { return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }); }
function formatRelativeDate(value: string) {
  const target = new Date(value);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const days = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
  const relative = days === 0 ? "오늘" : days === 1 ? "내일" : days > 1 && days < 7 ? `이번 주 ${target.toLocaleDateString("ko-KR", { weekday: "long" })}` : formatDate(value);
  return `${relative} · ${target.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} ${formatTime(value)}${days >= 0 ? ` (D-${days})` : ""}`;
}
function formatTime(value: string) { return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); }
/** Notices posted within a week carry a badge so members can spot what changed. */
function isRecent(value: string, days = 7) { return Date.now() - new Date(value).getTime() < days * 86_400_000; }
function naverMapUrl(event: Pick<Event, "venue" | "address">) { return `https://map.naver.com/p/search/${encodeURIComponent([event.venue, event.address].filter(Boolean).join(" "))}`; }
