"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, LogOut, MapPin, Megaphone, MoreHorizontal, Pencil, Plus, Shield, Trash2, Trophy, UserRound, X, Youtube } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, EventMomResult, EventMomVote, Fee, Feedback, FeedbackFeedItem, GuestFee, GuestPlayer, Notice, OfficerPermission, ParticipationForm, ParticipationKind, ParticipationSubmission, Profile, RolePermission, Venue } from "@/lib/types";
import type { EditorConfig } from "@/components/admin-console";
import WinnerEditor from "@/components/winner-editor";
import ThemeSwitch from "@/components/theme-switch";
import MemberHome from "@/components/member-home";
import HeroMotion from "@/components/hero-motion";
import MemberDirectory from "@/components/member-directory";
import { ClubMobileBar, ClubSidebar, ClubTabBar, MoreSheet, tabPaths, type Tab } from "@/components/club-nav";
import { FEE_AMOUNTS, feeRuleBadges, formatWon } from "@/lib/fee-rules";
import { buildSeasonRankings, type EventWinningMember } from "@/lib/season-rankings";
import { editorScopes, showError, tableScopes, toErrorMessage, type ReloadScope, type ToastKind } from "@/lib/ui-feedback";
import { getCheckInStatus } from "@/lib/attendance";
import { getAccountState, getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import { getEventCapacity } from "@/lib/event-capacity";
import { eventDatePath, isWeeklyScheduleEvent, parseEventDateKey, toDateKey, toEventDateKey } from "@/lib/event-date";
import { applyRsvpStatus, beginRsvpSave, getRsvpCapacityWarning, restoreRsvpStatus } from "@/lib/rsvp";
import { createPhoneLoginCredentials, getPhoneLoginError } from "@/lib/phone-login";
import { getLoadErrors, type LoadErrors, type LoadResource } from "@/lib/load-state";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { CapacityStatus, RsvpControls } from "@/components/rsvp-controls";
import { AccountConnectionNotice, Empty, FormError, LoadError, LoginGate, SectionSkeleton } from "@/components/section-states";

const FeedbackHub = dynamic(() => import("@/components/feedback-hub"), { loading: () => <SectionSkeleton /> });
const ParticipationHub = dynamic(() => import("@/components/participation-hub"), { loading: () => <SectionSkeleton /> });
const AdminConsole = dynamic(() => import("@/components/admin-console"), { loading: () => <SectionSkeleton /> });
const AdminEditor = dynamic(() => import("@/components/admin-console").then((module) => module.AdminEditor));
const ConfirmDialog = dynamic(() => import("@/components/confirm-dialog"));
const EventDetail = dynamic(() => import("@/components/event-detail"), { loading: () => <SectionSkeleton /> });

type RawGuestPlayer = Omit<GuestPlayer, "appearance_count">;
const systemAdminPermissions = ["roles.manage", "officers.manage", "members.manage", "fees.manage", "notices.manage", "events.manage", "feedback.manage", "elections.manage", "polls.manage", "surveys.manage", "welcome.manage"];
const pathTabs = new Map(Object.entries(tabPaths).map(([tab, path]) => [path, tab as Tab]));

/** Results the auth callback and the OAuth redirect hand back on the URL. */
const authResults: Record<string, { message: string; kind: ToastKind }> = {
  error: { message: "로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", kind: "error" },
  "phone-only": { message: "전화번호와 비밀번호로 로그인해 주세요.", kind: "success" },
  login: { message: "로그인했습니다.", kind: "success" },
  "password-updated": { message: "비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인해 주세요.", kind: "success" },
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const accountState = getAccountState(user, me);
  const membershipRestriction = getMembershipRestriction(me);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [rawGuestPlayers, setRawGuestPlayers] = useState<RawGuestPlayer[]>([]);
  const [winners, setWinners] = useState<EventWinningMember[]>([]);
  const [winnerEvent, setWinnerEvent] = useState<Event | null>(null);
  const [momVotes, setMomVotes] = useState<EventMomVote[]>([]);
  const [momResults, setMomResults] = useState<EventMomResult[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [guestFees, setGuestFees] = useState<GuestFee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackFeed, setFeedbackFeed] = useState<FeedbackFeedItem[]>([]);
  const [forms, setForms] = useState<ParticipationForm[]>([]);
  const [submissions, setSubmissions] = useState<ParticipationSubmission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [officerPermissions, setOfficerPermissions] = useState<OfficerPermission[]>([]);
  /** Four-state contract: every section reads loading → error → empty → data. */
  const [publicLoading, setPublicLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({});
  const [memberLoading, setMemberLoading] = useState(true);
  const [quickEditor, setQuickEditor] = useState<EditorConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ table: string; id: string; label: string } | null>(null);
  const [pendingKick, setPendingKick] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rsvpPendingEventIds, setRsvpPendingEventIds] = useState<Set<string>>(() => new Set());
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const userRef = useRef<User | null>(null);
  const memberRequestIdRef = useRef(0);
  const publicRequestIdRef = useRef(0);
  const rsvpPendingEventIdsRef = useRef(new Set<string>());
  const toastTimerRef = useRef<number | undefined>(undefined);

  const dismissToast = useCallback(() => { window.clearTimeout(toastTimerRef.current); setToast(null); }, []);
  const showToast = useCallback((message: string, kind: ToastKind = "success") => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = window.setTimeout(() => setToast(null), kind === "error" ? 8000 : 4000);
  }, []);

  const loadPublicData = useCallback(async (showSkeleton = false) => {
    const requestId = ++publicRequestIdRef.current;
    const requestUserId = userRef.current?.id;
    if (!supabase) { setPublicLoading(false); return; }
    if (showSkeleton) setPublicLoading(true);
    const [eventRes, noticeRes, formRes, venueRes] = await Promise.all([
      supabase.from("events").select("id, title, starts_at, venue_id, venue, address, note, capacity, is_competitive, team_mode, weekly_date, event_guest_players(event_id, guest_player_id, guest_name, guest_position, created_at), event_teams(id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating)), event_matches(id, event_id, match_number, team_a_id, team_b_id, team_a_score, team_b_score, event_match_players(id, event_id, match_id, team_id, profile_id, guest_player_id, player_name), event_match_scorers(id, event_id, match_id, team_id, profile_id, guest_player_id, scorer_name, goals))").order("starts_at"),
      supabase.from("notices").select("id, title, body, is_pinned, created_at").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("participation_forms").select("*, participation_questions(*, participation_options(*))").order("created_at", { ascending: false }),
      supabase.from("venues").select("id, name, address, note, created_at, updated_at").order("name"),
    ]);
    /** Keep the app usable if the frontend deploy reaches production before its migration. */
    const resolvedEventRes = eventRes.error
      ? await supabase.from("events").select("id, title, starts_at, venue, address, note, capacity, is_competitive, team_mode, event_guest_players(event_id, guest_player_id, guest_name, guest_position, created_at), event_teams(id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating))").order("starts_at")
      : eventRes;
    if (requestId !== publicRequestIdRef.current || requestUserId !== userRef.current?.id) return;
    setEvents(resolvedEventRes.error ? [] : ((resolvedEventRes.data as Event[] | null) ?? []).map((event) => ({ ...event, venue_id: event.venue_id ?? null })));
    setVenues(venueRes.error ? [] : (venueRes.data as Venue[] | null) ?? []);
    setNotices(noticeRes.error ? [] : (noticeRes.data as Notice[] | null) ?? []);
    setLoadErrors((current) => ({ ...current, ...getLoadErrors({ events: resolvedEventRes, notices: noticeRes, forms: formRes, venues: venueRes }) }));
    if (formRes.data) setForms((formRes.data as ParticipationForm[]).map((form) => ({ ...form, participation_questions: [...(form.participation_questions ?? [])].sort((a, b) => a.position - b.position).map((question) => ({ ...question, participation_options: [...(question.participation_options ?? [])].sort((a, b) => a.position - b.position) })) })));
    setPublicLoading(false);
  }, [supabase]);

  const loadMemberData = useCallback(async (currentUser?: User | null, showSkeleton = false) => {
    const requestId = ++memberRequestIdRef.current;
    if (!supabase) { setMemberLoading(false); return; }
    if (!currentUser) {
      setProfiles([]); setMe(null); setFees([]); setGuestFees([]); setAttendance([]); setFeedback([]); setFeedbackFeed([]); setSubmissions([]); setRolePermissions([]); setOfficerPermissions([]); setRawGuestPlayers([]); setWinners([]); setMomVotes([]); setMomResults([]);
      setLoadErrors((current) => ({ ...current, ...getLoadErrors({ memberDirectory: { error: null }, profiles: { error: null }, fees: { error: null }, guestFees: { error: null }, attendance: { error: null }, feedback: { error: null }, feedbackFeed: { error: null }, submissions: { error: null }, rolePermissions: { error: null }, officerPermissions: { error: null }, guestPlayers: { error: null }, winners: { error: null }, momVotes: { error: null }, momResults: { error: null } }) }));
      setMemberLoading(false); return;
    }
    if (showSkeleton) setMemberLoading(true);
    const [profileRes, allProfileRes, feeRes, guestFeeRes, attendanceRes, feedbackRes, feedbackFeedRes, submissionRes, permissionRes, officerPermissionRes, guestRes, winnerRes, momVoteRes, momResultRes] = await Promise.all([
      supabase.rpc("get_member_directory"),
      supabase.from("profiles").select("*").order("name"),
      supabase.from("fees").select("*, profiles(name)").order("month", { ascending: false }),
      supabase.from("event_guest_fees").select("*, guest_players(name), events(title, starts_at)").order("created_at", { ascending: false }),
      supabase.from("attendance").select("*"),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      supabase.from("feedback_feed").select("*").order("created_at", { ascending: false }),
      supabase.from("participation_submissions").select("id, form_id, participant_id, submitted_at, participation_answers(question_id, answer), profiles!inner(auth_user_id)").eq("profiles.auth_user_id", currentUser.id),
      supabase.from("role_permissions").select("role, permission"),
      supabase.from("officer_permissions").select("officer_title, permission"),
      supabase.from("guest_players").select("*"),
      supabase.rpc("get_event_winners"),
      supabase.from("event_mom_votes").select("*"),
      supabase.rpc("get_event_mom_results"),
    ]);
    if (requestId !== memberRequestIdRef.current || currentUser.id !== userRef.current?.id) return;
    const privateProfiles = (allProfileRes.data as Profile[] | null) ?? [];
    const visibleProfiles = new Map(((profileRes.data as Profile[] | null) ?? []).map((profile) => [profile.id, profile]));
    privateProfiles.forEach((profile) => visibleProfiles.set(profile.id, { ...visibleProfiles.get(profile.id), ...profile }));
    const enrichedProfiles = Array.from(visibleProfiles.values())
      .filter((profile) => !profile.is_test_account)
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const ownProfile = privateProfiles.find((profile) => profile.auth_user_id === currentUser.id) ?? null;
    setProfiles(enrichedProfiles);
    setMe(ownProfile);
    setFees((feeRes.data as unknown as Fee[]) ?? []); setGuestFees((guestFeeRes.data as unknown as GuestFee[]) ?? []); setAttendance((attendanceRes.data as Attendance[]) ?? []); setFeedback((feedbackRes.data as Feedback[]) ?? []); setFeedbackFeed((feedbackFeedRes.data as FeedbackFeedItem[]) ?? []); setSubmissions((submissionRes.data as ParticipationSubmission[]) ?? []); setRolePermissions((permissionRes.data as RolePermission[]) ?? []); setOfficerPermissions((officerPermissionRes.data as OfficerPermission[]) ?? []); setRawGuestPlayers((guestRes.data as RawGuestPlayer[]) ?? []); setWinners((winnerRes.data as EventWinningMember[]) ?? []); setMomVotes((momVoteRes.data as EventMomVote[]) ?? []); setMomResults((momResultRes.data as EventMomResult[]) ?? []);
    setLoadErrors((current) => ({ ...current, ...getLoadErrors({ memberDirectory: profileRes, profiles: allProfileRes, fees: feeRes, guestFees: guestFeeRes, attendance: attendanceRes, feedback: feedbackRes, feedbackFeed: feedbackFeedRes, submissions: submissionRes, rolePermissions: permissionRes, officerPermissions: officerPermissionRes, guestPlayers: guestRes, winners: winnerRes, momVotes: momVoteRes, momResults: momResultRes }) }));
    setMemberLoading(false);
  }, [supabase]);

  const reload = useCallback(async (scope: ReloadScope = "all") => {
    await Promise.all([
      scope === "member" ? null : loadPublicData(),
      scope === "public" ? null : loadMemberData(userRef.current),
    ]);
  }, [loadMemberData, loadPublicData]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); setAuthError(true); return; }
    let active = true;
    const pendingTimer = window.setTimeout(() => { if (active) setAuthError(true); }, 12000);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      if (userRef.current?.id !== nextUser?.id) {
        memberRequestIdRef.current += 1;
        publicRequestIdRef.current += 1;
        setPublicLoading(true);
        setMe(null);
        setMemberLoading(true);
      }
      userRef.current = nextUser;
      setUser(nextUser);
      setAuthLoading(false);
      setAuthError(false);
      window.clearTimeout(pendingTimer);
    });
    void supabase.auth.getSession().then(({ error }) => {
      if (active && error) setAuthError(true);
    }).catch(() => { if (active) setAuthError(true); });
    return () => {
      active = false;
      memberRequestIdRef.current += 1;
      publicRequestIdRef.current += 1;
      window.clearTimeout(pendingTimer);
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const sessionUserId = user?.id;
  useEffect(() => {
    if (authLoading) return;
    void loadMemberData(userRef.current, true);
    // Public views also contain member-only nested rows and must follow identity changes.
    void loadPublicData(true);
  }, [authLoading, sessionUserId, loadMemberData, loadPublicData]);

  /** The auth callback reports its outcome on the URL; report it to the member. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("auth");
    if (!result) return;
    params.delete("auth");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`);
    setLoginOpen(result === "password-updated" || result === "phone-only");
    const outcome = authResults[result];
    if (outcome) showToast(outcome.message, outcome.kind);
  }, [showToast]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);
  const requiresPasswordChange = !memberLoading && Boolean(me?.must_change_password) && pathname !== "/auth/update-password";
  useEffect(() => {
    if (requiresPasswordChange) router.replace("/auth/update-password");
  }, [requiresPasswordChange, router]);

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
  /** The home ranking module reads the current season, the same data the rankings page uses. */
  const seasonAwards = useMemo(() => buildSeasonRankings(new Date().getFullYear(), events, attendance, winners, profiles), [events, attendance, winners, profiles]);
  const goingCount = upcoming ? attendance.filter((item) => item.event_id === upcoming.id && item.status === "going").length : 0;
  /** Sections gated behind a session must not flash their signed-out state first. */
  const sessionPending = authLoading || memberLoading;
  const hasLoadError = (...resources: LoadResource[]) => resources.some((resource) => loadErrors[resource]);
  const eventLoadError = hasLoadError("events");
  const noticeLoadError = hasLoadError("notices");

  const navigate = useCallback((next: Tab) => {
    const proceed = () => { setSheetOpen(false); router.push(tabPaths[next]); };
    const request = new CustomEvent("welcome-before-navigation", { cancelable: true, detail: { navigate: proceed } });
    if (window.dispatchEvent(request)) proceed();
  }, [router]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const accountSummary = { loading: authLoading, state: accountState, profile: me };
  const confirmDelete = async () => {
    if (!supabase || !pendingDelete) return;
    setDeleting(true);
    const weeklyEvent = pendingDelete.table === "events" && events.some((event) => event.id === pendingDelete.id && isWeeklyScheduleEvent(event));
    const { error } = weeklyEvent
      ? await supabase.rpc("cancel_weekly_event", { target_event_id: pendingDelete.id })
      : await supabase.from(pendingDelete.table).delete().eq("id", pendingDelete.id);
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
  const passwordAuth = async (identifier: string, password: string) => {
    if (!supabase) return "로그인 연결을 준비 중입니다.";
    const credentials = createPhoneLoginCredentials(identifier, password);
    if (!credentials) return "올바른 휴대전화 번호를 입력해 주세요.";
    setBusy(true);
    try {
      const result = await supabase.auth.signInWithPassword(credentials);
      if (result.error) return getPhoneLoginError(result.error);
      setLoginOpen(false);
      if (password === "1234") {
        router.replace("/auth/update-password");
        return null;
      }
      showToast("로그인했습니다.");
      return null;
    } catch {
      return "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) return showToast("로그아웃을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.", "error");
      setAccountOpen(false);
      navigate("home");
      showToast("로그아웃했습니다.");
    } catch {
      showToast("인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      setBusy(false);
    }
  };
  const setMyAttendance = async (status: Attendance["status"], eventId = upcoming?.id) => {
    if (!eventId || !supabase) return;
    if (!user) return setLoginOpen(true);
    if (!me) return showError(showToast, "회원 프로필 연결 후 참석 여부를 등록할 수 있습니다.");
    if (membershipRestriction) return showError(showToast, getMembershipRestrictionCopy(membershipRestriction).action);
    const event = events.find((item) => item.id === eventId);
    if (!event) return showError(showToast, "일정 정보를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    if (new Date(event.starts_at).getTime() <= Date.now()) return showError(showToast, "일정이 시작되어 참석 응답이 마감되었습니다.");
    const existing = attendance.find((row) => row.event_id === eventId && row.member_id === me.id);
    if (existing?.status === status || (!existing && status === "undecided")) return;
    if (status === "going" && existing?.status !== "going") {
      const memberCount = attendance.filter((row) => row.event_id === eventId && row.status === "going").length;
      const capacity = getEventCapacity(event.capacity, memberCount, event.event_guest_players?.length ?? 0);
      const warning = getRsvpCapacityWarning(capacity);
      if (warning && !window.confirm(warning)) return;
    }
    if (!beginRsvpSave(rsvpPendingEventIdsRef.current, eventId)) return;
    setRsvpPendingEventIds((current) => new Set(current).add(eventId));
    setAttendance((rows) => applyRsvpStatus(rows, eventId, me.id, status));
    try {
      const { error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: me.id, status }, { onConflict: "event_id,member_id" });
      if (error) throw error;
      showToast(status === "going" ? "참석으로 저장했습니다." : status === "not_going" ? "불참으로 저장했습니다." : "참석 응답을 취소했습니다.");
    } catch (error) {
      setAttendance((rows) => restoreRsvpStatus(rows, eventId, me.id, existing));
      showToast(`참석 여부를 저장하지 못해 이전 상태로 되돌렸습니다. ${toErrorMessage(error)}`, "error");
    } finally {
      rsvpPendingEventIdsRef.current.delete(eventId);
      setRsvpPendingEventIds((current) => { const next = new Set(current); next.delete(eventId); return next; });
    }
  };

  if (requiresPasswordChange) {
    return <main className="password-page"><section className="password-card"><span className="eyebrow">SECURITY UPDATE</span><h1>비밀번호 변경이 필요합니다</h1><p>안전한 회원 계정 사용을 위해 새 비밀번호 설정 화면으로 이동하고 있습니다.</p></section></main>;
  }

  return <div className="page shell">
    <a className="skip-link" href="#main">본문 바로가기</a>
    <ClubSidebar tab={tab} pathname={pathname} isOfficer={isOfficer} account={accountSummary} onLogin={() => setLoginOpen(true)} onAccount={() => setAccountOpen(true)} />
    <div className="shell-main">
    <ClubMobileBar account={accountSummary} onLogin={() => setLoginOpen(true)} onAccount={() => setAccountOpen(true)} />

    <main id="main">
      {authError && <aside className="approval-banner" role="alert"><AlertCircle /><div><b>로그인 상태를 확인하지 못했습니다</b><p>연결 상태를 확인한 뒤 다시 연결해 주세요.</p><button type="button" className="text-link" onClick={() => window.location.reload()}>다시 연결</button></div></aside>}
      {membershipRestriction && <aside className={`approval-banner ${membershipRestriction}`} role="status"><Shield size={20} /><div><span>{getMembershipRestrictionCopy(membershipRestriction).label}</span><b>{getMembershipRestrictionCopy(membershipRestriction).title}</b><p>{getMembershipRestrictionCopy(membershipRestriction).description}</p></div></aside>}
      {view === "home" && authLoading && <section className="content"><SectionSkeleton label="홈을 불러오는 중" /></section>}
      {view === "home" && !authLoading && user && <MemberHome profile={me} upcoming={upcoming} attendance={attendance} profiles={profiles} notices={notices} forms={forms} feeStanding={myStanding} rankings={seasonAwards} publicLoading={publicLoading} sessionPending={sessionPending} eventLoadError={eventLoadError} noticeLoadError={noticeLoadError} feeLoadError={hasLoadError("fees", "profiles")} rsvpPending={Boolean(upcoming && rsvpPendingEventIds.has(upcoming.id))} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} onRetry={() => void reload()} />}
      {view === "home" && !authLoading && !user && <Home upcoming={upcoming} notice={notices[0]} feeStanding={myStanding} goingCount={goingCount} memberCount={activeProfiles.length} user={user} profile={me} sessionPending={sessionPending} rsvpPending={Boolean(upcoming && rsvpPendingEventIds.has(upcoming.id))} publicLoading={publicLoading} eventLoadError={eventLoadError} noticeLoadError={noticeLoadError} feeLoadError={hasLoadError("fees", "profiles")} onRetryFees={() => void loadMemberData(userRef.current, true)} onRetry={() => void reload("public")} onNavigate={navigate} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} myAttendance={attendance.find((row) => row.event_id === upcoming?.id && row.member_id === me?.id)?.status} />}
      {view === "members" && <Members profiles={activeProfiles} profile={me} user={user} loading={sessionPending} loadError={hasLoadError("memberDirectory", "profiles")} canManage={permissions.has("members.manage")} onEdit={(profile) => setQuickEditor({ type: "members", row: profile as unknown as Record<string, unknown> })} onKick={(profile) => setPendingKick(profile)} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} />}
      {view === "fees" && <Fees fees={fees} profiles={profiles} profile={me} events={events} user={user} loading={sessionPending} loadError={hasLoadError("fees", "profiles")} onAsk={() => navigate("feedback")} canManage={permissions.has("fees.manage")} onCreate={() => setQuickEditor({ type: "fees" })} onEdit={(fee) => setQuickEditor({ type: "fees", row: fee as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "fees", id, label })} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} />}
      {view === "events" && <Events events={events} attendance={attendance} user={user} profile={me} sessionPending={sessionPending} rsvpPendingEventIds={rsvpPendingEventIds} loading={publicLoading} loadError={eventLoadError} canManage={permissions.has("events.manage")} onCreate={() => setQuickEditor({ type: "events" })} onEdit={(event) => setQuickEditor({ type: "events", row: event as unknown as Record<string, unknown> })} onManageMatch={(event) => setQuickEditor({ type: "teams", row: event as unknown as Record<string, unknown> })} onManageAttendance={(event) => setQuickEditor({ type: "attendance", row: event as unknown as Record<string, unknown> })} onManageWinners={(event) => setWinnerEvent(event)} onDelete={(id, label) => setPendingDelete({ table: "events", id, label })} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("public")} />}
      {view === "rankings" && <Rankings events={events} attendance={attendance} winners={winners} profiles={profiles} user={user} profile={me} loading={sessionPending || publicLoading} loadError={hasLoadError("events", "attendance", "winners", "profiles")} onLogin={() => setLoginOpen(true)} onRetry={() => void reload()} />}
      {view === "feedback" && <FeedbackHub user={user} profile={me} feedback={feedback} feedbackFeed={feedbackFeed} supabase={supabase} loading={sessionPending} loadError={hasLoadError("feedback", "feedbackFeed", "profiles")} canManage={permissions.has("feedback.manage")} onEdit={(item) => setQuickEditor({ type: "feedback", row: item as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "feedback", id, label })} reload={() => void reload("member")} onLogin={() => setLoginOpen(true)} onRetry={() => void reload("member")} toast={showToast} />}
      {view === "participation" && <ParticipationHub user={user} profile={me} forms={forms.filter((form) => form.status === "open" || form.status === "closed")} submissions={submissions} supabase={supabase} loading={sessionPending || publicLoading} loadError={hasLoadError("forms", "submissions")} manageableKinds={manageableParticipationKinds} onCreate={() => setQuickEditor({ type: "forms" })} onEdit={(form) => setQuickEditor({ type: "forms", row: form as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "participation_forms", id, label })} reload={() => void reload("member")} onLogin={() => setLoginOpen(true)} onRetry={() => void reload()} toast={showToast} />}
      {view === "notices" && <Notices notices={notices} loading={publicLoading} loadError={noticeLoadError} canManage={permissions.has("notices.manage")} onCreate={() => setQuickEditor({ type: "notices" })} onEdit={(notice) => setQuickEditor({ type: "notices", row: notice as unknown as Record<string, unknown> })} onDelete={(id, label) => setPendingDelete({ table: "notices", id, label })} onRetry={() => void reload("public")} />}
      {view === "admin" && sessionPending && <SectionSkeleton />}
      {view === "admin" && !sessionPending && isOfficer && supabase && <AdminConsole profiles={profiles} guestPlayers={guestPlayers} attendance={attendance} fees={fees} guestFees={guestFees} notices={notices} venues={venues} events={events} feedback={feedback} forms={forms} rolePermissions={rolePermissions} officerPermissions={officerPermissions} sectionLoadErrors={{ members: hasLoadError("memberDirectory", "profiles"), guests: hasLoadError("guestPlayers"), fees: hasLoadError("fees", "guestFees", "profiles"), notices: noticeLoadError, venues: hasLoadError("venues"), events: eventLoadError, attendance: hasLoadError("events", "attendance"), teams: eventLoadError, feedback: hasLoadError("feedback"), forms: hasLoadError("forms"), permissions: hasLoadError("rolePermissions", "officerPermissions") }} permissions={permissions} currentProfileId={me?.id ?? null} supabase={supabase} reload={(scope) => void reload(scope)} toast={showToast} />}
      {view === "admin" && !sessionPending && !isOfficer && <div className="content"><Empty icon={<Shield />} title="운영진 전용 공간입니다" description="시스템 관리자 또는 운영 권한이 있는 관리자 계정으로 로그인해 주세요." /></div>}
      {eventDateKey && <EventDetail dateKey={eventDateKey} events={events} profiles={profiles} attendance={attendance} momVotes={momVotes} momResults={momResults} user={user} profile={me} supabase={supabase} loading={publicLoading} loadError={eventLoadError || hasLoadError("profiles", "attendance", "momVotes", "momResults")} sessionPending={sessionPending} rsvpPendingEventIds={rsvpPendingEventIds} canManage={permissions.has("events.manage")} onEdit={(event) => setQuickEditor({ type: "events", row: event as unknown as Record<string, unknown> })} onManageMatch={(event) => setQuickEditor({ type: "teams", row: event as unknown as Record<string, unknown> })} onManageAttendance={(event) => setQuickEditor({ type: "attendance", row: event as unknown as Record<string, unknown> })} onManageWinners={(event) => setWinnerEvent(event)} onDelete={(id, label) => setPendingDelete({ table: "events", id, label })} onAttendance={setMyAttendance} onLogin={() => void setLoginOpen(true)} onRetry={() => void reload()} reload={() => void reload("member")} toast={showToast} />}
      {children}
    </main>
    <div className="toast warning" role="status" aria-live="polite" aria-atomic="true">{toast?.kind === "warning" && <><AlertTriangle size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>

    <footer><span>경충FC · SINCE 2014</span><span>우리의 주말, 우리의 풋살.</span><a href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer">YOUTUBE <ChevronRight size={14} /></a></footer>
    </div>
    <ClubTabBar tab={tab} pathname={pathname} sheetOpen={sheetOpen} onOpenSheet={() => setSheetOpen(true)} />
    <MoreSheet open={sheetOpen} tab={tab} pathname={pathname} isOfficer={isOfficer} account={accountSummary} onClose={closeSheet} onLogin={() => setLoginOpen(true)} onAccount={() => setAccountOpen(true)} />
    {loginOpen && <LoginModal busy={busy} onClose={() => setLoginOpen(false)} onPasswordAuth={passwordAuth} />}
    {accountOpen && user && (accountState === "member" && me ? <AccountModal profile={me} busy={busy} onClose={() => setAccountOpen(false)} onSignOut={signOut} /> : <UnlinkedAccountModal onClose={() => setAccountOpen(false)} onSignOut={signOut} />)}
    {winnerEvent && supabase && <WinnerEditor event={winnerEvent} profiles={profiles} winners={winners} supabase={supabase} onClose={() => setWinnerEvent(null)} onSaved={() => { setWinnerEvent(null); showToast("우승 명단을 저장했습니다."); void reload("member"); }} onError={(message) => showToast(message, "error")} />}
    {quickEditor && supabase && <AdminEditor config={quickEditor} profiles={profiles} guestPlayers={guestPlayers} venues={venues} events={events} attendance={attendance} permissions={permissions} currentProfileId={me?.id ?? null} supabase={supabase} onClose={() => setQuickEditor(null)} onSaved={(result) => { const scope = editorScopes[quickEditor.type] ?? "all"; if (result?.close !== false) setQuickEditor(null); showToast(result?.message ?? "저장했습니다."); void reload(scope); }} onError={(message) => showToast(message, "error")} />}
    {pendingDelete && <ConfirmDialog title="삭제할까요?" target={pendingDelete.label} description="이 작업은 되돌릴 수 없습니다. 삭제한 항목은 복구할 수 없습니다." busy={deleting} onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} />}
    {pendingKick && <ConfirmDialog title="회원을 강퇴할까요?" target={pendingKick.name} description="회원 기능 이용이 즉시 중단됩니다. 다시 가입하려면 운영진이 상태를 변경해야 합니다." confirmLabel="강퇴하기" busy={deleting} onConfirm={() => void confirmKick()} onCancel={() => setPendingKick(null)} />}
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast?.kind === "success" && <><Check size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>
    <div className="toast error" role="alert" aria-live="assertive" aria-atomic="true">{toast?.kind === "error" && <><AlertCircle size={17} /><span>{toast.message}</span><button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismissToast}><X size={15} /></button></>}</div>
  </div>;
}

