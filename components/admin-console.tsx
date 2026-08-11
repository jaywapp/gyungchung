"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Github, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { AccountRole, Attendance, Event, Fee, Feedback, GuestPlayer, Notice, ParticipationForm, Profile, RolePermission } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
type Section = "members" | "guests" | "fees" | "notices" | "events" | "attendance" | "teams" | "feedback" | "forms" | "permissions";
type EditorConfig = { type: Exclude<Section, "permissions">; row?: Record<string, unknown> };

const roleLabels: Record<AccountRole, string> = { member: "일반 회원", manager: "매니저", admin: "어드민" };
const permissionLabels: Record<string, string> = {
  "roles.manage": "권한 설정", "members.manage": "회원 관리", "fees.manage": "회비 관리", "notices.manage": "공지 관리", "events.manage": "일정 관리", "feedback.manage": "의견 관리", "elections.manage": "선거 관리", "polls.manage": "투표 관리", "surveys.manage": "설문 관리",
};

export default function AdminConsole({ profiles, guestPlayers, attendance, fees, notices, events, feedback, forms, rolePermissions, permissions, supabase, reload, toast }: {
  profiles: Profile[]; guestPlayers: GuestPlayer[]; attendance: Attendance[]; fees: Fee[]; notices: Notice[]; events: Event[]; feedback: Feedback[]; forms: ParticipationForm[]; rolePermissions: RolePermission[];
  permissions: Set<string>; supabase: SupabaseClient; reload: () => void; toast: (message: string) => void;
}) {
  const sections = useMemo(() => [
    permissions.has("members.manage") && ["members", "회원"], permissions.has("events.manage") && ["guests", "용병"], permissions.has("fees.manage") && ["fees", "회비"], permissions.has("notices.manage") && ["notices", "공지"], permissions.has("events.manage") && ["events", "일정"], permissions.has("events.manage") && ["attendance", "출석"], permissions.has("events.manage") && ["teams", "팀 편성"], permissions.has("feedback.manage") && ["feedback", "의견"],
    (permissions.has("elections.manage") || permissions.has("polls.manage") || permissions.has("surveys.manage")) && ["forms", "참여"], permissions.has("roles.manage") && ["permissions", "권한"],
  ].filter(Boolean) as [Section, string][], [permissions]);
  const [section, setSection] = useState<Section>(sections[0]?.[0] ?? "members");
  const [editor, setEditor] = useState<EditorConfig | null>(null);

  const remove = async (table: string, id: string) => {
    if (!window.confirm("정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return toast(error.message);
    toast("삭제했습니다."); reload();
  };
  const count = section === "members" ? profiles.length : section === "guests" ? guestPlayers.length : section === "fees" ? fees.length : section === "notices" ? notices.length : section === "events" || section === "attendance" || section === "teams" ? events.length : section === "feedback" ? feedback.length : section === "forms" ? forms.length : rolePermissions.length;

  return <section className="content admin-page">
    <div className="page-intro"><span className="eyebrow">OPERATIONS DESK</span><h1>팀 운영 관리</h1><p>어드민은 전체 권한을 관리하고, 매니저는 부여된 운영 업무를 담당합니다.</p></div>
    <div className="admin-tabs">{sections.map(([key, label]) => <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}>{label} 관리</button>)}</div>
    <div className="admin-toolbar"><b>{count}개 항목</b>{!(["members", "attendance", "teams", "permissions"].includes(section)) && <button className="cta small" onClick={() => setEditor({ type: section as EditorConfig["type"] })}><Plus size={17} /> 새로 등록</button>}</div>
    {section === "permissions" ? <PermissionMatrix rows={rolePermissions} supabase={supabase} reload={reload} toast={toast} /> : <div className="admin-list">
      {section === "members" && profiles.map((row) => <AdminRow key={row.id} title={row.membership_application?.name ?? row.name} meta={`${row.membership_application?.preferred_position ?? row.position ?? "포지션 미정"} · ${roleLabels[row.role]} · ${row.status === "pending" ? row.membership_application ? "가입 승인 대기" : "신청서 미작성" : row.status}`} onEdit={() => setEditor({ type: "members", row: row as unknown as Record<string, unknown> })} />)}
      {section === "guests" && guestPlayers.map((row) => <AdminRow key={row.id} title={row.name} meta={`${row.preferred_position ?? "포지션 미정"} · ${row.appearance_count}회 참여 · ${row.is_active ? "활동" : "비활동"}`} onEdit={() => setEditor({ type: "guests", row: row as unknown as Record<string, unknown> })} />)}
      {section === "fees" && fees.map((row) => <AdminRow key={row.id} title={`${row.profiles?.name ?? profiles.find((p) => p.id === row.member_id)?.name ?? "회원"} · ${row.month.slice(0, 7)}`} meta={`${row.amount.toLocaleString()}원 · ${row.status}`} onEdit={() => setEditor({ type: "fees", row: row as unknown as Record<string, unknown> })} onDelete={() => remove("fees", row.id)} />)}
      {section === "notices" && notices.map((row) => <AdminRow key={row.id} title={row.title} meta={new Date(row.created_at).toLocaleDateString("ko-KR")} onEdit={() => setEditor({ type: "notices", row: row as unknown as Record<string, unknown> })} onDelete={() => remove("notices", row.id)} />)}
      {section === "events" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · ${row.venue}`} onEdit={() => setEditor({ type: "events", row: row as unknown as Record<string, unknown> })} onDelete={() => remove("events", row.id)} />)}
      {section === "attendance" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${new Date(row.starts_at).toLocaleDateString("ko-KR")} · 실제 출석 ${attendance.filter((item) => item.event_id === row.id && item.checked_in_at).length}명`} onEdit={() => setEditor({ type: "attendance", row: row as unknown as Record<string, unknown> })} />)}
      {section === "teams" && events.map((row) => <AdminRow key={row.id} title={row.title} meta={`${row.event_teams?.length ?? 0}개 팀 · ${row.team_mode === "balanced" ? "포지션 균형" : row.team_mode === "random" ? "랜덤" : "미편성"}${row.is_competitive ? " · 커피 내기" : ""}`} onEdit={() => setEditor({ type: "teams", row: row as unknown as Record<string, unknown> })} />)}
      {section === "feedback" && feedback.map((row) => <AdminRow key={row.id} title={`${row.is_anonymous ? "익명" : "회원"} · ${row.title}`} meta={`${row.category} · ${row.status}${row.github_issue_number ? ` · GitHub #${row.github_issue_number}` : row.publish_to_github ? " · GitHub 연결 대기" : ""}`} href={row.github_issue_url} onEdit={() => setEditor({ type: "feedback", row: row as unknown as Record<string, unknown> })} onDelete={() => remove("feedback", row.id)} />)}
      {section === "forms" && forms.map((row) => <AdminRow key={row.id} title={row.title} meta={`${row.kind} · ${row.status}${row.secret_ballot ? " · 비밀투표" : ""}`} onEdit={() => setEditor({ type: "forms", row: row as unknown as Record<string, unknown> })} onDelete={() => remove("participation_forms", row.id)} />)}
    </div>}
    {editor && <AdminEditor config={editor} profiles={profiles} guestPlayers={guestPlayers} attendance={attendance} permissions={permissions} supabase={supabase} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); toast("저장했습니다."); reload(); }} />}
  </section>;
}

