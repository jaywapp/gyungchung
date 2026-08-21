"use client";

import { useState } from "react";
import { BarChart3, Check, ClipboardList, LockKeyhole, Pencil, Plus, Trash2, Vote, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { ParticipationForm, ParticipationKind, ParticipationQuestion, ParticipationSubmission, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { showError, toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import { Empty, SectionSkeleton } from "@/components/section-states";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
type AnswerValue = string | string[] | number;

const kindMeta = {
  election: { label: "회장단 선거", icon: Vote },
  poll: { label: "의사 결정 투표", icon: BarChart3 },
  survey: { label: "회원 설문", icon: ClipboardList },
} as const;

export default function ParticipationHub({ user, profile, forms, submissions, supabase, loading, manageableKinds, onCreate, onEdit, onDelete, reload, onLogin, toast }: {
  user: User | null;
  profile: Profile | null;
  forms: ParticipationForm[];
  submissions: ParticipationSubmission[];
  supabase: SupabaseClient | null;
  loading: boolean;
  manageableKinds: ParticipationKind[];
  onCreate: () => void;
  onEdit: (form: ParticipationForm) => void;
  onDelete: (id: string, label: string) => void;
  reload: () => void;
  onLogin: () => void;
  toast: ToastHandler;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [saving, setSaving] = useState(false);
  const active = forms.find((form) => form.id === activeId);
  const dialogRef = useDialogFocus<HTMLFormElement>(() => setActiveId(null), Boolean(active));
  const completed = new Set(submissions.map((item) => item.form_id));
  const canManage = manageableKinds.length > 0;
  const membershipRestriction = getMembershipRestriction(profile);

  const setAnswer = (question: ParticipationQuestion, value: string, checked?: boolean) => {
    if (question.type !== "multiple_choice") return setAnswers((current) => ({ ...current, [question.id]: question.type === "rating" ? Number(value) : value }));
    const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
    setAnswers((all) => ({ ...all, [question.id]: checked ? [...current, value] : current.filter((item) => item !== value) }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return showError(toast, "회원 승인 후 참여할 수 있습니다.");
    if (!active) return;
    setSaving(true);
    const submittedAnswers = active.participation_questions
      .filter((question) => answers[question.id] !== undefined && answers[question.id] !== "" && (!Array.isArray(answers[question.id]) || (answers[question.id] as string[]).length > 0))
      .map((question) => ({ question_id: question.id, answer: answers[question.id] }));
    const { error } = await supabase.rpc("submit_participation", { target_form_id: active.id, submitted_answers: submittedAnswers });
    setSaving(false);
    if (error) return toast(toErrorMessage(error), "error");
    toast("소중한 응답을 제출했습니다.");
    setActiveId(null); setAnswers({}); reload();
  };

  return (
    <section className="content">
      <div className="page-intro"><span className="eyebrow">TEAM DECISIONS</span><h1>참여</h1><p>매년 진행하는 회장단 선거부터 팀의 중요한 의사 결정, 운영 개선 설문까지 한곳에서 참여하세요.</p></div>
      {canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 참여 항목 등록</button></div>}
      {loading ? <SectionSkeleton label="참여 항목을 불러오는 중" /> : <div className="participation-grid">
        {forms.map((form) => {
          const Icon = kindMeta[form.kind].icon;
          const isDone = completed.has(form.id);
          const canManageForm = manageableKinds.includes(form.kind);
          return <article className="participation-card" key={form.id}>
            <div className="participation-icon"><Icon /></div>
            <div className="participation-copy"><small>{kindMeta[form.kind].label} · {form.status === "open" ? "진행 중" : "마감"}</small><h2>{form.title}</h2><p>{form.description}</p>{form.ends_at && <time className="participation-deadline" dateTime={form.ends_at}>{formatDeadline(form.ends_at)}</time>}{form.secret_ballot && <span className="secret"><LockKeyhole size={14} /> 비밀 투표</span>}</div>
            <div className="participation-actions">{canManageForm && <div className="resource-actions"><button aria-label={`${form.title} 수정`} onClick={() => onEdit(form)}><Pencil size={16} /></button><button aria-label={`${form.title} 삭제`} onClick={() => onDelete(form.id, `${kindMeta[form.kind].label} · ${form.title}`)}><Trash2 size={16} /></button></div>}<button className={isDone ? "done-button" : "cta small"} disabled={isDone || form.status !== "open" || Boolean(membershipRestriction)} aria-describedby={membershipRestriction ? `participation-restriction-${form.id}` : undefined} onClick={() => { if (!user) return onLogin(); setActiveId(form.id); setAnswers({}); }}>{isDone ? <><Check size={16} /> 참여 완료</> : form.status === "open" ? "참여하기" : "마감됨"}</button>{membershipRestriction && <p className="restriction-reason" id={`participation-restriction-${form.id}`}>{getMembershipRestrictionCopy(membershipRestriction).action}</p>}</div>
          </article>;
        })}
        {forms.length === 0 && <Empty icon={<Vote />} title="현재 공개된 참여 항목이 없습니다" description="새 선거, 투표 또는 설문이 열리면 이곳에 표시됩니다." />}
      </div>}
      {active && <div className="modal-backdrop" onClick={() => setActiveId(null)}><form ref={dialogRef} tabIndex={-1} className="editor participation-editor" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${active.title} 응답`}><button type="button" className="modal-close" aria-label="닫기" onClick={() => setActiveId(null)}><X /></button><span className="eyebrow">{kindMeta[active.kind].label}</span><h2>{active.title}</h2><p>{active.description}</p>{active.participation_questions.map((question, index) => <QuestionField key={question.id} question={question} index={index} value={answers[question.id]} onChange={(value, checked) => setAnswer(question, value, checked)} />)}<button className="cta" disabled={saving}>{saving ? "제출 중…" : "응답 제출"}</button></form></div>}
    </section>
  );
}

function QuestionField({ question, index, value, onChange }: { question: ParticipationQuestion; index: number; value?: AnswerValue; onChange: (value: string, checked?: boolean) => void }) {
  const required = question.is_required;
  return <fieldset className="question-field"><legend><b>{index + 1}. {question.prompt}</b>{required && <small>필수</small>}</legend>
    {(question.type === "single_choice" || question.type === "yes_no") && question.participation_options.map((option) => <label className="choice" key={option.id}><input type="radio" name={question.id} value={option.id} required={required} checked={value === option.id} onChange={(event) => onChange(event.target.value)} /><span>{option.label}</span></label>)}
    {question.type === "multiple_choice" && question.participation_options.map((option) => <label className="choice" key={option.id}><input type="checkbox" value={option.id} checked={Array.isArray(value) && value.includes(option.id)} onChange={(event) => onChange(event.target.value, event.target.checked)} /><span>{option.label}</span></label>)}
    {question.type === "short_text" && <input required={required} maxLength={500} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />}
    {question.type === "long_text" && <textarea required={required} maxLength={5000} rows={5} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />}
    {question.type === "rating" && <div className="rating-row">{Array.from({ length: (question.max_value ?? 5) - (question.min_value ?? 1) + 1 }, (_, i) => i + (question.min_value ?? 1)).map((score) => <label key={score}><input type="radio" name={question.id} required={required} value={score} checked={value === score} onChange={(event) => onChange(event.target.value)} /><span>{score}</span></label>)}</div>}
  </fieldset>;
}

function formatDeadline(value: string) {
  const deadline = new Date(value);
  const remainingDays = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  const relative = remainingDays < 0 ? "마감" : remainingDays === 0 ? "오늘 마감" : `D-${remainingDays}`;
  return `${deadline.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" })} ${deadline.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })} 마감 · ${relative}`;
}