function LoginModal({ busy, onClose, onPasswordAuth }: { busy: boolean; onClose: () => void; onPasswordAuth: (phone: string, password: string) => Promise<string | null> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: onClose });
  const [phone, setPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    const error = await onPasswordAuth(phone, String(form.get("password") ?? ""));
    if (error) setErrorMessage(error);
  };
  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="회원 로그인">
      <button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button>
      <span className="eyebrow">MEMBER ACCESS</span>
      <h2>로그인</h2>
      <p>등록된 전화번호와 운영진에게 받은 비밀번호로 로그인하세요.</p>
      <p className="form-description">처음 이용하시나요? <Link href="/welcome" className="text-link">신규 회원 안내 보기</Link><br />경충FC는 운영진이 회원 프로필과 로그인 계정을 직접 등록합니다. 운영진에게 이름과 전화번호를 알려 계정 등록을 요청해 주세요.</p>
      <form className="password-auth-form" onSubmit={submit}>
        <label>전화번호<input name="phone" type="tel" required inputMode="tel" autoComplete="username" placeholder="010-1234-5678" value={phone} onChange={(event) => setPhone(event.target.value)} aria-invalid={errorMessage ? true : undefined} /></label>
        <label>비밀번호<input name="password" type="password" required minLength={4} autoComplete="current-password" placeholder="비밀번호 입력" /></label>
        {errorMessage && <FormError id="login-error" message={errorMessage} />}
        <button className="cta" disabled={busy}>{busy ? "로그인 중…" : "전화번호로 로그인"}</button>
        <small>초기 비밀번호로 로그인한 뒤에는 새 비밀번호를 설정해 주세요.</small>
      </form>
      <p className="form-description">로그인 상태는 이 브라우저에 저장되어 새로고침하거나 다시 방문해도 유지됩니다. 공용 기기에서는 사용 후 로그아웃해 주세요.</p>
        </div>
  </div>;
}

