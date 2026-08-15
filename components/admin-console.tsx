"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, ExternalLink, Github, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { AccountRole, Attendance, Event, Fee, Feedback, GuestFee, GuestPlayer, Notice, OfficerPermission, OfficerTitle, ParticipationForm, Profile, RolePermission, Venue } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { editorScopes, tableScopes, toErrorMessage, type ReloadHandler, type ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import ConfirmDialog from "@/components/confirm-dialog";

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
const permissionLabels: Record<string, string> = {
  "roles.manage": "계정·직책 설정", "officers.manage": "운영 권한 위임", "members.manage": "회원 관리", "fees.manage": "회비 관리", "notices.manage": "공지 관리", "events.manage": "일정·출석 관리", "feedback.manage": "의견 관리", "elections.manage": "선거 관리", "polls.manage": "투표 관리", "surveys.manage": "설문 관리",
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const { error } = await supabase.from(pendingDelete.table).delete().eq("id", pendingDelete.id);
    const scope = tableScopes[pendingDelete.table] ?? "all";
    setDeleting(false); setPendingDelete(null);
    if (error) return toast(toErrorMessage(error), "error");
    toast("삭제했습니다."); reload(scope);
  };
  const count = section === "members" ? profiles.length : section === "guests" ? guestPlayers.length : section === "fees" ? fees.length + guestFees.length : section === "notices" ? notices.length : section === "venues" ? venues.length : section === "events" || section === "attendance" || section === "teams" ? events.length : section === "feedback" ? feedback.length : section === "forms" ? forms.length : rolePermissions.length + officerPermissions.length;

  return <section className="content">
    <div className="page-intro"><span className="eyebrow">OPERATIONS DESK</span><h1>팀 운영 관리</h1><p>시스템 관리 권한은 회원 유형과 별도로 부여되며, 회장·부회장·총무는 직책별 운영 업무를 담당합니다.</p></div>
    <div className="admin-groups">{sectionGroups.map((group) => <button key={group.key} type="button" aria-pressed={group.key === activeGroup?.key} onClick={() => setSection(group.sections[0])}>{group.label}</button>)}</div>
    <div className="admin-tabs">{(activeGroup?.sections ?? []).map((key) => <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>{sectionLabels[key]} 관리</button>)}</div>
    <div className="admin-toolbar"><b>{count}개 항목</b><div className="resource-actions">{section === "fees" && <button className="cta small secondary" onClick={() => setBulkFeeOpen(true)}><CalendarPlus size={17} /> 월회비 일괄 등록</button>}{!(["members", "attendance", "teams", "permissions"].includes(section)) && <button className="cta small" onClick={() => setEditor({ type: section as EditorConfig["type"] })}><Plus size={17} /> 새로 등록</button>}</div></div>
    {section === "permissions" ? <PermissionMatrix roleRows={rolePermissions} officerRows={officerPermissions} canManageSystemRoles={permissions.has("roles.manage")} supabase={supabase} reload={reload} toast={toast} /> : <div className="admin-list">
      {section === "members" && profiles.map((row) => <AdminRow key={row.id} title={row.membership_application?.name ?? row.name} meta={`${row.membership_application?.preferred_position ?? row.position ?? "포지션 미정"} · ${row.role === "manager" && row.officer_title ? officerTitleLabels[row.officer_title] : roleLabels[row.role]}${row.is_system_admin ? " · 시스템 관리자" : ""} · ${row.role === "manager" ? "월 15,000원" : row.fee_plan === "per_event" ? "참여 시 10,000원" : "월 30,000원"} · ${isApplicationRejected(row) ? "가입 반려" : row.status === "pending" && !row.membership_application ? "신청서 미작성" : memberStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "members", row: row as unknown as Record<string, unknown> })} />)}
      {section === "guests" && guestPlayers.map((row) => <AdminRow key={row.id} title={row.name} meta={`${row.preferred_position ?? "포지션 미정"} · ${row.appearance_count}회 참여 · 참여비 ${row.fee_amount.toLocaleString()}원 · ${row.is_active ? "활동" : "비활동"}`} onEdit={() => setEditor({ type: "guests", row: row as unknown as Record<string, unknown> })} />)}
      {section === "fees" && fees.map((row) => <AdminRow key={row.id} title={`${row.profiles?.name ?? profiles.find((p) => p.id === row.member_id)?.name ?? "회원"} · ${row.month.slice(0, 7)}`} meta={`${row.fee_type === "participation" ? "참여비" : "월회비"} · ${row.amount.toLocaleString()}원 · ${feeStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "fees", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "fees", id: row.id, label })} />)}
      {section === "fees" && guestFees.map((row) => <AdminRow key={`${row.event_id}-${row.guest_player_id}`} title={`${row.guest_players?.name ?? "용병"} · ${row.events ? new Date(row.events.starts_at).toLocaleDateString("ko-KR") : "일정"}`} meta={`용병 참여비 · ${row.amount.toLocaleString()}원 · ${feeStatusLabels[row.status]}`} onEdit={() => setEditor({ type: "fees", row: { ...row, _fee_scope: "guest" } as unknown as Record<string, unknown> })} />)}
      {section === "notices" && notices.map((row) => <AdminRow key={row.id} title={row.title} meta={new Date(row.created_at).toLocaleDateString("ko-KR")} onEdit={() => setEditor({ type: "notices", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "notices", id: row.id, label })} />)}
      {section === "venues" && venues.map((row) => <AdminRow key={row.id} title={row.name} meta={row.address || "주소 미등록"} onEdit={() => setEditor({ type: "venues", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "venues", id: row.id, label })} />)}
      {section === "events" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · ${row.venue}`} onEdit={() => setEditor({ type: "events", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "events", id: row.id, label })} />)}
      {section === "attendance" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · 실제 출석 ${attendance.filter((item) => item.event_id === row.id && item.checked_in_at).length}명`} onEdit={() => setEditor({ type: "attendance", row: row as unknown as Record<string, unknown> })} />)}
      {section === "teams" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${row.event_teams?.length ?? 0}개 팀 · ${row.team_mode === "balanced" ? "포지션 균형" : row.team_mode === "random" ? "랜덤" : "미편성"}${row.is_competitive ? " · 커피 내기" : ""}`} onEdit={() => setEditor({ type: "teams", row: row as unknown as Record<string, unknown> })} />)}
      {section === "feedback" && feedback.map((row) => <AdminRow key={row.id} title={`${row.is_anonymous ? "익명" : "회원"} · ${row.title}`} meta={`${feedbackCategoryLabels[row.category]} · ${feedbackStatusLabels[row.status]}${row.github_issue_number ? ` · GitHub #${row.github_issue_number}` : row.publish_to_github ? " · GitHub 연결 대기" : ""}`} href={row.github_issue_url} onEdit={() => setEditor({ type: "feedback", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "feedback", id: row.id, label })} />)}
      {section === "forms" && forms.map((row) => <AdminRow key={row.id} title={row.title} meta={`${formKindLabels[row.kind]} · ${formStatusLabels[row.status]}${row.secret_ballot ? " · 비밀투표" : ""}`} onEdit={() => setEditor({ type: "forms", row: row as unknown as Record<string, unknown> })} onDelete={(label) => setPendingDelete({ table: "participation_forms", id: row.id, label })} />)}
    </div>}
    {editor && <AdminEditor config={editor} profiles={profiles} guestPlayers={guestPlayers} venues={venues} events={events} attendance={attendance} permissions={permissions} supabase={supabase} onClose={() => setEditor(null)} onSaved={() => { const scope = editorScopes[editor.type] ?? "all"; setEditor(null); toast("저장했습니다."); reload(scope); }} onError={(message) => toast(message, "error")} />}
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
  const dialogRef = useDialogFocus<HTMLFormElement>(onClose);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [saving, setSaving] = useState(false);
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
  return <div className="modal-backdrop" onClick={onClose}><form ref={dialogRef} tabIndex={-1} className="editor" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="월회비 일괄 등록">
    <button type="button" className="modal-close" aria-label="닫기" onClick={onClose}><X /></button>
    <span className="eyebrow">BULK FEE</span><h2>월회비<br />일괄 등록</h2>
    <p className="form-description">활동 중인 월회비 회원 전원에게 해당 월의 미납 회비를 한 번에 만듭니다. 금액은 회원 유형에 따라 자동 적용됩니다.</p>
    <label>기준 월<input name="month" type="month" required value={month} onChange={(event) => setMonth(event.target.value)} /></label>
    <div className="read-box">
      <b>{pending.length}명에게 새로 등록됩니다</b>
      <p>대상 {targets.length}명 중 {skipped}명은 이미 등록되어 있어 건너뜁니다.{perEventCount > 0 ? ` 참여비 회원 ${perEventCount}명은 일정별로 부과되므로 제외됩니다.` : ""}</p>
    </div>
    <button className="cta" disabled={saving || pending.length === 0}>{saving ? "등록 중…" : pending.length === 0 ? "등록할 회원이 없습니다" : `${pending.length}명 등록하기`}</button>
  </form></div>;
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

function isApplicationRejected(profile: Profile) {
  return profile.membership_application?.review_status === "rejected";
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

export function AdminEditor({ config, profiles, guestPlayers, venues, events, attendance, permissions, supabase, onClose, onSaved, onError }: { config: EditorConfig; profiles: Profile[]; guestPlayers: GuestPlayer[]; venues: Venue[]; events: Event[]; attendance: Attendance[]; permissions: Set<string>; supabase: SupabaseClient; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const dialogRef = useDialogFocus<HTMLFormElement>(onClose);
  const row = config.row ?? {};
  const eventRow = row as unknown as Event;
  const rowTeams = eventRow.event_teams ?? [];
  const scheduledGuests = eventRow.event_guest_players ?? [];
  const application = row.membership_application as Profile["membership_application"];
  const applicationRejected = application?.review_status === "rejected";
  const canApprove = row.status !== "pending" || Boolean(application);
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
  const [selectedRole, setSelectedRole] = useState<AccountRole>((row.role as AccountRole | undefined) ?? "member");
  const initialFeeMember = profiles.find((profile) => profile.id === row.member_id) ?? profiles[0];
  const [selectedFeeMemberId, setSelectedFeeMemberId] = useState(String(row.member_id ?? initialFeeMember?.id ?? ""));
  const selectedFeeMember = profiles.find((profile) => profile.id === selectedFeeMemberId);
  const selectedFeeType = row.id ? String(row.fee_type ?? "monthly") : selectedFeeMember?.role === "member" && selectedFeeMember.fee_plan === "per_event" ? "participation" : "monthly";
  const standardFeeAmount = selectedFeeMember?.role === "manager" ? 15000 : selectedFeeMember?.role === "member" && selectedFeeMember.fee_plan === "per_event" ? 10000 : selectedFeeMember?.role === "member" ? 30000 : 0;
  const allowedKinds = (["election", "poll", "survey"] as const).filter((kind) => permissions.has(`${kind === "election" ? "elections" : kind === "poll" ? "polls" : "surveys"}.manage`));
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    const fd = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const submitAction = submitter?.name === "action" ? submitter.value : null;
    let error: { message: string } | null = null;
    const addQuestion = async (formId: string, position: number) => {
      const prompt = String(fd.get("prompt") ?? "").trim();
      if (!prompt) return null;
      const questionType = String(fd.get("question_type"));
      const labels = String(fd.get("options") || "").split(",").map((item) => item.trim()).filter(Boolean);
      const optionLabels = questionType === "yes_no" && labels.length === 0 ? ["찬성", "반대"] : labels;
      if (["single_choice", "multiple_choice", "yes_no"].includes(questionType) && optionLabels.length < 2) return { message: "선택형 질문에는 쉼표로 구분한 선택지를 2개 이상 입력하세요." };
      const questionResult = await supabase.from("participation_questions").insert({ form_id: formId, prompt, type: questionType, is_required: true, position, min_value: questionType === "rating" ? 1 : null, max_value: questionType === "rating" ? 5 : null }).select("id").single();
      if (questionResult.error || !questionResult.data) return questionResult.error;
      if (optionLabels.length > 0) {
        const optionResult = await supabase.from("participation_options").insert(optionLabels.map((label, optionPosition) => ({ question_id: questionResult.data.id, label, position: optionPosition })));
        return optionResult.error;
      }
      return null;
    };
    if (config.type === "members") {
      if (submitAction === "reject") {
        const rejectionReason = String(fd.get("rejection_reason") ?? "").trim();
        if (rejectionReason.length < 2) error = { message: "반려 사유를 2자 이상 입력하세요." };
        else ({ error } = await supabase.from("membership_applications").update({ review_status: "rejected", rejection_reason: rejectionReason, reviewed_at: new Date().toISOString() }).eq("member_id", row.id));
      } else {
        const canManageRoles = permissions.has("roles.manage");
        const nextRole = canManageRoles ? fd.get("role") : row.role;
        ({ error } = await supabase.from("profiles").update({ name: fd.get("name"), position: fd.get("position") || null, jersey_number: Number(fd.get("jersey_number")) || null, role: nextRole, officer_title: canManageRoles ? nextRole === "manager" ? fd.get("officer_title") : null : row.officer_title ?? null, fee_plan: canManageRoles ? nextRole === "member" ? fd.get("fee_plan") : null : row.fee_plan ?? null, is_system_admin: canManageRoles ? fd.get("is_system_admin") === "on" : Boolean(row.is_system_admin), status: fd.get("status") }).eq("id", row.id));
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
      if (recurring && startsAt.getFullYear() !== currentYear) error = { message: `정기 일정 시작일은 ${currentYear}년 안에서 선택해 주세요.` };
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
        if (!error && recurringPayloads.length === 0) error = { message: "올해 생성할 새 정기 일정이 없습니다." };
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
      const eventId = String(row.id);
      const checkedMemberIds = fd.getAll("checked_member_ids").map(String);
      const activeProfiles = profiles.filter((profile) => profile.status === "active");
      for (const profile of activeProfiles) {
        const current = attendance.find((item) => item.event_id === eventId && item.member_id === profile.id);
        if (checkedMemberIds.includes(profile.id) && !current?.checked_in_at) ({ error } = await supabase.from("attendance").upsert({ event_id: eventId, member_id: profile.id, checked_in_at: new Date().toISOString() }, { onConflict: "event_id,member_id" }));
        if (!checkedMemberIds.includes(profile.id) && current?.checked_in_at) ({ error } = await supabase.from("attendance").update({ checked_in_at: null }).eq("event_id", eventId).eq("member_id", profile.id));
        if (error) break;
      }
    }
    if (config.type === "teams") {
      const action = submitAction ?? "generate";
      if (action === "generate") {
        const teamCount = Number(fd.get("team_count"));
        const mode = String(fd.get("team_mode"));
        const memberParticipants: TeamParticipant[] = profiles.filter((profile) => profile.status === "active" && attendance.some((item) => item.event_id === eventRow.id && item.member_id === profile.id && (item.status === "going" || item.checked_in_at))).map((profile) => ({ kind: "member", id: profile.id, name: profile.name, position: profile.position }));
        const guestParticipants: TeamParticipant[] = (eventRow.event_guest_players ?? []).map((guest) => ({ kind: "guest", id: guest.guest_player_id, name: guest.guest_name, position: guest.guest_position }));
        const participants = [...memberParticipants, ...guestParticipants];
        if (participants.length < teamCount) error = { message: "참가 인원이 팀 수보다 적습니다." };
        if (!error) {
          const ordered = mode === "balanced" ? ["GK", "DF", "MF", "FW", "ANY"].flatMap((position) => shuffled(participants.filter((participant) => (participant.position ?? "ANY") === position))) : shuffled(participants);
          const teams = Array.from({ length: teamCount }, (_, index) => ({ team_number: index + 1, team_name: `${String.fromCharCode(65 + index)}팀`, participants: [] as TeamParticipant[] }));
          ordered.forEach((participant, index) => { const round = Math.floor(index / teamCount); const offset = index % teamCount; const teamIndex = round % 2 === 0 ? offset : teamCount - 1 - offset; teams[teamIndex].participants.push(participant); });
          ({ error } = await supabase.rpc("save_event_teams", { target_event_id: eventRow.id, target_mode: mode, target_teams: teams }));
        }
      } else {
        const teams = eventRow.event_teams ?? [];
        const teamStats = teams.map((team) => ({ id: team.id, score: Number(fd.get(`team_score_${team.id}`) ?? 0) }));
        const playerStats = teams.flatMap((team) => team.event_team_members.map((member) => ({ id: member.id, goals: Number(fd.get(`goals_${member.id}`) ?? 0), rating: String(fd.get(`rating_${member.id}`) ?? "") })));
        ({ error } = await supabase.rpc("save_competitive_event_stats", { target_event_id: eventRow.id, target_team_stats: teamStats, target_player_stats: playerStats }));
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
    setSaving(false); if (error) return onError(toErrorMessage(error)); onSaved();
  };
  return <div className="modal-backdrop" onClick={onClose}><form ref={dialogRef} tabIndex={-1} className="editor" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={row.id ? "관리 항목 수정" : "관리 항목 등록"}><button type="button" className="modal-close" aria-label="닫기" onClick={onClose}><X /></button><span className="eyebrow">ADMIN EDITOR</span><h2>{editorTitles[config.type]} {row.id ? "수정" : "등록"}</h2>
    {config.type === "members" && <><label>이름<input name="name" required defaultValue={String(application?.name ?? row.name ?? "")} /></label>{application ? <div className="application-review"><b>{applicationRejected ? "반려된 가입 신청 정보" : "가입 신청 정보"}</b><dl><div><dt>전화번호</dt><dd>{application.phone}</dd></div><div><dt>생년월일</dt><dd>{new Date(`${application.birth_date}T00:00:00`).toLocaleDateString("ko-KR")}</dd></div><div><dt>거주지역</dt><dd>{application.residence}</dd></div><div><dt>선호 포지션</dt><dd>{application.preferred_position}</dd></div><div><dt>신청일</dt><dd>{new Date(application.submitted_at).toLocaleDateString("ko-KR")}</dd></div></dl>{applicationRejected && <p>반려 사유: {application.rejection_reason}</p>}</div> : row.status === "pending" && <div className="read-box"><b>가입 신청서 미작성</b><p>신청서가 제출되기 전에는 회원 승인을 할 수 없습니다.</p></div>}{row.status === "pending" && application && !applicationRejected && <><label>반려 사유<textarea name="rejection_reason" rows={3} minLength={2} maxLength={500} placeholder="신청자에게 안내할 수정 사항을 입력하세요" /></label><button className="cta secondary" name="action" value="reject" disabled={saving}>{saving ? "처리 중…" : "가입 신청 반려"}</button></>}<div className="field-row"><label>등록 포지션<input name="position" defaultValue={String(application?.preferred_position ?? row.position ?? "")} /></label><label>등번호<input name="jersey_number" type="number" min="0" max="99" defaultValue={String(row.jersey_number ?? "")} /></label></div><div className="field-row"><label>회원 유형<select name="role" value={selectedRole} disabled={!permissions.has("roles.manage")} onChange={(event) => setSelectedRole(event.target.value as AccountRole)}><option value="member">일반 회원</option><option value="manager">관리자</option></select></label>{selectedRole === "manager" ? <label>관리자 직책<select name="officer_title" required defaultValue={String(row.officer_title ?? "president")} disabled={!permissions.has("roles.manage")}><option value="president">회장</option><option value="vice_president">부회장</option><option value="treasurer">총무</option></select></label> : <label>회비 방식<select name="fee_plan" required defaultValue={String(row.fee_plan ?? "monthly")} disabled={!permissions.has("roles.manage")}><option value="monthly">월회비 · 30,000원</option><option value="per_event">참여 시 · 10,000원</option></select></label>}</div>{selectedRole === "manager" && <p className="form-description">관리자 월회비는 직책과 관계없이 15,000원입니다.</p>}{permissions.has("roles.manage") && <label className="check"><input name="is_system_admin" type="checkbox" defaultChecked={Boolean(row.is_system_admin)} /> 시스템 관리 권한 부여</label>}<label>상태<select name="status" defaultValue={String(row.status ?? "pending")}><option value="pending" disabled={Boolean(row.is_system_admin)}>승인 대기</option><option value="active" disabled={!canApprove}>활동</option><option value="inactive" disabled={Boolean(row.is_system_admin)}>비활동</option></select></label></>}
    {config.type === "guests" && <><label>이름<input name="name" required maxLength={50} defaultValue={String(row.name ?? "")} /></label><div className="field-row"><label>연락처<input name="phone" maxLength={30} placeholder="운영진에게만 공개" defaultValue={String(row.phone ?? "")} /></label><label>선호 포지션<select name="preferred_position" defaultValue={String(row.preferred_position ?? "ANY")}><option value="GK">GK</option><option value="DF">DF</option><option value="MF">MF</option><option value="FW">FW</option><option value="ANY">상관없음</option></select></label></div><div className="read-box"><b>용병 참여비 10,000원</b><p>일정에 배정할 때마다 참여비가 생성됩니다.</p></div><label>메모<textarea name="note" rows={3} maxLength={500} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_active" type="checkbox" defaultChecked={row.id ? Boolean(row.is_active) : true} /> 자주 부르는 용병 목록에 표시</label></>}
    {config.type === "fees" && row._fee_scope === "guest" && <><div className="read-box"><b>{String((row.guest_players as { name?: string } | undefined)?.name ?? "용병")} · 참여비 10,000원</b><p>{String((row.events as { title?: string } | undefined)?.title ?? "일정")}의 용병 회비 납부 상태를 관리합니다.</p></div><label>상태<select name="status" defaultValue={String(row.status ?? "unpaid")}><option value="paid">납부 완료</option><option value="unpaid">미납</option><option value="exempt">면제</option></select></label></>}
    {config.type === "fees" && row._fee_scope !== "guest" && <><label>회원<select name="member_id" required value={selectedFeeMemberId} disabled={Boolean(row.id)} onChange={(event) => setSelectedFeeMemberId(event.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role === "manager" ? "관리자" : p.role === "member" && p.fee_plan === "per_event" ? "참여비형" : p.role === "member" ? "월회비형" : "시스템 관리자"}</option>)}</select></label><input name="fee_type" type="hidden" value={selectedFeeType} /><div className="read-box"><b>{selectedFeeType === "participation" ? "참여비" : "월회비"} {standardFeeAmount.toLocaleString()}원</b><p>회원 유형에 따른 표준 금액이 자동 적용됩니다.</p></div>{selectedFeeType === "participation" ? <label>참여 일정<select name="event_id" required defaultValue={String(row.event_id ?? "")} disabled={Boolean(row.id)}><option value="" disabled>일정을 선택하세요</option>{events.map((item) => <option key={item.id} value={item.id}>{new Date(item.starts_at).toLocaleDateString("ko-KR")} · {item.title}</option>)}</select></label> : <label>기준 월<input name="month" type="month" required defaultValue={String(row.month ?? new Date().toISOString()).slice(0, 7)} /></label>}<label>상태<select name="status" defaultValue={String(row.status ?? "unpaid")}><option value="paid">납부 완료</option><option value="unpaid">미납</option><option value="exempt">면제</option></select></label></>}
    {config.type === "notices" && <><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>내용<textarea name="body" required rows={6} defaultValue={String(row.body ?? "")} /></label><label className="check"><input name="is_pinned" type="checkbox" defaultChecked={Boolean(row.is_pinned)} /> 상단 고정</label></>}
    {config.type === "venues" && <><label>구장명<input name="name" required maxLength={120} defaultValue={String(row.name ?? "")} /></label><label>주소<input name="address" maxLength={240} defaultValue={String(row.address ?? "")} /></label><label>메모<textarea name="note" rows={3} maxLength={500} defaultValue={String(row.note ?? "")} /></label></>}
    {config.type === "events" && <><label>일정명<input name="title" required defaultValue={String(row.title ?? "주말 정기 풋살")} /></label><label>시작 시간<input name="starts_at" type="datetime-local" required defaultValue={row.starts_at ? toLocalDateTimeInput(new Date(String(row.starts_at))) : toLocalDateTimeInput(nextSundayMorning())} /></label>{!row.id && <label className="check"><input name="recurring" type="checkbox" /> 선택한 요일과 시간으로 올해 말까지 매주 생성</label>}{venueOptions.length > 0 && <div className="venue-history"><b>등록·최근 사용 구장</b><div>{venueOptions.map((option) => <button type="button" key={JSON.stringify([option.id, option.venue, option.address])} onClick={() => { setVenueId(option.id); setVenue(option.venue); setAddress(option.address); }}><span>{option.venue}</span>{option.address && <small>{option.address}</small>}</button>)}</div></div>}<input name="venue_id" type="hidden" value={venueId} /><div className="field-row"><label>구장<input name="venue" required value={venue} onChange={(event) => { setVenueId(""); setVenue(event.target.value); }} /></label><label>정원<input name="capacity" type="number" min="1" defaultValue={String(row.capacity ?? 18)} /></label></div><label>주소<input name="address" value={address} onChange={(event) => { setVenueId(""); setAddress(event.target.value); }} /></label>{!venueId && <label className="check"><input name="save_venue" type="checkbox" defaultChecked /> 입력한 구장을 구장 목록에도 등록</label>}<label>안내<textarea name="note" rows={3} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_competitive" type="checkbox" defaultChecked={Boolean(row.is_competitive)} /> 커피 내기: 팀 스코어·골·평점·승패 기록</label><fieldset className="check-grid"><legend>참여 용병</legend>{guestPlayers.filter((guest) => guest.is_active || scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)).map((guest) => <label className="check" key={guest.id}><input name="guest_ids" value={guest.id} type="checkbox" defaultChecked={scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)} /> {guest.name} · {guest.preferred_position ?? "ANY"} · {guest.appearance_count}회</label>)}{guestPlayers.length === 0 && <p className="form-description">용병 관리에서 자주 부르는 용병을 먼저 등록해 주세요.</p>}</fieldset></>}
    {config.type === "attendance" && <><div className="read-box"><b>{String(row.title)}</b><p>{new Date(String(row.starts_at)).toLocaleString("ko-KR")} · {String(row.venue)}</p></div><fieldset className="check-grid"><legend>실제 출석 회원</legend>{profiles.filter((profile) => profile.status === "active").map((profile) => { const record = attendance.find((item) => item.event_id === row.id && item.member_id === profile.id); return <label className="check" key={profile.id}><input name="checked_member_ids" value={profile.id} type="checkbox" defaultChecked={Boolean(record?.checked_in_at)} /> {profile.name} · {profile.position ?? "PLAYER"}{record?.status === "going" ? " · 참석 예정" : ""}</label>; })}</fieldset></>}
    {config.type === "teams" && <><div className="read-box"><b>{String(row.title)}</b><p>참석 예정 또는 실제 출석 회원과 지정 용병을 대상으로 팀을 구성합니다.</p></div><div className="field-row"><label>편성 방식<select name="team_mode" defaultValue={String(row.team_mode ?? "balanced")}><option value="balanced">포지션 균형</option><option value="random">완전 랜덤</option></select></label><label>팀 수<select name="team_count" defaultValue={String(Math.max(2, rowTeams.length))}><option value="2">2팀</option><option value="3">3팀</option><option value="4">4팀</option></select></label></div><button className="cta" name="action" value="generate" disabled={saving}>{saving ? "편성 중…" : rowTeams.length > 0 ? "팀 다시 나누기" : "팀 나누기"}</button>{rowTeams.map((team) => <section className="team-admin-card" key={team.id}><div className="field-row"><h3>{team.team_name}</h3>{Boolean(row.is_competitive) && <label>팀 스코어<input name={`team_score_${team.id}`} type="number" min="0" defaultValue={String(team.score ?? 0)} /></label>}</div>{team.event_team_members.map((member) => <div className="team-member-stat" key={member.id}><b>{member.participant_name}</b><span>{member.participant_position ?? "ANY"}</span>{Boolean(row.is_competitive) && <><label>골<input name={`goals_${member.id}`} type="number" min="0" defaultValue={String(member.goals)} /></label><label>평점<input name={`rating_${member.id}`} type="number" min="0" max="10" step="0.5" defaultValue={String(member.rating ?? "")} /></label></>}</div>)}</section>)}{Boolean(row.is_competitive) && rowTeams.length > 0 && <button className="cta secondary" name="action" value="stats" disabled={saving}>경기 기록 저장</button>}</>}
    {config.type === "feedback" && <><div className="read-box"><b>{String(row.title)}</b><p>{String(row.body)}</p></div><label>처리 상태<select name="status" defaultValue={String(row.status ?? "received")}><option value="received">접수</option><option value="reviewing">검토 중</option><option value="resolved">답변 완료</option><option value="closed">종결</option></select></label><label>운영진 답변<textarea name="officer_response" rows={6} defaultValue={String(row.officer_response ?? "")} /></label></>}
    {config.type === "forms" && <><label>종류<select name="kind" defaultValue={String(row.kind ?? allowedKinds[0])} disabled={Boolean(row.id)}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{kind === "election" ? "회장단 선거" : kind === "poll" ? "의사 결정 투표" : "회원 설문"}</option>)}</select></label><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>설명<textarea name="description" rows={3} defaultValue={String(row.description ?? "")} /></label><div className="field-row"><label>시작<input name="starts_at" type="datetime-local" defaultValue={row.starts_at ? new Date(String(row.starts_at)).toISOString().slice(0, 16) : ""} /></label><label>마감<input name="ends_at" type="datetime-local" defaultValue={row.ends_at ? new Date(String(row.ends_at)).toISOString().slice(0, 16) : ""} /></label></div><label>상태<select name="status" defaultValue={String(row.status ?? "draft")}><option value="draft">초안</option><option value="open">진행 중</option><option value="closed">마감</option><option value="archived">보관</option></select></label><label>{row.id ? "새 질문 추가 (선택)" : "첫 질문"}<input name="prompt" required={!row.id} placeholder="회원에게 물어볼 내용을 입력하세요" /></label><label>질문 형식<select name="question_type" defaultValue="single_choice"><option value="single_choice">단일 선택</option><option value="multiple_choice">복수 선택</option><option value="yes_no">찬반</option><option value="short_text">짧은 답변</option><option value="long_text">긴 답변</option><option value="rating">1~5점</option></select></label><label>선택지<input name="options" placeholder="후보 A, 후보 B (쉼표로 구분)" /></label>{!row.id && <label className="check"><input name="secret_ballot" type="checkbox" /> 선거를 비밀투표로 진행</label>}<label className="check"><input name="show_results" type="checkbox" defaultChecked={row.id ? Boolean(row.show_results) : true} /> 종료 후 결과 공개</label></>}
    {config.type !== "teams" && <button className="cta" disabled={saving}>{saving ? "저장 중…" : "저장하기"}</button>}
  </form></div>;
}
