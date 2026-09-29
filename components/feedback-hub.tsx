"use client";

import { useState } from "react";
import { CheckCircle2, Lightbulb, MessageSquareText, Pencil, Send, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Feedback, FeedbackFeedItem, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { showError, toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import { AccountConnectionNotice, Empty, LoadError, SectionSkeleton } from "@/components/section-states";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
type FeedbackCardData = Pick<Feedback, "id" | "category" | "title" | "body" | "status" | "officer_response" | "created_at">;

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

function FeedbackCard({ item, visibility, editable, onEdit, onDelete }: {
  item: FeedbackCardData;
  visibility: string;
  editable?: Feedback;
  onEdit: (feedback: Feedback) => void;
  onDelete: (id: string, label: string) => void;
}) {
  return (
    <article className="feedback-card">
      <div>
        <span className="feedback-statuses">
          <span className={"status " + item.status}>{statusLabels[item.status]}</span>
          <span className="feedback-visibility">{visibility}</span>
        </span>
        <small>{categoryLabels[item.category]} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</small>
        {editable && <span className="resource-actions">
          <button type="button" aria-label={item.title + " 처리 상태 수정"} onClick={() => onEdit(editable)}><Pencil size={16} /></button>
          <button type="button" aria-label={item.title + " 삭제"} onClick={() => onDelete(item.id, item.title)}><Trash2 size={16} /></button>
        </span>}
      </div>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      {item.officer_response && <div className="officer-answer"><CheckCircle2 size={18} /><span><b>운영진 답변</b>{item.officer_response}</span></div>}
    </article>
  );
}

export default function FeedbackHub({ user, profile, feedback, feedbackFeed, supabase, loading, loadError, canManage, onEdit, onDelete, reload, onLogin, onRetry, toast }: {
  user: User | null;
  profile: Profile | null;
  feedback: Feedback[];
  feedbackFeed: FeedbackFeedItem[];
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
  const [category, setCategory] = useState<Feedback["category"]>("operation");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shareWithMembers, setShareWithMembers] = useState(true);
  const [historyTab, setHistoryTab] = useState<"shared" | "mine">("shared");
  const formLocked = loading || loadError || !user || profile?.status !== "active";
  const membershipRestriction = getMembershipRestriction(profile);
  const myFeedback = feedback.filter((item) => item.author_id === profile?.id);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return showError(toast, "회원 승인이 완료된 뒤 의견을 등록할 수 있습니다.");
    setSaving(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        author_id: profile.id,
        category,
        title,
        body,
        share_with_members: shareWithMembers,
      });
      if (error) return toast(toErrorMessage(error), "error");
      setCategory("operation");
      setTitle("");
      setBody("");
      setShareWithMembers(true);
      setHistoryTab(shareWithMembers ? "shared" : "mine");
      toast(shareWithMembers ? "제보를 접수했습니다. 회원 제보 목록에서 진행 상황을 확인할 수 있습니다." : "제보를 비공개로 접수했습니다. 내 제보에서 진행 상황을 확인할 수 있습니다.");
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content">
      <div className="page-intro">
        <span className="eyebrow">MEMBER VOICE</span>
        <h1>사용자 제보</h1>
        <p>제보를 남기고 처리 상태와 운영진 답변을 이곳에서 확인하세요.</p>
      </div>
      <div className="voice-layout">
        <form className="voice-form" onSubmit={submit}>
          <div className="panel-title"><Lightbulb /><span><small>NEW FEEDBACK</small><b>제보 남기기</b></span></div>
          {!user && <button type="button" className="login-callout" onClick={onLogin}>로그인하고 제보하기</button>}
          {user && !loading && !loadError && !profile && <AccountConnectionNotice />}
          {membershipRestriction && <p className="form-lock-notice">{getMembershipRestrictionCopy(membershipRestriction).description}</p>}
          <fieldset disabled={formLocked || saving}>
            <label>분류<select name="category" value={category} onChange={(event) => setCategory(event.target.value as Feedback["category"])}><option value="operation">팀 운영</option><option value="system">시스템</option><option value="facility">구장·시설</option><option value="finance">회비·재정</option><option value="safety">안전</option><option value="other">기타</option></select></label>
            <label>제목<input name="title" required minLength={2} maxLength={120} value={title} placeholder="어떤 제보인가요?" aria-describedby="feedback-title-count" onChange={(event) => setTitle(event.target.value)} /></label>
            <span className="character-count" id="feedback-title-count">{title.length.toLocaleString()} / 120</span>
            <label>내용<textarea name="body" required minLength={5} maxLength={5000} rows={7} value={body} placeholder="상황과 개선 아이디어를 구체적으로 알려주세요." aria-describedby="feedback-body-count" onChange={(event) => setBody(event.target.value)} /></label>
            <span className="character-count" id="feedback-body-count">{body.length.toLocaleString()} / 5,000</span>
            <label className="check"><input type="checkbox" name="share_with_members" checked={shareWithMembers} onChange={(event) => setShareWithMembers(event.target.checked)} /> 활동 회원에게 제보와 답변 공개</label>
            <p className="feedback-privacy-notice">제보는 클럽하우스 DB에 저장됩니다. 공개를 끄면 작성자와 운영진만 볼 수 있습니다. 작성자 정보는 공개 목록에 표시되지 않습니다.</p>
            <button className="cta"><Send size={17} /> {saving ? "접수 중…" : "제보 접수"}</button>
          </fieldset>
        </form>
        <div className="voice-history">
          <div className="section-heading compact"><div><h2>제보 목록</h2></div>{!loading && !loadError && <span>{historyTab === "shared" ? feedbackFeed.length : myFeedback.length}건</span>}</div>
          <div className="feedback-tabs" role="group" aria-label="제보 목록 선택">
            <button type="button" aria-pressed={historyTab === "shared"} onClick={() => setHistoryTab("shared")}>회원 제보</button>
            <button type="button" aria-pressed={historyTab === "mine"} onClick={() => setHistoryTab("mine")}>내 제보</button>
          </div>
          {loading ? <SectionSkeleton label="제보 목록을 불러오는 중" /> : loadError ? <LoadError onRetry={onRetry} /> : historyTab === "shared" ? (
            !user || profile?.status !== "active" ? <Empty icon={<MessageSquareText />} title="회원 제보는 활동 회원에게 공개됩니다" description="로그인과 회원 승인이 완료되면 목록을 볼 수 있습니다." /> :
            feedbackFeed.length === 0 ? <Empty icon={<MessageSquareText />} title="공개된 제보가 없습니다" description="첫 제보를 남겨 주세요." /> :
            feedbackFeed.map((item) => <FeedbackCard key={item.feedback_id} item={{ ...item, id: item.feedback_id }} visibility="회원 공개" editable={canManage ? feedback.find((source) => source.id === item.feedback_id) : undefined} onEdit={onEdit} onDelete={onDelete} />)
          ) : myFeedback.length === 0 ? <Empty icon={<MessageSquareText />} title="아직 접수한 제보가 없습니다" description="작은 아이디어도 팀을 더 좋게 만듭니다." /> :
            myFeedback.map((item) => <FeedbackCard key={item.id} item={item} visibility={item.share_with_members ? "회원 공개" : "비공개"} editable={canManage ? item : undefined} onEdit={onEdit} onDelete={onDelete} />)}
        </div>
      </div>
    </section>
  );
}