function AccountModal({ profile, busy, onClose, onSignOut }: { profile: Profile; busy: boolean; onClose: () => void; onSignOut: () => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: onClose });
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="마이페이지"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">MY ACCOUNT</span><h2>마이페이지</h2><div className="read-box"><b>{profile.name}</b><p>{profile.phone?.replace(/^\+82/, "0") ?? "전화번호 미등록"} · {profile.position ?? "포지션 미정"}</p></div><p className="form-description">등록된 전화번호와 비밀번호로 로그인합니다. 비밀번호를 잊었다면 운영진에게 초기화를 요청해 주세요.</p><ThemeSwitch /><button type="button" className="cta ghost" disabled={busy} onClick={() => void onSignOut()}><LogOut size={17} /> {busy ? "로그아웃 중…" : "로그아웃"}</button></div></div>;
}

function UnlinkedAccountModal({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => Promise<void> }) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: onClose });
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} tabIndex={-1} className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="계정 연결 필요"><button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">ACCOUNT NOTICE</span><h2>계정 연결이 필요합니다</h2><div className="read-box"><b>회원 프로필을 찾지 못했습니다</b><p>로그인은 완료됐지만 이 계정은 아직 경충FC 회원 프로필에 연결되지 않았습니다.</p></div><AccountConnectionNotice /><ThemeSwitch /><button type="button" className="cta ghost" onClick={() => void onSignOut()}><LogOut size={17} /> 로그아웃</button></div></div>;
}

