"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ExternalLink, Github, Inbox, Pencil, Plus, SearchX, ShieldCheck, Trash2, X } from "lucide-react";
import type { AccountRole, Attendance, Event, Fee, Feedback, GuestFee, GuestPlayer, Notice, OfficerPermission, OfficerTitle, ParticipationForm, Profile, RolePermission, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { countChangedFields, countChangedRecords, countSetChanges, dirtyDialogAction } from "@/lib/dirty-state";
import { editorScopes, tableScopes, toErrorMessage, userError, type ReloadHandler, type ToastHandler } from "@/lib/ui-feedback";
import { getCheckInStatus, isCheckedIn } from "@/lib/attendance";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { eventDatePath } from "@/lib/event-date";
import { requiresMemberApprovalConfirmation } from "@/lib/member-status";
import { filterAdminRows } from "@/lib/admin-list-filters";
import ConfirmDialog from "@/components/confirm-dialog";
import { Empty } from "@/components/section-states";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
type Section = "members" | "guests" | "fees" | "notices" | "venues" | "events" | "attendance" | "teams" | "feedback" | "forms" | "permissions";
export type EditorConfig = { type: Exclude<Section, "permissions">; row?: Record<string, unknown> };

const groupDefinitions: { key: string; label: string; sections: Section[] }[] = [
  { key: "roster", label: "회원", sections: ["members", "guests", "fees"] },
  { key: "schedule", label: "일정", sections: ["venues", "events", "attendance", "teams"] },
  { key: "operations", label: "운영", sections: ["notices", "feedback", "forms", "permissions"] },
];
const sectionLabels: Record<Section, string> = { members: "회원", guests: "용병", fees: "회비", notices: "공지", venues: "구장", events: "일정", attendance: "출석", teams: "팀 편성", feedback: "의견", forms: "참여", permissions: "권한" };
const editorTitles: Record<EditorConfig["type"], string> = { members: "회원", guests: "용병", fees: "회비", notices: "공지", venues: "구장", events: "일정", attendance: "출석", teams: "팀 편성", feedback: "의견", forms: "참여 항목" };

const roleLabels: Record<AccountRole, string> = { member: "일반 회원", manager: "관리자" };
const officerTitleLabels: Record<OfficerTitle, string> = { president: "회장", vice_president: "부회장", treasurer: "총무" };
const memberStatusLabels: Record<Profile["status"], string> = { pending: "승인 대기", active: "활동", inactive: "비활동" };
const feeStatusLabels: Record<Fee["status"], string> = { paid: "납부 완료", unpaid: "미납", exempt: "면제" };
const feedbackCategoryLabels: Record<Feedback["category"], string> = { operation: "팀 운영", system: "시스템", facility: "구장·시설", finance: "회비·재정", safety: "안전", other: "기타" };
const feedbackStatusLabels: Record<Feedback["status"], string> = { received: "접수", reviewing: "검토 중", resolved: "답변 완료", closed: "종결" };
const formKindLabels: Record<ParticipationForm["kind"], string> = { election: "회장단 선거", poll: "의사 결정 투표", survey: "회원 설문" };
const formStatusLabels: Record<ParticipationForm["status"], string> = { draft: "초안", open: "진행 중", closed: "마감", archived: "보관" };
const checkInStatusLabels: Record<NonNullable<Attendance["check_in_status"]>, string> = { present: "출석", late: "지각", absent: "결석" };
/* The five roster codes every position column in the schema is limited to.
   profiles.position is the one that can still hold free text until the
   constraint migration lands, so read it through rosterPosition. */
const rosterPositions = ["GK", "DF", "MF", "FW", "ANY"] as const;
const rosterPosition = (position: string | null | undefined) => rosterPositions.find((code) => code === position) ?? "ANY";
const checkInStatusOrder: Array<NonNullable<Attendance["check_in_status"]>> = ["absent", "late", "present"];

const permissionLabels: Record<string, string> = {
  "roles.manage": "계정·직책 설정", "officers.manage": "운영 권한 위임", "members.manage": "회원 관리", "fees.manage": "회비 관리", "notices.manage": "공지 관리", "events.manage": "일정·출석 관리", "feedback.manage": "의견 관리", "elections.manage": "선거 관리", "polls.manage": "투표 관리", "surveys.manage": "설문 관리",
};

const listStatusOptions: Partial<Record<Section, Array<{ value: string; label: string }>>> = {
  members: [{ value: "pending", label: "승인 대기" }, { value: "active", label: "활동" }, { value: "inactive", label: "비활동" }],
  guests: [{ value: "active", label: "활동" }, { value: "inactive", label: "비활동" }],
  fees: [{ value: "paid", label: "납부 완료" }, { value: "unpaid", label: "미납" }, { value: "exempt", label: "면제" }],
  feedback: [{ value: "received", label: "접수" }, { value: "reviewing", label: "검토 중" }, { value: "resolved", label: "답변 완료" }, { value: "closed", label: "종결" }],
  forms: [{ value: "draft", label: "초안" }, { value: "open", label: "진행 중" }, { value: "closed", label: "마감" }, { value: "archived", label: "보관" }],
};

const listSearchPlaceholders: Record<Section, string> = {
  members: "이름 또는 전화번호 검색", guests: "이름 또는 전화번호 검색", fees: "회원 또는 용병 이름 검색", notices: "제목 또는 내용 검색", venues: "구장 또는 주소 검색", events: "일정 제목 또는 날짜 검색", attendance: "일정 제목 또는 날짜 검색", teams: "일정 제목 또는 날짜 검색", feedback: "의견 제목 또는 내용 검색", forms: "제목 또는 설명 검색", permissions: "",
};

export default function AdminConsole({ profiles, guestPlayers, attendance, fees, guestFees, notices, venues, events, feedback, forms, rolePermissions, officerPermissions, permissions, supabase, reload, toast }: {
  profiles: Profile[]; guestPlayers: GuestPlayer[]; attendance: Attendance[]; fees: Fee[]; guestFees: GuestFee[]; notices: Notice[]; venues: Venue[]; events: Event[]; feedback: Feedback[]; forms: ParticipationForm[]; rolePermissions: RolePermission[]; officerPermissions: OfficerPermission[];
  permissions: Set<string>; supabase: SupabaseClient; reload: ReloadHandler; toast: ToastHandler;
}) {
  /** Narrow by domain first, then by section — ten flat tabs read as a wall. */
  const sectionGroups = useMemo(() => {
    const allowed = new Set<Section>();
    if (permissions.has("members.manage")) allowed.add("members");
    if (permissions.has("fees.manage")) allowed.add("fees");
    if (permissions.has("notices.manage")) allowed.add("notices");
    if (permissions.has("feedback.manage")) allowed.add("feedback");
    if (permissions.has("events.manage")) ["guests", "venues", "events", "attendance", "teams"].forEach((key) => allowed.add(key as Section));
    if (permissions.has("elections.manage") || permissions.has("polls.manage") || permissions.has("surveys.manage")) allowed.add("forms");
    if (permissions.has("roles.manage") || permissions.has("officers.manage")) allowed.add("permissions");
    return groupDefinitions
      .map((group) => ({ ...group, sections: group.sections.filter((key) => allowed.has(key)) }))
      .filter((group) => group.sections.length > 0);
  }, [permissions]);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const activeGroup = sectionGroups.find((group) => selectedSection !== null && group.sections.includes(selectedSection)) ?? sectionGroups[0];
  const section: Section = (selectedSection !== null && activeGroup?.sections.includes(selectedSection) ? selectedSection : activeGroup?.sections[0]) ?? "members";
  const setSection = setSelectedSection;
  const [editor, setEditor] = useState<EditorConfig | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ table: string; id: string; label: string } | null>(null);
  const [bulkFeeOpen, setBulkFeeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listStatus, setListStatus] = useState("all");
  const resetListFilters = () => { setListQuery(""); setListStatus("all"); };
  const selectListSection = (nextSection: Section) => { setSection(nextSection); resetListFilters(); };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const { error } = await supabase.from(pendingDelete.table).delete().eq("id", pendingDelete.id);
    const scope = tableScopes[pendingDelete.table] ?? "all";
    setDeleting(false); setPendingDelete(null);
    if (error) return toast(toErrorMessage(error), "error");
    toast("삭제했습니다."); reload(scope);
  };
  const filteredProfiles = filterAdminRows(profiles.map((item) => ({ item, searchValues: [item.name, item.phone], status: item.status })), listQuery, listStatus).map((row) => row.item).sort((left, right) => Number(right.status === "pending") - Number(left.status === "pending"));
  const filteredGuests = filterAdminRows(guestPlayers.map((item) => ({ item, searchValues: [item.name, item.phone], status: item.is_active ? "active" : "inactive" })), listQuery, listStatus).map((row) => row.item);
  const filteredFees = filterAdminRows(fees.map((item) => ({ item, searchValues: [item.profiles?.name ?? profiles.find((profile) => profile.id === item.member_id)?.name, item.month.slice(0, 7), item.fee_type], status: item.status })), listQuery, listStatus).map((row) => row.item);
  const filteredGuestFees = filterAdminRows(guestFees.map((item) => ({ item, searchValues: [item.guest_players?.name, item.events?.title, item.events?.starts_at?.slice(0, 10)], status: item.status })), listQuery, listStatus).map((row) => row.item);
  const filteredNotices = filterAdminRows(notices.map((item) => ({ item, searchValues: [item.title, item.body] })), listQuery).map((row) => row.item);
  const filteredVenues = filterAdminRows(venues.map((item) => ({ item, searchValues: [item.name, item.address, item.note] })), listQuery).map((row) => row.item);
  const filteredEvents = filterAdminRows(events.map((item) => ({ item, searchValues: [item.title, item.starts_at.slice(0, 10), item.venue, item.address] })), listQuery).map((row) => row.item);
  const filteredFeedback = filterAdminRows(feedback.map((item) => ({ item, searchValues: [item.title, item.body, feedbackCategoryLabels[item.category]], status: item.status })), listQuery, listStatus).map((row) => row.item);
  const filteredForms = filterAdminRows(forms.map((item) => ({ item, searchValues: [item.title, item.description, formKindLabels[item.kind]], status: item.status })), listQuery, listStatus).map((row) => row.item);
  const count = section === "members" ? profiles.length : section === "guests" ? guestPlayers.length : section === "fees" ? fees.length + guestFees.length : section === "notices" ? notices.length : section === "venues" ? venues.length : section === "events" || section === "attendance" || section === "teams" ? events.length : section === "feedback" ? feedback.length : section === "forms" ? forms.length : rolePermissions.length + officerPermissions.length;
  const filteredCount = section === "members" ? filteredProfiles.length : section === "guests" ? filteredGuests.length : section === "fees" ? filteredFees.length + filteredGuestFees.length : section === "notices" ? filteredNotices.length : section === "venues" ? filteredVenues.length : section === "events" || section === "attendance" || section === "teams" ? filteredEvents.length : section === "feedback" ? filteredFeedback.length : section === "forms" ? filteredForms.length : count;
  const hasListFilters = listQuery.trim().length > 0 || listStatus !== "all";
  const hasStatusFilter = (listStatusOptions[section]?.length ?? 0) > 0;
  const pendingMemberCount = profiles.filter((profile) => profile.status === "pending").length;
  const emptyState = count === 0
    ? <Empty icon={<Inbox />} title={`등록된 ${sectionLabels[section]} 항목이 없습니다`} description="새 항목을 등록하면 이 목록에서 관리할 수 있습니다." />
    : listQuery.trim().length > 0
      ? <Empty icon={<SearchX />} title="검색 결과가 없습니다" description="검색어를 바꾸거나 필터를 초기화해 보세요." />
      : <Empty icon={<SearchX />} title="선택한 상태의 항목이 없습니다" description="다른 상태를 선택하거나 필터를 초기화해 보세요." />;

  return <section className="content">
    <div className="page-intro"><span className="eyebrow">OPERATIONS DESK</span><h1>팀 운영 관리</h1><p>시스템 관리 권한은 회원 유형과 별도로 부여되며, 회장·부회장·총무는 직책별 운영 업무를 담당합니다.</p></div>
    <div className="admin-groups">{sectionGroups.map((group) => <button key={group.key} type="button" aria-pressed={group.key === activeGroup?.key} onClick={() => selectListSection(group.sections[0])}>{group.label}</button>)}</div>
    <div className="admin-tabs">{(activeGroup?.sections ?? []).map((key) => <button key={key} type="button" aria-pressed={section === key} onClick={() => selectListSection(key)}>{sectionLabels[key]} 관리{key === "members" && pendingMemberCount > 0 && <span className="admin-tab-badge" aria-label={`승인 대기 ${pendingMemberCount}명`}>{pendingMemberCount}</span>}</button>)}</div>
    <div className="admin-toolbar"><b>{hasListFilters ? `검색 결과 ${filteredCount}개` : `${filteredCount}개 항목`}</b><div className="resource-actions">{section === "fees" && <button className="cta small secondary" onClick={() => setBulkFeeOpen(true)}><CalendarPlus size={17} /> 월회비 일괄 등록</button>}{!(["attendance", "teams", "permissions"].includes(section)) && <button className="cta small" onClick={() => setEditor({ type: section as EditorConfig["type"] })}><Plus size={17} /> 새로 등록</button>}</div></div>
    {section !== "permissions" && <div className="admin-list-filters"><label><span className="sr-only">{sectionLabels[section]} 검색</span><input type="search" value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder={listSearchPlaceholders[section]} /></label>{hasStatusFilter && <label><span className="sr-only">상태 필터</span><select value={listStatus} onChange={(event) => setListStatus(event.target.value)}><option value="all">모든 상태</option>{listStatusOptions[section]?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}{hasListFilters && <button type="button" className="text-link" onClick={resetListFilters}>필터 초기화</button>}</div>}
    {section === "permissions" ? <PermissionMatrix roleRows={rolePermissions} officerRows={officerPermissions} canManageSystemRoles={permissions.has("roles.manage")} supabase={supabase} reload={reload} toast={toast} /> : <div className="admin-list">
      {filteredCount === 0 ? emptyState : <>
        {section === "members" && filteredProfiles.map((row) => <AdminRow key={row.id} title={row.name} meta={`${row.position ?? "포지션 미정"} · ${row.role === "manager" && row.officer_title ? officerTitleLabels[row.officer_title] : roleLabels[row.role]}${row.is_system_admin ? " · 시스템 관리자" : ""} · ${row.auth_user_id ? "로그인 연결" : "로그인 미연결"} · ${memberStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "members", row: row as unknown as Record<string, unknown> })} />)}
        {section === "guests" && filteredGuests.map((row) => <AdminRow key={row.id} title={row.name} meta={`${row.preferred_position ?? "포지션 미정"} · ${row.appearance_count}회 참여 · 참여비 ${row.fee_amount.toLocaleString()}원 · ${row.is_active ? "활동" : "비활동"}`} onEdit={() => setEditor({ type: "guests", row: row as unknown as Record<string, unknown> })} />)}
        {section === "fees" && filteredFees.map((row) => <AdminRow key={row.id} title={`${row.profiles?.name ?? profiles.find((p) => p.id === row.member_id)?.name ?? "회원"} · ${row.month.slice(0, 7)}`} meta={`${row.fee_type === "participation" ? "참여비" : "월회비"} · ${row.amount.toLocaleString()}원 · ${feeStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "fees", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "fees", id: row.id, label })} />)}
        {section === "fees" && filteredGuestFees.map((row) => <AdminRow key={`${row.event_id}-${row.guest_player_id}`} title={`${row.guest_players?.name ?? "용병"} · ${row.events ? new Date(row.events.starts_at).toLocaleDateString("ko-KR") : "일정"}`} meta={`용병 참여비 · ${row.amount.toLocaleString()}원 · ${feeStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "fees", row: { ...row, _fee_scope: "guest" } as unknown as Record<string, unknown> })} />)}
        {section === "notices" && filteredNotices.map((row) => <AdminRow key={row.id} title={row.title} meta={new Date(row.created_at).toLocaleDateString("ko-KR")} onEdit={() => setEditor({ type: "notices", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "notices", id: row.id, label })} />)}
        {section === "venues" && filteredVenues.map((row) => <AdminRow key={row.id} title={row.name} meta={row.address || "주소 미등록"} onEdit={() => setEditor({ type: "venues", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "venues", id: row.id, label })} />)}
        {section === "events" && filteredEvents.map((row) => <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · ${row.venue}`} onEdit={() => setEditor({ type: "events", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "events", id: row.id, label })} />)}
        {section === "attendance" && filteredEvents.map((row) => { const eventAttendance = attendance.filter((item) => item.event_id === row.id); const presentCount = eventAttendance.filter((item) => getCheckInStatus(item) === "present").length; const lateCount = eventAttendance.filter((item) => getCheckInStatus(item) === "late").length; const absentCount = eventAttendance.filter((item) => getCheckInStatus(item) === "absent").length; return <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · 출석 ${presentCount}명 · 지각 ${lateCount}명 · 결석 ${absentCount}명`} onEdit={() => setEditor({ type: "attendance", row: row as unknown as Record<string, unknown> })} />; })}
        {section === "teams" && filteredEvents.map((row) => <AdminRow key={row.id} title={row.title} meta={`${row.event_teams?.length ?? 0}개 팀 · ${row.team_mode === "balanced" ? "균형 편성" : row.team_mode === "random" ? "랜덤" : "미편성"}${row.is_competitive ? " · 커피 내기" : ""}`} onEdit={() => setEditor({ type: "teams", row: row as unknown as Record<string, unknown> })} />)}
        {section === "feedback" && filteredFeedback.map((row) => <AdminRow key={row.id} title={`${row.is_anonymous ? "익명" : "회원"} · ${row.title}`} meta={`${feedbackCategoryLabels[row.category]} · ${feedbackStatusLabels[row.status]}${row.github_issue_number ? ` · GitHub #${row.github_issue_number}` : row.publish_to_github ? " · GitHub 연결 대기" : ""}`} href={row.github_issue_url} onEdit={() => setEditor({ type: "feedback", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "feedback", id: row.id, label })} />)}
        {section === "forms" && filteredForms.map((row) => <AdminRow key={row.id} title={row.title} meta={`${formKindLabels[row.kind]} · ${formStatusLabels[row.status]}${row.secret_ballot ? " · 비밀투표" : ""}`} onEdit={() => setEditor({ type: "forms", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "participation_forms", id: row.id, label })} />)}
      </>}
    </div>}
    {editor && <AdminEditor config={editor} profiles={profiles} guestPlayers={guestPlayers} venues={venues} events={events} attendance={attendance} permissions={permissions} supabase={supabase} onClose={() => setEditor(null)} onSaved={(result) => { const scope = editorScopes[editor.type] ?? "all"; if (result?.close !== false) setEditor(null); toast(result?.message ?? "저장했습니다."); reload(scope); }} onError={(message) => toast(message, "error")} />}
    {pendingDelete && <ConfirmDialog title="삭제할까요?" target={pendingDelete.label} description="이 작업은 되돌릴 수 없습니다. 삭제한 항목은 복구할 수 없습니다." busy={deleting} onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(null)} />}
    {bulkFeeOpen && <BulkFeeDialog profiles={profiles} fees={fees} supabase={supabase} onClose={() => setBulkFeeOpen(false)} onSaved={(created) => { setBulkFeeOpen(false); toast(`${created}명의 월회비를 등록했습니다.`); reload("member"); }} onError={(message) => toast(message, "error")} />}
  </section>;
}

/** The row owns its display name, so it hands that name to the delete flow. */
function AdminRow({ title, meta, href, onEdit, onDelete }: { title: string; meta: string; href?: string | null; onEdit: () => void; onDelete?: (label: string) => void }) { return <div className="admin-row"><span><b>{title}</b><small>{meta}</small></span><div>{href && <a href={href} target="_blank" rel="noreferrer" aria-label={`${title} GitHub 이슈 열기`}><Github size={17} /><ExternalLink size={11} /></a>}<button type="button" onClick={onEdit} aria-label={`${title} 수정`}><Pencil size={17} /></button>{onDelete && <button type="button" onClick={() => onDelete(title)} aria-label={`${title} 삭제`}><Trash2 size={17} /></button>}</div></div>; }

/**
 * The treasurer's monthly ritual, collapsed into one action: create this
 * month's unpaid row for every active monthly-plan member who lacks one.
 * Per-event members are excluded — their fees are raised per schedule, and the
 * database rejects a monthly row for them outright.
 */
function BulkFeeDialog({ profiles, fees, supabase, onClose, onSaved, onError }: { profiles: Profile[]; fees: Fee[]; supabase: SupabaseClient; onClose: () => void; onSaved: (created: number) => void; onError: (message: string) => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestClose = () => dirtyDialogAction(isDirty, "request") === "confirm" ? setDiscardOpen(true) : onClose();
  const handleBackdrop = () => {
    if (dirtyDialogAction(isDirty, "backdrop") === "close") onClose();
  };
  const dialogRef = useDialogFocus<HTMLFormElement>({ onRequestClose: requestClose });
  const targets = profiles.filter((profile) => profile.status === "active" && (profile.role === "manager" || profile.fee_plan !== "per_event"));
  const registered = new Set(fees.filter((fee) => fee.fee_type === "monthly" && fee.month.slice(0, 7) === month).map((fee) => fee.member_id));
  const pending = targets.filter((profile) => !registered.has(profile.id));
  const skipped = targets.length - pending.length;
  const perEventCount = profiles.filter((profile) => profile.status === "active" && profile.role === "member" && profile.fee_plan === "per_event").length;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.length === 0) return;
    setSaving(true);
    const { error } = await supabase.from("fees").insert(pending.map((profile) => ({
      member_id: profile.id,
      fee_type: "monthly",
      event_id: null,
      month: `${month}-01`,
      amount: profile.role === "manager" ? 15000 : 30000,
      status: "unpaid",
    })));
    setSaving(false);
    if (error) return onError(toErrorMessage(error));
    onSaved(pending.length);
  };
  return <><div className="modal-backdrop" onClick={handleBackdrop}><form ref={dialogRef} tabIndex={-1} className="editor" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="월회비 일괄 등록">
    <button type="button" className="modal-close" aria-label="닫기" onClick={requestClose}><X /></button>
    <span className="eyebrow">BULK FEE</span><h2>월회비<br />일괄 등록</h2>
    <p className="form-description">활동 중인 월회비 회원 전원에게 해당 월의 미납 회비를 한 번에 만듭니다. 금액은 회원 유형에 따라 자동 적용됩니다.</p>
    <label>기준 월<input name="month" type="month" required value={month} onChange={(event) => { setMonth(event.target.value); setIsDirty(true); }} /></label>
    <div className="read-box">
      <b>{pending.length}명에게 새로 등록됩니다</b>
      <p>대상 {targets.length}명 중 {skipped}명은 이미 등록되어 있어 건너뜁니다.{perEventCount > 0 ? ` 참여비 회원 ${perEventCount}명은 일정별로 부과되므로 제외됩니다.` : ""}</p>
    </div>
    <button className="cta" disabled={saving || pending.length === 0}>{saving ? "등록 중…" : pending.length === 0 ? "등록할 회원이 없습니다" : `${pending.length}명 등록하기`}</button>
  </form></div>{discardOpen && <ConfirmDialog title="작성 중인 내용을 버릴까요?" target="변경한 월회비 일괄 등록 기준이 있습니다." description="버리면 변경한 내용을 복구할 수 없습니다." confirmLabel="버리기" onConfirm={onClose} onCancel={() => setDiscardOpen(false)} />}</>;
}

function PermissionMatrix({ roleRows, officerRows, canManageSystemRoles, supabase, reload, toast }: { roleRows: RolePermission[]; officerRows: OfficerPermission[]; canManageSystemRoles: boolean; supabase: SupabaseClient; reload: ReloadHandler; toast: ToastHandler }) {
  const columns: Array<{ key: "admin" | OfficerTitle; label: string }> = [
    { key: "admin", label: "시스템 관리자" },
    ...(["president", "vice_president", "treasurer"] as OfficerTitle[]).map((title) => ({ key: title, label: officerTitleLabels[title] })),
  ];
  const toggle = async (officerTitle: OfficerTitle, permission: string, enabled: boolean) => {
    if (permission === "roles.manage" || permission === "officers.manage" || (!canManageSystemRoles && officerTitle === "president")) return;
    const result = enabled ? await supabase.from("officer_permissions").insert({ officer_title: officerTitle, permission }) : await supabase.from("officer_permissions").delete().eq("officer_title", officerTitle).eq("permission", permission);
    if (result.error) return toast(toErrorMessage(result.error), "error");
    reload("member");
  };
  return <div className="permission-matrix"><div className="permission-intro"><ShieldCheck /><p>시스템 관리 권한은 일반회원·관리자 여부와 별개이며 모든 운영 권한을 포함합니다. 회장은 부회장·총무의 세부 운영 권한을 조정할 수 있습니다.</p></div><div className="table-wrap scroll-region" tabIndex={0} role="region" aria-label="직책별 운영 권한 설정"><table><caption className="sr-only">직책별 운영 권한 설정</caption><thead><tr><th scope="col">권한</th>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{Object.entries(permissionLabels).map(([permission, label]) => <tr key={permission}><th scope="row">{label}</th>{columns.map((column) => { const isAdmin = column.key === "admin"; const checked = isAdmin ? roleRows.some((row) => row.role === "admin" && row.permission === permission) : officerRows.some((row) => row.officer_title === column.key && row.permission === permission); const disabled = isAdmin || permission === "roles.manage" || permission === "officers.manage" || (!canManageSystemRoles && column.key === "president"); return <td key={column.key}><input aria-label={`${column.label} ${label}`} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => { if (!isAdmin) void toggle(column.key as OfficerTitle, permission, event.target.checked); }} /></td>; })}</tr>)}</tbody></table></div></div>;
}

function toLocalDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextSundayMorning() {
  const date = new Date();
  const daysUntilSunday = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  date.setHours(8, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 7);
  return date;
}

type TeamParticipant = { kind: "member" | "guest"; id: string; name: string; position: string | null };

type MatchScorerDraft = { id: string; team_id: string; member_id: string; goals: number };
type MatchLineupDraft = { member_id: string; team_id: string };
type MatchDraft = { id: string; match_number: number; team_a_id: string; team_b_id: string; team_a_other_goals: number; team_b_other_goals: number; lineups: MatchLineupDraft[]; scorers: MatchScorerDraft[] };
type TeamSaveAction = "generate" | "stats" | "matches";
type TeamSaveSignal = { action: TeamSaveAction; version: number } | null;

function matchScoreFor(match: MatchDraft, teamId: string) {
  const scorerGoals = match.scorers.filter((scorer) => scorer.team_id === teamId && scorer.member_id).reduce((sum, scorer) => sum + scorer.goals, 0);
  const otherGoals = teamId === match.team_a_id ? match.team_a_other_goals : teamId === match.team_b_id ? match.team_b_other_goals : 0;
  return scorerGoals + otherGoals;
}

function buildMatchDrafts(event: Event): MatchDraft[] {
  const teams = event.event_teams ?? [];
  const members = teams.flatMap((team) => team.event_team_members);
  const memberIdFor = (profileId: string | null, guestPlayerId: string | null) => members.find((member) => (profileId !== null && member.profile_id === profileId) || (guestPlayerId !== null && member.guest_player_id === guestPlayerId))?.id ?? "";
  return (event.event_matches ?? []).map((match) => {
    const savedLineups = match.event_match_players ?? [];
    const lineups = savedLineups.length > 0
      ? savedLineups.map((player) => ({ member_id: memberIdFor(player.profile_id, player.guest_player_id), team_id: player.team_id })).filter((lineup) => lineup.member_id)
      : teams.filter((team) => team.id === match.team_a_id || team.id === match.team_b_id).flatMap((team) => team.event_team_members.map((member) => ({ member_id: member.id, team_id: team.id })));
    const scorers = (match.event_match_scorers ?? []).map((scorer) => ({
      id: scorer.id,
      team_id: scorer.team_id,
      member_id: memberIdFor(scorer.profile_id, scorer.guest_player_id),
      goals: scorer.goals,
    }));
    return {
      id: match.id,
      match_number: match.match_number,
      team_a_id: match.team_a_id,
      team_b_id: match.team_b_id,
      team_a_other_goals: Math.max(0, match.team_a_score - scorers.filter((scorer) => scorer.team_id === match.team_a_id).reduce((sum, scorer) => sum + scorer.goals, 0)),
      team_b_other_goals: Math.max(0, match.team_b_score - scorers.filter((scorer) => scorer.team_id === match.team_b_id).reduce((sum, scorer) => sum + scorer.goals, 0)),
      lineups,
      scorers,
    };
  });
}

function createMatchDraft(teams: Event["event_teams"], matchNumber: number): MatchDraft {
  const [teamA, teamB] = teams ?? [];
  const selectedTeams = [teamA, teamB].filter((team): team is NonNullable<Event["event_teams"]>[number] => Boolean(team));
  return { id: `draft-${Date.now()}-${matchNumber}`, match_number: matchNumber, team_a_id: teamA?.id ?? "", team_b_id: teamB?.id ?? "", team_a_other_goals: 0, team_b_other_goals: 0, lineups: selectedTeams.flatMap((team) => team.event_team_members.map((member) => ({ member_id: member.id, team_id: team.id }))), scorers: [] };
}

function buildTeamStatValues(teams: NonNullable<Event["event_teams"]>, goalCounts: Record<string, number>, ratings: Record<string, number | null>, scoreAdjustments: Record<string, number>) {
  const values: Record<string, number | null> = {};
  for (const team of teams) {
    values[`score:${team.id}`] = scoreAdjustments[team.id] ?? 0;
    for (const member of team.event_team_members) {
      values[`goals:${member.id}`] = goalCounts[member.id] ?? 0;
      values[`rating:${member.id}`] = ratings[member.id] ?? null;
    }
  }
  return values;
}

function shuffled<T>(items: T[]) {
  const result = [...items];
  if (result.length < 2) return result;
  const randomValues = new Uint32Array(result.length);
  window.crypto.getRandomValues(randomValues);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomValues[index] % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function AdminEditor({ config, profiles, guestPlayers, venues, events, attendance, permissions, supabase, onClose, onSaved, onError }: { config: EditorConfig; profiles: Profile[]; guestPlayers: GuestPlayer[]; venues: Venue[]; events: Event[]; attendance: Attendance[]; permissions: Set<string>; supabase: SupabaseClient; onClose: () => void; onSaved: (result?: { close?: boolean; message?: string }) => void; onError: (message: string) => void }) {
  const row = config.row ?? {};
  const eventRow = row as unknown as Event;
  const [teamEvent, setTeamEvent] = useState(eventRow);
  const teamResultsRef = useRef<HTMLDivElement>(null);
  const rowTeams = teamEvent.event_teams ?? [];
  const assignedMemberIds = new Set(rowTeams.flatMap((team) => team.event_team_members.map((member) => member.profile_id).filter((id): id is string => Boolean(id))));
  const scheduledGuests = eventRow.event_guest_players ?? [];
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const eventId = String(row.id ?? "");
  const eventAttendance = attendance.filter((item) => item.event_id === eventId);
  const scheduledProfiles = activeProfiles.filter((profile) => eventAttendance.find((item) => item.member_id === profile.id)?.status === "going");
  const walkInProfiles = activeProfiles.filter((profile) => !scheduledProfiles.some((scheduled) => scheduled.id === profile.id));
  const [attendanceQuery, setAttendanceQuery] = useState("");
  const attendanceSearch = attendanceQuery.trim().toLocaleLowerCase();
  const attendanceRecordFor = (profile: Profile) => eventAttendance.find((item) => item.member_id === profile.id);
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<string, Attendance["check_in_status"]>>(() => Object.fromEntries(activeProfiles.map((profile) => [profile.id, getCheckInStatus(attendanceRecordFor(profile))])) as Record<string, Attendance["check_in_status"]>);
  const attendanceStatusFor = (profile: Profile) => attendanceStatuses[profile.id] ?? null;
  const cycleAttendanceStatus = (profileId: string) => setAttendanceStatuses((current) => {
    const currentStatus = current[profileId] ?? null;
    const currentIndex = currentStatus ? checkInStatusOrder.indexOf(currentStatus) : -1;
    const nextStatus = checkInStatusOrder[(currentIndex + 1) % checkInStatusOrder.length];
    return { ...current, [profileId]: nextStatus };
  });
  const hasRecordedWalkIns = walkInProfiles.some((profile) => attendanceStatusFor(profile) !== null);
  const attendanceScope = activeProfiles.filter((profile) => scheduledProfiles.some((scheduled) => scheduled.id === profile.id) || attendanceStatusFor(profile) !== null);
  const attendanceCheckedCount = attendanceScope.filter((profile) => ["present", "late"].includes(attendanceStatusFor(profile) ?? "")).length;
  const attendancePresentCount = attendanceScope.filter((profile) => attendanceStatusFor(profile) === "present").length;
  const attendanceLateCount = attendanceScope.filter((profile) => attendanceStatusFor(profile) === "late").length;
  const attendanceAbsentCount = attendanceScope.filter((profile) => attendanceStatusFor(profile) === "absent").length;
  const attendanceProgress = attendanceScope.length > 0 ? Math.round((attendanceCheckedCount / attendanceScope.length) * 100) : 0;
  const matchesAttendanceSearch = (profile: Profile) => !attendanceSearch || profile.name.toLocaleLowerCase().includes(attendanceSearch);
  const filteredScheduledProfiles = scheduledProfiles.filter(matchesAttendanceSearch);
  const filteredWalkInProfiles = walkInProfiles.filter(matchesAttendanceSearch);
  const renderAttendanceRow = (profile: Profile) => {
    const record = attendanceRecordFor(profile);
    const status = attendanceStatusFor(profile);
    const currentIndex = status ? checkInStatusOrder.indexOf(status) : -1;
    const nextStatus = checkInStatusOrder[(currentIndex + 1) % checkInStatusOrder.length];
    const statusLabel = status ? checkInStatusLabels[status] : "미체크";
    const responseLabel = record?.status === "going" ? "참석 예정" : record?.status === "not_going" ? "불참 응답" : record?.status === "undecided" ? "미응답" : "현장 추가 가능";
    return <div className={`attendance-row attendance-row-${status ?? "pending"}`} key={profile.id} role="group" aria-label={`${profile.name} 출석 상태`}><span className="attendance-avatar" aria-hidden="true">{profile.name.slice(0, 1)}</span><span className="attendance-member"><b>{profile.name}</b><small>{responseLabel}</small></span><input type="hidden" name={`check_in_status_${profile.id}`} value={status ?? ""} readOnly /><button type="button" className="attendance-status-toggle" onClick={() => cycleAttendanceStatus(profile.id)} aria-label={`${profile.name} 상태 ${statusLabel}. 클릭하면 ${checkInStatusLabels[nextStatus]}으로 변경`}>{statusLabel}</button></div>;
  };
  const [venue, setVenue] = useState(String(row.venue ?? ""));
  const [address, setAddress] = useState(String(row.address ?? ""));
  const [venueId, setVenueId] = useState(String(row.venue_id ?? ""));
  /** Registered venues come first, with event snapshots filling legacy gaps. */
  const venueOptions = useMemo(() => {
    const registered = venues.map((item) => ({ id: item.id, venue: item.name, address: item.address }));
    const keys = new Set(registered.map((item) => JSON.stringify([item.venue, item.address])));
    const recent = Array.from(new Map(events.filter((item) => item.venue.trim()).map((item) => [JSON.stringify([item.venue, item.address ?? ""]), { id: "", venue: item.venue, address: item.address ?? "" }])).values()).filter((item) => !keys.has(JSON.stringify([item.venue, item.address])));
    return [...registered, ...recent];
  }, [events, venues]);
  const [saving, setSaving] = useState(false);
  const [pendingMemberUpdate, setPendingMemberUpdate] = useState<{ formData: FormData; submitAction: string | null } | null>(null);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const pendingTeamAction = useRef<TeamAction | null>(null);
  const [matchDrafts, setMatchDrafts] = useState<MatchDraft[]>(() => buildMatchDrafts(eventRow));
  const [selectedRole, setSelectedRole] = useState<AccountRole>((row.role as AccountRole | undefined) ?? "member");
  const initialFeeMember = profiles.find((profile) => profile.id === row.member_id) ?? profiles[0];
  const [selectedFeeMemberId, setSelectedFeeMemberId] = useState(String(row.member_id ?? initialFeeMember?.id ?? ""));
  const selectedFeeMember = profiles.find((profile) => profile.id === selectedFeeMemberId);
  const selectedFeeType = row.id ? String(row.fee_type ?? "monthly") : selectedFeeMember?.role === "member" && selectedFeeMember.fee_plan === "per_event" ? "participation" : "monthly";
  const standardFeeAmount = selectedFeeMember?.role === "manager" ? 15000 : selectedFeeMember?.role === "member" && selectedFeeMember.fee_plan === "per_event" ? 10000 : selectedFeeMember?.role === "member" ? 30000 : 0;
  const allowedKinds = (["election", "poll", "survey"] as const).filter((kind) => permissions.has(`${kind === "election" ? "elections" : kind === "poll" ? "polls" : "surveys"}.manage`));
  const confirmPasswordReset = async () => {
    if (!row.id) return;
    setSaving(true);
    const { error } = await supabase.functions.invoke("provision-member-account", { body: { member_id: row.id } });
    setSaving(false);
    if (error) return onError(toErrorMessage(error));
    setPasswordResetOpen(false);
    onSaved({ message: "비밀번호를 1234로 초기화했습니다." });
  };
  const [formDirty, setFormDirty] = useState(false);
  const [teamDirtyCount, setTeamDirtyCount] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [teamSaveSignal, setTeamSaveSignal] = useState<TeamSaveSignal>(null);
  const isDirty = config.type === "teams" ? teamDirtyCount > 0 : formDirty;
  const requestClose = () => dirtyDialogAction(isDirty, "request") === "confirm" ? setDiscardOpen(true) : onClose();
  const handleBackdrop = () => {
    if (dirtyDialogAction(isDirty, "backdrop") === "close") onClose();
  };
  const dialogRef = useDialogFocus<HTMLFormElement>({ onRequestClose: requestClose });
  const requestTeamAction = (action: TeamAction) => {
    pendingTeamAction.current = action;
    dialogRef.current?.requestSubmit();
  };
  const save = async (fd: FormData, submitAction: string | null) => {
    setSaving(true);
    let error: { message: string; userFacing?: boolean } | null = null;
    const addQuestion = async (formId: string, position: number) => {
      const prompt = String(fd.get("prompt") ?? "").trim();
      if (!prompt) return null;
      const questionType = String(fd.get("question_type"));
      const labels = String(fd.get("options") || "").split(",").map((item) => item.trim()).filter(Boolean);
      const optionLabels = questionType === "yes_no" && labels.length === 0 ? ["찬성", "반대"] : labels;
      if (["single_choice", "multiple_choice", "yes_no"].includes(questionType) && optionLabels.length < 2) return userError("선택형 질문에는 쉼표로 구분한 선택지를 2개 이상 입력하세요.");
      const questionResult = await supabase.from("participation_questions").insert({ form_id: formId, prompt, type: questionType, is_required: true, position, min_value: questionType === "rating" ? 1 : null, max_value: questionType === "rating" ? 5 : null }).select("id").single();
      if (questionResult.error || !questionResult.data) return questionResult.error;
      if (optionLabels.length > 0) {
        const optionResult = await supabase.from("participation_options").insert(optionLabels.map((label, optionPosition) => ({ question_id: questionResult.data.id, label, position: optionPosition })));
        return optionResult.error;
      }
      return null;
    };
    if (config.type === "members") {
      const canManageRoles = permissions.has("roles.manage");
      const nextRole = canManageRoles ? fd.get("role") : row.role ?? "member";
      const payload = { name: fd.get("name"), phone: fd.get("phone"), position: fd.get("position") || null, jersey_number: Number(fd.get("jersey_number")) || null, role: nextRole, officer_title: canManageRoles ? nextRole === "manager" ? fd.get("officer_title") : null : row.officer_title ?? null, fee_plan: canManageRoles ? nextRole === "member" ? fd.get("fee_plan") : null : row.fee_plan ?? "monthly", is_system_admin: canManageRoles ? fd.get("is_system_admin") === "on" : Boolean(row.is_system_admin), status: fd.get("status") ?? "active" };
      if (row.id) {
        ({ error } = await supabase.from("profiles").update(payload).eq("id", row.id));
      } else {
        const memberResult = await supabase.from("profiles").insert(payload).select("id").single();
        error = memberResult.error;
        if (!error && memberResult.data) ({ error } = await supabase.functions.invoke("provision-member-account", { body: { member_id: memberResult.data.id } }));
      }
    }
    if (config.type === "guests") ({ error } = await supabase.from("guest_players").upsert({ ...(row.id ? { id: row.id } : {}), name: fd.get("name"), phone: fd.get("phone") || null, preferred_position: fd.get("preferred_position") || null, note: fd.get("note") || null, is_active: fd.get("is_active") === "on" }));
    if (config.type === "fees" && row._fee_scope === "guest") {
      ({ error } = await supabase.from("event_guest_fees").update({ status: fd.get("status"), paid_at: fd.get("status") === "paid" ? new Date().toISOString() : null }).eq("event_id", row.event_id).eq("guest_player_id", row.guest_player_id));
    }
    if (config.type === "fees" && row._fee_scope !== "guest") {
      const feeType = String(fd.get("fee_type"));
      const eventId = feeType === "participation" ? String(fd.get("event_id") ?? row.event_id) : null;
      const feeEvent = events.find((item) => item.id === eventId);
      const month = feeType === "participation" && feeEvent ? feeEvent.starts_at.slice(0, 7) : String(fd.get("month"));
      ({ error } = await supabase.from("fees").upsert({ ...(row.id ? { id: row.id } : {}), member_id: fd.get("member_id") ?? row.member_id, fee_type: feeType, event_id: eventId, month: `${month}-01`, amount: standardFeeAmount, status: fd.get("status"), paid_at: fd.get("status") === "paid" ? new Date().toISOString() : null }));
    }
    if (config.type === "notices") ({ error } = await supabase.from("notices").upsert({ ...(row.id ? { id: row.id } : {}), title: fd.get("title"), body: fd.get("body"), is_pinned: fd.get("is_pinned") === "on" }));
    if (config.type === "venues") ({ error } = await supabase.from("venues").upsert({ ...(row.id ? { id: row.id } : {}), name: fd.get("name"), address: fd.get("address") || "", note: fd.get("note") || null }));
    if (config.type === "events") {
      const startsAt = new Date(String(fd.get("starts_at")));
      const recurring = fd.get("recurring") === "on";
      const currentYear = new Date().getFullYear();
      if (recurring && startsAt.getFullYear() !== currentYear) error = userError(`정기 일정 시작일은 ${currentYear}년 안에서 선택해 주세요.`);
      let selectedVenueId = String(fd.get("venue_id") ?? "");
      if (!error && !selectedVenueId && fd.get("save_venue") === "on") {
        const venueResult = await supabase.from("venues").upsert({ name: fd.get("venue"), address: fd.get("address") || "" }, { onConflict: "name,address" }).select("id").single();
        error = venueResult.error;
        selectedVenueId = venueResult.data?.id ?? "";
      }
      const eventPayload = { title: fd.get("title"), starts_at: startsAt.toISOString(), venue_id: selectedVenueId || null, venue: fd.get("venue"), address: fd.get("address") || null, note: fd.get("note") || null, capacity: Number(fd.get("capacity")) || null, is_competitive: fd.get("is_competitive") === "on" };
      let eventIds: string[] = [];
      if (!error && row.id) {
        const eventResult = await supabase.from("events").update(eventPayload).eq("id", row.id).select("id").single();
        error = eventResult.error;
        if (eventResult.data) eventIds = [eventResult.data.id];
      } else if (!error && recurring) {
        const existingStarts = new Set(events.map((item) => new Date(item.starts_at).getTime()));
        const recurringPayloads: Array<typeof eventPayload> = [];
        for (const date = new Date(startsAt); !error && date.getFullYear() === currentYear; date.setDate(date.getDate() + 7)) {
          if (!existingStarts.has(date.getTime())) recurringPayloads.push({ ...eventPayload, starts_at: date.toISOString() });
        }
        if (!error && recurringPayloads.length === 0) error = userError("올해 생성할 새 정기 일정이 없습니다.");
        if (!error) {
          const eventResult = await supabase.from("events").insert(recurringPayloads).select("id");
          error = eventResult.error;
          eventIds = eventResult.data?.map((item) => item.id) ?? [];
        }
      } else if (!error) {
        const eventResult = await supabase.from("events").insert(eventPayload).select("id").single();
        error = eventResult.error;
        if (eventResult.data) eventIds = [eventResult.data.id];
      }
      if (!error && eventIds.length > 0) {
        const selectedGuestIds = fd.getAll("guest_ids").map(String);
        const currentGuestIds = scheduledGuests.map((guest) => guest.guest_player_id);
        const removedGuestIds = currentGuestIds.filter((id) => !selectedGuestIds.includes(id));
        const addedGuestIds = selectedGuestIds.filter((id) => !currentGuestIds.includes(id));
        if (row.id && removedGuestIds.length > 0) ({ error } = await supabase.from("event_guest_players").delete().eq("event_id", eventIds[0]).in("guest_player_id", removedGuestIds));
        if (!error && addedGuestIds.length > 0) ({ error } = await supabase.from("event_guest_players").insert(eventIds.flatMap((eventId) => addedGuestIds.map((guestPlayerId) => ({ event_id: eventId, guest_player_id: guestPlayerId })))));
      }
    }
    if (config.type === "attendance") {
      for (const profile of activeProfiles) {
        const current = attendance.find((item) => item.event_id === eventId && item.member_id === profile.id);
        const submittedStatus = String(fd.get(`check_in_status_${profile.id}`) ?? "");
        const nextStatus: Attendance["check_in_status"] = submittedStatus === "present" || submittedStatus === "late" || submittedStatus === "absent" ? submittedStatus : null;
        const currentStatus = getCheckInStatus(current);
        if (nextStatus && (currentStatus !== nextStatus || current?.check_in_status === null || !current?.checked_in_at)) ({ error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: profile.id, status: current?.status ?? "undecided", check_in_status: nextStatus }, { onConflict: "event_id,member_id" }));
        if (!nextStatus && currentStatus) ({ error } = await supabase.from("attendance").update({ check_in_status: null, checked_in_at: null, checked_in_by: null }).eq("event_id", eventId).eq("member_id", profile.id));
        if (error) break;
      }
    }
    if (config.type === "teams") {
      const action = submitAction;
      if (action === "generate") {
        const teamCount = Number(fd.get("team_count"));
        const mode = String(fd.get("team_mode"));
        const selectedMemberIds = new Set(fd.getAll("member_ids").map(String));
        const memberParticipants: TeamParticipant[] = profiles.filter((profile) => profile.status === "active" && selectedMemberIds.has(profile.id)).map((profile) => ({ kind: "member", id: profile.id, name: profile.name, position: profile.position }));
        const guestParticipants: TeamParticipant[] = (teamEvent.event_guest_players ?? []).map((guest) => ({ kind: "guest", id: guest.guest_player_id, name: guest.guest_name, position: guest.guest_position }));
        const participants = [...memberParticipants, ...guestParticipants];
        if (participants.length < teamCount) error = userError("참가 인원이 팀 수보다 적습니다.");
        if (!error) {
          /* Balanced mode buckets by roster code, so a position the roster
             cannot express must fall back to ANY rather than drop out of the
             bucketing — a dropped participant silently produced empty teams
             while save_event_teams had already deleted the previous ones. */
          const ordered = mode === "balanced" ? rosterPositions.flatMap((code) => shuffled(participants.filter((participant) => rosterPosition(participant.position) === code))) : shuffled(participants);
          const teams = Array.from({ length: teamCount }, (_, index) => ({ team_number: index + 1, team_name: `${String.fromCharCode(65 + index)}팀`, participants: [] as TeamParticipant[] }));
          ordered.forEach((participant, index) => { const round = Math.floor(index / teamCount); const offset = index % teamCount; const teamIndex = round % 2 === 0 ? offset : teamCount - 1 - offset; teams[teamIndex].participants.push(participant); });
          /* Never hand the RPC a formation that lost people on the way: it
             deletes the existing teams before inserting the new ones. */
          if (ordered.length !== participants.length || teams.some((team) => team.participants.length === 0)) error = userError("팀 분배에 실패했습니다. 참가자 포지션을 확인해 주세요.");
          else {
            ({ error } = await supabase.rpc("save_event_teams", { target_event_id: teamEvent.id, target_mode: mode, target_teams: teams }));
            if (!error) {
              const refreshed = await supabase.from("event_teams").select("id, event_id, team_number, team_name, score, generation_mode, event_team_members(id, event_id, event_team_id, profile_id, guest_player_id, participant_name, participant_position, goals, rating)").eq("event_id", teamEvent.id).order("team_number");
              error = refreshed.error;
              if (!error) {
                const nextEvent = { ...teamEvent, team_mode: mode as Event["team_mode"], event_teams: (refreshed.data ?? []) as Event["event_teams"] };
                setTeamEvent(nextEvent);
                setMatchDrafts(buildMatchDrafts(nextEvent));
                window.setTimeout(() => teamResultsRef.current?.focus(), 0);
              }
            }
          }
        }
      } else if (action === "stats") {
        const teams = teamEvent.event_teams ?? [];
        const teamStats = teams.map((team) => ({ id: team.id, score: Number(fd.get(`team_score_${team.id}`) ?? 0) }));
        const playerStats = teams.flatMap((team) => team.event_team_members.map((member) => ({ id: member.id, goals: Number(fd.get(`goals_${member.id}`) ?? 0), rating: String(fd.get(`rating_${member.id}`) ?? "") })));
        ({ error } = await supabase.rpc("save_competitive_event_stats", { target_event_id: eventRow.id, target_team_stats: teamStats, target_player_stats: playerStats }));
      } else if (action === "matches") {
        const teams = teamEvent.event_teams ?? [];
        const members = teams.flatMap((team) => team.event_team_members);
        const targetMatches: Array<Record<string, unknown>> = [];
        for (const match of matchDrafts) {
          if (!match.team_a_id || !match.team_b_id || match.team_a_id === match.team_b_id) {
            error = userError("각 경기에 서로 다른 두 팀을 선택해 주세요.");
            break;
          }
          const teamAScore = matchScoreFor(match, match.team_a_id);
          const teamBScore = matchScoreFor(match, match.team_b_id);
          const lineups: Array<Record<string, unknown>> = [];
          for (const teamId of [match.team_a_id, match.team_b_id]) {
            if (!match.lineups.some((lineup) => lineup.team_id === teamId)) {
              const teamName = teams.find((team) => team.id === teamId)?.team_name ?? "선택한 팀";
              error = userError(`${match.match_number}경기의 ${teamName} 출전 선수를 한 명 이상 선택해 주세요.`);
              break;
            }
          }
          if (error) break;
          for (const lineup of match.lineups) {
            const member = members.find((item) => item.id === lineup.member_id);
            if (!member || (lineup.team_id !== match.team_a_id && lineup.team_id !== match.team_b_id)) {
              error = userError(`${match.match_number}경기의 출전 명단을 확인해 주세요.`);
              break;
            }
            lineups.push({ team_id: lineup.team_id, profile_id: member.profile_id, guest_player_id: member.guest_player_id, player_name: member.participant_name });
          }
          if (error) break;
          const scorers: Array<Record<string, unknown>> = [];
          for (const scorer of match.scorers) {
            if (!scorer.member_id) {
              error = userError(`${match.match_number}경기의 득점자를 선택해 주세요.`);
              break;
            }
            const member = members.find((item) => item.id === scorer.member_id);
            const lineup = match.lineups.find((item) => item.member_id === scorer.member_id && item.team_id === scorer.team_id);
            if (!member || !lineup) {
              error = userError(`${match.match_number}경기의 득점자가 출전 명단에 있는지 확인해 주세요.`);
              break;
            }
            scorers.push({ team_id: scorer.team_id, profile_id: member.profile_id, guest_player_id: member.guest_player_id, scorer_name: member.participant_name, goals: Math.max(1, Number(scorer.goals) || 1) });
          }
          if (error) break;
          targetMatches.push({ match_number: match.match_number, team_a_id: match.team_a_id, team_b_id: match.team_b_id, team_a_score: teamAScore, team_b_score: teamBScore, lineups, scorers });
        }
        if (!error) ({ error } = await supabase.rpc("save_event_match_history", { target_event_id: eventRow.id, target_matches: targetMatches }));
      }
    }
    if (config.type === "feedback") ({ error } = await supabase.from("feedback").update({ status: fd.get("status"), officer_response: fd.get("officer_response") || null }).eq("id", row.id));
    if (config.type === "forms" && row.id) {
      ({ error } = await supabase.from("participation_forms").update({ title: fd.get("title"), description: fd.get("description") || null, status: fd.get("status"), starts_at: fd.get("starts_at") ? new Date(String(fd.get("starts_at"))).toISOString() : null, ends_at: fd.get("ends_at") ? new Date(String(fd.get("ends_at"))).toISOString() : null, show_results: fd.get("show_results") === "on" }).eq("id", row.id));
      if (!error) error = await addQuestion(String(row.id), Array.isArray(row.participation_questions) ? row.participation_questions.length : 0);
    }
    if (config.type === "forms" && !row.id) {
      const kind = String(fd.get("kind"));
      const formResult = await supabase.from("participation_forms").insert({ kind, title: fd.get("title"), description: fd.get("description") || null, status: fd.get("status"), starts_at: fd.get("starts_at") ? new Date(String(fd.get("starts_at"))).toISOString() : null, ends_at: fd.get("ends_at") ? new Date(String(fd.get("ends_at"))).toISOString() : null, secret_ballot: kind === "election" && fd.get("secret_ballot") === "on", show_results: fd.get("show_results") === "on" }).select("id").single();
      error = formResult.error;
      if (!error && formResult.data) error = await addQuestion(formResult.data.id, 0);
    }
    setSaving(false); if (error) return onError(toErrorMessage(error));
    if (config.type === "teams") {
      const action = (submitAction ?? "generate") as TeamSaveAction;
      setTeamSaveSignal((current) => ({ action, version: (current?.version ?? 0) + 1 }));
      const message = action === "generate" ? "팀 편성을 완료했습니다." : action === "stats" ? "팀 집계를 저장했습니다." : "경기별 기록을 저장했습니다.";
      return onSaved({ close: false, message });
    }
    setFormDirty(false);
    onSaved();
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    let submitAction = submitter?.name === "action" ? submitter.value : pendingTeamAction.current;
    pendingTeamAction.current = null;
    if (config.type === "teams" && !submitAction) return;
    const formData = new FormData(event.currentTarget);
    if (config.type === "members" && submitAction === "password") {
      if (document.activeElement === submitter) {
        setPasswordResetOpen(true);
        return;
      }
      submitAction = null;
    }
    if (config.type === "members" && submitAction !== "password" && requiresMemberApprovalConfirmation(row.status as "pending" | "active" | "inactive" | undefined, formData.get("status"))) {
      setPendingMemberUpdate({ formData, submitAction });
      return;
    }
    void save(formData, submitAction);
  };
  const memberName = String(pendingMemberUpdate?.formData.get("name") ?? row.name ?? "회원");
  return <><div className="modal-backdrop" onClick={handleBackdrop}><form ref={dialogRef} tabIndex={-1} className="editor" onSubmit={submit} onChange={() => { if (config.type !== "teams") setFormDirty(true); }} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={row.id ? "관리 항목 수정" : "관리 항목 등록"}><button type="button" className="modal-close" aria-label="닫기" onClick={requestClose}><X /></button><span className="eyebrow">ADMIN EDITOR</span><h2>{editorTitles[config.type]} {row.id ? "수정" : "등록"}</h2>
    {config.type === "members" && <><label>이름<input name="name" required minLength={1} maxLength={50} defaultValue={String(row.name ?? "")} /></label><label>전화번호<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" pattern="01[016789]-?[0-9]{3,4}-?[0-9]{4}" defaultValue={String(row.phone ?? "").replace(/^\+82/, "0")} /></label><div className="read-box"><b>{row.auth_user_id ? "로그인 계정 연결 완료" : "로그인 계정 준비 필요"}</b><p>{row.auth_user_id ? "회원은 전화번호와 비밀번호로 로그인할 수 있습니다. 초기화하면 비밀번호가 1234로 변경됩니다." : "저장하면 초기 비밀번호 1234로 로그인 계정을 준비합니다."}</p></div>{row.id && <button type="button" className="cta secondary" disabled={saving} onClick={() => setPasswordResetOpen(true)}>{saving ? "처리 중…" : row.auth_user_id ? "비밀번호를 1234로 초기화" : "초기 비밀번호로 계정 준비"}</button>}<div className="field-row"><label>등록 포지션<select name="position" defaultValue={String(row.position ?? "")}><option value="">미정</option><option value="GK">GK</option><option value="DF">DF</option><option value="MF">MF</option><option value="FW">FW</option><option value="ANY">상관없음</option></select></label><label>등번호<input name="jersey_number" type="number" min="0" max="99" defaultValue={String(row.jersey_number ?? "")} /></label></div><div className="field-row"><label>회원 유형<select name="role" value={selectedRole} disabled={!permissions.has("roles.manage")} onChange={(event) => setSelectedRole(event.target.value as AccountRole)}><option value="member">일반 회원</option><option value="manager">관리자</option></select></label>{selectedRole === "manager" ? <label>관리자 직책<select name="officer_title" required defaultValue={String(row.officer_title ?? "president")} disabled={!permissions.has("roles.manage")}><option value="president">회장</option><option value="vice_president">부회장</option><option value="treasurer">총무</option></select></label> : <label>회비 방식<select name="fee_plan" required defaultValue={String(row.fee_plan ?? "monthly")} disabled={!permissions.has("roles.manage")}><option value="monthly">월회비 · 30,000원</option><option value="per_event">참여 시 · 10,000원</option></select></label>}</div>{selectedRole === "manager" && <p className="form-description">관리자 월회비는 직책과 관계없이 15,000원입니다.</p>}{permissions.has("roles.manage") && <label className="check"><input name="is_system_admin" type="checkbox" defaultChecked={Boolean(row.is_system_admin)} /> 시스템 관리 권한 부여</label>}<label>상태<select name="status" defaultValue={String(row.status ?? "active")}><option value="pending">승인 대기</option><option value="active">활동</option><option value="inactive" disabled={Boolean(row.is_system_admin)}>비활동</option></select></label><p className="form-description">활동으로 변경하면 회원 기능 전체가 열리고, 승인 대기로 변경하면 회원 기능을 이용할 수 없습니다.</p></>}
    {config.type === "guests" && <><label>이름<input name="name" required maxLength={50} defaultValue={String(row.name ?? "")} /></label><div className="field-row"><label>연락처<input name="phone" maxLength={30} placeholder="운영진에게만 공개" defaultValue={String(row.phone ?? "")} /></label><label>선호 포지션<select name="preferred_position" defaultValue={String(row.preferred_position ?? "ANY")}><option value="GK">GK</option><option value="DF">DF</option><option value="MF">MF</option><option value="FW">FW</option><option value="ANY">상관없음</option></select></label></div><div className="read-box"><b>용병 참여비 10,000원</b><p>일정에 배정할 때마다 참여비가 생성됩니다.</p></div><label>메모<textarea name="note" rows={3} maxLength={500} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_active" type="checkbox" defaultChecked={row.id ? Boolean(row.is_active) : true} /> 자주 부르는 용병 목록에 표시</label></>}
    {config.type === "fees" && row._fee_scope === "guest" && <><div className="read-box"><b>{String((row.guest_players as { name?: string } | undefined)?.name ?? "용병")} · 참여비 10,000원</b><p>{String((row.events as { title?: string } | undefined)?.title ?? "일정")}의 용병 회비 납부 상태를 관리합니다.</p></div><label>상태<select name="status" defaultValue={String(row.status ?? "unpaid")}><option value="paid">납부 완료</option><option value="unpaid">미납</option><option value="exempt">면제</option></select></label></>}
    {config.type === "fees" && row._fee_scope !== "guest" && <><label>회원<select name="member_id" required value={selectedFeeMemberId} disabled={Boolean(row.id)} onChange={(event) => setSelectedFeeMemberId(event.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role === "manager" ? "관리자" : p.role === "member" && p.fee_plan === "per_event" ? "참여비형" : p.role === "member" ? "월회비형" : "시스템 관리자"}</option>)}</select></label><input name="fee_type" type="hidden" value={selectedFeeType} /><div className="read-box"><b>{selectedFeeType === "participation" ? "참여비" : "월회비"} {standardFeeAmount.toLocaleString()}원</b><p>회원 유형에 따른 표준 금액이 자동 적용됩니다.</p></div>{selectedFeeType === "participation" ? <label>참여 일정<select name="event_id" required defaultValue={String(row.event_id ?? "")} disabled={Boolean(row.id)}><option value="" disabled>일정을 선택하세요</option>{events.map((item) => <option key={item.id} value={item.id}>{new Date(item.starts_at).toLocaleDateString("ko-KR")} · {item.title}</option>)}</select></label> : <label>기준 월<input name="month" type="month" required defaultValue={String(row.month ?? new Date().toISOString()).slice(0, 7)} /></label>}<label>상태<select name="status" defaultValue={String(row.status ?? "unpaid")}><option value="paid">납부 완료</option><option value="unpaid">미납</option><option value="exempt">면제</option></select></label></>}
    {config.type === "notices" && <><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>내용<textarea name="body" required rows={6} defaultValue={String(row.body ?? "")} /></label><label className="check"><input name="is_pinned" type="checkbox" defaultChecked={Boolean(row.is_pinned)} /> 상단 고정</label></>}
    {config.type === "venues" && <><label>구장명<input name="name" required maxLength={120} defaultValue={String(row.name ?? "")} /></label><label>주소<input name="address" maxLength={240} defaultValue={String(row.address ?? "")} /></label><label>메모<textarea name="note" rows={3} maxLength={500} defaultValue={String(row.note ?? "")} /></label></>}
    {config.type === "events" && <><label>일정명<input name="title" required defaultValue={String(row.title ?? "주말 정기 풋살")} /></label><label>시작 시간<input name="starts_at" type="datetime-local" required defaultValue={row.starts_at ? toLocalDateTimeInput(new Date(String(row.starts_at))) : toLocalDateTimeInput(nextSundayMorning())} /></label>{!row.id && <label className="check"><input name="recurring" type="checkbox" /> 선택한 요일과 시간으로 올해 말까지 매주 생성</label>}{venueOptions.length > 0 && <div className="venue-history"><b>등록·최근 사용 구장</b><div>{venueOptions.map((option) => <button type="button" key={JSON.stringify([option.id, option.venue, option.address])} onClick={() => { setVenueId(option.id); setVenue(option.venue); setAddress(option.address); }}><span>{option.venue}</span>{option.address && <small>{option.address}</small>}</button>)}</div></div>}<input name="venue_id" type="hidden" value={venueId} /><div className="field-row"><label>구장<input name="venue" required value={venue} onChange={(event) => { setVenueId(""); setVenue(event.target.value); }} /></label><label>정원<input name="capacity" type="number" min="1" defaultValue={String(row.capacity ?? 18)} /></label></div><label>주소<input name="address" value={address} onChange={(event) => { setVenueId(""); setAddress(event.target.value); }} /></label>{!venueId && <label className="check"><input name="save_venue" type="checkbox" defaultChecked /> 입력한 구장을 구장 목록에도 등록</label>}<label>안내<textarea name="note" rows={3} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_competitive" type="checkbox" defaultChecked={Boolean(row.is_competitive)} /> 커피 내기: 팀 스코어·골·평점·승패 기록</label><fieldset className="check-grid"><legend>참여 용병</legend>{guestPlayers.filter((guest) => guest.is_active || scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)).map((guest) => <label className="check" key={guest.id}><input name="guest_ids" value={guest.id} type="checkbox" defaultChecked={scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)} /> {guest.name} · {guest.preferred_position ?? "ANY"} · {guest.appearance_count}회</label>)}{guestPlayers.length === 0 && <p className="form-description">용병 관리에서 자주 부르는 용병을 먼저 등록해 주세요.</p>}</fieldset></>}
    {config.type === "attendance" && <div className="attendance-editor">
      <div className="read-box attendance-editor-intro"><b>{String(row.title)}</b><p>{new Date(String(row.starts_at)).toLocaleString("ko-KR")} · {String(row.venue)}</p><small>참석 예정 회원을 먼저 확인하고, 현장에 온 회원은 누구든 출석·지각·결석으로 기록할 수 있습니다.</small></div>
      <section className="attendance-summary" aria-label="출석 진행률">
        <div className="attendance-summary-head"><div><span className="eyebrow">CHECK-IN DESK</span><h3>실제 출석 회원</h3></div><strong>{attendanceCheckedCount} / {attendanceScope.length}명 확인</strong></div>
        <div className="attendance-progress" aria-hidden="true"><span style={{ width: `${attendanceProgress}%` }} /></div>
        <div className="attendance-summary-stats"><span className="attendance-stat-present">{attendancePresentCount} 출석</span><span className="attendance-stat-late">{attendanceLateCount} 지각</span><span className="attendance-stat-absent">{attendanceAbsentCount} 결석</span></div>
      </section>
      <label className="attendance-search"><span className="sr-only">회원 검색</span><input type="search" value={attendanceQuery} onChange={(event) => setAttendanceQuery(event.target.value)} placeholder="이름 검색" /></label>
      <p className="form-description attendance-toggle-help">상태 버튼을 누를 때마다 결석 → 지각 → 출석 순서로 바뀝니다.</p>
      <section className="attendance-group">
        <div className="attendance-group-heading"><b>참석 예정</b><span>{scheduledProfiles.length}명</span></div>
        <div className="attendance-status-grid">{filteredScheduledProfiles.length > 0 ? filteredScheduledProfiles.map(renderAttendanceRow) : <p className="form-description">{attendanceSearch ? "검색 결과가 없습니다." : "참석 예정으로 답한 회원이 없습니다."}</p>}</div>
      </section>
      <details className="attendance-walk-in" open={hasRecordedWalkIns}>
        <summary><span>미응답 / 불참 · 현장 추가</span><b>{walkInProfiles.length}명</b></summary>
        <p className="form-description">참석 여부를 밝히지 않았거나 불참으로 답한 회원도 현장에 오면 여기서 상태를 기록하세요.</p>
        <div className="attendance-status-grid">{filteredWalkInProfiles.length > 0 ? filteredWalkInProfiles.map(renderAttendanceRow) : <p className="form-description">{attendanceSearch ? "검색 결과가 없습니다." : "추가할 활동 회원이 없습니다."}</p>}</div>
      </details>
    </div>}
     {config.type === "teams" && <TeamEditor event={teamEvent} profiles={profiles} attendance={attendance} assignedMemberIds={assignedMemberIds} saving={saving} matchDrafts={matchDrafts} saveSignal={teamSaveSignal} resultRef={teamResultsRef} onMatchDraftsChange={setMatchDrafts} onDirtyCountChange={setTeamDirtyCount} onAction={requestTeamAction} />}
    {config.type === "feedback" && <><div className="read-box"><b>{String(row.title)}</b><p>{String(row.body)}</p></div><label>처리 상태<select name="status" defaultValue={String(row.status ?? "received")}><option value="received">접수</option><option value="reviewing">검토 중</option><option value="resolved">답변 완료</option><option value="closed">종결</option></select></label><label>운영진 답변<textarea name="officer_response" rows={6} defaultValue={String(row.officer_response ?? "")} /></label></>}
    {config.type === "forms" && <><label>종류<select name="kind" defaultValue={String(row.kind ?? allowedKinds[0])} disabled={Boolean(row.id)}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{kind === "election" ? "회장단 선거" : kind === "poll" ? "의사 결정 투표" : "회원 설문"}</option>)}</select></label><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>설명<textarea name="description" rows={3} defaultValue={String(row.description ?? "")} /></label><div className="field-row"><label>시작<input name="starts_at" type="datetime-local" defaultValue={row.starts_at ? new Date(String(row.starts_at)).toISOString().slice(0, 16) : ""} /></label><label>마감<input name="ends_at" type="datetime-local" defaultValue={row.ends_at ? new Date(String(row.ends_at)).toISOString().slice(0, 16) : ""} /></label></div><label>상태<select name="status" defaultValue={String(row.status ?? "draft")}><option value="draft">초안</option><option value="open">진행 중</option><option value="closed">마감</option><option value="archived">보관</option></select></label><label>{row.id ? "새 질문 추가 (선택)" : "첫 질문"}<input name="prompt" required={!row.id} placeholder="회원에게 물어볼 내용을 입력하세요" /></label><label>질문 형식<select name="question_type" defaultValue="single_choice"><option value="single_choice">단일 선택</option><option value="multiple_choice">복수 선택</option><option value="yes_no">찬반</option><option value="short_text">짧은 답변</option><option value="long_text">긴 답변</option><option value="rating">1~5점</option></select></label><label>선택지<input name="options" placeholder="후보 A, 후보 B (쉼표로 구분)" /></label>{!row.id && <label className="check"><input name="secret_ballot" type="checkbox" /> 선거를 비밀투표로 진행</label>}<label className="check"><input name="show_results" type="checkbox" defaultChecked={row.id ? Boolean(row.show_results) : true} /> 종료 후 결과 공개</label></>}
    {config.type !== "teams" && <button className="cta" disabled={saving}>{saving ? "저장 중…" : "저장하기"}</button>}
  </form>{pendingMemberUpdate && <ConfirmDialog title="회원 승인을 진행할까요?" target={memberName} description="활동으로 변경하면 이 회원의 회원 명단·회비·팀 편성·투표 등 회원 기능 전체가 열립니다." confirmLabel="승인하기" busy={saving} onConfirm={() => { void save(pendingMemberUpdate.formData, pendingMemberUpdate.submitAction); setPendingMemberUpdate(null); }} onCancel={() => setPendingMemberUpdate(null)} />}{passwordResetOpen && <ConfirmDialog title="비밀번호를 초기화할까요?" target={String(row.name ?? "이 회원")} description="이 회원은 기존 비밀번호를 더 이상 사용할 수 없으며, 비밀번호가 1234로 변경됩니다." confirmLabel="비밀번호 초기화" busy={saving} onConfirm={() => void confirmPasswordReset()} onCancel={() => setPasswordResetOpen(false)} />}</div>{discardOpen && <ConfirmDialog title="작성 중인 내용을 버릴까요?" target={config.type === "teams" ? `저장되지 않은 기록 ${teamDirtyCount}건이 있습니다.` : `저장하지 않은 ${editorTitles[config.type]} 변경이 있습니다.`} description="버리면 변경한 내용을 복구할 수 없습니다." confirmLabel="버리기" onConfirm={onClose} onCancel={() => setDiscardOpen(false)} />}</>;
}

type TeamEditorProps = {
  event: Event;
  profiles: Profile[];
  attendance: Attendance[];
  assignedMemberIds: Set<string>;
  saving: boolean;
  matchDrafts: MatchDraft[];
  saveSignal: TeamSaveSignal;
  resultRef: React.RefObject<HTMLDivElement | null>;
  onMatchDraftsChange: (matches: MatchDraft[]) => void;
  onAction: (action: TeamAction) => void;
  onDirtyCountChange: (count: number) => void;
};

type TeamAction = "generate" | "stats" | "matches";

const ratingSteps = [2, 4, 6, 8, 10];

function TeamEditor({ event, profiles, attendance, assignedMemberIds, saving, matchDrafts, saveSignal, resultRef, onMatchDraftsChange, onDirtyCountChange, onAction }: TeamEditorProps) {
  const teams = event.event_teams ?? [];
  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const hasAttendance = (profile: Profile) => {
    const record = attendance.find((item) => item.event_id === event.id && item.member_id === profile.id);
    return isCheckedIn(record) || (record?.status === "going" && getCheckInStatus(record) !== "absent");
  };
  /* Only the members who turned up can be put on a team, so attendance is the
     roster rather than a hint beside every active member. */
  const eligibleProfiles = activeProfiles.filter(hasAttendance);
  const [goalCounts, setGoalCounts] = useState<Record<string, number>>(() => Object.fromEntries(teams.flatMap((team) => team.event_team_members.map((member) => [member.id, member.goals]))));
  /* A team score is the sum of its scorers plus goals that cannot be assigned
     to a player, such as own goals. Keeping only that adjustment separate
     makes every player goal update the scoreboard without losing corrections. */
  const [scoreAdjustments, setScoreAdjustments] = useState<Record<string, number>>(() => Object.fromEntries(teams.map((team) => {
    const playerGoals = team.event_team_members.reduce((sum, member) => sum + member.goals, 0);
    return [team.id, Math.max(0, (team.score ?? playerGoals) - playerGoals)];
  })));
  const [ratings, setRatings] = useState<Record<string, number | null>>(() => Object.fromEntries(teams.flatMap((team) => team.event_team_members.map((member) => [member.id, member.rating]))));
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set(eligibleProfiles.map((profile) => profile.id)));
  const [teamMode, setTeamMode] = useState(String(event.team_mode ?? "balanced"));
  const [teamCount, setTeamCount] = useState(String(Math.max(2, teams.length)));
  const [savedSetup, setSavedSetup] = useState(() => ({ memberIds: [...selectedMemberIds], teamMode, teamCount }));
  const [savedStats, setSavedStats] = useState<Record<string, unknown>>(() => buildTeamStatValues(teams, goalCounts, ratings, scoreAdjustments));
  const [savedMatches, setSavedMatches] = useState(matchDrafts);
  const teamScores = Object.fromEntries(teams.map((team) => [team.id, team.event_team_members.reduce((sum, member) => sum + (goalCounts[member.id] ?? 0), 0) + (scoreAdjustments[team.id] ?? 0)]));
  const highestScore = Math.max(0, ...teams.map((team) => teamScores[team.id] ?? 0));
  const selectedCount = selectedMemberIds.size;
  const updateScoreAdjustment = (teamId: string, delta: number) => setScoreAdjustments((current) => ({ ...current, [teamId]: Math.max(0, (current[teamId] ?? 0) + delta) }));
  const updateGoals = (memberId: string, delta: number) => setGoalCounts((current) => ({ ...current, [memberId]: Math.max(0, (current[memberId] ?? 0) + delta) }));
  const updateRating = (memberId: string, value: number) => setRatings((current) => ({ ...current, [memberId]: value }));
  const currentSetup = { memberIds: [...selectedMemberIds], teamMode, teamCount };
  const currentStats = buildTeamStatValues(teams, goalCounts, ratings, scoreAdjustments);
  const setupDirtyCount = countSetChanges(savedSetup.memberIds, currentSetup.memberIds) + countChangedFields({ teamMode: savedSetup.teamMode, teamCount: savedSetup.teamCount }, { teamMode, teamCount });
  const statsDirtyCount = countChangedFields(savedStats, currentStats);
  const matchesDirtyCount = countChangedRecords(savedMatches, matchDrafts);
  const dirtyCount = setupDirtyCount + statsDirtyCount + matchesDirtyCount;
  const currentSetupRef = useRef(currentSetup);
  const currentStatsRef = useRef(currentStats);
  const currentMatchesRef = useRef(matchDrafts);
  const teamsRef = useRef(teams);
  currentSetupRef.current = currentSetup;
  currentStatsRef.current = currentStats;
  currentMatchesRef.current = matchDrafts;
  teamsRef.current = teams;

  useEffect(() => {
    if (!saveSignal) return;
    if (saveSignal.action === "generate") {
      const savedTeams = teamsRef.current;
      const nextGoalCounts = Object.fromEntries(savedTeams.flatMap((team) => team.event_team_members.map((member) => [member.id, member.goals])));
      const nextScoreAdjustments = Object.fromEntries(savedTeams.map((team) => {
        const playerGoals = team.event_team_members.reduce((sum, member) => sum + member.goals, 0);
        return [team.id, Math.max(0, (team.score ?? playerGoals) - playerGoals)];
      }));
      const nextRatings = Object.fromEntries(savedTeams.flatMap((team) => team.event_team_members.map((member) => [member.id, member.rating])));
      setGoalCounts(nextGoalCounts);
      setScoreAdjustments(nextScoreAdjustments);
      setRatings(nextRatings);
      setSavedSetup(currentSetupRef.current);
      setSavedStats(buildTeamStatValues(savedTeams, nextGoalCounts, nextRatings, nextScoreAdjustments));
      setSavedMatches(currentMatchesRef.current);
      return;
    }
    if (saveSignal.action === "stats") setSavedStats(currentStatsRef.current);
    if (saveSignal.action === "matches") setSavedMatches(currentMatchesRef.current);
  }, [saveSignal]);

  useEffect(() => onDirtyCountChange(dirtyCount), [dirtyCount, onDirtyCountChange]);

  return <>
    <div className="read-box team-editor-intro"><b>{String(event.title)}</b><p>1. 회원을 고르고 → 2. 팀 방식과 수를 정한 뒤 → 3. 팀 만들기를 누르세요.</p><small>팀을 다시 만들면 기존 팀 편성과 기록이 새 결과로 교체됩니다.</small></div>
    <p className={`unsaved-records ${dirtyCount > 0 ? "is-dirty" : ""}`} role="status" aria-live="polite">{dirtyCount > 0 ? `저장되지 않은 기록 ${dirtyCount}건` : "모든 기록이 저장되었습니다."}</p>
    <fieldset className="check-grid team-roster-picker">
      <legend>1. 참여 회원 선택 · {selectedCount}명</legend>
      <p className="form-description team-step-description">참석 예정이거나 출석 확인된 회원만 나옵니다. 기본으로 모두 선택되며, 빠질 회원만 체크를 해제하세요.</p>
      <div className="team-roster-list">{eligibleProfiles.length > 0 ? eligibleProfiles.map((profile) => {
        const attended = hasAttendance(profile);
        const assigned = assignedMemberIds.has(profile.id);
        return <label className="team-roster-row" key={profile.id}><input name="member_ids" value={profile.id} type="checkbox" checked={selectedMemberIds.has(profile.id)} onChange={(changeEvent) => setSelectedMemberIds((current) => { const next = new Set(current); if (changeEvent.target.checked) next.add(profile.id); else next.delete(profile.id); return next; })} /><span className="team-roster-avatar" aria-hidden="true">{profile.name.slice(0, 1)}</span><span className="team-roster-copy"><b>{profile.name}</b></span><span className={`team-roster-state ${assigned ? "is-assigned" : attended ? "is-attended" : ""}`}>{assigned ? "편성됨" : attended ? "참석" : "선택 가능"}</span></label>;
      }) : <p className="form-description">이 일정에 출석한 회원이 없습니다. 출석 체크에서 출석을 먼저 기록해 주세요.</p>}</div>
    </fieldset>
    <section className="team-generation-panel">
      <div className="team-step-heading"><h3>2. 팀 나누기</h3><p className="form-description">선택한 회원을 몇 팀으로 나눌지 정한 뒤 팀 만들기를 누르세요.</p></div>
      <div className="field-row team-generation-controls"><label>편성 방식<select name="team_mode" value={teamMode} onChange={(event) => setTeamMode(event.target.value)}><option value="balanced">균형 편성</option><option value="random">무작위 편성</option></select></label><label>팀 수<select name="team_count" value={teamCount} onChange={(event) => setTeamCount(event.target.value)}><option value="2">2팀</option><option value="3">3팀</option><option value="4">4팀</option></select></label></div>
      <p className="team-generation-hint">처음이라면 균형 편성을 권장합니다. 선택한 회원을 팀마다 고르게 나눕니다.</p>
      <button type="button" className="cta" onClick={() => onAction("generate")} disabled={saving}>{saving ? "편성 중…" : teams.length > 0 ? "팀 다시 만들기" : "팀 만들기"}</button>
    </section>
    {teams.length > 0 && <div ref={resultRef} tabIndex={-1} className="team-record-content" aria-live="polite">
      <header className="team-results-heading"><h3>3. 팀 편성 결과</h3><span>{teams.length}개 팀 · {teams.reduce((sum, team) => sum + team.event_team_members.length, 0)}명</span></header>
      {Boolean(event.is_competitive) && <><p className="form-description">선수 득점은 팀 점수에 자동 합산됩니다. 자책골·득점자 미상만 기타 득점으로 보정하세요.</p><section className="team-scoreboard" aria-label="팀 스코어보드">{teams.map((team) => { const score = teamScores[team.id] ?? 0; const isLeading = highestScore > 0 && score === highestScore; return <article className={`team-score-card ${isLeading ? "is-leading" : ""}`} key={team.id}><div className="team-score-card-label"><b>{team.team_name}</b>{isLeading && <em>리드</em>}</div><output>{score}</output><div className="team-score-stepper"><button type="button" onClick={() => updateScoreAdjustment(team.id, -1)} aria-label={`${team.team_name} 기타 득점 감소`}>−</button><span>기타 득점</span><button type="button" onClick={() => updateScoreAdjustment(team.id, 1)} aria-label={`${team.team_name} 기타 득점 증가`}>+</button></div><input type="hidden" name={`team_score_${team.id}`} value={score} readOnly /></article>; })}</section></>}
      <div className="team-record-grid">{teams.map((team) => <section className="team-admin-card team-record-card" key={team.id}><header className="team-record-heading"><div><span className="eyebrow">ROSTER {String(team.team_number).padStart(2, "0")}</span><h3>{team.team_name}</h3></div>{Boolean(event.is_competitive) && <strong>{teamScores[team.id] ?? 0}점</strong>}</header><div className="team-record-member-list">{team.event_team_members.map((member) => { const goals = goalCounts[member.id] ?? 0; const rating = ratings[member.id] ?? null; return <div className="team-member-stat" key={member.id}><span className="team-member-avatar" aria-hidden="true">{member.participant_name.slice(0, 1)}</span><span className="team-member-copy"><b>{member.participant_name}</b></span>{Boolean(event.is_competitive) && <><input type="hidden" name={`goals_${member.id}`} value={goals} readOnly /><div className="team-goal-stepper" aria-label={`${member.participant_name} 골`}><button type="button" onClick={() => updateGoals(member.id, -1)} aria-label={`${member.participant_name} 골 감소`}>−</button><output>{goals}골</output><button type="button" onClick={() => updateGoals(member.id, 1)} aria-label={`${member.participant_name} 골 증가`}>+</button></div><input type="hidden" name={`rating_${member.id}`} value={rating ?? ""} readOnly /><div className="team-rating-control" role="group" aria-label={`${member.participant_name} 평점`}>{ratingSteps.map((value) => <button type="button" key={value} className={rating !== null && rating >= value ? "is-selected" : ""} aria-label={`${value}점`} aria-pressed={rating !== null && rating >= value} onClick={() => updateRating(member.id, value)}><span /></button>)}<b>{rating === null ? "미평가" : `${rating}/10`}</b></div></>}</div>; })}</div></section>)}</div>
      {Boolean(event.is_competitive) && <button type="button" className="cta secondary" onClick={() => onAction("stats")} disabled={saving || statsDirtyCount === 0}>{saving ? "저장 중…" : statsDirtyCount > 0 ? `팀 집계 저장 · ${statsDirtyCount}건` : "팀 집계 저장됨"}</button>}
      <MatchHistoryEditor teams={teams} matches={matchDrafts} onChange={onMatchDraftsChange} />
      <button type="button" className="cta secondary" onClick={() => onAction("matches")} disabled={saving || matchesDirtyCount === 0}>{saving ? "저장 중…" : matchesDirtyCount > 0 ? `경기별 기록 저장 · ${matchesDirtyCount}건` : "경기별 기록 저장됨"}</button>
      <a className="cta team-roster-link" href={`${eventDatePath(event.starts_at)}?section=teams`}>일정에서 팀 명단 보기</a>
    </div>}
  </>;
}


function MatchHistoryEditor({ teams, matches, onChange }: { teams: Event["event_teams"]; matches: MatchDraft[]; onChange: (matches: MatchDraft[]) => void }) {
  const availableTeams = teams ?? [];
  const allMembers = availableTeams.flatMap((team) => team.event_team_members.map((member) => ({ ...member, baseTeamName: team.team_name })));
  const removeMatch = (matchId: string) => onChange(matches.filter((match) => match.id !== matchId));
  const addMatch = () => onChange([...matches, createMatchDraft(availableTeams, Math.max(0, ...matches.map((match) => match.match_number)) + 1)]);
  const addScorer = (matchId: string) => onChange(matches.map((match) => match.id === matchId ? { ...match, scorers: [...match.scorers, { id: `draft-scorer-${Date.now()}`, team_id: match.team_a_id, member_id: "", goals: 1 }] } : match));
  const updateScorer = (matchId: string, scorerId: string, patch: Partial<MatchScorerDraft>) => onChange(matches.map((match) => match.id === matchId ? { ...match, scorers: match.scorers.map((scorer) => scorer.id === scorerId ? { ...scorer, ...patch } : scorer) } : match));
  const removeScorer = (matchId: string, scorerId: string) => onChange(matches.map((match) => match.id === matchId ? { ...match, scorers: match.scorers.filter((scorer) => scorer.id !== scorerId) } : match));
  const changeMatchTeam = (matchId: string, side: "a" | "b", teamId: string) => onChange(matches.map((match) => {
    if (match.id !== matchId) return match;
    const previousTeamId = side === "a" ? match.team_a_id : match.team_b_id;
    const newTeam = availableTeams.find((team) => team.id === teamId);
    const retainedLineups = match.lineups.filter((lineup) => lineup.team_id !== previousTeamId);
    const retainedMemberIds = new Set(retainedLineups.map((lineup) => lineup.member_id));
    const defaultLineups = (newTeam?.event_team_members ?? []).filter((member) => !retainedMemberIds.has(member.id)).map((member) => ({ member_id: member.id, team_id: teamId }));
    return {
      ...match,
      [side === "a" ? "team_a_id" : "team_b_id"]: teamId,
      [side === "a" ? "team_a_other_goals" : "team_b_other_goals"]: 0,
      lineups: [...retainedLineups, ...defaultLineups],
      scorers: match.scorers.filter((scorer) => scorer.team_id !== previousTeamId),
    };
  }));
  const assignPlayer = (matchId: string, memberId: string, teamId: string) => onChange(matches.map((match) => {
    if (match.id !== matchId) return match;
    const lineups = match.lineups.filter((lineup) => lineup.member_id !== memberId);
    if (teamId) lineups.push({ member_id: memberId, team_id: teamId });
    return { ...match, lineups, scorers: match.scorers.filter((scorer) => scorer.member_id !== memberId || scorer.team_id === teamId) };
  }));
  const adjustOtherGoals = (matchId: string, side: "a" | "b", delta: number) => onChange(matches.map((match) => match.id === matchId ? { ...match, [side === "a" ? "team_a_other_goals" : "team_b_other_goals"]: Math.max(0, (side === "a" ? match.team_a_other_goals : match.team_b_other_goals) + delta) } : match));

  return <section className="match-history-editor">
    <header><div><h3>경기별 기록</h3><p className="form-description">한 일정에 여러 경기를 추가하고, 경기마다 대진·출전 명단·결과를 따로 남깁니다.</p></div><span>{matches.length}경기</span></header>
    {matches.map((match) => {
      const teamOptions = availableTeams.filter((team) => team.id === match.team_a_id || team.id === match.team_b_id);
      const teamA = teamOptions.find((team) => team.id === match.team_a_id);
      const teamB = teamOptions.find((team) => team.id === match.team_b_id);
      const lineupTeamFor = (memberId: string) => match.lineups.find((lineup) => lineup.member_id === memberId)?.team_id ?? "";
      return <div className="match-history-row" key={match.id}>
        <header><b>{match.match_number}경기</b><button type="button" onClick={() => removeMatch(match.id)}>삭제</button></header>
        <div className="match-history-score">
          <label>팀 A<select value={match.team_a_id} onChange={(event) => changeMatchTeam(match.id, "a", event.target.value)}>{availableTeams.filter((team) => team.id !== match.team_b_id).map((team) => <option key={team.id} value={team.id}>{team.team_name}</option>)}</select></label>
          <div className="match-score-total"><small>점수</small><output>{matchScoreFor(match, match.team_a_id)}</output><span><button type="button" aria-label={`${teamA?.team_name ?? "팀 A"} 기타 득점 감소`} onClick={() => adjustOtherGoals(match.id, "a", -1)}>−</button><em>기타 {match.team_a_other_goals}</em><button type="button" aria-label={`${teamA?.team_name ?? "팀 A"} 기타 득점 증가`} onClick={() => adjustOtherGoals(match.id, "a", 1)}>+</button></span></div>
          <span>:</span>
          <div className="match-score-total"><small>점수</small><output>{matchScoreFor(match, match.team_b_id)}</output><span><button type="button" aria-label={`${teamB?.team_name ?? "팀 B"} 기타 득점 감소`} onClick={() => adjustOtherGoals(match.id, "b", -1)}>−</button><em>기타 {match.team_b_other_goals}</em><button type="button" aria-label={`${teamB?.team_name ?? "팀 B"} 기타 득점 증가`} onClick={() => adjustOtherGoals(match.id, "b", 1)}>+</button></span></div>
          <label>팀 B<select value={match.team_b_id} onChange={(event) => changeMatchTeam(match.id, "b", event.target.value)}>{availableTeams.filter((team) => team.id !== match.team_a_id).map((team) => <option key={team.id} value={team.id}>{team.team_name}</option>)}</select></label>
        </div>
        <div className="match-lineup-editor">
          <header><div><b>출전 명단</b><small>기본 편성을 불러왔습니다. 이 경기에서만 빠지거나 팀이 바뀐 선수를 조정하세요.</small></div><span>{teamA?.team_name ?? "팀 A"} {match.lineups.filter((lineup) => lineup.team_id === match.team_a_id).length}명 · {teamB?.team_name ?? "팀 B"} {match.lineups.filter((lineup) => lineup.team_id === match.team_b_id).length}명</span></header>
          <div className="match-lineup-list">{allMembers.map((member) => <label className="match-lineup-player" key={member.id}><span><b>{member.participant_name}</b><small>기본 {member.baseTeamName}</small></span><select aria-label={`${member.participant_name} 출전 팀`} value={lineupTeamFor(member.id)} onChange={(event) => assignPlayer(match.id, member.id, event.target.value)}><option value="">미출전</option>{teamOptions.map((team) => <option key={team.id} value={team.id}>{team.team_name}</option>)}</select></label>)}</div>
        </div>
        <div className="match-history-scorers">
          <header><span>득점자</span><button type="button" className="text-link" onClick={() => addScorer(match.id)}>득점자 추가</button></header>
          {match.scorers.map((scorer) => {
            const memberOptions = match.lineups.filter((lineup) => lineup.team_id === scorer.team_id).map((lineup) => allMembers.find((member) => member.id === lineup.member_id)).filter((member): member is (typeof allMembers)[number] => Boolean(member));
            return <div className="match-scorer-row" key={scorer.id}><label>팀<select value={scorer.team_id} onChange={(event) => updateScorer(match.id, scorer.id, { team_id: event.target.value, member_id: "" })}>{teamOptions.map((team) => <option key={team.id} value={team.id}>{team.team_name}</option>)}</select></label><label>선수<select value={scorer.member_id} onChange={(event) => updateScorer(match.id, scorer.id, { member_id: event.target.value })}><option value="">선수 선택</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.participant_name}</option>)}</select></label><label>골<input type="number" min="1" value={scorer.goals} onChange={(event) => updateScorer(match.id, scorer.id, { goals: Math.max(1, Number(event.target.value) || 1) })} /></label><button type="button" aria-label="득점자 삭제" onClick={() => removeScorer(match.id, scorer.id)}>×</button></div>;
          })}
        </div>
      </div>;
    })}
    <button type="button" className="cta secondary" onClick={addMatch} disabled={availableTeams.length < 2}>경기 추가</button>
  </section>;
}
