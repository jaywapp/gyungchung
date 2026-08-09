"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, Check, ChevronRight, CircleDollarSign, LogIn, LogOut, MapPin, Menu, Megaphone, Shield, UserRound, X, Youtube } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Attendance, Event, Fee, Feedback, Notice, ParticipationForm, ParticipationSubmission, Profile, RolePermission } from "@/lib/types";

const FeedbackHub = dynamic(() => import("@/components/feedback-hub"));
const ParticipationHub = dynamic(() => import("@/components/participation-hub"));
const AdminConsole = dynamic(() => import("@/components/admin-console"));

type Tab = "home" | "members" | "fees" | "notices" | "events" | "feedback" | "participation" | "admin";
const roleLabels: Record<Profile["role"], string> = { member: "일반 회원", manager: "매니저", admin: "어드민" };
const navItems: [Tab, string][] = [["home", "홈"], ["members", "회원"], ["fees", "회비"], ["notices", "공지"], ["events", "일정"], ["feedback", "의견"], ["participation", "참여"]];

const nextSaturday = (() => { const date = new Date(); date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7)); date.setHours(18, 0, 0, 0); return date.toISOString(); })();
const sampleProfiles: Profile[] = [
  { id: "sample-1", name: "김경충", email: null, phone: null, role: "admin", position: "GK", jersey_number: 1, joined_at: "2018-03-01", status: "active" },
  { id: "sample-2", name: "박주말", email: null, phone: null, role: "member", position: "FW", jersey_number: 9, joined_at: "2019-05-12", status: "active" },
  { id: "sample-3", name: "이풋살", email: null, phone: null, role: "member", position: "MF", jersey_number: 7, joined_at: "2020-08-23", status: "active" },
  { id: "sample-4", name: "최패스", email: null, phone: null, role: "member", position: "DF", jersey_number: 4, joined_at: "2021-04-10", status: "active" },
];
const sampleEvents: Event[] = [{ id: "sample-event", title: "주말 정기 풋살", starts_at: nextSaturday, venue: "브라보 풋살장", address: "서울시 송파구", note: "흰색·검정색 유니폼을 모두 챙겨주세요.", capacity: 18 }];
const sampleNotices: Notice[] = [{ id: "sample-notice", title: "이번 주 풋살 참석 여부를 알려주세요", body: "목요일 밤 10시까지 참석 버튼을 눌러주세요. 인원에 맞춰 팀을 나눕니다.", is_pinned: true, created_at: new Date().toISOString() }];

