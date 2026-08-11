"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CalendarDays, Check, ChevronRight, CircleDollarSign, LogIn, LogOut, MapPin, Menu, Megaphone, Pencil, Plus, Shield, Trash2, UserRound, X, Youtube } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Fee, Feedback, GuestFee, GuestPlayer, MemberRanking, MomLeaderboardEntry, Notice, OfficerPermission, OfficerTitle, ParticipationForm, ParticipationKind, ParticipationSubmission, Profile, RolePermission } from "@/lib/types";
import type { EditorConfig } from "@/components/admin-console";

const FeedbackHub = dynamic(() => import("@/components/feedback-hub"));
const ParticipationHub = dynamic(() => import("@/components/participation-hub"));
const AdminConsole = dynamic(() => import("@/components/admin-console"));
const AdminEditor = dynamic(() => import("@/components/admin-console").then((module) => module.AdminEditor));

type Tab = "home" | "members" | "fees" | "notices" | "events" | "rankings" | "feedback" | "participation" | "admin";
type PasswordAuthMode = "login" | "signup";
const roleLabels: Record<Profile["role"], string> = { member: "일반 회원", manager: "관리자" };
const officerTitleLabels: Record<OfficerTitle, string> = { president: "회장", vice_president: "부회장", treasurer: "총무" };
const navItems: [Tab, string][] = [["home", "홈"], ["members", "회원"], ["fees", "회비"], ["notices", "공지"], ["events", "일정"], ["rankings", "랭킹"], ["feedback", "의견"], ["participation", "참여"]];
const tabPaths: Record<Tab, string> = { home: "/", members: "/members", fees: "/fees", notices: "/notices", events: "/events", rankings: "/rankings", feedback: "/feedback", participation: "/participation", admin: "/admin" };
const pathTabs = new Map(Object.entries(tabPaths).map(([tab, path]) => [path, tab as Tab]));

const nextSaturday = (() => { const date = new Date(); date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7)); date.setHours(18, 0, 0, 0); return date.toISOString(); })();
const sampleEvents: Event[] = [{ id: "sample-event", title: "주말 정기 풋살", starts_at: nextSaturday, venue: "브라보 풋살장", address: "서울시 송파구", note: "흰색·검정색 유니폼을 모두 챙겨주세요.", capacity: 18, is_competitive: false, team_mode: null, event_guest_players: [], event_teams: [] }];
const sampleNotices: Notice[] = [{ id: "sample-notice", title: "이번 주 풋살 참석 여부를 알려주세요", body: "목요일 밤 10시까지 참석 버튼을 눌러주세요. 인원에 맞춰 팀을 나눕니다.", is_pinned: true, created_at: new Date().toISOString() }];