function Home({ upcoming, notice, feeStanding, goingCount, memberCount, user, profile, sessionPending, rsvpPending, publicLoading, eventLoadError, noticeLoadError, feeLoadError, onRetryFees, onRetry, onNavigate, onAttendance, onLogin, myAttendance }: { upcoming?: Event; notice?: Notice; feeStanding: FeeStanding | null; goingCount: number; memberCount: number; user: User | null; profile: Profile | null; sessionPending: boolean; rsvpPending: boolean; publicLoading: boolean; eventLoadError: boolean; noticeLoadError: boolean; feeLoadError: boolean; onRetryFees: () => void; onRetry: () => void; onNavigate: (tab: Tab) => void; onAttendance: (status: Attendance["status"]) => void; onLogin: () => void; myAttendance?: Attendance["status"] }) {
  const date = upcoming ? new Date(upcoming.starts_at) : null;
  const now = new Date();
  const capacity = upcoming ? getEventCapacity(upcoming.capacity, goingCount, upcoming.event_guest_players?.length ?? 0) : null;
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow"><span /> EST. 2014 · SEOUL</span><HeroMotion /><div className="lead-row"><strong>2026<br />SEASON</strong><p>경쟁보다 함께 뛰는 즐거움. 경충FC는 주말마다 모여 공을 차고, 땀 흘리고, 오래 함께할 사람을 만듭니다.</p></div><div className="hero-actions"><button className="cta" onClick={() => onNavigate("events")}>다음 일정 참석하기 <ChevronRight /></button><button className="text-link" onClick={() => onNavigate("participation")}>팀 의사결정 참여</button></div></div>
    <div className="fixture-side"><span className="giant-number" aria-hidden="true">{date?.getDate().toString().padStart(2, "0") ?? "FC"}</span><span className="eyebrow light">NEXT SCHEDULE</span>{publicLoading ? <article className="schedule-card schedule-loading" role="status" aria-label="일정을 불러오는 중"><span /><span /><span /></article> : eventLoadError ? <article className="schedule-card schedule-empty schedule-error"><AlertCircle /><small>SCHEDULE ERROR</small><h2>일정을 불러오지 못했습니다.</h2><p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p><button type="button" onClick={onRetry}>다시 시도</button></article> : upcoming && capacity ? <article className="schedule-card"><header className="schedule-head"><span>다가오는 팀 일정</span><strong>{formatRelativeDate(upcoming.starts_at)}</strong></header><div className="schedule-main"><time className="schedule-date" dateTime={upcoming.starts_at}><small>{date?.toLocaleDateString("ko-KR", { month: "long" })}</small><b>{date?.getDate().toString().padStart(2, "0")}</b><span>{date?.toLocaleDateString("ko-KR", { weekday: "long" })}</span></time><div className="schedule-copy"><small>WEEKEND FUTSAL</small><h2>{upcoming.title}</h2><dl><div><dt>시간</dt><dd>{formatTime(upcoming.starts_at)}</dd></div><div><dt>장소</dt><dd>{upcoming.venue}</dd></div></dl><a className="map-link" href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={15} /><span>{upcoming.address || upcoming.venue}</span><small>네이버 지도</small></a></div></div><div className="schedule-foot"><div>{user && <span>참석 예정 <b>{goingCount}명</b>{goingCount === 0 && <small> · 첫 번째로 참석해 주세요</small>}</span>}<span>참여 용병 <b>{upcoming.event_guest_players?.length ?? 0}명</b></span><CapacityStatus capacity={capacity} /></div><button type="button" onClick={() => onNavigate("events")}>일정 보기 <ChevronRight size={16} /></button></div></article> : <article className="schedule-card schedule-empty"><CalendarDays /><small>UPCOMING SCHEDULE</small><h2>새 일정을 준비 중입니다.</h2><p>다음 주말 풋살 일정이 확정되면 이곳에서 바로 알려드릴게요.</p><button type="button" onClick={() => onNavigate("events")}>전체 일정 보기 <ChevronRight size={16} /></button></article>}<div className="side-stats">{user && <span><b>{memberCount}</b> ACTIVE {memberCount === 1 ? "MEMBER" : "MEMBERS"}</span>}<span><b>WEEKLY</b> SUNDAY</span></div></div></section>
    <section className="locker"><div className="section-heading"><div><span className="eyebrow">MEMBER LOCKER ROOM</span><h2>팀 클럽하우스</h2></div><span suppressHydrationWarning>{now.getFullYear()} · {String(now.getMonth() + 1).padStart(2, "0")}</span></div><div className="panel-grid">
      <article className="panel"><div className="panel-title"><CalendarDays /><span><small>NEXT SCHEDULE RSVP</small><h3>참석 여부</h3></span></div>{publicLoading ? <SectionSkeleton label="참석 일정을 불러오는 중" /> : eventLoadError ? <><p>일정을 불러오지 못했습니다.</p><button type="button" className="panel-link" onClick={onRetry}>다시 시도 <ChevronRight /></button></> : upcoming ? <div className="rsvp-schedule"><time dateTime={upcoming.starts_at}>{formatDate(upcoming.starts_at)} · {formatTime(upcoming.starts_at)}</time><a href={naverMapUrl(upcoming)} target="_blank" rel="noreferrer"><MapPin size={16} /><span><b>{upcoming.venue}</b><small>{upcoming.address || "네이버 지도에서 위치 확인"}</small></span><ChevronRight size={16} /></a></div> : <p>아직 등록된 다음 일정이 없습니다.</p>}{!publicLoading && !eventLoadError && capacity && <CapacityStatus capacity={capacity} />}{!publicLoading && !eventLoadError && upcoming && <RsvpControls eventTitle={upcoming.title} startsAt={upcoming.starts_at} status={myAttendance ?? null} isAuthenticated={Boolean(user)} memberStatus={profile?.status ?? null} isLoading={sessionPending} isSaving={rsvpPending} onChange={onAttendance} onLogin={onLogin} />}</article>
      <article className="panel green-top"><div className="panel-title"><Megaphone /><span><small>LATEST NOTICE</small><h3>팀 공지</h3></span></div>{publicLoading ? <div className="panel-loading" role="status" aria-label="공지를 불러오는 중"><span /><span /></div> : noticeLoadError ? <><p className="panel-headline">공지를 불러오지 못했습니다.</p><button className="panel-link" onClick={onRetry}>다시 시도 <ChevronRight /></button></> : <><p className="panel-headline">{notice?.title ?? "등록된 공지가 없습니다"}</p><p>{notice?.body}</p><button className="panel-link" onClick={() => onNavigate("notices")}>전체 공지 <ChevronRight /></button></>}</article>
      <article className="panel"><div className="panel-title"><CircleDollarSign /><span><small>MEMBERSHIP FEE</small><h3>회비 현황</h3></span></div><div aria-live="polite">{sessionPending ? <SectionSkeleton label="회비 정보를 불러오는 중" /> : user && feeLoadError ? <><p>회비 정보를 불러오지 못했습니다.</p><button type="button" className="panel-link" onClick={onRetryFees}>다시 시도 <ChevronRight /></button></> : <>{!user ? <><p className="panel-empty">로그인하면 내 회비 납부 상태를 확인할 수 있습니다.</p><button type="button" className="panel-link" onClick={onLogin}>로그인 <ChevronRight /></button></> : !feeStanding ? <p className="panel-empty">아직 등록된 회비 내역이 없습니다.</p> : <div className="fee-amount">{feeStanding.unpaidCount > 0 ? `${feeStanding.unpaidTotal.toLocaleString()}원` : "미납 없음"}</div>}{feeStanding && <><FeeStatus status={feeStanding.unpaidCount > 0 ? "unpaid" : feeStanding.paidCount > 0 ? "paid" : "exempt"} /><p className="fee-panel-note">{feeStanding.unpaidCount > 0 ? `미납 ${feeStanding.unpaidCount}건 · 납부 완료 ${feeStanding.paidCount}건` : `납부 완료 ${feeStanding.paidCount}건 · 면제 ${feeStanding.exemptCount}건`}</p></>}</>}</div>{user && <button className="panel-link" onClick={() => onNavigate("fees")}>상세 보기 <ChevronRight /></button>}</article>
    </div></section><a className="video-banner" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer"><span className="play"><Youtube /></span><span><small>GYUNGCHUNG FILM</small><b>구장에서 기록한 경충FC의 플레이를 만나보세요.</b></span><ChevronRight /></a></>;
}