export default function Clubhouse() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>(sampleProfiles);
  const [events, setEvents] = useState<Event[]>(sampleEvents);
  const [notices, setNotices] = useState<Notice[]>(sampleNotices);
  const [fees, setFees] = useState<Fee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [forms, setForms] = useState<ParticipationForm[]>([]);
  const [submissions, setSubmissions] = useState<ParticipationSubmission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadData = useCallback(async (currentUser?: User | null) => {
    if (!supabase) return;
    const [profileRes, eventRes, noticeRes, formRes] = await Promise.all([
      supabase.from("profiles").select("*").order("name"),
      supabase.from("events").select("*").order("starts_at"),
      supabase.from("notices").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("participation_forms").select("*, participation_questions(*, participation_options(*))").order("created_at", { ascending: false }),
    ]);
    if (eventRes.data?.length) setEvents(eventRes.data as Event[]);
    if (noticeRes.data?.length) setNotices(noticeRes.data as Notice[]);
    if (formRes.data) setForms((formRes.data as ParticipationForm[]).map((form) => ({ ...form, participation_questions: [...(form.participation_questions ?? [])].sort((a, b) => a.position - b.position).map((question) => ({ ...question, participation_options: [...(question.participation_options ?? [])].sort((a, b) => a.position - b.position) })) })));
    if (!currentUser) {
      if (profileRes.data?.length) setProfiles(profileRes.data as Profile[]);
      setMe(null); setFees([]); setAttendance([]); setFeedback([]); setSubmissions([]); setRolePermissions([]); return;
    }
    const [ownRes, applicationRes, feeRes, attendanceRes, feedbackRes, submissionRes, permissionRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
      supabase.from("membership_applications").select("*"),
      supabase.from("fees").select("*, profiles(name)").order("month", { ascending: false }),
      supabase.from("attendance").select("*"),
      supabase.from("feedback").select("*").order("created_at", { ascending: false }),
      supabase.from("participation_submissions").select("id, form_id, participant_id, submitted_at"),
      supabase.from("role_permissions").select("role, permission"),
    ]);
    const applications = applicationRes.data ?? [];
    const enrichedProfiles = ((profileRes.data as Profile[] | null) ?? []).map((profile) => ({
      ...profile,
      membership_application: applications.find((application) => application.member_id === profile.id) ?? null,
    }));
    const ownProfile = ownRes.data as Profile | null;
    setProfiles(enrichedProfiles);
    setMe(ownProfile ? {
      ...ownProfile,
      membership_application: applications.find((application) => application.member_id === ownProfile.id) ?? null,
    } : null);
    setFees((feeRes.data as unknown as Fee[]) ?? []); setAttendance((attendanceRes.data as Attendance[]) ?? []); setFeedback((feedbackRes.data as Feedback[]) ?? []); setSubmissions((submissionRes.data as ParticipationSubmission[]) ?? []); setRolePermissions((permissionRes.data as RolePermission[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); void loadData(data.user); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); void loadData(session?.user); });
    return () => data.subscription.unsubscribe();
  }, [loadData, supabase]);

  const permissions = useMemo(() => new Set(rolePermissions.filter((row) => row.role === me?.role).map((row) => row.permission)), [me?.role, rolePermissions]);
  const isOfficer = permissions.size > 0;
  const needsApplication = Boolean(user && me?.status === "pending" && !me.membership_application);
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const upcoming = events.find((event) => new Date(event.starts_at) >= new Date()) ?? events[0];
  const myFee = fees.find((fee) => fee.member_id === user?.id);
  const goingCount = upcoming ? attendance.filter((item) => item.event_id === upcoming.id && item.status === "going").length : 0;

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3000); };
  const navigate = (next: Tab) => { setTab(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const signIn = async (provider: "google" | "kakao") => {
    if (!supabase) return showToast("로그인 연결을 준비 중입니다.");
    setBusy(true);
    const oauthProvider = provider === "kakao" ? "custom:kakao" : provider;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: oauthProvider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { showToast("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."); setBusy(false); }
  };
  const signOut = async () => { await supabase?.auth.signOut(); setTab("home"); showToast("로그아웃했습니다."); };
  const setMyAttendance = async (status: Attendance["status"], eventId = upcoming?.id) => {
    if (!user || !eventId || !supabase) return setLoginOpen(true);
    if (me?.status !== "active") return showToast("회원 승인 후 참석 여부를 등록할 수 있습니다.");
    const { error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: user.id, status }, { onConflict: "event_id,member_id" });
    if (error) return showToast(error.message);
    setAttendance((rows) => [...rows.filter((row) => row.event_id !== eventId || row.member_id !== user.id), { event_id: eventId, member_id: user.id, status }]); showToast("참석 여부를 저장했습니다.");
  };

  return <main className="page">
    <header className="topbar">
      <button className="brand" onClick={() => navigate("home")} aria-label="경충FC 홈"><span className="crest"><span>GC</span></span><span className="brand-copy"><strong>경충FC</strong><small>WEEKEND FUTSAL CLUB</small></span></button>
      <nav className={menuOpen ? "nav open" : "nav"} aria-label="주 메뉴">{navItems.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => navigate(key)}>{label}</button>)}{isOfficer && <button className={tab === "admin" ? "active" : ""} onClick={() => navigate("admin")}>관리</button>}</nav>
      <div className="account"><a className="youtube-link" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer" aria-label="경충FC 유튜브"><Youtube size={20} /></a>{user ? <button className="login-button" onClick={signOut}><LogOut size={16} /> {me?.name ?? "로그아웃"}</button> : <button className="login-button" onClick={() => setLoginOpen(true)}><LogIn size={16} /> 로그인</button>}<button className="menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="메뉴 열기">{menuOpen ? <X /> : <Menu />}</button></div>
    </header>

    {me?.status === "pending" && me.membership_application && <div className="approval-banner">가입 신청이 접수되었습니다. 매니저 또는 어드민의 승인을 기다리고 있습니다.</div>}
    {tab === "home" && <Home upcoming={upcoming} notice={notices[0]} fee={myFee} goingCount={goingCount} memberCount={activeProfiles.length} user={user} onNavigate={navigate} onAttendance={setMyAttendance} myAttendance={attendance.find((row) => row.event_id === upcoming?.id && row.member_id === user?.id)?.status} />}
    {tab === "members" && <Members profiles={activeProfiles} />}
    {tab === "fees" && <Fees fees={fees} profiles={profiles} user={user} onLogin={() => setLoginOpen(true)} />}
    {tab === "notices" && <Notices notices={notices} />}
    {tab === "events" && <Events events={events} attendance={attendance} user={user} onAttendance={setMyAttendance} onLogin={() => setLoginOpen(true)} />}
    {tab === "feedback" && <FeedbackHub user={user} profile={me} feedback={feedback} supabase={supabase} reload={() => void loadData(user)} onLogin={() => setLoginOpen(true)} toast={showToast} />}
    {tab === "participation" && <ParticipationHub user={user} profile={me} forms={forms.filter((form) => form.status === "open" || form.status === "closed")} submissions={submissions} supabase={supabase} reload={() => void loadData(user)} onLogin={() => setLoginOpen(true)} toast={showToast} />}
    {tab === "admin" && isOfficer && supabase && <AdminConsole profiles={profiles} fees={fees} notices={notices} events={events} feedback={feedback} forms={forms} rolePermissions={rolePermissions} permissions={permissions} supabase={supabase} reload={() => void loadData(user)} toast={showToast} />}
    {tab === "admin" && !isOfficer && <div className="content"><Empty icon={<Shield />} title="운영진 전용 공간입니다" description="어드민 또는 매니저 권한이 있는 계정으로 로그인해 주세요." /></div>}

    <footer><span>경충FC · SINCE 2018</span><span>우리의 주말, 우리의 풋살.</span><a href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer">YOUTUBE <ChevronRight size={14} /></a></footer>
    {loginOpen && <LoginModal busy={busy} onClose={() => setLoginOpen(false)} onSignIn={signIn} />}
    {needsApplication && supabase && me && <MembershipApplicationModal profile={me} supabase={supabase} onSignOut={signOut} onSubmitted={async () => { await loadData(user); showToast("가입 신청을 접수했습니다."); }} />}
    {toast && <div className="toast"><Check size={17} />{toast}</div>}
  </main>;
}

