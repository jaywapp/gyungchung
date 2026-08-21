"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Github, Lightbulb, MessageSquareText, Pencil, Send, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Feedback, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { showError, toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import { Empty, LoadError, SectionSkeleton } from "@/components/section-states";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

const categoryLabels: Record<Feedback["category"], string> = {
  operation: "팀 운영",
  system: "시스템",
  facility: "구장·시설",
  finance: "회비·재정",
  safety: "안전",
  other: "기타",
};

const statusLabels: Record<Feedback["status"], string> = {
  received: "접수",
  reviewing: "검토 중",
  resolved: "답변 완료",
  closed: "종결",
};

export default function FeedbackHub({ user, profile, feedback, supabase, loading, loadError, canManage, onEdit, onDelete, reload, onLogin, onRetry, toast }: {
  user: User | null;
  profile: Profile | null;
  feedback: Feedback[];
  supabase: SupabaseClient | null;
  loading: boolean;
  loadError: boolean;
  canManage: boolean;
  onEdit: (feedback: Feedback) => void;
  onDelete: (id: string, label: string) => void;
  reload: () => void;
  onLogin: () => void;
  onRetry: () => void;
  toast: ToastHandler;
}) {
  const [saving, setSaving] = useState(false);
  const [titleLength, setTitleLength] = useState(0);
  const [bodyLength, setBodyLength] = useState(0);
  const [syncedIssuesKey, setSyncedIssuesKey] = useState("");
  const syncedIssuesRef = useRef("");
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const formLocked = !user || profile?.status !== "active";
  const membershipRestriction = getMembershipRestriction(profile);
  const linkedIssuesKey = feedback
    .filter((item) => item.github_issue_number)
    .map((item) => `${item.github_issue_number}:${item.github_issue_state ?? "unknown"}`)
    .join(",");
  const issueSyncKey = user && linkedIssuesKey ? `${user.id}|${linkedIssuesKey}` : "";
  const linkedIssuesReady = !issueSyncKey || syncedIssuesKey === issueSyncKey;
  const visibleFeedback = feedback.filter((item) => item.github_issue_state !== "closed" && (!item.github_issue_number || linkedIssuesReady));

  useEffect(() => {
    if (!supabase || !issueSyncKey || syncedIssuesRef.current === issueSyncKey) return;
    syncedIssuesRef.current = issueSyncKey;
    void supabase.functions.invoke("github-feedback", { body: { action: "sync" } }).then(({ data, error }) => {
      if (syncedIssuesRef.current !== issueSyncKey) return;
      if (!error && Number(data?.changed) > 0) reloadRef.current();
      else setSyncedIssuesKey(issueSyncKey);
    });
  }, [issueSyncKey, supabase]);

  const publishToGithub = async (feedbackId: string) => {
    if (!supabase) return false;
    const { data, error } = await supabase.functions.invoke("github-feedback", { body: { feedbackId } });
    if (error || !data?.issueUrl) return false;
    return true;
  };

  const retryGithubPublish = async (feedbackId: string) => {
    setSaving(true);
    try {
      const published = await publishToGithub(feedbackId);
      if (published) toast("GitHub 이슈 연결을 완료했습니다.");
      else showError(toast, "GitHub 이슈를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (published) reload();
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return showError(toast, "회원 승인이 완료된 뒤 의견을 등록할 수 있습니다.");
    setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const category = String(form.get("category")) as Feedback["category"];
    const shouldPublish = category === "system";
    const { data: saved, error } = await supabase.from("feedback").insert({
      author_id: profile.id,
      category,
      title: form.get("title"),
      body: form.get("body"),
      is_anonymous: form.get("is_anonymous") === "on",
      publish_to_github: shouldPublish,
    }).select("*").single();
    if (error) {
      setSaving(false);
      return toast(toErrorMessage(error), "error");
    }
    try {
      const published = shouldPublish && saved ? await publishToGithub(saved.id) : false;
      formElement.reset();
      setTitleLength(0); setBodyLength(0);
      if (shouldPublish && !published) toast("내부 접수는 완료했지만 GitHub 연결에 실패했습니다.", "warning");
      else toast(shouldPublish ? "의견을 접수하고 GitHub 이슈로 연결했습니다." : "의견을 안전하게 접수했습니다.");
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content">
      <div className="page-intro">
        <span className="eyebrow">MEMBER VOICE</span>
        <h1>사용자 의견</h1>
        <p>팀 운영, 시스템, 구장과 안전에 관한 제안이나 제보를 운영진에 전달하세요. 익명 표시를 선택해도 시스템은 중복·악용 방지를 위해 작성자 정보를 보호 저장합니다.</p>
      </div>
      <div className="voice-layout">
        <form className="voice-form" onSubmit={submit}>
          <div className="panel-title"><Lightbulb /><span><small>NEW FEEDBACK</small><b>의견 보내기</b></span></div>
          {!user && <button type="button" className="login-callout" onClick={onLogin}>로그인하고 의견 남기기</button>}
          {membershipRestriction && <p className="form-lock-notice">{getMembershipRestrictionCopy(membershipRestriction).description}</p>}
          <fieldset disabled={formLocked || saving}>
            <label>분류<select name="category" defaultValue="operation" aria-describedby="feedback-routing-notice"><option value="operation">팀 운영</option><option value="system">시스템</option><option value="facility">구장·시설</option><option value="finance">회비·재정</option><option value="safety">안전</option><option value="other">기타</option></select></label>
            <label>제목<input name="title" required minLength={2} maxLength={120} placeholder="어떤 의견인가요?" aria-describedby="feedback-title-count" onChange={(event) => setTitleLength(event.target.value.length)} /></label>
            <span className="character-count" id="feedback-title-count">{titleLength.toLocaleString()} / 120</span>
            <label>내용<textarea name="body" required minLength={5} maxLength={5000} rows={7} placeholder="상황과 개선 아이디어를 구체적으로 알려주세요." aria-describedby="feedback-body-count" onChange={(event) => setBodyLength(event.target.value.length)} /></label>
            <span className="character-count" id="feedback-body-count">{bodyLength.toLocaleString()} / 5,000</span>
            <label className="check"><input type="checkbox" name="is_anonymous" /> 익명으로 제보</label>
            <p className="github-notice" id="feedback-routing-notice"><Github size={16} /> 시스템 제보는 공개 GitHub 이슈로 자동 등록되며, 익명을 선택하지 않으면 회원 이름도 함께 기록됩니다. 다른 의견은 운영진 게시판에만 접수됩니다.</p>
            <button className="cta"><Send size={17} /> {saving ? "접수 중…" : "의견 접수"}</button>
          </fieldset>
        </form>
        <div className="voice-history">
          <div className="section-heading compact"><div><span className="eyebrow">MY REPORTS</span><h2>접수 내역</h2></div>{!loading && !loadError && <span>{visibleFeedback.length}건</span>}</div>
          {loading ? <SectionSkeleton label="접수 내역을 불러오는 중" /> : loadError ? <LoadError onRetry={onRetry} /> : visibleFeedback.length === 0 ? <Empty icon={<MessageSquareText />} title="아직 접수한 의견이 없습니다" description="작은 아이디어도 팀을 더 좋게 만듭니다." /> : visibleFeedback.map((item) => (
            <article className="feedback-card" key={item.id}>
              <div><span className={`status ${item.status}`}>{statusLabels[item.status]}</span><small>{categoryLabels[item.category]} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</small>{canManage && <span className="resource-actions"><button type="button" aria-label={`${item.title} 처리 상태 수정`} onClick={() => onEdit(item)}><Pencil size={16} /></button><button type="button" aria-label={`${item.title} 삭제`} onClick={() => onDelete(item.id, item.title)}><Trash2 size={16} /></button></span>}</div>
              <h3>{item.title}</h3><p>{item.body}</p>
              {item.github_issue_url && <a className="github-issue-link" href={item.github_issue_url} target="_blank" rel="noreferrer"><Github size={16} /> GitHub Issue #{item.github_issue_number} <ExternalLink size={14} /></a>}
              {item.publish_to_github && !item.github_issue_url && item.author_id === profile?.id && <button className="github-retry" disabled={saving} onClick={() => void retryGithubPublish(item.id)}><Github size={16} /> GitHub 연결 다시 시도</button>}
              {item.officer_response && <div className="officer-answer"><CheckCircle2 size={18} /><span><b>운영진 답변</b>{item.officer_response}</span></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