function PageIntro({ kicker, title, description, children }: { kicker: string; title: string; description: string; children?: React.ReactNode }) { return <div className="page-intro"><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{description}</p>{children}</div>; }
function MemberRestrictionNotice({ restriction, resource }: { restriction: ReturnType<typeof getMembershipRestriction>; resource: string }) {
  if (!restriction) return null;
  const copy = getMembershipRestrictionCopy(restriction);
  return <Empty icon={<Shield />} title={copy.title} description={`${resource} ${copy.description}`} />;
}
function Members({ profiles, profile, user, loading, loadError, canManage, onEdit, onKick, onLogin, onRetry }: { profiles: Profile[]; profile: Profile | null; user: User | null; loading: boolean; loadError: boolean; canManage: boolean; onEdit: (profile: Profile) => void; onKick: (profile: Profile) => void; onLogin: () => void; onRetry: () => void }) {
  const intro = <PageIntro kicker="SQUAD" title="함께 뛰는 사람들" description={user ? "포지션보다 이름을 먼저 기억하는 경충FC의 회원입니다." : "회원 명단은 승인된 회원에게만 공개합니다."} />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="회원 명단을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<UserRound />} title="로그인 후 회원 명단을 확인하세요" description="회원 명단은 승인된 회원에게만 공개합니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  if (getMembershipRestriction(profile)) return <section className="content">{intro}<MemberRestrictionNotice restriction={getMembershipRestriction(profile)} resource="회원 명단은 활동 회원에게만 공개합니다." /></section>;
  if (profiles.length === 0) return <section className="content">{intro}<Empty icon={<UserRound />} title="공개된 회원이 없습니다" description="가입 승인이 완료된 회원이 생기면 이곳에 표시됩니다." /></section>;
  return <section className="content">{intro}{canManage && <div className="inline-management-note"><Shield size={17} /> 회원 카드의 ⋯ 메뉴에서 정보를 수정하거나 회원을 강퇴할 수 있습니다.</div>}<MemberDirectory profiles={profiles} currentUserId={user.id} canManage={canManage} onEdit={onEdit} onKick={onKick} /></section>;
}
/* `fees` row-level security hands a regular member only their own rows, so the
   old club-wide table degenerated into their own name repeated once per month.
   Each audience now gets the screen its data can actually answer. */