function LoginModal({ busy, onClose, onSignIn }: { busy: boolean; onClose: () => void; onSignIn: (provider: "google" | "kakao") => void }) { return <div className="modal-backdrop" onClick={onClose}><div className="login-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="로그인"><button className="modal-close" onClick={onClose} aria-label="닫기"><X /></button><span className="eyebrow">MEMBER ACCESS</span><h2>로그인 또는<br />가입 신청</h2><p>Google이나 카카오로 본인을 확인합니다. 처음 방문했다면 이어서 가입 신청서를 작성해야 합니다.</p><button className="social kakao" disabled={busy} onClick={() => onSignIn("kakao")}><span>●</span> 카카오로 계속하기</button><button className="social google" disabled={busy} onClick={() => onSignIn("google")}><span>G</span> Google로 계속하기</button><small>가입 신청서 제출 후 회장단이 승인해야 회원 기능을 이용할 수 있습니다.</small></div></div>; }

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
    <span className="eyebrow">MEMBERSHIP APPLICATION</span><h2>경충FC<br />가입 신청</h2><p className="form-description">필수 정보를 작성해 주세요. 회장단이 신청 내용을 확인하고 승인하면 회원 기능이 열립니다.</p>
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
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow"><span /> EST. 2018 · SEOUL</span><h1>우리의 주말,<br /><em>우리의 풋살.</em></h1><div className="lead-row"><strong>2026<br />SEASON</strong><p>경쟁보다 함께 뛰는 즐거움. 경충FC는 주말마다 모여 공을 차고, 땀 흘리고, 오래 함께할 사람을 만듭니다.</p></div><div className="hero-actions"><button className="cta" onClick={() => onNavigate("events")}>이번 주 참석하기 <ChevronRight /></button><button className="text-link" onClick={() => onNavigate("participation")}>팀 의사결정 참여</button></div></div>
    <div className="fixture-side"><span className="giant-number">{date?.getDate().toString().padStart(2, "0") ?? "FC"}</span><span className="eyebrow light">NEXT WEEKEND</span>{upcoming && <div className="ticket"><div className="ticket-head"><span>WEEKLY FUTSAL</span><strong>{formatDate(upcoming.starts_at)}</strong></div><div className="ticket-main"><div className="ticket-mark"><span className="mini-crest">GC</span><b>경충FC</b></div><div className="vs">PLAY</div><div className="time"><b>{formatTime(upcoming.starts_at)}</b><span>{goingCount || "-"}명 참석</span></div></div><div className="venue"><MapPin size={17} /><span><b>{upcoming.venue}</b>{upcoming.address}</span></div></div>}<div className="side-stats"><span><b>{memberCount}</b> ACTIVE MEMBERS</span><span><b>WEEKLY</b> SAT / SUN</span></div></div></section>
    <section className="locker"><div className="section-heading"><div><span className="eyebrow">MEMBER LOCKER ROOM</span><h2>이번 주 클럽하우스</h2></div><span>{new Date().getFullYear()} · {String(new Date().getMonth() + 1).padStart(2, "0")}</span></div><div className="panel-grid">
      <article className="panel"><div className="panel-title"><CalendarDays /><span><small>WEEKEND RSVP</small><b>참석 여부</b></span></div><p>{user ? "이번 주 함께 뛰나요?" : "로그인하고 참석 여부를 알려주세요."}</p><div className="rsvp"><button className={myAttendance === "going" ? "selected" : ""} onClick={() => onAttendance("going")}>참석</button><button className={myAttendance === "not_going" ? "selected no" : ""} onClick={() => onAttendance("not_going")}>불참</button></div></article>
      <article className="panel green-top"><div className="panel-title"><Megaphone /><span><small>LATEST NOTICE</small><b>팀 공지</b></span></div><h3>{notice?.title ?? "등록된 공지가 없습니다"}</h3><p>{notice?.body}</p><button className="panel-link" onClick={() => onNavigate("notices")}>전체 공지 <ChevronRight /></button></article>
      <article className="panel"><div className="panel-title"><CircleDollarSign /><span><small>MEMBERSHIP FEE</small><b>회비 현황</b></span></div><div className="fee-amount">{fee ? `${fee.amount.toLocaleString()}원` : "로그인 필요"}</div>{fee && <FeeStatus status={fee.status} />}<button className="panel-link" onClick={() => onNavigate("fees")}>상세 보기 <ChevronRight /></button></article>
    </div></section><a className="video-banner" href="https://www.youtube.com/channel/UCR4JmQqbKE21qOMkf7xdYQQ" target="_blank" rel="noreferrer"><span className="play"><Youtube /></span><span><small>GYUNGCHUNG FILM</small><b>구장에서 기록한 경충FC의 플레이를 만나보세요.</b></span><ChevronRight /></a></>;
}

function PageIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) { return <div className="page-intro"><span className="eyebrow">{kicker}</span><h1>{title}</h1><p>{description}</p></div>; }
function Members({ profiles }: { profiles: Profile[] }) { return <section className="content"><PageIntro kicker="SQUAD" title="함께 뛰는 사람들" description="포지션보다 이름을 먼저 기억하는 경충FC의 회원입니다." /><div className="member-grid">{profiles.map((profile, index) => <article className="member-card" key={profile.id}><span className="member-number">{profile.jersey_number ?? String(index + 1).padStart(2, "0")}</span><div className="avatar"><UserRound /></div><small>{profile.position ?? "PLAYER"}</small><h3>{profile.name}</h3><p>JOINED {new Date(profile.joined_at).getFullYear()}</p>{profile.role !== "member" && <span className="admin-badge">{roleLabels[profile.role]}</span>}</article>)}</div></section>; }
function Fees({ fees, profiles, user, onLogin }: { fees: Fee[]; profiles: Profile[]; user: User | null; onLogin: () => void }) { if (!user) return <section className="content"><PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description="회원에게만 공개하는 정보입니다." /><button className="cta" onClick={onLogin}>로그인하고 확인하기 <ChevronRight /></button></section>; return <section className="content"><PageIntro kicker="MEMBERSHIP FEE" title="회비 현황" description="월별 납부 내역을 투명하게 확인합니다." /><div className="table-wrap"><table><thead><tr><th>회원</th><th>기준 월</th><th>금액</th><th>상태</th></tr></thead><tbody>{fees.map((fee) => <tr key={fee.id}><td>{fee.profiles?.name ?? profiles.find((profile) => profile.id === fee.member_id)?.name ?? "회원"}</td><td>{fee.month.slice(0, 7)}</td><td>{fee.amount.toLocaleString()}원</td><td><FeeStatus status={fee.status} /></td></tr>)}</tbody></table>{fees.length === 0 && <Empty icon={<CircleDollarSign />} title="등록된 회비 내역이 없습니다" description="총무가 회비 내역을 등록하면 여기에 표시됩니다." />}</div></section>; }
function FeeStatus({ status }: { status: Fee["status"] }) { return <span className={`status ${status}`}>{status === "paid" ? "납부 완료" : status === "exempt" ? "면제" : "미납"}</span>; }
function Notices({ notices }: { notices: Notice[] }) { return <section className="content"><PageIntro kicker="NOTICE BOARD" title="공지사항" description="놓치면 안 되는 클럽 소식을 전합니다." /><div className="notice-list">{notices.map((notice, index) => <article key={notice.id}><span className="notice-index">{String(index + 1).padStart(2, "0")}</span><div>{notice.is_pinned && <small className="pin">PINNED</small>}<h3>{notice.title}</h3><p>{notice.body}</p><time>{new Date(notice.created_at).toLocaleDateString("ko-KR")}</time></div></article>)}</div></section>; }
function Events({ events, attendance, user, onAttendance, onLogin }: { events: Event[]; attendance: Attendance[]; user: User | null; onAttendance: (status: Attendance["status"], eventId?: string) => void; onLogin: () => void }) { return <section className="content"><PageIntro kicker="WEEKEND SCHEDULE" title="우리의 일정" description="상대 팀과의 경기가 아닌, 우리끼리 모여 뛰는 주말 풋살 일정입니다." /><div className="event-list">{events.map((event, index) => { const count = attendance.filter((item) => item.event_id === event.id && item.status === "going").length; return <article key={event.id} className="event-card"><div className="event-date"><small>{new Date(event.starts_at).toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</small><b>{String(new Date(event.starts_at).getDate()).padStart(2, "0")}</b><span>{new Date(event.starts_at).toLocaleDateString("ko-KR", { weekday: "short" })}</span></div><div className="event-info"><small>WEEKLY FUTSAL · #{String(index + 1).padStart(2, "0")}</small><h3>{event.title}</h3><p><MapPin size={16} /> {event.venue} · {formatTime(event.starts_at)}</p><span>{event.note}</span></div><div className="event-action"><b>{count}명 참석</b><button className="cta small" onClick={() => user ? onAttendance("going", event.id) : onLogin()}>참석하기</button></div></article>; })}</div></section>; }
function Empty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="empty">{icon}<h3>{title}</h3><p>{description}</p></div>; }
function formatDate(value: string) { return new Date(value).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" }); }
function formatTime(value: string) { return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); }