function AdminRow({ title, meta, href, onEdit, onDelete }: { title: string; meta: string; href?: string | null; onEdit: () => void; onDelete?: () => void }) { return <div className="admin-row"><span><b>{title}</b><small>{meta}</small></span><div>{href && <a href={href} target="_blank" rel="noreferrer" aria-label="GitHub 이슈 열기"><Github size={17} /><ExternalLink size={11} /></a>}<button onClick={onEdit} aria-label="수정"><Pencil size={17} /></button>{onDelete && <button onClick={onDelete} aria-label="삭제"><Trash2 size={17} /></button>}</div></div>; }

function PermissionMatrix({ rows, supabase, reload, toast }: { rows: RolePermission[]; supabase: SupabaseClient; reload: () => void; toast: (message: string) => void }) {
  const roles: AccountRole[] = ["admin", "manager"];
  const toggle = async (role: AccountRole, permission: string, enabled: boolean) => {
    if (role === "admin" || permission === "roles.manage" || (role === "manager" && permission === "members.manage")) return;
    const result = enabled ? await supabase.from("role_permissions").insert({ role, permission }) : await supabase.from("role_permissions").delete().eq("role", role).eq("permission", permission);
    if (result.error) return toast(result.error.message);
    reload();
  };
  return <div className="permission-matrix"><div className="permission-intro"><ShieldCheck /><p>어드민 권한과 매니저의 회원 관리·가입 승인 권한은 고정되며, 그 외 매니저 운영 업무를 조정할 수 있습니다.</p></div><div className="table-wrap"><table><caption className="sr-only">역할별 운영 권한 설정</caption><thead><tr><th scope="col">권한</th>{roles.map((role) => <th scope="col" key={role}>{roleLabels[role]}</th>)}</tr></thead><tbody>{Object.entries(permissionLabels).map(([permission, label]) => <tr key={permission}><th scope="row">{label}</th>{roles.map((role) => { const checked = rows.some((row) => row.role === role && row.permission === permission); const disabled = role === "admin" || permission === "roles.manage" || (role === "manager" && permission === "members.manage"); return <td key={role}><input aria-label={`${roleLabels[role]} ${label}`} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => void toggle(role, permission, event.target.checked)} /></td>; })}</tr>)}</tbody></table></div></div>;
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