function Fees({ fees, profiles, profile, events, user, loading, loadError, canManage, onCreate, onEdit, onDelete, onLogin, onRetry, onAsk }: { fees: Fee[]; profiles: Profile[]; profile: Profile | null; events: Event[]; user: User | null; loading: boolean; loadError: boolean; canManage: boolean; onCreate: () => void; onEdit: (fee: Fee) => void; onDelete: (id: string, label: string) => void; onLogin: () => void; onRetry: () => void; onAsk: () => void }) {
  const myFees = useMemo(() => fees.filter((fee) => fee.member_id === profile?.id), [fees, profile?.id]);
  const intro = <PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description={!user ? "회원에게만 공개하는 정보입니다." : canManage ? "회원별 납부 상태를 확인하고 회비를 등록·수정합니다." : "내가 낸 회비와 아직 남은 회비를 월별로 확인합니다."}>{user && canManage && <ul className="fee-rule-badges" aria-label="회비 기준">{feeRuleBadges.map((rule) => <li key={rule}>{rule}</li>)}</ul>}</PageIntro>;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="회비 내역을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<CircleDollarSign />} title="로그인 후 회비를 확인하세요" description="납부 내역은 본인과 회비 담당 운영진에게만 공개합니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  if (getMembershipRestriction(profile)) return <section className="content">{intro}<MemberRestrictionNotice restriction={getMembershipRestriction(profile)} resource="회비 내역은 활동 회원에게만 공개합니다." /></section>;
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
    {/* One header row reads title, filter, action; the totals follow at full width. */}
    <div className="fee-ledger-head">
      <h2>회원별 납부 현황</h2>
      <div className="fee-filter" role="group" aria-label="표시할 회원 범위"><button type="button" className={unpaidOnly ? undefined : "selected"} aria-pressed={!unpaidOnly} onClick={() => setUnpaidOnly(false)}>전체 {groups.length}명</button><button type="button" className={unpaidOnly ? "selected" : undefined} aria-pressed={unpaidOnly} onClick={() => setUnpaidOnly(true)}>미납 {owing.length}명</button></div>
      <button className="cta small" onClick={onCreate}><Plus size={17} /> 회비 등록</button>
    </div>
    <dl className="fee-ledger-summary"><div className={owing.length > 0 ? "owing" : undefined}><dt>미납 회원</dt><dd>{owing.length}명</dd></div><div className={owingTotal > 0 ? "owing" : undefined}><dt>미납 합계</dt><dd>{owingTotal.toLocaleString()}원</dd></div><div><dt>등록 회원</dt><dd>{groups.length}명</dd></div><div><dt>등록 건수</dt><dd>{fees.length}건</dd></div></dl>
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
  if (profile.role === "manager") return { label: "관리자 월회비", amount: FEE_AMOUNTS.managerMonthly, note: `직책과 무관하게 매월 ${formatWon(FEE_AMOUNTS.managerMonthly)}` };
  if (profile.fee_plan === "per_event") return { label: "참여비", amount: FEE_AMOUNTS.perEvent, note: `참여한 일정마다 ${formatWon(FEE_AMOUNTS.perEvent)}` };
  return { label: "월회비", amount: FEE_AMOUNTS.memberMonthly, note: `매월 ${formatWon(FEE_AMOUNTS.memberMonthly)}` };
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
  const [manualMonth, setManualMonth] = useState(false);
  useEffect(() => {
    if (manualMonth || !selectedKey) return;
    const date = parseEventDateKey(selectedKey);
    if (date) setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [selectedKey, manualMonth]);
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
  const moveMonth = (offset: number) => { setManualMonth(true); setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + offset, 1)); };
  const today = new Date();
  const thisWeekSundayKey = toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - today.getDay()) % 7));
  return <section className="month-calendar" aria-labelledby="month-calendar-title">
    <header><div><small>MONTHLY SCHEDULE</small><h2 id="month-calendar-title">{visibleMonth.toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</h2></div><div className="month-calendar-controls"><button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeft /></button><button type="button" onClick={() => { setManualMonth(false); setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1)); }}>이번 달</button><button type="button" onClick={() => moveMonth(1)} aria-label="다음 달"><ChevronRight /></button></div></header>
    <div className="month-calendar-scroll scroll-region" tabIndex={0} role="region" aria-label={`${visibleMonth.getFullYear()}년 ${visibleMonth.getMonth() + 1}월 일정 달력`}><div className="month-calendar-grid"><div className="month-calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div><div className="month-calendar-days">{days.map(({ date, key, events: dayEvents }) => {
      const isToday = date.toDateString() === today.toDateString();
      const marks = <><time dateTime={`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`}>{date.getDate()}</time>{dayEvents.map((event) => <span key={event.id} className="day-event"><b>{formatTime(event.starts_at)}</b><span>{event.title}</span></span>)}</>;
      if (date.getMonth() !== visibleMonth.getMonth()) return <div key={key} className="outside">{marks}</div>;
      const isSelected = selectedKey === key;
      const isThisWeekSunday = key === thisWeekSundayKey;
      return <button key={key} type="button" className={`${isToday ? "today " : ""}${isSelected ? "selected " : ""}${isThisWeekSunday ? "this-week-sunday" : ""}`.trim() || undefined} aria-pressed={isSelected} aria-controls={events.length > 0 ? "event-focus" : undefined} aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 ${date.toLocaleDateString("ko-KR", { weekday: "long" })}${isToday ? " 오늘" : ""} · ${dayEvents.length > 0 ? `일정 ${dayEvents.length}개` : "일정 없음"}`} onClick={() => onSelect(key)}>{marks}</button>;
    })}</div></div></div>
  </section>;
}

function Events({ events, attendance, user, profile, sessionPending, rsvpPendingEventIds, loading, loadError, canManage, onCreate, onEdit, onManageMatch, onManageAttendance, onManageWinners, onDelete, onAttendance, onLogin, onRetry }: { events: Event[]; attendance: Attendance[]; user: User | null; profile: Profile | null; sessionPending: boolean; rsvpPendingEventIds: Set<string>; loading: boolean; loadError: boolean; canManage: boolean; onCreate: () => void; onEdit: (event: Event) => void; onManageMatch: (event: Event) => void; onManageAttendance: (event: Event) => void; onManageWinners: (event: Event) => void; onDelete: (id: string, label: string) => void; onAttendance: (status: Attendance["status"], eventId?: string) => void; onLogin: () => void; onRetry: () => void }) {
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));
  useEffect(() => { setPickedKey(null); }, [todayKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(toDateKey(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const focusRef = useRef<HTMLElement>(null);
  /** Events arrive after this component mounts, so the default day is derived
      instead of seeded into state: the next upcoming day, or — once the season
      has no dates left — the most recent past one. The summary is never blank. */
  const defaultKey = useMemo(() => {
    const now = Date.now();
    const today = parseEventDateKey(todayKey) ?? new Date();
    const sunday = toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - today.getDay()) % 7));
    const fallback = events.find((event) => toEventDateKey(event.starts_at) === sunday)
      ?? events.find((event) => new Date(event.starts_at).getTime() >= now) ?? events[events.length - 1];
    return fallback ? toEventDateKey(fallback.starts_at) : null;
  }, [events, todayKey]);
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
  return <section className="content">{intro}{canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 일정 등록</button></div>}<MonthCalendar key={todayKey} events={events} selectedKey={selectedKey} onSelect={selectDay} />{events.length === 0 ? <Empty icon={<CalendarDays />} title="등록된 일정이 없습니다" description="운영진이 주말 일정을 등록하면 이곳에 표시됩니다." /> : <section ref={focusRef} id="event-focus" className="event-focus" aria-labelledby="event-focus-title">
    <header className="event-focus-head" aria-live="polite"><h2 id="event-focus-title">{selectedDate ? `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 ${selectedDate.toLocaleDateString("ko-KR", { weekday: "long" })}` : "날짜를 선택해 주세요"}</h2><span>{selectedEvents.length > 0 ? `일정 ${selectedEvents.length}개` : "일정 없음"}</span></header>
    {selectedEvents.length === 0 ? <Empty icon={<CalendarDays />} title="이 날짜에는 일정이 없습니다" description="달력에서 초록색 일정 표시가 있는 날짜를 선택해 주세요." /> : selectedEvents.map((event) => {
      const eventAttendance = attendance.filter((item) => item.event_id === event.id);
      const goingCount = eventAttendance.filter((item) => item.status === "going").length;
      const presentCount = eventAttendance.filter((item) => getCheckInStatus(item) === "present").length;
      const guestCount = event.event_guest_players?.length ?? 0;
      const capacity = getEventCapacity(event.capacity, goingCount, guestCount);
      const isPast = new Date(event.starts_at) < new Date();
      const eventDate = new Date(event.starts_at);
      const myAttendance = eventAttendance.find((row) => row.member_id === profile?.id)?.status ?? null;
      /* Teams themselves stay on the day page; the card only carries the
         signal that they exist and, for a signed-in member, which one is
         theirs — the question a member actually opens the card to answer. */
      const teams = event.event_teams ?? [];
      const hasTeams = teams.length > 0;
      const myTeam = profile ? teams.find((team) => team.event_team_members.some((member) => member.profile_id === profile.id)) : undefined;
      const eventDateLabel = eventDate.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
      const minutesUntilStart = (eventDate.getTime() - Date.now()) / 60000;
      const isStartingSoon = minutesUntilStart > 0 && minutesUntilStart <= 120;
      const attendanceProgress = capacity.capacity === null ? 0 : Math.min(100, Math.max(0, Math.round((capacity.totalCount / capacity.capacity) * 100)));
      const remainingLabel = capacity.capacity === null
        ? "정원 제한 없음"
        : (capacity.remaining ?? 0) < 0
          ? `정원 ${Math.abs(capacity.remaining ?? 0)}명 초과`
          : `${capacity.remaining ?? 0}자리 남음`;
      const managementHint = isPast ? "경기 기록을 정리해 주세요." : isStartingSoon ? "경기 시작 전 출석을 확인해 주세요." : "참석 응답을 먼저 확인해 주세요.";
      return <article key={event.id} className={`event-card${isPast ? " past" : ""}`}>
        <time className="event-date" dateTime={event.starts_at}>
          <small>{eventDate.getFullYear()} · {eventDate.toLocaleDateString("ko-KR", { month: "long" })}</small>
          <b>{String(eventDate.getDate()).padStart(2, "0")}</b>
          <span>{eventDate.toLocaleDateString("ko-KR", { weekday: "long" })}</span>
        </time>
        <div className="event-card-main">
          <div className="event-card-title-row">
            <div className="event-info">
              <small>{isPast ? "지난 일정" : "WEEKLY FUTSAL"}</small>
              <h2><Link className="event-card-link" href={eventDatePath(event.starts_at)}>{event.title}</Link></h2>
            </div>
            {canManage && <details className="event-management-menu event-card-more">
              <summary className="event-management-trigger" aria-label={`${event.title} 일정 메뉴`}><MoreHorizontal size={20} /></summary>
              <div className="event-management-popover" role="menu">
                <button type="button" role="menuitem" onClick={() => onEdit(event)}><Pencil size={15} /> 일정 수정</button>
                <button type="button" role="menuitem" className="danger" onClick={() => onDelete(event.id, `${formatDate(event.starts_at)} · ${event.title}`)}><Trash2 size={15} /> 일정 삭제</button>
              </div>
            </details>}
          </div>
          <div className="event-card-schedule">
            <time dateTime={event.starts_at}><Clock3 size={16} /> {eventDateLabel} · {formatTime(event.starts_at)}</time>
            <a href={naverMapUrl(event)} target="_blank" rel="noreferrer"><MapPin size={16} /> {event.venue}</a>
          </div>
          {(myTeam || hasTeams || event.is_competitive) && <div className="event-card-chips" aria-label="일정 특성">
            {myTeam && <span className="event-card-chip mine">{myTeam.team_name}</span>}
            {hasTeams && <span className="event-card-chip">{teams.length}팀 편성</span>}
            {event.is_competitive && <span className="event-card-chip">커피 내기</span>}
            {hasTeams && !myTeam && <a className="event-card-chip unassigned" href={`${eventDatePath(event.starts_at)}?section=teams`}>팀 명단 보기</a>}
          </div>}
          <section className="event-card-section event-card-attendance" aria-labelledby={`event-card-attendance-${event.id}`}>
            <div className="event-card-section-heading"><h3 id={`event-card-attendance-${event.id}`}>참석 현황</h3><span>{isPast ? "출석 기록" : "현재 등록 기준"}</span></div>
            <div className="event-card-attendance-figure"><div><strong>{capacity.totalCount}</strong>{capacity.capacity !== null && <span>/ {capacity.capacity}명</span>}{capacity.capacity === null && <span>명</span>}</div><b>{remainingLabel}</b></div>
            {capacity.capacity !== null && <div className="event-card-attendance-progress" role="progressbar" aria-label={`참석 ${capacity.totalCount}명, 정원 ${capacity.capacity}명`} aria-valuemin={0} aria-valuemax={capacity.capacity} aria-valuenow={Math.min(capacity.totalCount, capacity.capacity)}><span style={{ width: `${attendanceProgress}%` }} /></div>}
            <p>{isPast ? `출석 ${presentCount}명` : `참석 ${goingCount}명`} · 용병 {guestCount}명</p>
          </section>
          <section className="event-card-section event-card-response" aria-labelledby={`event-card-response-${event.id}`}>
            <div className="event-card-section-heading"><h3 id={`event-card-response-${event.id}`}>내 응답</h3></div>
            <RsvpControls variant="detail" eventTitle={event.title} startsAt={event.starts_at} status={myAttendance} isAuthenticated={Boolean(user)} memberStatus={profile?.status ?? null} isLoading={sessionPending} isSaving={rsvpPendingEventIds.has(event.id)} onChange={(status) => onAttendance(status, event.id)} onLogin={onLogin} />
          </section>
          {canManage && <section className={`event-card-section event-card-management${isPast ? " past-priority" : isStartingSoon ? " attendance-priority" : ""}`} aria-labelledby={`event-card-management-${event.id}`}>
            <div className="event-card-section-heading"><h3 id={`event-card-management-${event.id}`}>경기 관리</h3><span>{managementHint}</span></div>
            <div className="officer-menu" role="group" aria-label={`${event.title} 운영 메뉴`}><button type="button" className={`officer-menu-item${isStartingSoon ? " priority" : ""}`} aria-label={`출석 체크 · ${event.title}`} onClick={() => onManageAttendance(event)}><ClipboardCheck size={17} /> 출석 체크</button><button type="button" className={`officer-menu-item${isPast ? " priority" : ""}`} aria-label={`팀·경기 기록 · ${event.title}`} onClick={() => onManageMatch(event)}><Trophy size={17} /> 팀·경기 기록</button><button type="button" className="officer-menu-item" aria-label={`우승 명단 · ${event.title}`} onClick={() => onManageWinners(event)}><Trophy size={17} /> 우승 명단</button></div>
          </section>}
        </div>
      </article>;
    })}
  </section>}</section>;
}

function Rankings({ events, attendance, winners, profiles, user, profile, loading, loadError, onLogin, onRetry }: { events: Event[]; attendance: Attendance[]; winners: EventWinningMember[]; profiles: Profile[]; user: User | null; profile: Profile | null; loading: boolean; loadError: boolean; onLogin: () => void; onRetry: () => void }) {
  const currentYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
  const [year, setYear] = useState(currentYear);
  const years = [...new Set([currentYear, ...events.map((event) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date(event.starts_at))))])].sort((a, b) => b - a);
  const awards = useMemo(() => buildSeasonRankings(year, events, attendance, winners, profiles), [year, events, attendance, winners, profiles]);
  const intro = <PageIntro kicker="CLUB RANKING" title="클럽 랭킹" description="올해의 우승, 득점, 출석 기록을 확인하세요." />;
  if (loading) return <section className="content">{intro}<SectionSkeleton label="랭킹을 불러오는 중" /></section>;
  if (!user) return <section className="content">{intro}<LoginGate icon={<Shield />} title="로그인 후 클럽 기록을 확인하세요" description="회원 전용 연간 랭킹입니다." onLogin={onLogin} /></section>;
  if (loadError) return <section className="content">{intro}<LoadError onRetry={onRetry} /></section>;
  if (getMembershipRestriction(profile)) return <section className="content">{intro}<MemberRestrictionNotice restriction={getMembershipRestriction(profile)} resource="활동 랭킹은 활동 회원에게만 공개합니다." /></section>;
  return <section className="content">{intro}
    <label className="ranking-year">집계 연도 <select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((value) => <option key={value} value={value}>{value}년</option>)}</select></label>
    <div className="ranking-layout">
      <SeasonRankingTable title="MVP" description="일정별 최종 우승 명단에 이름이 등록된 횟수입니다." rows={awards.wins} unit="회" />
      <SeasonRankingTable title="득점왕" description="경기별 득점을 우선하고, 경기 기록이 없는 일정은 팀 기록을 사용합니다." rows={awards.goals} unit="골" />
      <SeasonRankingTable title="출석왕" description="실제 출석과 지각을 일정당 한 번씩 계산합니다." rows={awards.attendance} unit="회" />
      <section className="ranking-fair-play"><div className="section-heading compact"><h2>올해의 페어플레이어</h2></div><p className="section-note">연말에 운영진이 선정합니다.</p><div className="table-wrap"><Empty icon={<Trophy />} title="연말 선정 예정" description="선정 결과가 나오면 이곳에 표시됩니다." /></div></section>
    </div>
  </section>;
}

function SeasonRankingTable({ title, description, rows, unit }: { title: string; description: string; rows: ReturnType<typeof buildSeasonRankings>["wins"]; unit: string }) {
  return <section><div className="section-heading compact"><h2>{title}</h2></div><p className="section-note">{description}</p>
    <div className="table-wrap ranking-table scroll-region" tabIndex={0} role="region" aria-label={`${title} 상위 5명`}><table><caption className="sr-only">{title} 상위 5명</caption><thead><tr><th scope="col">순위</th><th scope="col">회원</th><th scope="col">기록</th></tr></thead><tbody>{rows.map((row) => {
      /* Ties share one badge style and read "T1" so a joint first never looks like two different places. */
      const tied = rows.filter((other) => other.rank === row.rank).length > 1;
      return <tr key={row.member_id}><td><span className={`rank-badge${row.rank === 1 ? " top" : ""}${tied ? " tied" : ""}`} aria-label={tied ? `공동 ${row.rank}위` : `${row.rank}위`}>{tied ? `T${row.rank}` : row.rank}</span></td><th scope="row">{row.member_name}</th><td><b>{row.count}{unit}</b></td></tr>;
    })}</tbody></table>
      {rows.length === 0 && <Empty icon={<Trophy />} title="아직 기록이 없습니다" description="운영진이 해당 일정의 기록을 등록하면 순위가 표시됩니다." />}
    </div>
  </section>;
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
