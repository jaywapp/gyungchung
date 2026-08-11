"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Github, Lightbulb, MessageSquareText, Pencil, Send, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Feedback, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

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

export default function FeedbackHub({ user, profile, feedback, supabase, canManage, onEdit, onDelete, reload, onLogin, toast }: {
  user: User | null;
  profile: Profile | null;
  feedback: Feedback[];
  supabase: SupabaseClient | null;
  canManage: boolean;
  onEdit: (feedback: Feedback) => void;
  onDelete: (id: string) => void;
  reload: () => void;
  onLogin: () => void;
  toast: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

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
      toast(published ? "GitHub 이슈 연결을 완료했습니다." : "GitHub 이슈를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (published) reload();
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return toast("회원 승인이 완료된 뒤 의견을 등록할 수 있습니다.");
    setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const shouldPublish = form.get("publish_to_github") === "on";
    const { data: saved, error } = await supabase.from("feedback").insert({
      author_id: user.id,
      category: form.get("category"),
      title: form.get("title"),
      body: form.get("body"),
      is_anonymous: form.get("is_anonymous") === "on",
      publish_to_github: shouldPublish,
    }).select("*").single();
    if (error) {
      setSaving(false);
      return toast(error.message);
    }
    try {
      const published = shouldPublish && saved ? await publishToGithub(saved.id) : false;
      formElement.reset();
      toast(shouldPublish ? published ? "의견을 접수하고 GitHub 이슈로 연결했습니다." : "내부 접수는 완료했지만 GitHub 연결에 실패했습니다." : "의견을 안전하게 접수했습니다.");
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
          <label>분류<select name="category" defaultValue="operation"><option value="operation">팀 운영</option><option value="system">시스템</option><option value="facility">구장·시설</option><option value="finance">회비·재정</option><option value="safety">안전</option><option value="other">기타</option></select></label>
          <label>제목<input name="title" required minLength={2} maxLength={120} placeholder="어떤 의견인가요?" /></label>
          <label>내용<textarea name="body" required minLength={5} maxLength={5000} rows={7} placeholder="상황과 개선 아이디어를 구체적으로 알려주세요." /></label>
          <label className="check"><input type="checkbox" name="is_anonymous" /> 목록에서 익명으로 표시</label>
          <label className="check github-consent"><input type="checkbox" name="publish_to_github" aria-describedby="github-publish-notice" /> 공개 GitHub 이슈로도 등록</label>
          <p className="github-notice" id="github-publish-notice"><Github size={16} /> 선택하면 제목과 내용이 공개 저장소에 게시됩니다. 이름·이메일 등 작성자 정보는 전송하지 마세요.</p>
          <button className="cta" disabled={saving || !user}><Send size={17} /> {saving ? "접수 중…" : "의견 접수"}</button>
        </form>
        <div className="voice-history">
          <div className="section-heading compact"><div><span className="eyebrow">MY REPORTS</span><h2>접수 내역</h2></div><span>{feedback.length}건</span></div>
          {feedback.length === 0 ? <div className="empty"><MessageSquareText /><h2>아직 접수한 의견이 없습니다</h2><p>작은 아이디어도 팀을 더 좋게 만듭니다.</p></div> : feedback.map((item) => (
            <article className="feedback-card" key={item.id}>
              <div><span className={`status ${item.status}`}>{statusLabels[item.status]}</span><small>{categoryLabels[item.category]} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</small>{canManage && <span className="resource-actions"><button type="button" aria-label={`${item.title} 처리 상태 수정`} onClick={() => onEdit(item)}><Pencil size={16} /></button><button type="button" aria-label={`${item.title} 삭제`} onClick={() => onDelete(item.id)}><Trash2 size={16} /></button></span>}</div>
              <h3>{item.title}</h3><p>{item.body}</p>
              {item.github_issue_url && <a className="github-issue-link" href={item.github_issue_url} target="_blank" rel="noreferrer"><Github size={16} /> GitHub Issue #{item.github_issue_number} <ExternalLink size={14} /></a>}
              {item.publish_to_github && !item.github_issue_url && item.author_id === user?.id && <button className="github-retry" disabled={saving} onClick={() => void retryGithubPublish(item.id)}><Github size={16} /> GitHub 연결 다시 시도</button>}
              {item.officer_response && <div className="officer-answer"><CheckCircle2 size={18} /><span><b>운영진 답변</b>{item.officer_response}</span></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