function AdminEditor({ config, profiles, guestPlayers, attendance, permissions, supabase, onClose, onSaved }: { config: EditorConfig; profiles: Profile[]; guestPlayers: GuestPlayer[]; attendance: Attendance[]; permissions: Set<string>; supabase: SupabaseClient; onClose: () => void; onSaved: () => void }) {
  const row = config.row ?? {};
  const eventRow = row as unknown as Event;
  const rowTeams = eventRow.event_teams ?? [];
  const scheduledGuests = eventRow.event_guest_players ?? [];
  const application = row.membership_application as Profile["membership_application"];
  const canApprove = row.status !== "pending" || Boolean(application);
  const [saving, setSaving] = useState(false);
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
    if (config.type === "members") ({ error } = await supabase.from("profiles").update({ name: fd.get("name"), position: fd.get("position") || null, jersey_number: Number(fd.get("jersey_number")) || null, role: permissions.has("roles.manage") ? fd.get("role") : row.role, status: fd.get("status") }).eq("id", row.id));
    if (config.type === "guests") ({ error } = await supabase.from("guest_players").upsert({ ...(row.id ? { id: row.id } : {}), name: fd.get("name"), phone: fd.get("phone") || null, preferred_position: fd.get("preferred_position") || null, note: fd.get("note") || null, is_active: fd.get("is_active") === "on" }));
    if (config.type === "fees") ({ error } = await supabase.from("fees").upsert({ ...(row.id ? { id: row.id } : {}), member_id: fd.get("member_id"), month: `${fd.get("month")}-01`, amount: Number(fd.get("amount")), status: fd.get("status"), paid_at: fd.get("status") === "paid" ? new Date().toISOString() : null }));
    if (config.type === "notices") ({ error } = await supabase.from("notices").upsert({ ...(row.id ? { id: row.id } : {}), title: fd.get("title"), body: fd.get("body"), is_pinned: fd.get("is_pinned") === "on" }));
    if (config.type === "events") {
      const eventPayload = { title: fd.get("title"), starts_at: new Date(String(fd.get("starts_at"))).toISOString(), venue: fd.get("venue"), address: fd.get("address") || null, note: fd.get("note") || null, capacity: Number(fd.get("capacity")) || null, is_competitive: fd.get("is_competitive") === "on" };
      const eventResult = row.id ? await supabase.from("events").update(eventPayload).eq("id", row.id).select("id").single() : await supabase.from("events").insert(eventPayload).select("id").single();
      error = eventResult.error;
      if (!error && eventResult.data) {
        const eventId = eventResult.data.id;
        const selectedGuestIds = fd.getAll("guest_ids").map(String);
        const currentGuestIds = scheduledGuests.map((guest) => guest.guest_player_id);
        const removedGuestIds = currentGuestIds.filter((id) => !selectedGuestIds.includes(id));
        const addedGuestIds = selectedGuestIds.filter((id) => !currentGuestIds.includes(id));
        if (removedGuestIds.length > 0) ({ error } = await supabase.from("event_guest_players").delete().eq("event_id", eventId).in("guest_player_id", removedGuestIds));
        if (!error && addedGuestIds.length > 0) ({ error } = await supabase.from("event_guest_players").insert(addedGuestIds.map((guestPlayerId) => ({ event_id: eventId, guest_player_id: guestPlayerId }))));
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
    setSaving(false); if (error) return window.alert(error.message); onSaved();
  };
  return <div className="modal-backdrop" onClick={onClose}><form className="editor" onSubmit={submit} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" aria-label="닫기" onClick={onClose}><X /></button><span className="eyebrow">ADMIN EDITOR</span><h2>{row.id ? "정보 수정" : "새 항목 등록"}</h2>
    {config.type === "members" && <><label>이름<input name="name" required defaultValue={String(application?.name ?? row.name ?? "")} /></label>{application ? <div className="application-review"><b>가입 신청 정보</b><dl><div><dt>전화번호</dt><dd>{application.phone}</dd></div><div><dt>생년월일</dt><dd>{new Date(`${application.birth_date}T00:00:00`).toLocaleDateString("ko-KR")}</dd></div><div><dt>거주지역</dt><dd>{application.residence}</dd></div><div><dt>선호 포지션</dt><dd>{application.preferred_position}</dd></div><div><dt>신청일</dt><dd>{new Date(application.submitted_at).toLocaleDateString("ko-KR")}</dd></div></dl></div> : row.status === "pending" && <div className="read-box"><b>가입 신청서 미작성</b><p>신청서가 제출되기 전에는 회원 승인을 할 수 없습니다.</p></div>}<div className="field-row"><label>등록 포지션<input name="position" defaultValue={String(application?.preferred_position ?? row.position ?? "")} /></label><label>등번호<input name="jersey_number" type="number" min="0" max="99" defaultValue={String(row.jersey_number ?? "")} /></label></div><div className="field-row"><label>계정 권한<select name="role" defaultValue={String(row.role ?? "member")} disabled={!permissions.has("roles.manage")}><option value="member" disabled={row.role === "admin"}>일반 회원</option><option value="manager" disabled={row.role === "admin"}>매니저</option><option value="admin" disabled={row.role !== "admin"}>어드민</option></select></label><label>상태<select name="status" defaultValue={String(row.status ?? "pending")}><option value="pending" disabled={row.role === "admin"}>승인 대기</option><option value="active" disabled={!canApprove}>활동</option><option value="inactive" disabled={row.role === "admin"}>비활동</option></select></label></div></>}
    {config.type === "guests" && <><label>이름<input name="name" required maxLength={50} defaultValue={String(row.name ?? "")} /></label><div className="field-row"><label>연락처<input name="phone" maxLength={30} placeholder="운영진에게만 공개" defaultValue={String(row.phone ?? "")} /></label><label>선호 포지션<select name="preferred_position" defaultValue={String(row.preferred_position ?? "ANY")}><option value="GK">GK</option><option value="DF">DF</option><option value="MF">MF</option><option value="FW">FW</option><option value="ANY">상관없음</option></select></label></div><label>메모<textarea name="note" rows={3} maxLength={500} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_active" type="checkbox" defaultChecked={row.id ? Boolean(row.is_active) : true} /> 자주 부르는 용병 목록에 표시</label></>}
    {config.type === "fees" && <><label>회원<select name="member_id" required defaultValue={String(row.member_id ?? "")}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="field-row"><label>기준 월<input name="month" type="month" required defaultValue={String(row.month ?? new Date().toISOString()).slice(0, 7)} /></label><label>금액<input name="amount" type="number" min="0" required defaultValue={String(row.amount ?? 30000)} /></label></div><label>상태<select name="status" defaultValue={String(row.status ?? "unpaid")}><option value="paid">납부 완료</option><option value="unpaid">미납</option><option value="exempt">면제</option></select></label></>}
    {config.type === "notices" && <><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>내용<textarea name="body" required rows={6} defaultValue={String(row.body ?? "")} /></label><label className="check"><input name="is_pinned" type="checkbox" defaultChecked={Boolean(row.is_pinned)} /> 상단 고정</label></>}
    {config.type === "events" && <><label>일정명<input name="title" required defaultValue={String(row.title ?? "주말 정기 풋살")} /></label><label>시작 시간<input name="starts_at" type="datetime-local" required defaultValue={row.starts_at ? new Date(String(row.starts_at)).toISOString().slice(0, 16) : ""} /></label><div className="field-row"><label>구장<input name="venue" required defaultValue={String(row.venue ?? "")} /></label><label>정원<input name="capacity" type="number" min="1" defaultValue={String(row.capacity ?? 18)} /></label></div><label>주소<input name="address" defaultValue={String(row.address ?? "")} /></label><label>안내<textarea name="note" rows={3} defaultValue={String(row.note ?? "")} /></label><label className="check"><input name="is_competitive" type="checkbox" defaultChecked={Boolean(row.is_competitive)} /> 커피 내기: 팀 스코어·골·평점·승패 기록</label><fieldset className="check-grid"><legend>참여 용병</legend>{guestPlayers.filter((guest) => guest.is_active || scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)).map((guest) => <label className="check" key={guest.id}><input name="guest_ids" value={guest.id} type="checkbox" defaultChecked={scheduledGuests.some((scheduled) => scheduled.guest_player_id === guest.id)} /> {guest.name} · {guest.preferred_position ?? "ANY"} · {guest.appearance_count}회</label>)}{guestPlayers.length === 0 && <p className="form-description">용병 관리에서 자주 부르는 용병을 먼저 등록해 주세요.</p>}</fieldset></>}
    {config.type === "attendance" && <><div className="read-box"><b>{String(row.title)}</b><p>{new Date(String(row.starts_at)).toLocaleString("ko-KR")} · {String(row.venue)}</p></div><fieldset className="check-grid"><legend>실제 출석 회원</legend>{profiles.filter((profile) => profile.status === "active").map((profile) => { const record = attendance.find((item) => item.event_id === row.id && item.member_id === profile.id); return <label className="check" key={profile.id}><input name="checked_member_ids" value={profile.id} type="checkbox" defaultChecked={Boolean(record?.checked_in_at)} /> {profile.name} · {profile.position ?? "PLAYER"}{record?.status === "going" ? " · 참석 예정" : ""}</label>; })}</fieldset></>}
    {config.type === "teams" && <><div className="read-box"><b>{String(row.title)}</b><p>참석 예정 또는 실제 출석 회원과 지정 용병을 대상으로 팀을 구성합니다.</p></div><div className="field-row"><label>편성 방식<select name="team_mode" defaultValue={String(row.team_mode ?? "balanced")}><option value="balanced">포지션 균형</option><option value="random">완전 랜덤</option></select></label><label>팀 수<select name="team_count" defaultValue={String(Math.max(2, rowTeams.length))}><option value="2">2팀</option><option value="3">3팀</option><option value="4">4팀</option></select></label></div><button className="cta" name="action" value="generate" disabled={saving}>{saving ? "편성 중…" : rowTeams.length > 0 ? "팀 다시 나누기" : "팀 나누기"}</button>{rowTeams.map((team) => <section className="team-admin-card" key={team.id}><div className="field-row"><h3>{team.team_name}</h3>{Boolean(row.is_competitive) && <label>팀 스코어<input name={`team_score_${team.id}`} type="number" min="0" defaultValue={String(team.score ?? 0)} /></label>}</div>{team.event_team_members.map((member) => <div className="team-member-stat" key={member.id}><b>{member.participant_name}</b><span>{member.participant_position ?? "ANY"}</span>{Boolean(row.is_competitive) && <><label>골<input name={`goals_${member.id}`} type="number" min="0" defaultValue={String(member.goals)} /></label><label>평점<input name={`rating_${member.id}`} type="number" min="0" max="10" step="0.5" defaultValue={String(member.rating ?? "")} /></label></>}</div>)}</section>)}{Boolean(row.is_competitive) && rowTeams.length > 0 && <button className="cta secondary" name="action" value="stats" disabled={saving}>경기 기록 저장</button>}</>}
    {config.type === "feedback" && <><div className="read-box"><b>{String(row.title)}</b><p>{String(row.body)}</p></div><label>처리 상태<select name="status" defaultValue={String(row.status ?? "received")}><option value="received">접수</option><option value="reviewing">검토 중</option><option value="resolved">답변 완료</option><option value="closed">종결</option></select></label><label>운영진 답변<textarea name="officer_response" rows={6} defaultValue={String(row.officer_response ?? "")} /></label></>}
    {config.type === "forms" && <><label>종류<select name="kind" defaultValue={String(row.kind ?? allowedKinds[0])} disabled={Boolean(row.id)}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{kind === "election" ? "회장단 선거" : kind === "poll" ? "의사 결정 투표" : "회원 설문"}</option>)}</select></label><label>제목<input name="title" required defaultValue={String(row.title ?? "")} /></label><label>설명<textarea name="description" rows={3} defaultValue={String(row.description ?? "")} /></label><div className="field-row"><label>시작<input name="starts_at" type="datetime-local" defaultValue={row.starts_at ? new Date(String(row.starts_at)).toISOString().slice(0, 16) : ""} /></label><label>마감<input name="ends_at" type="datetime-local" defaultValue={row.ends_at ? new Date(String(row.ends_at)).toISOString().slice(0, 16) : ""} /></label></div><label>상태<select name="status" defaultValue={String(row.status ?? "draft")}><option value="draft">초안</option><option value="open">진행 중</option><option value="closed">마감</option><option value="archived">보관</option></select></label><label>{row.id ? "새 질문 추가 (선택)" : "첫 질문"}<input name="prompt" required={!row.id} placeholder="회원에게 물어볼 내용을 입력하세요" /></label><label>질문 형식<select name="question_type" defaultValue="single_choice"><option value="single_choice">단일 선택</option><option value="multiple_choice">복수 선택</option><option value="yes_no">찬반</option><option value="short_text">짧은 답변</option><option value="long_text">긴 답변</option><option value="rating">1~5점</option></select></label><label>선택지<input name="options" placeholder="후보 A, 후보 B (쉼표로 구분)" /></label>{!row.id && <label className="check"><input name="secret_ballot" type="checkbox" /> 선거를 비밀투표로 진행</label>}<label className="check"><input name="show_results" type="checkbox" defaultChecked={row.id ? Boolean(row.show_results) : true} /> 종료 후 결과 공개</label></>}
    {config.type !== "teams" && <button className="cta" disabled={saving}>{saving ? "저장 중…" : "저장하기"}</button>}
  </form></div>;
}
