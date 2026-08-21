"use client";

import { useMemo, useState } from "react";
import { BarChart3, Check, CheckCircle2, ClipboardList, LockKeyhole, Pencil, Plus, Trash2, Vote, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { ParticipationForm, ParticipationKind, ParticipationQuestion, ParticipationQuestionResult, ParticipationSubmission, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { dirtyDialogAction, hasMeaningfulDraft } from "@/lib/dirty-state";
import { showError, toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import ConfirmDialog from "@/components/confirm-dialog";
import { createSubmittedAnswers, findFirstMissingRequiredQuestion, getRequiredQuestionIdFromRpcError, type ParticipationAnswerValue } from "@/lib/participation-validation";
import { canReviewParticipationAnswers, formatParticipationAnswer, indexOwnSubmissions } from "@/lib/submission-history";
import { parseParticipationResults } from "@/lib/participation-results";
import { Empty, LoadError, SectionSkeleton } from "@/components/section-states";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const kindMeta = {
  election: { label: "회장단 선거", icon: Vote },
  poll: { label: "의사 결정 투표", icon: BarChart3 },
  survey: { label: "회원 설문", icon: ClipboardList },
} as const;

export default function ParticipationHub({ user, profile, forms, submissions, supabase, loading, loadError, manageableKinds, onCreate, onEdit, onDelete, reload, onLogin, onRetry, toast }: {
  user: User | null;
  profile: Profile | null;
  forms: ParticipationForm[];
  submissions: ParticipationSubmission[];
  supabase: SupabaseClient | null;
  loading: boolean;
  loadError: boolean;
  manageableKinds: ParticipationKind[];
  onCreate: () => void;
  onEdit: (form: ParticipationForm) => void;
  onDelete: (id: string, label: string) => void;
  reload: () => void;
  onLogin: () => void;
  onRetry: () => void;
  toast: ToastHandler;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, ParticipationAnswerValue>>({});
  const [questionErrors, setQuestionErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resultsByForm, setResultsByForm] = useState<Record<string, ParticipationQuestionResult[]>>({});
  const [resultsFormId, setResultsFormId] = useState<string | null>(null);
  const [resultsLoadingId, setResultsLoadingId] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const active = forms.find((form) => form.id === activeId);
  const isDirty = hasMeaningfulDraft(answers);
  const reviewForm = forms.find((form) => form.id === reviewId);
  const ownSubmissions = useMemo(() => indexOwnSubmissions(submissions, profile?.id), [profile?.id, submissions]);
  const reviewSubmission = reviewForm ? ownSubmissions.get(reviewForm.id) : undefined;
  const close = () => {
    setActiveId(null);
    setAnswers({});
    setQuestionErrors({});
  };
  const requestClose = () => dirtyDialogAction(isDirty, "request") === "confirm" ? setDiscardOpen(true) : close();
  const handleBackdrop = () => {
    if (dirtyDialogAction(isDirty, "backdrop") === "close") close();
  };
  const discard = () => {
    setDiscardOpen(false);
    setAnswers({});
    close();
  };
  const dialogRef = useDialogFocus<HTMLFormElement>({ onRequestClose: requestClose, active: Boolean(active) });
  const reviewDialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: () => setReviewId(null), active: Boolean(reviewForm && reviewSubmission) });
  const canManage = manageableKinds.length > 0;
  const membershipRestriction = getMembershipRestriction(profile);

  const showQuestionError = (questionId: string) => {
    setQuestionErrors({ [questionId]: "필수 문항입니다. 답변을 입력하거나 선택해 주세요." });
    requestAnimationFrame(() => {
      const field = document.getElementById(`participation-question-${questionId}`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    });
  };

  const openResults = async (form: ParticipationForm) => {
    if (!user) return onLogin();
    if (!supabase || form.status !== "closed" || !form.show_results) return;
    setResultsFormId(form.id);
    setResultsError(null);
    if (resultsByForm[form.id]) return;
    setResultsLoadingId(form.id);
    const { data, error } = await supabase.rpc("get_participation_results", { target_form_id: form.id });
    setResultsLoadingId(null);
    if (error) {
      setResultsError(toErrorMessage(error));
      return;
    }
    setResultsByForm((current) => ({ ...current, [form.id]: parseParticipationResults(data) }));
  };

  const setAnswer = (question: ParticipationQuestion, value: string, checked?: boolean) => {
    setQuestionErrors((current) => {
      if (!(question.id in current)) return current;
      const remaining = { ...current };
      delete remaining[question.id];
      return remaining;
    });
    if (question.type !== "multiple_choice") return setAnswers((current) => ({ ...current, [question.id]: question.type === "rating" ? Number(value) : value }));
    setAnswers((all) => {
      const current: string[] = Array.isArray(all[question.id]) ? all[question.id] as string[] : [];
      return { ...all, [question.id]: checked ? [...current, value] : current.filter((item) => item !== value) };
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return showError(toast, "회원 승인 후 참여할 수 있습니다.");
    if (!active) return;
    const missingQuestion = findFirstMissingRequiredQuestion(active.participation_questions, answers);
    if (missingQuestion) return showQuestionError(missingQuestion.id);
    setSaving(true);
    const submittedAnswers = createSubmittedAnswers(active.participation_questions, answers);
    const { error } = await supabase.rpc("submit_participation", { target_form_id: active.id, submitted_answers: submittedAnswers });
    setSaving(false);
    const questionId = getRequiredQuestionIdFromRpcError(error);
    if (error && questionId && active.participation_questions.some((question) => question.id === questionId)) return showQuestionError(questionId);
    if (error) return toast(toErrorMessage(error), "error");
    toast("소중한 응답을 제출했습니다.");
    setActiveId(null); setAnswers({}); reload();
  };

  return (
    <section className="content">
      <div className="page-intro"><span className="eyebrow">TEAM DECISIONS</span><h1>참여</h1><p>매년 진행하는 회장단 선거부터 팀의 중요한 의사 결정, 운영 개선 설문까지 한곳에서 참여하세요.</p></div>
      {canManage && <div className="page-management-actions"><button className="cta small" onClick={onCreate}><Plus size={17} /> 참여 항목 등록</button></div>}
      {loading ? <SectionSkeleton label="참여 항목과 내 응답을 불러오는 중" /> : loadError ? <LoadError onRetry={onRetry} /> : <div className="participation-grid">
        {forms.map((form) => {
          const Icon = kindMeta[form.kind].icon;
          const submission = ownSubmissions.get(form.id);
          const isDone = Boolean(submission);
          const canManageForm = manageableKinds.includes(form.kind);
          return <article className="participation-card" key={form.id}>
            <div className="participation-icon"><Icon /></div>
            <div className="participation-copy"><small>{kindMeta[form.kind].label} · {form.status === "open" ? "진행 중" : "마감"}</small><h2>{form.title}</h2><p>{form.description}</p>{form.ends_at && <time className="participation-deadline" dateTime={form.ends_at}>{formatDeadline(form.ends_at)}</time>}{form.secret_ballot && <span className="secret"><LockKeyhole size={14} /> 비밀 투표</span>}</div>
            <div className="participation-actions">{canManageForm && <div className="resource-actions"><button aria-label={`${form.title} 수정`} onClick={() => onEdit(form)}><Pencil size={16} /></button><button aria-label={`${form.title} 삭제`} onClick={() => onDelete(form.id, `${kindMeta[form.kind].label} · ${form.title}`)}><Trash2 size={16} /></button></div>}{form.status === "closed" && form.show_results && <button type="button" className="text-link" onClick={() => void openResults(form)} disabled={resultsLoadingId === form.id}>{resultsLoadingId === form.id ? "결과 불러오는 중…" : "결과 보기"}</button>}{isDone ? <button type="button" className="done-button" onClick={() => setReviewId(form.id)}><Check size={16} /> 내 응답 보기</button> : <button className="cta small" disabled={form.status !== "open" || Boolean(membershipRestriction)} aria-describedby={membershipRestriction ? `participation-restriction-${form.id}` : undefined} onClick={() => { if (!user) return onLogin(); setActiveId(form.id); setAnswers({}); setQuestionErrors({}); setDiscardOpen(false); }}>{form.status === "open" ? "참여하기" : "마감됨"}</button>}{membershipRestriction && <p className="restriction-reason" id={`participation-restriction-${form.id}`}>{getMembershipRestrictionCopy(membershipRestriction).action}</p>}</div>
          </article>;
        })}
        {forms.length === 0 && <Empty icon={<Vote />} title="현재 공개된 참여 항목이 없습니다" description="새 선거, 투표 또는 설문이 열리면 이곳에 표시됩니다." />}
      </div>}
      {resultsFormId && <ParticipationResultsPanel form={forms.find((form) => form.id === resultsFormId)} results={resultsByForm[resultsFormId]} loading={resultsLoadingId === resultsFormId} error={resultsError} onRetry={() => { const form = forms.find((item) => item.id === resultsFormId); if (form) void openResults(form); }} onClose={() => { setResultsFormId(null); setResultsError(null); }} />}
      {active && <div className="modal-backdrop" onClick={handleBackdrop}><form ref={dialogRef} tabIndex={-1} noValidate className="editor participation-editor" onSubmit={submit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${active.title} 응답`}><button type="button" className="modal-close" aria-label="닫기" onClick={requestClose}><X /></button><span className="eyebrow">{kindMeta[active.kind].label}</span><h2>{active.title}</h2><p>{active.description}</p>{active.participation_questions.map((question, index) => <QuestionField key={question.id} question={question} index={index} value={answers[question.id]} error={questionErrors[question.id]} onChange={(value, checked) => setAnswer(question, value, checked)} />)}<button className="cta" disabled={saving}>{saving ? "제출 중…" : "응답 제출"}</button></form></div>}
      {discardOpen && <ConfirmDialog title="작성 중인 내용을 버릴까요?" target="아직 제출하지 않은 참여 답변이 있습니다." description="버리면 입력한 답변을 복구할 수 없습니다." confirmLabel="버리기" onConfirm={discard} onCancel={() => setDiscardOpen(false)} />}
      {reviewForm && reviewSubmission && <div className="modal-backdrop" onClick={() => setReviewId(null)}><div ref={reviewDialogRef} tabIndex={-1} className="editor participation-editor submission-review" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${reviewForm.title} 내 응답`}><button type="button" className="modal-close" aria-label="닫기" onClick={() => setReviewId(null)}><X /></button><span className="eyebrow">MY SUBMISSION</span><h2>{reviewForm.title}</h2><div className="submission-receipt"><CheckCircle2 /><span><b>제출 완료</b><time dateTime={reviewSubmission.submitted_at}>{formatSubmittedAt(reviewSubmission.submitted_at)}</time></span></div>{canReviewParticipationAnswers(reviewForm.secret_ballot) ? <div className="submission-answers">{reviewForm.participation_questions.map((question, index) => { const savedAnswer = reviewSubmission.participation_answers.find((answer) => answer.question_id === question.id); return <article key={question.id}><small>{index + 1}. {question.prompt}</small><p>{formatParticipationAnswer(question, savedAnswer?.answer)}</p></article>; })}</div> : <div className="secret-ballot-notice"><LockKeyhole /><span><b>비밀투표 제출 내역</b><p>비밀 보장을 위해 선택 내용은 다시 표시하지 않습니다. 제출 완료 여부와 시각만 확인할 수 있습니다.</p></span></div>}<button type="button" className="cta secondary" onClick={() => setReviewId(null)}>확인</button></div></div>}
    </section>
  );
}

function ParticipationResultsPanel({ form, results, loading, error, onRetry, onClose }: { form?: ParticipationForm; results?: ParticipationQuestionResult[]; loading: boolean; error: string | null; onRetry: () => void; onClose: () => void }) {
  if (!form) return null;
  return <section className="participation-results" aria-live="polite"><header><div><span className="eyebrow">PUBLISHED RESULTS</span><h2>{form.title}</h2><p>개인 응답은 공개하지 않고 문항별 집계만 표시합니다.</p></div><button type="button" className="text-link" onClick={onClose}>결과 닫기</button></header>{loading ? <SectionSkeleton label="결과를 불러오는 중" /> : error ? <LoadError onRetry={onRetry} /> : !results || results.length === 0 ? <Empty icon={<BarChart3 />} title="표시할 결과가 없습니다" description="아직 집계된 응답이 없거나 결과를 불러오지 못했습니다." /> : <div className="participation-result-list">{results.map((result) => <article className="participation-result-card" key={result.question_id}><div className="participation-result-heading"><span>{result.prompt}</span><small>{result.response_count}명 응답{result.average !== null ? ` · 평균 ${result.average.toFixed(1)}점` : ""}</small></div>{result.options.length > 0 ? <div className="participation-result-options">{result.options.map((option) => <div className="participation-result-option" key={option.option_id}><div><span>{option.label}</span><b>{option.count}표</b></div><meter min="0" max={Math.max(result.response_count, 1)} value={option.count} aria-label={`${option.label} ${option.count}표`} /></div>)}</div> : <p className="form-description">서술형 응답은 개인정보 보호를 위해 응답 수만 표시합니다.</p>}</article>)}</div>}</section>;
}

function QuestionField({ question, index, value, error, onChange }: { question: ParticipationQuestion; index: number; value?: ParticipationAnswerValue; error?: string; onChange: (value: string, checked?: boolean) => void }) {
  const required = question.is_required;
  const errorId = `participation-question-error-${question.id}`;
  return <fieldset id={`participation-question-${question.id}`} className={`question-field${error ? " has-error" : ""}`} tabIndex={-1} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} aria-required={required}><legend><b>{index + 1}. {question.prompt}</b>{required && <small>필수</small>}</legend>
    {(question.type === "single_choice" || question.type === "yes_no") && question.participation_options.map((option) => <label className="choice" key={option.id}><input type="radio" name={question.id} value={option.id} required={required} checked={value === option.id} onChange={(event) => onChange(event.target.value)} /><span>{option.label}</span></label>)}
    {question.type === "multiple_choice" && question.participation_options.map((option) => <label className="choice" key={option.id}><input type="checkbox" value={option.id} checked={Array.isArray(value) && value.includes(option.id)} onChange={(event) => onChange(event.target.value, event.target.checked)} /><span>{option.label}</span></label>)}
    {question.type === "short_text" && <input required={required} maxLength={500} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />}
    {question.type === "long_text" && <textarea required={required} maxLength={5000} rows={5} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />}
    {question.type === "rating" && <div className="rating-row">{Array.from({ length: (question.max_value ?? 5) - (question.min_value ?? 1) + 1 }, (_, i) => i + (question.min_value ?? 1)).map((score) => <label key={score}><input type="radio" name={question.id} required={required} value={score} checked={value === score} onChange={(event) => onChange(event.target.value)} /><span>{score}</span></label>)}</div>}
    {error && <p id={errorId} className="question-error" role="alert">{error}</p>}
  </fieldset>;
}

function formatDeadline(value: string) {
  const deadline = new Date(value);
  const remainingDays = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  const relative = remainingDays < 0 ? "마감" : remainingDays === 0 ? "오늘 마감" : `D-${remainingDays}`;
  return `${deadline.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" })} ${deadline.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })} 마감 · ${relative}`;
}

function formatSubmittedAt(value: string) {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" });
}