export default function Clubhouse() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<Event[]>(sampleEvents);
  const [guestPlayers, setGuestPlayers] = useState<GuestPlayer[]>([]);
  const [rankings, setRankings] = useState<MemberRanking[]>([]);
  const [momVotes, setMomVotes] = useState<EventMomVote[]>([]);
  const [momResults, setMomResults] = useState<EventMomResult[]>([]);
  const [momLeaderboard, setMomLeaderboard] = useState<MomLeaderboardEntry[]>([]);
  const [notices, setNotices] = useState<Notice[]>(sampleNotices);
  const [fees, setFees] = useState<Fee[]>([]);
  const [guestFees, setGuestFees] = useState<GuestFee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [forms, setForms] = useState<ParticipationForm[]>([]);
  const [submissions, setSubmissions] = useState<ParticipationSubmission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [officerPermissions, setOfficerPermissions] = useState<OfficerPermission[]>([]);
  const [quickEditor, setQuickEditor] = useState<EditorConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const authLoadKeyRef = useRef<string | undefined>(undefined);

  const loadData = useCallback(async (currentUser?: User | null) => {
    if (!supabase) return;
    const [eventRes, noticeRes, formRes] = await Promise.all([
      supabase.from("events").select("id, title, starts_at, venue, address, note, capacity, is_competitive, team_mode, event_guest_players(event_id, guest_player_id, guest_name, guest_position, created_at), event_teams(id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating))").order("starts_at"),
      supabase.from("notices").select("id, title, body, is_pinned, created_at").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("participation_forms").select("*, participation_questions(*, participation_options(*))").order("created_at", { ascending: false }),
    ]);
    const loadedEvents = (eventRes.data as Event[] | null) ?? [];
    if (loadedEvents.length) setEvents(loadedEvents);
    if (noticeRes.data?.length) setNotices(noticeRes.data as Notice[]);
    if (formRes.data) setForms((formRes.data as ParticipationForm[]).map((form) => ({ ...form, participation_questions: [...(form.participation_questions ?? [])].sort((a, b) => a.position - b.position).map((question) => ({ ...question, participation_options: [...(question.participation_options ?? [])].sort((a, b) => a.position - b.position) })) })));
    if (!currentUser) {
      setProfiles([]); setMe(null); setFees([]); setGuestFees([]); setAttendance([]); setFeedback([]); setSubmissions([]); setRolePermissions([]); setOfficerPermissions([]); setGuestPlayers([]); setRankings([]); setMomVotes([]); setMomResults([]); setMomLeaderboard([]); return;
    }
    const [profileRes, allProfileRes, applicationRes, feeRes, guestFeeRes, attendanceRes, feedbackRes, submissionRes, permissionRes, officerPermissionRes, guestRes, rankingRes, momVoteRes, momResultRes, momLeaderboardRes] = await Promise.all([
      supabase.rpc("get_member_directory"),
      supabase.from("profiles").select("*").order("name"),
      supabase.from("membership_applications").select("*"),
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
    const applications = applicationRes.data ?? [];
    const privateProfiles = (allProfileRes.data as Profile[] | null) ?? [];
    const visibleProfiles = new Map(((profileRes.data as Profile[] | null) ?? []).map((profile) => [profile.id, profile]));
    privateProfiles.forEach((profile) => visibleProfiles.set(profile.id, { ...visibleProfiles.get(profile.id), ...profile }));
    const enrichedProfiles = Array.from(visibleProfiles.values())
      .map((profile) => ({ ...profile, membership_application: applications.find((application) => application.member_id === profile.id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const ownProfile = privateProfiles.find((profile) => profile.id === currentUser.id) ?? null;
    setProfiles(enrichedProfiles);
    setMe(ownProfile ? {
      ...ownProfile,
      membership_application: applications.find((application) => application.member_id === ownProfile.id) ?? null,
    } : null);
    const guestAppearances = new Map<string, number>();
    loadedEvents.flatMap((event) => event.event_guest_players ?? []).forEach((guest) => guestAppearances.set(guest.guest_player_id, (guestAppearances.get(guest.guest_player_id) ?? 0) + 1));
    const loadedGuests = ((guestRes.data ?? []) as Omit<GuestPlayer, "appearance_count">[]).map((guest) => ({ ...guest, appearance_count: guestAppearances.get(guest.id) ?? 0 })).sort((a, b) => b.appearance_count - a.appearance_count || a.name.localeCompare(b.name, "ko"));
    setFees((feeRes.data as unknown as Fee[]) ?? []); setGuestFees((guestFeeRes.data as unknown as GuestFee[]) ?? []); setAttendance((attendanceRes.data as Attendance[]) ?? []); setFeedback((feedbackRes.data as Feedback[]) ?? []); setSubmissions((submissionRes.data as ParticipationSubmission[]) ?? []); setRolePermissions((permissionRes.data as RolePermission[]) ?? []); setOfficerPermissions((officerPermissionRes.data as OfficerPermission[]) ?? []); setGuestPlayers(loadedGuests); setRankings((rankingRes.data as MemberRanking[]) ?? []); setMomVotes((momVoteRes.data as EventMomVote[]) ?? []); setMomResults((momResultRes.data as EventMomResult[]) ?? []); setMomLeaderboard((momLeaderboardRes.data as MomLeaderboardEntry[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      const authLoadKey = nextUser?.id ?? "anonymous";
      if (authLoadKeyRef.current === authLoadKey) return;
      authLoadKeyRef.current = authLoadKey;
      setUser(nextUser);
      setAuthLoading(false);
      void loadData(nextUser);
    });
    return () => data.subscription.unsubscribe();
  }, [loadData, supabase]);

  useEffect(() => {
    const syncPath = () => setTab(pathTabs.get(window.location.pathname) ?? "home");
    syncPath();
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstItem = document.querySelector<HTMLAnchorElement>("#primary-navigation a");
    firstItem?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [menuOpen]);

  const permissions = useMemo(() => {
    if (me?.is_system_admin) return new Set(rolePermissions.filter((row) => row.role === "admin").map((row) => row.permission));
    if (me?.role === "manager" && me.officer_title) return new Set(officerPermissions.filter((row) => row.officer_title === me.officer_title).map((row) => row.permission));
    return new Set<string>();
  }, [me?.is_system_admin, me?.officer_title, me?.role, officerPermissions, rolePermissions]);
  const isOfficer = permissions.size > 0;
  const manageableParticipationKinds = (["election", "poll", "survey"] as ParticipationKind[]).filter((kind) => permissions.has(`${kind === "election" ? "elections" : kind === "poll" ? "polls" : "surveys"}.manage`));
  const needsEmail = Boolean(user && !user.email);
  const needsApplication = Boolean(user?.email && me?.status === "pending" && !me.membership_application);
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const upcoming = events.find((event) => new Date(event.starts_at) >= new Date());
  const myFee = fees.find((fee) => fee.member_id === user?.id);
  const goingCount = upcoming ? attendance.filter((item) => item.event_id === upcoming.id && item.status === "going").length : 0;

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3000); };
  const activateTab = (next: Tab) => { setTab(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const navigate = (next: Tab) => { setTab(next); setMenuOpen(false); window.history.pushState({}, "", tabPaths[next]); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const removeManagedItem = async (table: string, id: string) => {
    if (!supabase || !window.confirm("정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return showToast(error.message);
    showToast("삭제했습니다.");
    await loadData(user);
  };
  const signIn = async (provider: "google" | "kakao", mode: PasswordAuthMode) => {
    if (!supabase) return showToast("로그인 연결을 준비 중입니다.");
    setBusy(true);
    const oauthProvider = provider === "kakao" ? "custom:kakao" : provider;
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", `/?auth=${mode}`);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: oauthProvider,
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });
    if (error) { showToast("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."); setBusy(false); }
  };
  const passwordAuth = async (mode: PasswordAuthMode, email: string, password: string) => {
    if (!supabase) return "로그인 연결을 준비 중입니다.";
    setBusy(true);
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
      if (result.error) {
        if (result.error.code === "invalid_credentials") return "이메일 또는 비밀번호를 확인해 주세요. 소셜 계정과 같은 이메일이라면 비밀번호를 먼저 설정해 주세요.";
        if (result.error.code === "email_not_confirmed") return "이메일 인증을 완료한 뒤 로그인해 주세요.";
        if (result.error.code === "email_address_invalid") return "사용할 수 있는 이메일 주소를 입력해 주세요.";
        if (result.error.code === "weak_password") return "더 안전한 비밀번호를 사용해 주세요.";
        if (result.error.code?.includes("rate_limit")) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
        return mode === "login" ? "로그인하지 못했습니다. 입력 정보를 확인해 주세요." : "회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      }
      setLoginOpen(false);
      if (mode === "signup" && !result.data.session) {
        showToast("메일을 확인해 주세요. 기존 소셜 계정이라면 비밀번호 설정을 이용해 주세요.");
      } else {
        showToast(mode === "signup" ? "회원가입했습니다. 가입 신청서를 작성해 주세요." : "로그인했습니다.");
      }
      return null;
    } catch {
      return "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      setBusy(false);
    }
  };
  const sendPasswordReset = async (email: string) => {
    if (!supabase) return "로그인 연결을 준비 중입니다.";
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (error) {
        if (error.code === "email_address_invalid") return "사용할 수 있는 이메일 주소를 입력해 주세요.";
        if (error.code?.includes("rate_limit")) return "요청이 많습니다. 잠시 후 다시 시도해 주세요.";
        return "비밀번호 설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
      }
      setLoginOpen(false);
      showToast("계정이 존재하면 비밀번호 설정 메일이 발송됩니다.");
      return null;
    } catch {
      return "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => { await supabase?.auth.signOut(); navigate("home"); showToast("로그아웃했습니다."); };
  const setMyAttendance = async (status: Attendance["status"], eventId = upcoming?.id) => {
    if (!user || !eventId || !supabase) return setLoginOpen(true);
    if (me?.status !== "active") return showToast("회원 승인 후 참석 여부를 등록할 수 있습니다.");
    const { error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: user.id, status }, { onConflict: "event_id,member_id" });
    if (error) return showToast(error.message);
    setAttendance((rows) => { const existing = rows.find((row) => row.event_id === eventId && row.member_id === user.id); return [...rows.filter((row) => row.event_id !== eventId || row.member_id !== user.id), { event_id: eventId, member_id: user.id, status, checked_in_at: existing?.checked_in_at ?? null, checked_in_by: existing?.checked_in_by ?? null }]; }); showToast("참석 여부를 저장했습니다.");
  };

  return <main className="page">
    <header className="topbar">
      <Link className="brand" href="/" onClick={() => activateTab("home")} aria-label="경충FC 홈"><span className="crest"><span>GC</span></span><span className="brand-copy"><strong>경충FC</strong><small>WEEKEND FUTSAL CLUB</small></span></Link>
      <nav id="primary-navigation" className={menuOpen ? "nav open" : "nav"} aria-label="주 메뉴">{navItems.map(([key, label]) => <Link key={key} href={tabPaths[key]} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => activateTab(key)}>{label}</Link>)}{isOfficer && <Link href={tabPaths.admin} className={tab === "admin" ? "active" : ""} aria-current={tab === "admin" ? "page" : undefined} onClick={() => activateTab("admin")}>관리</Link>}</nav>
      <div className="account"><a className="youtube-link" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer" aria-label="경충FC 유튜브"><Youtube size={20} /></a>{authLoading ? <span className="auth-loading" aria-label="로그인 상태 확인 중">확인 중</span> : user ? <button className="login-button" onClick={signOut}><LogOut size={16} /> {me?.name ?? "로그아웃"}</button> : <button className="login-button" onClick={() => setLoginOpen(true)}><LogIn size={16} /> 로그인</button>}<button ref={menuButtonRef} className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"} aria-expanded={menuOpen} aria-controls="primary-navigation">{menuOpen ? <X /> : <Menu />}</button></div>
    </header>

    {me?.status === "pending" && me.membership_application && <div className="approval-banner">가입 신청이 접수되었습니다. 회원 관리 권한이 있는 관리자의 승인을 기다리고 있습니다.</div>}
    {tab === "home" && <Home upcoming={upcoming} notice={notices[0]} fee={myFee} goingCount={goingCount} memberCount={activeProfiles.length} user={user} onNavigate={navigate} onAttendance={setMyAttendance} myAttendance={attendance.find((row) => row.event_id === upcoming?.id && row.member_id === user?.id)?.status} />}
    {tab === "members" && <Members profiles={activeProfiles} user={user} canManage={permissions.has("members.manage")} onEdit={(profile) => setQuickEditor({ type: "members", row: profile as unknown as Record<string, unknown> })} onLogin={() => setLoginOpen(true)} />}
    {tab === "fees" && <Fees fees={fees} profiles={profiles} user={user} canManage={permissions.has("fees.manage")} onCreate={() => setQuickEditor({ type: "fees" })} onEdit={(fee) => setQuickEditor({ type: "fees", row: fee as unknown as Record<string, unknown> })} onDelete={(id) => void removeManagedItem("fees", id)} onLogin={() => setLoginOpen(true)} />}
    {tab === "notices" && <Notices notices={notices} canManage={permissions.has("notices.manage")} onCreate={() => setQuickEditor({ type: "notices" })} onEdit={(notice) => setQuickEditor({ type: "notices", row: notice as unknown as Record<string, unknown> })} onDelete={(id) => void removeManagedItem("notices", id)} />}
    {tab === "events" && <Events events={events} profiles={profiles} attendance={attendance} momVotes={momVotes} momResults={momResults} user={user} profile={me} supabase={supabase} canManage={permissions.has("events.manage")} onCreate={() => setQuickEditor({ type: "events" })} onEdit={(event) => setQuickEditor({ type: "events", row: event as unknown as Record<string, unknown> })} onDelete={(id) => void removeManagedItem("events", id)} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} reload={() => void loadData(user)} toast={showToast} />}
    {tab === "rankings" && <Rankings rankings={rankings} momLeaderboard={momLeaderboard} user={user} profile={me} onLogin={() => setLoginOpen(true)} />}
    {tab === "feedback" && <FeedbackHub user={user} profile={me} feedback={feedback} supabase={supabase} canManage={permissions.has("feedback.manage")} onEdit={(item) => setQuickEditor({ type: "feedback", row: item as unknown as Record<string, unknown> })} onDelete={(id) => void removeManagedItem("feedback", id)} reload={() => void loadData(user)} onLogin={() => setLoginOpen(true)} toast={showToast} />}
    {tab === "participation" && <ParticipationHub user={user} profile={me} forms={forms.filter((form) => form.status === "open" || form.status === "closed")} submissions={submissions} supabase={supabase} manageableKinds={manageableParticipationKinds} onCreate={() => setQuickEditor({ type: "forms" })} onEdit={(form) => setQuickEditor({ type: "forms", row: form as unknown as Record<string, unknown> })} onDelete={(id) => void removeManagedItem("participation_forms", id)} reload={() => void loadData(user)} onLogin={() => setLoginOpen(true)} toast={showToast} />}
    {tab === "admin" && isOfficer && supabase && <AdminConsole profiles={profiles} guestPlayers={guestPlayers} attendance={attendance} fees={fees} guestFees={guestFees} notices={notices} events={events} feedback={feedback} forms={forms} rolePermissions={rolePermissions} officerPermissions={officerPermissions} permissions={permissions} supabase={supabase} reload={() => void loadData(user)} toast={showToast} />}
    {tab === "admin" && !isOfficer && <div className="content"><Empty icon={<Shield />} title="운영진 전용 공간입니다" description="시스템 관리자 또는 운영 권한이 있는 관리자 계정으로 로그인해 주세요." /></div>}

    <footer><span>경충FC · SINCE 2014</span><span>우리의 주말, 우리의 풋살.</span><a href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer">YOUTUBE <ChevronRight size={14} /></a></footer>
    {loginOpen && <LoginModal busy={busy} onClose={() => setLoginOpen(false)} onSignIn={signIn} onPasswordAuth={passwordAuth} onPasswordReset={sendPasswordReset} />}
    {needsEmail && supabase && <EmailRequiredModal supabase={supabase} onSignOut={signOut} />}
    {needsApplication && supabase && me && <MembershipApplicationModal profile={me} supabase={supabase} onSignOut={signOut} onSubmitted={async () => { await loadData(user); showToast("가입 신청을 접수했습니다."); }} />}
    {quickEditor && supabase && <AdminEditor config={quickEditor} profiles={profiles} guestPlayers={guestPlayers} events={events} attendance={attendance} permissions={permissions} supabase={supabase} onClose={() => setQuickEditor(null)} onSaved={() => { setQuickEditor(null); showToast("저장했습니다."); void loadData(user); }} />}
    {toast && <div className="toast"><Check size={17} />{toast}</div>}
  </main>;
}

function LoginModal({ busy, onClose, onSignIn, onPasswordAuth, onPasswordReset }: { busy: boolean; onClose: () => void; onSignIn: (provider: "google" | "kakao", mode: PasswordAuthMode) => void; onPasswordAuth: (mode: PasswordAuthMode, email: string, password: string) => Promise<string | null>; onPasswordReset: (email: string) => Promise<string | null> }) {
  const [mode, setMode] = useState<PasswordAuthMode>("login");
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (mode === "signup" && password !== String(form.get("password_confirm") ?? "")) return setErrorMessage("비밀번호 확인이 일치하지 않습니다.");
    const error = await onPasswordAuth(mode, email, password);
    if (error) setErrorMessage(error);
  };
  const resetPassword = async () => {
    setErrorMessage(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return setErrorMessage("비밀번호를 설정할 이메일 주소를 입력해 주세요.");
    const error = await onPasswordReset(normalizedEmail);
    if (error) setErrorMessage(error);
  };
  const changeMode = (nextMode: PasswordAuthMode) => { setMode(nextMode); setErrorMessage(null); };
  return <div className="modal-backdrop" onClick={onClose}><div className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="로그인 또는 회원가입"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">MEMBER ACCESS</span><h2>{mode === "login" ? <>로그인</> : <>회원가입</>}</h2><p>{mode === "login" ? "가입한 이메일 또는 연결된 소셜 계정으로 로그인하세요." : "이메일로 가입하거나 Google·카카오의 이름과 이메일을 불러와 가입을 시작하세요."}</p><div className="auth-mode-tabs" role="tablist" aria-label="계정 인증 방식"><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>로그인</button><button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => changeMode("signup")}>회원가입</button></div><form className="password-auth-form" onSubmit={submit}><label>이메일 아이디<input name="email" type="email" required autoComplete="email" placeholder="member@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>비밀번호<input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="8자 이상 입력" /></label>{mode === "signup" && <label>비밀번호 확인<input name="password_confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="비밀번호를 다시 입력" /></label>}{errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}<button className="cta" disabled={busy}>{busy ? "처리 중…" : mode === "login" ? "이메일로 로그인" : "이메일로 회원가입"}</button>{mode === "login" && <button type="button" className="password-reset-link" disabled={busy} onClick={resetPassword}>비밀번호 설정·재설정</button>}</form><div className="auth-divider"><span>또는</span></div><button type="button" className="social kakao" disabled={busy} onClick={() => onSignIn("kakao", mode)}><span>●</span> {mode === "login" ? "카카오로 로그인" : "카카오 정보로 회원가입"}</button><button type="button" className="social google" disabled={busy} onClick={() => onSignIn("google", mode)}><span>G</span> {mode === "login" ? "Google로 로그인" : "Google 정보로 회원가입"}</button><small>{mode === "signup" ? "소셜 계정도 이메일이 반드시 필요하며, 처음 이용하면 가입 신청서로 이어집니다. " : "가입한 이메일과 동일한 인증 이메일의 소셜 계정은 기존 회원 계정으로 연결됩니다. "}가입 신청서 제출 후 회원 관리 권한이 있는 관리자가 승인해야 회원 기능을 이용할 수 있습니다.</small></div></div>;
}

function EmailRequiredModal({ supabase, onSignOut }: { supabase: NonNullable<ReturnType<typeof createClient>>; onSignOut: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setErrorMessage(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/?auth=email-confirmed");
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: callbackUrl.toString() });
    setSaving(false);
    if (error?.code === "email_exists" || error?.message.toLowerCase().includes("already")) return setErrorMessage("이미 가입된 이메일입니다. 해당 이메일로 로그인한 뒤 소셜 계정을 연결해 주세요.");
    if (error) return setErrorMessage("이메일 인증을 시작하지 못했습니다. 주소를 확인해 주세요.");
    setSentTo(email);
  };
  return <div className="modal-backdrop membership-gate"><form className="editor membership-form" onSubmit={submit} role="dialog" aria-modal="true" aria-label="가입 이메일 등록">
    <span className="eyebrow">EMAIL REQUIRED</span><h2>이메일<br />등록</h2><p className="form-description">경충FC 회원 계정에는 인증된 이메일이 반드시 필요합니다. 소셜 계정에서 이메일을 받지 못해 직접 확인합니다.</p>
    {sentTo ? <div className="read-box"><b>인증 메일을 보냈습니다</b><p>{sentTo}의 메일에서 인증 링크를 누르면 가입 신청을 계속할 수 있습니다.</p></div> : <label>이메일<input name="email" type="email" required autoComplete="email" placeholder="member@example.com" /></label>}
    {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
    {!sentTo && <button className="cta" disabled={saving}>{saving ? "전송 중…" : "이메일 인증하기"}</button>}
    <button className="text-link application-signout" type="button" onClick={() => void onSignOut()}>다른 계정으로 로그인</button>
  </form></div>;
}

function MembershipApplicationModal({ profile, supabase, onSignOut, onSubmitted }: { profile: Profile; supabase: NonNullable<ReturnType<typeof createClient>>; onSignOut: () => Promise<void>; onSubmitted: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true); setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("submit_membership_application", {
      applicant_name: String(form.get("name") ?? "").trim(),
      applicant_phone: String(form.get("phone") ?? "").trim(),
      applicant_birth_date: String(form.get("birth_date") ?? ""),
      applicant_residence: String(form.get("residence") ?? "").trim(),
      applicant_preferred_position: String(form.get("preferred_position") ?? ""),
    });
    setSaving(false);
    if (error) return setErrorMessage("입력 정보를 확인한 뒤 다시 시도해 주세요.");
    await onSubmitted();
  };
  return <div className="modal-backdrop membership-gate"><form className="editor membership-form" onSubmit={submit} role="dialog" aria-modal="true" aria-label="경충FC 가입 신청">
    <span className="eyebrow">MEMBERSHIP APPLICATION</span><h2>경충FC<br />가입 신청</h2><p className="form-description">필수 정보를 작성해 주세요. 회원 관리 권한이 있는 관리자가 신청 내용을 확인하고 승인하면 회원 기능이 열립니다.</p>
    <label>이름<input name="name" required minLength={2} maxLength={50} autoComplete="name" defaultValue={profile.name} /></label>
    <div className="field-row"><label>전화번호<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" pattern="01[016789]-?[0-9]{3,4}-?[0-9]{4}" /></label><label>생년월일<input name="birth_date" required type="date" max={new Date().toISOString().slice(0, 10)} /></label></div>
    <label>거주지역<input name="residence" required minLength={2} maxLength={100} autoComplete="address-level1" placeholder="예: 서울 송파구" /></label>
    <label>선호 포지션<select name="preferred_position" required defaultValue=""><option value="" disabled>포지션을 선택해 주세요</option><option value="GK">골키퍼 (GK)</option><option value="DF">수비 (DF)</option><option value="MF">미드필더 (MF)</option><option value="FW">공격 (FW)</option><option value="ANY">상관없음</option></select></label>
    {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
    <button className="cta" disabled={saving}>{saving ? "신청 중…" : "가입 신청서 제출"}</button>
    <button className="text-link application-signout" type="button" onClick={() => void onSignOut()}>다른 계정으로 로그인</button>
  </form></div>;
}

function Home({ upcoming, notice, fee, goingCount, memberCount, user, onNavigate, onAttendance, myAttendance }: { upcoming?: Event; notice?: Notice; fee?: Fee; goingCount: number; memberCount: number; user: User | null; onNavigate: (tab: Tab) => void; onAttendance: (status: Attendance["status"]) => void; myAttendance?: Attendance["status"] }) {
  const date = upcoming ? new Date(upcoming.starts_at) : null;
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow"><span /> EST. 2014 · SEOUL</span><h1>우리의 주말,<br /><em>우리의 풋살.</em></h1><div className="lead-row"><strong>2026<br />SEASON</strong><p>경쟁보다 함께 뛰는 즐거움. 경충FC는 주말마다 모여 공을 차고, 땀 흘리고, 오래 함께할 사람을 만듭니다.</p></div><div className="hero-actions"><button className="cta" onClick={() => onNavigate("events")}>다음 일정 참석하기 <ChevronRight /></button><button className="text-link" onClick={() => onNavigate("participation")}>팀 의사결정 참여</button></div></div>
    <div className="fixture-side"><span className="giant-number">{date?.getDate().toString().padStart(2, "0") ?? "FC"}</span><span className="eyebrow light">NEXT SCHEDULE</span>{upcoming ? <article className="schedule-card"><header className="schedule-head"><span>다가오는 팀 일정</span><strong>{formatDate(upcoming.starts_at)}</strong></header><div className="schedule-main"><time className="schedule-date" dateTime={upcoming.starts_at}><small>{date?.toLocaleDateString("ko-KR", { month: "long" })}</small><b>{date?.getDate().toString().padStart(2, "0")}</b><span>{date?.toLocaleDateString("ko-KR", { weekday: "long" })}</span></time><div className="schedule-copy"><small>WEEKEND FUTSAL</small><h2>{upcoming.title}</h2><dl><div><dt>시간</dt><dd>{formatTime(upcoming.starts_at)}</dd></div><div><dt>장소</dt><dd>{upcoming.venue}</dd></div></dl><a className="map-link" href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={15} /><span>{upcoming.address || upcoming.venue}</span><small>네이버 지도</small></a></div></div><div className="schedule-foot"><div><span>참석 예정 <b>{goingCount || "-"}명</b></span><span>참여 용병 <b>{upcoming.event_guest_players?.length ?? 0}명</b></span></div><button type="button" onClick={() => onNavigate("events")}>일정 보기 <ChevronRight size={16} /></button></div></article> : <article className="schedule-card schedule-empty"><CalendarDays /><small>UPCOMING SCHEDULE</small><h2>새 일정을 준비 중입니다.</h2><p>다음 주말 풋살 일정이 확정되면 이곳에서 바로 알려드릴게요.</p><button type="button" onClick={() => onNavigate("events")}>전체 일정 보기 <ChevronRight size={16} /></button></article>}<div className="side-stats"><span><b>{memberCount}</b> ACTIVE {memberCount === 1 ? "MEMBER" : "MEMBERS"}</span><span><b>WEEKLY</b> SAT / SUN</span></div></div></section>
    <section className="locker"><div className="section-heading"><div><span className="eyebrow">MEMBER LOCKER ROOM</span><h2>팀 클럽하우스</h2></div><span>{new Date().getFullYear()} · {String(new Date().getMonth() + 1).padStart(2, "0")}</span></div><div className="panel-grid">
      <article className="panel rsvp-panel"><div className="panel-title"><CalendarDays /><span><small>NEXT SCHEDULE RSVP</small><b>참석 여부</b></span></div>{upcoming ? <div className="rsvp-schedule"><time dateTime={upcoming.starts_at}>{formatDate(upcoming.starts_at)} · {formatTime(upcoming.starts_at)}</time><a href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={16} /><span><b>{upcoming.venue}</b><small>{upcoming.address || "네이버 지도에서 위치 확인"}</small></span><ChevronRight size={16} /></a></div> : <p>아직 등록된 다음 일정이 없습니다.</p>}{upcoming && <div className="rsvp"><button className={myAttendance === "going" ? "selected" : ""} onClick={() => onAttendance("going")}>{user ? "참석" : "로그인 후 참석"}</button><button className={myAttendance === "not_going" ? "selected no" : ""} onClick={() => onAttendance("not_going")}>불참</button></div>}</article>
      <article className="panel green-top"><div className="panel-title"><Megaphone /><span><small>LATEST NOTICE</small><b>팀 공지</b></span></div><h3>{notice?.title ?? "등록된 공지가 없습니다"}</h3><p>{notice?.body}</p><button className="panel-link" onClick={() => onNavigate("notices")}>전체 공지 <ChevronRight /></button></article>
      <article className="panel"><div className="panel-title"><CircleDollarSign /><span><small>MEMBERSHIP FEE</small><b>회비 현황</b></span></div><div className="fee-amount">{fee ? `${fee.amount.toLocaleString()}원` : user ? "등록 내역 없음" : "로그인 필요"}</div>{fee && <FeeStatus status={fee.status} />}<button className="panel-link" onClick={() => onNavigate("fees")}>상세 보기 <ChevronRight /></button></article>
    </div></section><a className="video-banner" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer"><span className="play"><Youtube /></span><span><small>GYUNGCHUNG FILM</small><b>구장에서 기록한 경충FC의 플레이를 만나보세요.</b></span><ChevronRight /></a></>;
}

function PageIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) { return <div className="page-intro"><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{description}</p></div>; }
function Members({ profiles, user, canManage, onEdit, onLogin }: { profiles: Profile[]; user: User | null; canManage: boolean; onEdit: (profile: Profile) => void; onLogin: () => void }) { if (!user) return <section className="content"><PageIntro kicker="SQUAD" title="함께 뛰는 사람들" description="회원 명단은 승인된 회원에게만 공개합니다." /><button className="cta" onClick={onLogin}>로그인하고 확인하기 <ChevronRight /></button></section>; return <section className="content"><PageIntro kicker="SQUAD" title="함께 뛰는 사람들" description="포지션보다 이름을 먼저 기억하는 경충FC의 회원입니다." />{canManage && <div className="inline-management-note"><Shield size={17} /> 회원 카드를 선택해 회원 정보를 수정할 수 있습니다.</div>}<div className="member-grid">{profiles.map((profile, index) => <article className="member-card" key={profile.id}><span className="member-number">{profile.jersey_number ?? String(index + 1).padStart(2, "0")}</span>{canManage && <button className="resource-icon-action" aria-label={`${profile.name} 회원 정보 수정`} onClick={() => onEdit(profile)}><Pencil size={16} /></button>}<div className="avatar"><UserRound /></div><small>{profile.position ?? "PLAYER"}</small><h2>{profile.name}</h2><p>JOINED {new Date(profile.joined_at).getFullYear()}</p><div className="member-badges">{profile.role === "manager" && <span className="admin-badge">{profile.officer_title ? officerTitleLabels[profile.officer_title] : roleLabels.manager}</span>}{profile.is_system_admin && <span className="admin-badge system">시스템 관리자</span>}</div></article>)}</div></section>; }
function Fees({ fees, profiles, user, canManage, onCreate, onEdit, onDelete, onLogin }: { fees: Fee[]; profiles: Profile[]; user: User | null; canManage: boolean; onCreate: () => void; onEdit: (fee: Fee) => void; onDelete: (id: string) => void; onLogin: () => void }) { if (!user) return <section className="content"><PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description="회원에게만 공개하는 정보입니다." /><button className="cta" onClick={onLogin}>로그인하고 확인하기 <ChevronRight /></button></section>; return <section className="content"><PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description="시스템 관리 권한과 무관하게 관리자 월 15,000원, 일반회원 월 30,000원 또는 참여 시 10,000원을 적용합니다." />{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 회비 등록</button></div>}<div className="table-wrap"><table><caption className="sr-only">회원별 회비 납부 현황</caption><thead><tr><th scope="col">회원</th><th scope="col">구분</th><th scope="col">기준</th><th scope="col">금액</th><th scope="col">상태</th>{canManage && <th scope="col">관리</th>}</tr></thead><tbody>{fees.map((fee) => <tr key={fee.id}><th scope="row">{fee.profiles?.name ?? profiles.find((profile) => profile.id === fee.member_id)?.name ?? "회원"}</th><td>{fee.fee_type === "participation" ? "참여비" : "월회비"}</td><td>{fee.month.slice(0, 7)}</td><td>{fee.amount.toLocaleString()}원</td><td><FeeStatus status={fee.status} /></td>{canManage && <td><div className="resource-actions"><button aria-label="회비 수정" onClick={() => onEdit(fee)}><Pencil size={16} /></button><button aria-label="회비 삭제" onClick={() => onDelete(fee.id)}><Trash2 size={16} /></button></div></td>}</tr>)}</tbody></table>{fees.length === 0 && <Empty icon={<CircleDollarSign />} title="등록된 회비 내역이 없습니다" description="총무가 회비 내역을 등록하면 여기에 표시됩니다." />}</div></section>; }
function FeeStatus({ status }: { status: Fee["status"] }) { return <span className={`status ${status}`}>{status === "paid" ? "납부 완료" : status === "exempt" ? "면제" : "미납"}</span>; }
function Notices({ notices, canManage, onCreate, onEdit, onDelete }: { notices: Notice[]; canManage: boolean; onCreate: () => void; onEdit: (notice: Notice) => void; onDelete: (id: string) => void }) { return <section className="content"><PageIntro kicker="NOTICE BOARD" title="공지사항" description="놓치면 안 되는 클럽 소식을 전합니다." />{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 공지 등록</button></div>}<div className="notice-list">{notices.map((notice, index) => <article key={notice.id}><span className="notice-index">{String(index + 1).padStart(2, "0")}</span><div>{notice.is_pinned && <small className="pin">PINNED</small>}<h2>{notice.title}</h2><p>{notice.body}</p><time>{new Date(notice.created_at).toLocaleDateString("ko-KR")}</time></div>{canManage && <div className="resource-actions"><button aria-label={`${notice.title} 수정`} onClick={() => onEdit(notice)}><Pencil size={16} /></button><button aria-label={`${notice.title} 삭제`} onClick={() => onDelete(notice.id)}><Trash2 size={16} /></button></div>}</article>)}</div></section>; }
function Events({ events, profiles, attendance, momVotes, momResults, user, profile, supabase, canManage, onCreate, onEdit, onDelete, onAttendance, onLogin, reload, toast }: { events: Event[]; profiles: Profile[]; attendance: Attendance[]; momVotes: EventMomVote[]; momResults: EventMomResult[]; user: User | null; profile: Profile | null; supabase: ReturnType<typeof createClient>; canManage: boolean; onCreate: () => void; onEdit: (event: Event) => void; onDelete: (id: string) => void; onAttendance: (status: Attendance["status"], eventId?: string) => void; onLogin: () => void; reload: () => void; toast: (message: string) => void }) {
  const [votingEvent, setVotingEvent] = useState<Event | null>(null);
  const submitMomVote = async (candidateProfileId: string) => {
    if (!user || !votingEvent || !supabase) return;
    const { error } = await supabase.from("event_mom_votes").upsert({ event_id: votingEvent.id, voter_id: user.id, candidate_profile_id: candidateProfileId }, { onConflict: "event_id,voter_id" });
    if (error) return toast(error.message);
    setVotingEvent(null); toast("MOM 투표를 저장했습니다."); reload();
  };
  return <section className="content"><PageIntro kicker="WEEKEND SCHEDULE" title="우리의 일정" description="상대 팀과의 경기가 아닌, 우리끼리 모여 뛰는 주말 풋살 일정입니다." />{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 일정 등록</button></div>}<div className="event-list">{events.map((event, index) => {
    const count = attendance.filter((item) => item.event_id === event.id && item.status === "going").length;
    const guests = event.event_guest_players ?? [];
    const teams = [...(event.event_teams ?? [])].sort((a, b) => a.team_number - b.team_number);
    const eventResults = momResults.filter((result) => result.event_id === event.id);
    const isPast = new Date(event.starts_at) < new Date();
    const canVote = Boolean(user && profile?.status === "active" && isPast && attendance.some((row) => row.event_id === event.id && row.member_id === user.id && row.checked_in_at));
    const ownVote = momVotes.find((vote) => vote.event_id === event.id);
    const scoredTeams = teams.filter((team) => team.score !== null);
    const maxScore = scoredTeams.length ? Math.max(...scoredTeams.map((team) => team.score ?? 0)) : null;
    const winnerCount = maxScore === null ? 0 : scoredTeams.filter((team) => team.score === maxScore).length;
    const eventDate = new Date(event.starts_at);
    return <article key={event.id} className={`event-card${isPast ? " past" : ""}`}><time className="event-date" dateTime={event.starts_at}><small>{eventDate.getFullYear()} · {eventDate.toLocaleDateString("ko-KR", { month: "long" })}</small><b>{String(eventDate.getDate()).padStart(2, "0")}</b><span>{eventDate.toLocaleDateString("ko-KR", { weekday: "long" })}</span></time><div className="event-info"><small>{isPast ? "지난 일정" : "WEEKLY FUTSAL"} · #{String(index + 1).padStart(2, "0")}{event.is_competitive ? " · 커피 내기" : ""}</small><h2>{event.title}</h2><p><MapPin size={16} /> <a className="inline-map-link" href={naverMapUrl(event)} target="_blank" rel="noreferrer">{event.venue}</a> · {formatTime(event.starts_at)}</p><span>{event.note}</span>{guests.length > 0 && <div className="guest-roster"><b>참여 용병</b>{guests.map((guest) => <span key={guest.guest_player_id}>{guest.guest_name}{guest.guest_position ? ` · ${guest.guest_position}` : ""}</span>)}</div>}{teams.length > 0 && <div className="event-teams">{teams.map((team) => { const result = team.score === null || maxScore === null ? null : team.score === maxScore ? winnerCount > 1 ? "무승부" : "승리" : "패배"; return <div className="event-team" key={team.id}><div><b>{team.team_name}</b>{event.is_competitive && <span>{team.score ?? "-"}점{result ? ` · ${result}` : ""}</span>}</div><p>{team.event_team_members.map((member) => `${member.participant_name}${member.goals ? ` ${member.goals}골` : ""}${member.rating !== null ? ` ${member.rating}점` : ""}`).join(" · ")}</p></div>; })}</div>}{eventResults.length > 0 && <div className="mom-results"><b>MOM TOP 3</b>{eventResults.map((result) => <span key={result.candidate_profile_id}>{result.mom_rank}위 {result.candidate_name} · {result.vote_count}표</span>)}</div>}</div><div className="event-action"><b>회원 {count}명 · 용병 {guests.length}명</b>{canManage && <div className="resource-actions"><button aria-label={`${event.title} 수정`} onClick={() => onEdit(event)}><Pencil size={16} /></button><button aria-label={`${event.title} 삭제`} onClick={() => onDelete(event.id)}><Trash2 size={16} /></button></div>}<button className="cta small" disabled={isPast} onClick={() => user ? onAttendance("going", event.id) : onLogin()}>{isPast ? "지난 일정" : "참석하기"}</button>{canVote && <button className="text-link" onClick={() => setVotingEvent(event)}>{ownVote ? "MOM 재투표" : "MOM 투표"}</button>}</div></article>;
  })}</div>{votingEvent && <div className="modal-backdrop" onClick={() => setVotingEvent(null)}><div className="editor mom-vote-modal" role="dialog" aria-modal="true" aria-label="MOM 투표" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="닫기" onClick={() => setVotingEvent(null)}><X /></button><span className="eyebrow">MAN OF THE MATCH</span><h2>MOM 투표</h2><p className="form-description">실제 출석한 회원 중 한 명을 선택해 주세요. 본인에게는 투표할 수 없습니다.</p><div className="mom-candidates">{profiles.filter((candidate) => candidate.id !== user?.id && candidate.status === "active" && attendance.some((row) => row.event_id === votingEvent.id && row.member_id === candidate.id && row.checked_in_at)).map((candidate) => <button key={candidate.id} className={momVotes.find((vote) => vote.event_id === votingEvent.id)?.candidate_profile_id === candidate.id ? "selected" : ""} onClick={() => void submitMomVote(candidate.id)}><span>{candidate.position ?? "PLAYER"}</span><b>{candidate.name}</b></button>)}</div></div></div>}</section>;
}

function Rankings({ rankings, momLeaderboard, user, profile, onLogin }: { rankings: MemberRanking[]; momLeaderboard: MomLeaderboardEntry[]; user: User | null; profile: Profile | null; onLogin: () => void }) {
  if (!user) return <section className="content"><PageIntro kicker="CLUB RANKING" title="활동 랭킹" description="실제 출석과 회비 납부 기록으로 보는 경충FC 활동 대시보드입니다." /><button className="cta" onClick={onLogin}>로그인하고 확인하기 <ChevronRight /></button></section>;
  if (profile?.status !== "active") return <section className="content"><PageIntro kicker="CLUB RANKING" title="활동 랭킹" description="실제 출석과 회비 납부 기록으로 보는 경충FC 활동 대시보드입니다." /><Empty icon={<Shield />} title="회원 승인 후 확인할 수 있습니다" description="가입 승인이 완료되면 활동 랭킹이 공개됩니다." /></section>;
  return <section className="content"><PageIntro kicker="CLUB RANKING" title="활동 랭킹" description="실제 출석 1회는 3점, 회비 납부 1개월은 1점으로 집계합니다. 금액과 개인 연락처는 공개하지 않습니다." /><div className="ranking-layout"><div><div className="section-heading compact"><div><span className="eyebrow">ACTIVITY</span><h2>활동 순위</h2></div></div><div className="table-wrap ranking-table"><table><caption className="sr-only">회원별 출석 및 회비 납부 활동 순위</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">실제 출석</th><th scope="col">회비 납부</th><th scope="col">종합 점수</th></tr></thead><tbody>{rankings.map((ranking, index) => <tr key={ranking.member_id}><td><span className="rank-badge">{index + 1}</span></td><th scope="row">{ranking.member_name}</th><td>{ranking.attendance_count}회</td><td>{ranking.paid_fee_count}개월</td><td><b>{ranking.total_score}점</b></td></tr>)}</tbody></table>{rankings.length === 0 && <Empty icon={<CalendarDays />} title="아직 집계된 기록이 없습니다" description="실제 출석이나 회비 납부 기록이 등록되면 순위가 표시됩니다." />}</div></div><div><div className="section-heading compact"><div><span className="eyebrow">MOM HALL OF FAME</span><h2>MOM 명예의 전당</h2></div></div><div className="table-wrap ranking-table"><table><caption className="sr-only">회원별 MOM 수상 및 득표 순위</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">1위</th><th scope="col">2위</th><th scope="col">3위</th><th scope="col">득표</th></tr></thead><tbody>{momLeaderboard.map((ranking, index) => <tr key={ranking.member_id}><td><span className="rank-badge">{index + 1}</span></td><th scope="row">{ranking.member_name}</th><td>{ranking.first_place_count}회</td><td>{ranking.second_place_count}회</td><td>{ranking.third_place_count}회</td><td>{ranking.total_votes}표</td></tr>)}</tbody></table></div></div></div></section>;
}
function Empty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="empty">{icon}<h2>{title}</h2><p>{description}</p></div>; }
function formatDate(value: string) { return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }); }
function formatTime(value: string) { return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); }
function naverMapUrl(event: Pick<Event, "venue" | "address">) { return `https://map.naver.com/p/search/${encodeURIComponent([event.venue, event.address].filter(Boolean).join(" "))}`; }
