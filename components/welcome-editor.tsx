"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Eye, Plus, Save, Send, Trash2, TriangleAlert } from "lucide-react";
import ConfirmDialog from "@/components/confirm-dialog";
import WelcomePage from "@/components/welcome-page";
import type { createClient } from "@/lib/supabase/client";
import type { ToastHandler } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { DEFAULT_WELCOME_CONTENT, isApprovedIosUrl, validateWelcomeContent, type WelcomeContent, type WelcomeDraft, type WelcomePublication, type WelcomeStep } from "@/lib/welcome-content";
import "./welcome-editor.css";

type Section = "basic" | "officers" | "apps";
type Issue = { message: string; section: Section; field: string };
type Failure = { kind: "save" | "publish" | "conflict" | "permission"; message: string };
type AndroidMetadata = { versionName: string; versionCode: number; sizeBytes: number; publishedAt: string | null };
const sections: { id: Section; label: string }[] = [{ id: "basic", label: "기본 안내" }, { id: "officers", label: "운영진 소개" }, { id: "apps", label: "앱 설치" }];
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 기록이 없습니다";
const summary = (value: WelcomeContent) => `운영진 ${value.officers.length}명`;
const sectionValue = (value: WelcomeContent, section: Section) => section === "basic" ? { title: value.title, introduction: value.introduction, accountSteps: value.accountSteps } : section === "apps" ? { android: value.android, ios: value.ios } : value[section];
function sectionDisplayText(content: WelcomeContent, section: Section): string {
  const text = (value: string) => value.trim() ? value : "미입력";
  const steps = (values: WelcomeStep[]) => values.length ? values.map((step, index) => `${index + 1}단계: ${text(step.title)}\n${text(step.body)}`).join("\n\n") : "등록된 안내 단계가 없습니다.";
  if (section === "basic") return `환영 제목\n${text(content.title)}\n\n소개 문구\n${text(content.introduction)}\n\n계정 안내\n${steps(content.accountSteps)}`;
  if (section === "officers") return content.officers.length ? content.officers.map((officer, index) => `운영진 ${index + 1}${index === 0 ? " (첫 소개 패널)" : ""}\n공개 이름: ${text(officer.name)}\n직책 표시명: ${text(officer.role)}\n소개: ${officer.bio || "등록된 소개가 없습니다."}`).join("\n\n") : "등록된 운영진 소개가 없습니다. 공개 페이지에서 운영진 영역은 숨겨집니다.";
  const iosStatus = { preparing: "준비 중", testflight: "테스트 참여 (TestFlight)", released: "출시 (App Store)", hidden: "숨김" }[content.ios.status];
  return `Android 앱 다운로드: ${content.android.enabled ? "표시" : "숨김"}\n\n설치 안내\n${steps(content.android.installSteps)}\n\niOS 상태: ${iosStatus}\n배포 주소: ${content.ios.url || "미등록"}\n안내 문구: ${content.ios.message || "미등록"}`;
}
const contentDisplayText = (content: WelcomeContent) => sections.map((section) => `${section.label}\n\n${sectionDisplayText(content, section.id)}`).join("\n\n────────────────────\n\n");
function reordered<T>(items: T[], index: number, offset: number) {
  const result = [...items];
  const target = index + offset;
  if (target < 0 || target >= items.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
function checkedContent(value: WelcomeContent) {
  try { return validateWelcomeContent(value).length === 0; } catch { return false; }
}
function validationIssues(content: WelcomeContent, publish: boolean): Issue[] {
  const issues: Issue[] = [];
  const field = (value: string, label: string, section: Section, id: string, maximum: number, required = publish) => {
    if ((required && !value.trim()) || value.length > maximum) issues.push({ message: `${label}: ${!value.trim() ? "필수 항목을 입력해 주세요." : `최대 ${maximum}자입니다.`}`, section, field: id });
  };
  field(content.title, "환영 제목", "basic", "welcome-title", 160);
  field(content.introduction, "소개 문구", "basic", "welcome-introduction", 1000);
  for (const [steps, section, prefix, label] of [[content.accountSteps, "basic", "account", "계정 안내"], [content.android.installSteps, "apps", "install", "설치 안내"]] as const) {
    steps.forEach((step, index) => { field(step.title, `${label} ${index + 1} 제목`, section, `${prefix}-${index}-title`, 160); field(step.body, `${label} ${index + 1} 설명`, section, `${prefix}-${index}-body`, 2000); });
  }
  content.officers.forEach((officer, index) => { field(officer.name, `운영진 ${index + 1} 이름`, "officers", `${officer.id}-name`, 100); field(officer.role, `운영진 ${index + 1} 직책`, "officers", `${officer.id}-role`, 100); field(officer.bio, `운영진 ${index + 1} 소개`, "officers", `${officer.id}-bio`, 2000, false); });
  field(content.ios.message, "iOS 안내", "apps", "welcome-ios-message", 1000, false);
  if ((content.ios.url || (publish && ["testflight", "released"].includes(content.ios.status))) && !isApprovedIosUrl(content.ios.url)) issues.push({ message: "iOS 배포 주소: 공식 App Store 또는 TestFlight HTTPS 주소를 입력해 주세요.", section: "apps", field: "welcome-ios-url" });
  const common = validateWelcomeContent(content, publish);
  const structural = /지원하지|항목 ID|최대 10단계|최대 30명|500KB/;
  const additional = issues.length ? common.filter((message) => structural.test(message)) : common;
  additional.forEach((message) => issues.push({ message, section: /운영진/.test(message) ? "officers" : /iOS|Android|설치/.test(message) ? "apps" : "basic", field: "" }));
  return issues;
}

function Field({ id, label, value, onChange, maxLength, multiline = false, type = "text", hint, error }: { id: string; label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; type?: string; hint?: string; error?: string }) {
  const props = { id, value, maxLength, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), "aria-invalid": error ? true as const : undefined, "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined };
  return <label htmlFor={id}>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} type={type} />}{hint && <small id={`${id}-hint`}>{hint}</small>}{error && <small className="welcome-editor-field-error" id={`${id}-error`}>{error}</small>}</label>;
}
function ItemHeader({ label, index, total, onMove, onRemove }: { label: string; index: number; total: number; onMove: (offset: number) => void; onRemove: () => void }) {
  return <header className="welcome-editor-item-header"><strong>{label}</strong><button type="button" aria-label={`${label} 위로 이동`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={18} /></button><button type="button" aria-label={`${label} 아래로 이동`} disabled={index === total - 1} onClick={() => onMove(1)}><ArrowDown size={18} /></button><button type="button" aria-label={`${label} 삭제`} onClick={onRemove}><Trash2 size={18} /></button></header>;
}
function Preview({ content, onClose }: { content: WelcomeContent; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>({ onRequestClose: onClose });
  return createPortal(<div className="welcome-editor-preview" role="dialog" aria-modal="true" aria-labelledby="welcome-preview-title" tabIndex={-1} ref={ref}><header className="welcome-editor-preview-header"><button type="button" className="cta small ghost" onClick={onClose}>편집으로 돌아가기</button><h2 id="welcome-preview-title">초안 미리보기<small>현재 입력한 내용입니다. 방문자에게는 아직 보이지 않습니다.</small></h2></header><div className="welcome-editor-preview-stage"><WelcomePage content={content} preview state="published" /></div></div>, document.body);
}

export default function WelcomeEditor({ supabase, toast, onDirtyChange, canManage = true }: { supabase: NonNullable<ReturnType<typeof createClient>>; toast: ToastHandler; onDirtyChange?: (dirty: boolean) => void; canManage?: boolean }) {
  const [content, setContent] = useState<WelcomeContent>(() => copy(DEFAULT_WELCOME_CONTENT));
  const [draft, setDraft] = useState<WelcomeDraft | null>(null);
  const [publication, setPublication] = useState<WelcomePublication | null>(null);
  const [section, setSection] = useState<Section>("basic");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [preview, setPreview] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [latest, setLatest] = useState<WelcomeDraft | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [metadata, setMetadata] = useState<AndroidMetadata | null>(null);
  const [metadataCheckedAt, setMetadataCheckedAt] = useState<string | null>(null);
  const [metadataState, setMetadataState] = useState<"loading" | "ready" | "error">("loading");
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const operationSequence = useRef(0);
  const mutationLock = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const baseline = draft?.content ?? DEFAULT_WELCOME_CONTENT;
  const dirty = !same(content, baseline);
  const denied = !canManage || failure?.kind === "permission";
  const unpublished = Boolean(draft && draft.revision !== (draft.published_revision ?? publication?.revision));
  const publishIssues = validationIssues(content, true);
  const canPublish = !loading && !loadError && !denied && !busy && !dirty && unpublished && !publishIssues.length && failure?.kind !== "conflict";
  const canSave = !loading && !loadError && !denied && !busy && (dirty || !draft) && failure?.kind !== "conflict";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty || Boolean(busy)); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const allowNavigation = () => window.removeEventListener("beforeunload", guard);
    window.addEventListener("beforeunload", guard);
    window.addEventListener("welcome-navigation-confirmed", allowNavigation);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("welcome-navigation-confirmed", allowNavigation);
    };
  }, [dirty, busy]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError(null);
    try {
      const [draftResult, publicationResult] = await Promise.all([
        supabase.from("welcome_page_drafts").select("id,content,revision,published_revision,updated_at,updated_by").eq("id", true).maybeSingle(),
        supabase.from("welcome_page_publications").select("id,content,revision,published_at").eq("id", true).maybeSingle(),
      ]);
      if (!mounted.current || sequence !== loadSequence.current) return;
      if (draftResult.error || publicationResult.error) throw draftResult.error ?? publicationResult.error;
      const nextDraft = draftResult.data as WelcomeDraft | null;
      const nextPublication = publicationResult.data as WelcomePublication | null;
      if ((nextDraft && !checkedContent(nextDraft.content)) || (nextPublication && !checkedContent(nextPublication.content))) throw new Error("invalid-content");
      setDraft(nextDraft); setPublication(nextPublication); setContent(copy(nextDraft?.content ?? DEFAULT_WELCOME_CONTENT)); setFailure(null); setIssues([]);
    } catch (error) {
      if (!mounted.current || sequence !== loadSequence.current) return;
      if ((error as { code?: string }).code === "42501") setFailure({ kind: "permission", message: "웰컴 페이지를 편집할 권한이 없습니다. 회장 또는 시스템 관리자에게 웰컴 페이지 관리 권한을 요청해 주세요." });
      setLoadError("게시본과 초안을 불러오지 못했습니다. 네트워크 연결과 관리 권한을 확인한 뒤 다시 시도해 주세요.");
    } finally { if (mounted.current && sequence === loadSequence.current) setLoading(false); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    setMetadataState("loading");
    void fetch("/api/welcome/android", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("metadata-unavailable");
      const value = await response.json() as AndroidMetadata;
      if (!value.versionName || !Number.isFinite(value.versionCode) || !Number.isFinite(value.sizeBytes)) throw new Error("invalid-metadata");
      if (!controller.signal.aborted) { setMetadata(value); setMetadataCheckedAt(new Date().toISOString()); setMetadataState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) { setMetadata(null); setMetadataState("error"); } });
    return () => controller.abort();
  }, [metadataAttempt]);

  const edit = (change: (next: WelcomeContent) => void) => { if (busy) return; setContent((current) => { const next = copy(current); change(next); return next; }); setIssues([]); if (failure && ["save", "publish"].includes(failure.kind)) setFailure(null); };
  const jump = (issue: Issue) => { setSection(issue.section); requestAnimationFrame(() => { const target = document.getElementById(issue.field) ?? document.getElementById(`welcome-section-${issue.section}`); target?.focus(); target?.scrollIntoView({ block: "center", behavior: "instant" }); }); };
  const showIssues = (values: Issue[]) => { setIssues(values); requestAnimationFrame(() => summaryRef.current?.focus()); };
  const readLatest = async () => {
    if (comparing) return;
    setCompareOpen(true); setComparing(true); setCompareError(null);
    const sequence = ++operationSequence.current;
    try {
      const result = await supabase.from("welcome_page_drafts").select("id,content,revision,published_revision,updated_at,updated_by").eq("id", true).maybeSingle();
      if (!mounted.current || sequence !== operationSequence.current) return;
      if (result.error) throw result.error;
      const value = result.data as WelcomeDraft | null;
      if (!value || !checkedContent(value.content)) throw new Error("latest-unavailable");
      setLatest(value);
      requestAnimationFrame(() => { compareRef.current?.focus(); compareRef.current?.scrollIntoView({ block: "start" }); });
    } catch (error) {
      if (!mounted.current || sequence !== operationSequence.current) return;
      setLatest(null); setCompareError("최신 초안을 불러오지 못했습니다. 내 입력은 그대로 유지됩니다. 연결과 권한을 확인한 뒤 다시 비교해 주세요.");
      if ((error as { code?: string }).code === "42501") setFailure({ kind: "permission", message: "관리 권한이 변경되어 최신 초안을 읽을 수 없습니다. 작성 내용을 복사해 보관하고 시스템 관리자에게 권한을 요청해 주세요." });
    } finally { if (mounted.current && sequence === operationSequence.current) setComparing(false); }
  };
  const handleFailure = (error: unknown, kind: "save" | "publish") => {
    const code = (error as { code?: string })?.code;
    const message = code === "40001" ? "다른 운영진이 먼저 초안을 저장했습니다. 내 변경은 이 화면에 그대로 있습니다. 최신 초안을 불러와 비교한 뒤 다시 저장해 주세요." : code === "42501" ? "관리 권한이 변경되어 작업을 완료할 수 없습니다. 작성 내용은 유지됩니다. 회장 또는 시스템 관리자에게 웰컴 페이지 관리 권한을 요청해 주세요." : kind === "save" ? "초안을 저장하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 저장해 주세요. 작성한 내용은 지워지지 않았습니다." : "게시하지 못했습니다. 저장한 초안은 그대로 있습니다. 연결을 확인한 뒤 다시 게시해 주세요.";
    setFailure({ kind: code === "40001" ? "conflict" : code === "42501" ? "permission" : kind, message }); toast(message, "error");
  };
  const save = async () => {
    if (!canSave || mutationLock.current) return;
    const validation = validationIssues(content, false);
    if (validation.length) { showIssues(validation); return; }
    mutationLock.current = true; setBusy("save"); setFailure(null);
    try {
      const result = await supabase.rpc("save_welcome_page_draft", { page_content: content, expected_revision: draft?.revision ?? 0 });
      if (!mounted.current) return;
      if (result.error) throw result.error;
      const value = (Array.isArray(result.data) ? result.data[0] : result.data) as WelcomeDraft | null;
      if (!value || !checkedContent(value.content)) throw new Error("save-result-unavailable");
      setDraft(value); setContent(copy(value.content)); toast("초안을 저장했습니다. 공개 페이지는 아직 바뀌지 않았습니다.", "success");
    } catch (error) { if (mounted.current) handleFailure(error, "save"); }
    finally { mutationLock.current = false; if (mounted.current) setBusy(null); }
  };
  const publish = async () => {
    if (!canPublish || !draft || mutationLock.current) return;
    const validation = validationIssues(draft.content, true);
    if (validation.length) { showIssues(validation); return; }
    mutationLock.current = true; setBusy("publish"); setFailure(null);
    try {
      const result = await supabase.rpc("publish_welcome_page", { expected_revision: draft.revision });
      if (!mounted.current) return;
      if (result.error) throw result.error;
      const value = (Array.isArray(result.data) ? result.data[0] : result.data) as WelcomePublication | null;
      if (!value || !checkedContent(value.content)) throw new Error("publish-result-unavailable");
      setPublication(value); setDraft((current) => current ? { ...current, published_revision: value.revision } : current); toast("게시했습니다. 방문자에게 새 내용이 보입니다.", "success");
    } catch (error) { if (mounted.current) handleFailure(error, "publish"); }
    finally { mutationLock.current = false; if (mounted.current) setBusy(null); }
  };
  const fieldError = (id: string) => issues.find((issue) => issue.field === id)?.message;
  const stepsEditor = (steps: WelcomeStep[], prefix: "account" | "install", update: (next: WelcomeContent, values: WelcomeStep[]) => void): ReactNode => <><ol className="welcome-editor-repeat">{steps.map((step, index) => <li key={`${prefix}-${index}`}><ItemHeader label={`${index + 1}단계`} index={index} total={steps.length} onMove={(offset) => edit((next) => update(next, reordered(steps, index, offset)))} onRemove={() => edit((next) => update(next, steps.filter((_, current) => current !== index)))} /><Field id={`${prefix}-${index}-title`} label="단계 제목" value={step.title} maxLength={160} error={fieldError(`${prefix}-${index}-title`)} onChange={(value) => edit((next) => { const values = copy(steps); values[index].title = value; update(next, values); })} /><Field id={`${prefix}-${index}-body`} label="단계 설명" value={step.body} maxLength={2000} multiline error={fieldError(`${prefix}-${index}-body`)} onChange={(value) => edit((next) => { const values = copy(steps); values[index].body = value; update(next, values); })} /></li>)}</ol><button type="button" className="welcome-editor-add" disabled={steps.length >= 10} onClick={() => edit((next) => update(next, [...steps, { title: "", body: "" }]))}><Plus size={18} />단계 추가</button></>;
  const status = busy === "save" ? "초안을 저장하는 중입니다" : busy === "publish" ? "게시하는 중입니다" : failure?.kind === "conflict" ? "저장이 보류되었습니다" : denied ? "관리 권한이 필요합니다" : dirty ? "저장하지 않은 변경이 있습니다" : unpublished ? "초안이 저장되었습니다 · 미게시" : publication ? "게시본과 초안이 같습니다" : "처음 게시를 기다리고 있습니다";

  return <div className="welcome-editor">
    {loading ? <div role="status" aria-label="게시본과 초안을 불러오는 중입니다"><div className="welcome-editor-status"><div className="welcome-editor-skeleton" /><div className="welcome-editor-skeleton" /></div><div className="welcome-editor-skeleton form" /></div> : <>
      <dl className="welcome-editor-status" aria-label="게시 상태"><div><dt>방문자가 보는 게시본 <span className={`status ${publication ? "ok" : "neutral"}`}>{publication ? "공개 중" : "게시 전"}</span></dt><dd>{publication ? `${dateLabel(publication.published_at)} 게시` : "아직 게시한 적이 없습니다"}<small>{publication ? `리비전 ${publication.revision} · ${summary(publication.content)}` : "방문자에게는 준비 중 안내가 보입니다."}</small></dd><a href="/welcome" target="_blank" rel="noopener noreferrer">공개 페이지 열기</a></div><div><dt>편집 중인 초안 <span className={`status ${dirty || unpublished ? "warn" : "neutral"}`}>{dirty ? "저장 안 한 변경" : unpublished ? "미게시 변경 있음" : draft ? "게시본과 같음" : "첫 초안"}</span></dt><dd>{draft ? `${dateLabel(draft.updated_at)} 마지막 저장` : "아직 저장한 적이 없습니다"}<small>{draft ? `리비전 ${draft.revision} · ` : ""}{summary(content)}</small></dd></div></dl>
      {loadError && <div className="welcome-editor-alert" role="alert"><h3><TriangleAlert size={20} />불러오지 못했습니다</h3><p>{loadError}</p><div><button type="button" className="cta small ghost" onClick={() => void load()}>다시 시도</button></div></div>}
      {failure && <div className={`welcome-editor-alert ${failure.kind === "conflict" ? "warn" : ""}`} role="alert"><h3><TriangleAlert size={20} />{failure.kind === "conflict" ? "다른 운영진이 먼저 초안을 저장했습니다" : failure.kind === "permission" ? "웰컴 페이지를 편집할 권한이 없습니다" : failure.kind === "save" ? "초안을 저장하지 못했습니다" : "게시하지 못했습니다"}</h3><p>{failure.message}</p>{failure.kind === "conflict" && <div className="welcome-editor-inline-actions"><button type="button" className="cta small ghost" disabled={comparing} onClick={() => void readLatest()}>{comparing ? "불러오는 중" : "최신 초안과 비교"}</button><button type="button" className="cta small ghost" onClick={() => { setCompareOpen(true); setCopyOpen(true); }}>내 작성 내용 복사</button></div>}</div>}
      {!canManage && !failure && <div className="welcome-editor-alert" role="alert"><h3>웰컴 페이지를 편집할 권한이 없습니다</h3><p>회장 또는 시스템 관리자에게 웰컴 페이지 관리 권한을 요청해 주세요. 공개 페이지는 누구나 볼 수 있습니다.</p></div>}
      {failure?.kind === "permission" && <button type="button" className="cta small ghost" onClick={() => { setCompareOpen(true); setCopyOpen(true); }}>작성 내용 복사하여 보관</button>}
      {issues.length > 0 && <div className="welcome-editor-alert" role="alert" tabIndex={-1} ref={summaryRef}><h3>아래 항목을 확인해 주세요</h3><ul>{issues.map((issue, index) => <li key={`${issue.field}-${index}`}><button type="button" onClick={() => jump(issue)}>{issue.message}</button></li>)}</ul></div>}
      {compareOpen && <div className="welcome-editor-compare" ref={compareRef} tabIndex={-1}><h2>최신 초안과 비교</h2><p>내 입력을 자동으로 덮어쓰지 않습니다. 필요한 내용을 복사한 뒤 최신 초안을 불러와 다시 반영해 주세요.</p>{comparing && <p role="status">최신 초안을 불러오는 중입니다.</p>}{compareError && <p role="alert">{compareError}</p>}{latest && <><p>최신 초안: 리비전 {latest.revision} · {dateLabel(latest.updated_at)} 저장 · {summary(latest.content)}</p>{sections.map((item) => <details key={item.id}><summary>{item.label} · {same(sectionValue(content, item.id), sectionValue(latest.content, item.id)) ? "같은 내용" : "다른 내용"}</summary><div className="welcome-editor-row"><div><h3>내 입력</h3><pre>{sectionDisplayText(content, item.id)}</pre></div><div><h3>최신 저장본</h3><pre>{sectionDisplayText(latest.content, item.id)}</pre></div></div></details>)}</>}<div className="welcome-editor-inline-actions"><button type="button" className="cta small ghost" disabled={comparing} onClick={() => void readLatest()}>최신 초안 다시 확인</button><button type="button" className="cta small ghost" onClick={() => { setCopyOpen(true); void navigator.clipboard?.writeText(contentDisplayText(content)).then(() => toast("내 작성 내용을 복사했습니다.", "success")).catch(() => toast("아래 작성 내용을 선택해 복사해 주세요.", "warning")); }}>내 작성 내용 복사</button><button type="button" className="cta small ghost" disabled={!latest || comparing || Boolean(busy)} onClick={() => setDiscardOpen(true)}>내 변경을 버리고 최신 초안 불러오기</button><button type="button" className="cta small ghost" onClick={() => setCompareOpen(false)}>비교 닫기</button></div>{copyOpen && <label>내 작성 내용 (전체 선택 후 복사)<textarea className="welcome-editor-copy" readOnly value={contentDisplayText(content)} onFocus={(event) => event.currentTarget.select()} /></label>}</div>}
      {!loadError && <><div className="welcome-editor-sections" role="group" aria-label="편집 영역">{sections.map((item) => <button type="button" key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.label}{!same(sectionValue(content, item.id), sectionValue(baseline, item.id)) && <small>변경 있음</small>}</button>)}</div>
      <form className="welcome-editor-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={Boolean(busy) || denied}>
          <section hidden={section !== "basic"} id="welcome-section-basic" tabIndex={-1}><h2>기본 안내</h2><p>환영 제목과 소개, 계정 이용 순서를 안내합니다.</p><Field id="welcome-title" label="환영 제목" value={content.title} multiline maxLength={160} hint="줄을 바꾸면 공개 페이지에서도 줄이 나뉩니다." error={fieldError("welcome-title")} onChange={(value) => edit((next) => { next.title = value; })} /><Field id="welcome-introduction" label="소개 문구" value={content.introduction} multiline maxLength={1000} error={fieldError("welcome-introduction")} onChange={(value) => edit((next) => { next.introduction = value; })} /><h3>계정 안내</h3>{stepsEditor(content.accountSteps, "account", (next, values) => { next.accountSteps = values; })}</section>
          <section hidden={section !== "officers"} id="welcome-section-officers" tabIndex={-1}><h2>운영진 소개</h2><p className="welcome-editor-note">공개 이름, 직책 표시명, 소개는 공개 페이지에만 쓰이며 계정의 회원 유형, 실제 직책, 시스템 권한은 바뀌지 않습니다.</p>{!content.officers.length && <p className="welcome-editor-empty">등록된 운영진 소개가 없습니다. 운영진을 추가하면 공개 페이지에 소개 영역이 나타납니다.</p>}<ol className="welcome-editor-repeat">{content.officers.map((officer, index) => <li key={officer.id}><ItemHeader label={`운영진 ${index + 1}${index === 0 ? " · 첫 소개 패널" : ""}`} index={index} total={content.officers.length} onMove={(offset) => edit((next) => { next.officers = reordered(next.officers, index, offset); })} onRemove={() => edit((next) => { next.officers.splice(index, 1); })} /><div className="welcome-editor-row"><Field id={`${officer.id}-name`} label="공개 이름" value={officer.name} maxLength={100} error={fieldError(`${officer.id}-name`)} onChange={(value) => edit((next) => { next.officers[index].name = value; })} /><Field id={`${officer.id}-role`} label="직책 표시명" value={officer.role} maxLength={100} error={fieldError(`${officer.id}-role`)} onChange={(value) => edit((next) => { next.officers[index].role = value; })} /></div><Field id={`${officer.id}-bio`} label="소개" value={officer.bio} multiline maxLength={2000} error={fieldError(`${officer.id}-bio`)} onChange={(value) => edit((next) => { next.officers[index].bio = value; })} /></li>)}</ol><button type="button" className="welcome-editor-add" disabled={content.officers.length >= 30} onClick={() => edit((next) => { next.officers.push({ id: newId("officer"), name: "", role: "", bio: "" }); })}><Plus size={18} />운영진 추가</button></section>
          <section hidden={section !== "apps"} id="welcome-section-apps" tabIndex={-1}><h2>앱 설치</h2><p>Android 배포 정보는 공개 최신 릴리스에서 자동으로 가져옵니다. 안내 문구와 노출 설정만 편집합니다.</p><h3>Android</h3>{metadataState === "ready" && metadata ? <dl className="welcome-editor-metadata"><div><dt>버전</dt><dd>{metadata.versionName}</dd></div><div><dt>빌드 코드</dt><dd>{metadata.versionCode}</dd></div><div><dt>파일 크기</dt><dd>{(metadata.sizeBytes / 1024 / 1024).toFixed(1)} MB</dd></div><div><dt>확인 시점</dt><dd>{dateLabel(metadataCheckedAt)}</dd></div></dl> : <p role="status">{metadataState === "loading" ? "버전 정보를 확인하는 중입니다." : "버전 정보를 불러오지 못했습니다. 최신 설치 파일은 그대로 받을 수 있습니다."}</p>}{metadataState === "error" && <button type="button" className="cta small ghost" onClick={() => setMetadataAttempt((value) => value + 1)}>다시 확인</button>}<label className="welcome-editor-check"><input type="checkbox" checked={content.android.enabled} onChange={(event) => edit((next) => { next.android.enabled = event.target.checked; })} />Android 앱 다운로드 표시</label><h3>설치 안내</h3>{stepsEditor(content.android.installSteps, "install", (next, values) => { next.android.installSteps = values; })}<h3>iOS</h3><label htmlFor="welcome-ios-status">상태<select id="welcome-ios-status" value={content.ios.status} onChange={(event) => edit((next) => { next.ios.status = event.target.value as WelcomeContent["ios"]["status"]; })}><option value="preparing">준비 중</option><option value="testflight">테스트 참여 (TestFlight)</option><option value="released">출시 (App Store)</option><option value="hidden">숨김</option></select></label><Field id="welcome-ios-url" label="배포 주소" type="url" value={content.ios.url} maxLength={2000} hint="공식 apps.apple.com 또는 testflight.apple.com HTTPS 주소만 사용할 수 있습니다. 테스트 참여와 출시 상태에서 필요합니다." error={fieldError("welcome-ios-url")} onChange={(value) => edit((next) => { next.ios.url = value; })} /><Field id="welcome-ios-message" label="안내 문구" value={content.ios.message} maxLength={1000} multiline error={fieldError("welcome-ios-message")} onChange={(value) => edit((next) => { next.ios.message = value; })} /></section>
        </fieldset>
      </form></>}
    </>}
    {!loading && <div className="welcome-editor-actions"><p role="status">{status}<small>{dirty ? "미리보기에는 현재 입력이 반영됩니다. 게시하려면 먼저 초안을 저장해 주세요." : unpublished ? "게시하기 전까지 방문자는 이전 내용을 봅니다." : "초안을 저장한 뒤 미리보기로 확인하고 게시하세요."}</small></p><button type="button" className="cta small ghost" disabled={!canSave} aria-busy={busy === "save"} onClick={() => void save()}><Save size={18} />{busy === "save" ? "저장 중" : "초안 저장"}</button><button type="button" className="cta small ghost" disabled={Boolean(busy) || Boolean(loadError)} onClick={() => setPreview(true)}><Eye size={18} />미리보기</button><button type="button" className="cta small" disabled={!canPublish} aria-busy={busy === "publish"} onClick={() => void publish()}><Send size={18} />{busy === "publish" ? "게시 중" : "게시"}</button>{!dirty && unpublished && publishIssues.length > 0 && <button type="button" className="text-link" onClick={() => showIssues(publishIssues)}>게시 필수 항목 {publishIssues.length}개 확인</button>}</div>}
    {preview && <Preview content={content} onClose={() => setPreview(false)} />}
    {discardOpen && <ConfirmDialog title="내 변경을 버리고 최신 초안을 불러올까요?" description="이 화면의 작성 내용이 최신 초안으로 교체됩니다. 필요한 내용은 먼저 복사해 주세요. 공개 게시본은 바뀌지 않습니다." confirmLabel="버리고 불러오기" onCancel={() => setDiscardOpen(false)} onConfirm={() => { if (!latest) return; setDiscardOpen(false); setCompareOpen(false); void load(); }} />}
  </div>;
}
