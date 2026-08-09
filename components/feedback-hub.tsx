"use client";

import { useState } from "react";
import { CheckCircle2, Lightbulb, MessageSquareText, Send } from "lucide-react";
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

export default function FeedbackHub({ user, profile, feedback, supabase, reload, onLogin, toast }: {
  user: User | null;
  profile: Profile | null;
  feedback: Feedback[];
  supabase: SupabaseClient | null;
  reload: () => void;
  onLogin: () => void;
  toast: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return toast("회원 승인이 완료된 뒤 의견을 등록할 수 있습니다.");
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("feedback").insert({
      author_id: user.id,
      category: form.get("category"),
      title: form.get("title"),
      body: form.get("body"),
      is_anonymous: form.get("is_anonymous") === "on",
    });
    setSaving(false);
    if (error) return toast(error.message);
    event.currentTarget.reset();
    toast("의견을 안전하게 접수했습니다.");
    reload();
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
          <button className="cta" disabled={saving || !user}><Send size={17} /> {saving ? "접수 중…" : "의견 접수"}</button>
        </form>
        <div className="voice-history">
          <div className="section-heading compact"><div><span className="eyebrow">MY REPORTS</span><h2>접수 내역</h2></div><span>{feedback.length}건</span></div>
          {feedback.length === 0 ? <div className="empty"><MessageSquareText /><h3>아직 접수한 의견이 없습니다</h3><p>작은 아이디어도 팀을 더 좋게 만듭니다.</p></div> : feedback.map((item) => (
            <article className="feedback-card" key={item.id}>
              <div><span className={`status ${item.status}`}>{statusLabels[item.status]}</span><small>{categoryLabels[item.category]} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</small></div>
              <h3>{item.title}</h3><p>{item.body}</p>
              {item.officer_response && <div className="officer-answer"><CheckCircle2 size={18} /><span><b>운영진 답변</b>{item.officer_response}</span></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
