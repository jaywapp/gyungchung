"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Github, Lightbulb, MessageSquareText, Pencil, Send, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import type { Feedback, FeedbackFeedItem, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { showError, toErrorMessage, type ToastHandler } from "@/lib/ui-feedback";
import { getMembershipRestriction, getMembershipRestrictionCopy } from "@/lib/account-state";
import { AccountConnectionNotice, Empty, LoadError, SectionSkeleton } from "@/components/section-states";
import { buildGithubPublicationPreview } from "@/supabase/functions/_shared/feedback-publication";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
type FeedbackCardData = Pick<Feedback, "id" | "category" | "title" | "body" | "status" | "officer_response" | "created_at" | "github_issue_number" | "github_issue_url" | "github_issue_state">;

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

function FeedbackCard({ item, visibility, editable, publication, saving, onEdit, onDelete, onRetryPublish }: {
  item: FeedbackCardData;
  visibility: string;
  editable?: Feedback;
  publication?: Feedback;
  saving: boolean;
  onEdit: (feedback: Feedback) => void;
  onDelete: (id: string, label: string) => void;
  onRetryPublish: (id: string) => void;
}) {
  return (
    <article className="feedback-card">
      <div>
        <span className="feedback-statuses">
          <span className={"status " + item.status}>{statusLabels[item.status]}</span>
          {item.github_issue_state && <span className={"status " + (item.github_issue_state === "closed" ? "resolved" : "reviewing")}>GitHub · {item.github_issue_state === "closed" ? "닫힘" : "열림"}</span>}
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
      {item.github_issue_url && <a className="github-issue-link" href={item.github_issue_url} target="_blank" rel="noreferrer"><Github size={16} /> GitHub Issue #{item.github_issue_number} <ExternalLink size={14} /></a>}
      {publication?.publish_to_github && !publication.github_issue_url && <div className={"github-publication-state " + publication.github_publication_status}>
        <p role={publication.github_publication_status === "failed" ? "alert" : "status"}>{publication.github_publication_status === "failed" ? publication.github_publication_error ?? "GitHub 공개 등록에 실패했습니다. 원본 제보는 접수되어 있습니다." : "GitHub 공개 등록이 아직 완료되지 않았습니다. 원본 제보는 접수되어 있습니다."}</p>
        <button type="button" className="github-retry" disabled={saving} onClick={() => onRetryPublish(item.id)}><Github size={16} /> GitHub 공개 등록 다시 시도</button>
      </div>}
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
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [shareWithMembers, setShareWithMembers] = useState(true);
  const [githubConsent, setGithubConsent] = useState(false);
  const [historyTab, setHistoryTab] = useState<"shared" | "mine">("shared");
  const syncedIssuesRef = useRef("");
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const formLocked = loading || loadError || !user || profile?.status !== "active";
  const membershipRestriction = getMembershipRestriction(profile);
  const myFeedback = feedback.filter((item) => item.author_id === profile?.id);
  const linkedIssuesKey = feedback
    .filter((item) => item.github_issue_number)
    .map((item) => String(item.github_issue_number) + ":" + (item.github_issue_state ?? "unknown"))
    .join(",");
  const issueSyncKey = user && linkedIssuesKey ? user.id + "|" + linkedIssuesKey : "";
  const isSystemFeedback = category === "system";
  const githubPreview = isSystemFeedback ? buildGithubPublicationPreview({
    category,
    title: title || "제목 입력 전",
    body: body || "내용 입력 전",
    isAnonymous,
    authorName: profile?.name ?? "회원 이름",
  }) : null;

  useEffect(() => {
    if (!supabase || !issueSyncKey || syncedIssuesRef.current === issueSyncKey) return;
    syncedIssuesRef.current = issueSyncKey;
    void supabase.functions.invoke("github-feedback", { body: { action: "sync" } }).then(({ data, error }) => {
      if (syncedIssuesRef.current !== issueSyncKey) return;
      if (!error && Number(data?.changed) > 0) reloadRef.current();
    });
  }, [issueSyncKey, supabase]);

  const publishToGithub = async (feedbackId: string) => {
    if (!supabase) return false;
    try {
      const { data, error } = await supabase.functions.invoke("github-feedback", { body: { feedbackId } });
      return !error && Boolean(data?.issueUrl);
    } catch {
      return false;
    }
  };

  const retryGithubPublish = async (feedbackId: string) => {
    setSaving(true);
    try {
      const published = await publishToGithub(feedbackId);
      if (published) toast("GitHub 이슈 연결을 완료했습니다.");
      else showError(toast, "GitHub 이슈를 연결하지 못했습니다. 원본 제보는 접수되어 있으며 잠시 후 다시 시도해 주세요.");
      reload();
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) return onLogin();
    if (profile?.status !== "active") return showError(toast, "회원 승인이 완료된 뒤 의견을 등록할 수 있습니다.");
    setSaving(true);
    const shouldPublish = isSystemFeedback && githubConsent;
    const { data: saved, error } = await supabase.from("feedback").insert({
      author_id: profile.id,
      category,
      title,
      body,
      is_anonymous: isAnonymous,
      share_with_members: shareWithMembers || shouldPublish,
      publish_to_github: shouldPublish,
      github_publication_consented_at: shouldPublish ? new Date().toISOString() : null,
    }).select("*").single();
    if (error) {
      setSaving(false);
      return toast(toErrorMessage(error), "error");
    }
    try {
      const published = shouldPublish && saved ? await publishToGithub(saved.id) : false;
      setCategory("operation");
      setTitle("");
      setBody("");
      setIsAnonymous(false);
      setShareWithMembers(true);
      setGithubConsent(false);
      setHistoryTab(shareWithMembers ? "shared" : "mine");
      if (!shouldPublish) toast(shareWithMembers ? "제보를 접수했습니다. 회원 제보 목록에서 진행 상황을 확인할 수 있습니다." : "제보를 비공개로 접수했습니다. 내 제보에서 진행 상황을 확인할 수 있습니다.");
      else if (published) toast("제보를 DB에 저장하고 공개 GitHub 이슈로 연결했습니다.");
      else toast("내부 접수는 완료했지만 GitHub 연결에 실패했습니다. 접수 내역에서 다시 시도해 주세요.", "warning");
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="content">
      <div className="page-intro">
        <span className="eyebrow">MEMBER VOICE</span>
        <h1>의견</h1>
        <p>제보를 남기고 처리 상태와 운영진 답변을 이곳에서 확인하세요.</p>
      </div>
      <div className="voice-layout">
        <form className="voice-form" onSubmit={submit}>
          <div className="panel-title"><Lightbulb /><span><small>NEW FEEDBACK</small><b>제보 남기기</b></span></div>
          {!user && <button type="button" className="login-callout" onClick={onLogin}>로그인하고 제보하기</button>}
          {user && !loading && !loadError && !profile && <AccountConnectionNotice />}
          {membershipRestriction && <p className="form-lock-notice">{getMembershipRestrictionCopy(membershipRestriction).description}</p>}
          <fieldset disabled={formLocked || saving}>
            <label>분류<select name="category" value={category} aria-describedby="feedback-routing-notice" onChange={(event) => {
              const nextCategory = event.target.value as Feedback["category"];
              setCategory(nextCategory);
              if (nextCategory !== "system") { setGithubConsent(false); setIsAnonymous(false); }
            }}><option value="operation">팀 운영</option><option value="system">시스템</option><option value="facility">구장·시설</option><option value="finance">회비·재정</option><option value="safety">안전</option><option value="other">기타</option></select></label>
            <label>제목<input name="title" required minLength={2} maxLength={120} value={title} placeholder="어떤 제보인가요?" aria-describedby="feedback-title-count" onChange={(event) => setTitle(event.target.value)} /></label>
            <span className="character-count" id="feedback-title-count">{title.length.toLocaleString()} / 120</span>
            <label>내용<textarea name="body" required minLength={5} maxLength={5000} rows={7} value={body} placeholder="상황과 개선 아이디어를 구체적으로 알려주세요." aria-describedby="feedback-body-count" onChange={(event) => setBody(event.target.value)} /></label>
            <span className="character-count" id="feedback-body-count">{body.length.toLocaleString()} / 5,000</span>
            {isSystemFeedback && <label className="check"><input type="checkbox" name="is_anonymous" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} /> GitHub에서 익명으로 표시</label>}
            <label className="check"><input type="checkbox" name="share_with_members" checked={shareWithMembers} onChange={(event) => {
              setShareWithMembers(event.target.checked);
              if (!event.target.checked) setGithubConsent(false);
            }} /> 활동 회원에게 제보와 답변 공개</label>
            <p className="feedback-privacy-notice">제보 원본은 클럽하우스 DB에 저장됩니다. 회원 공개를 끄면 작성자와 운영진만 볼 수 있습니다. 회원 목록에는 작성자 정보가 표시되지 않습니다.</p>
            <p className="github-notice" id="feedback-routing-notice"><Github size={16} /> {isSystemFeedback ? "시스템 제보는 아래 내용을 확인하고 별도로 동의한 경우에만 공개 GitHub 이슈에도 등록됩니다." : "현재 분류는 클럽하우스 DB에만 접수되며 GitHub에는 등록되지 않습니다."}</p>
            {githubPreview && <div className="github-publication-panel">
              <div className="github-publication-heading"><span><Github size={17} /> 공개 미리보기</span><small>동의 시 아래 필드가 공개됩니다</small></div>
              <dl>
                <div><dt>저장 위치</dt><dd>GitHub 공개 저장소 {githubPreview.repository} / Issues</dd></div>
                <div><dt>라벨</dt><dd>{githubPreview.label}</dd></div>
                <div><dt>제목</dt><dd>{githubPreview.title}</dd></div>
                <div><dt>제보자</dt><dd>{githubPreview.reporter}</dd></div>
                <div><dt>본문</dt><dd className="github-preview-body">{githubPreview.body}</dd></div>
              </dl>
              <p>공개 이슈는 검색 엔진과 외부 사용자에게 노출되고 복제될 수 있습니다. 원본 제보에는 익명 선택 여부와 관계없이 작성자가 보호 저장됩니다.</p>
              <label className="check github-consent"><input type="checkbox" name="github_consent" checked={githubConsent} onChange={(event) => {
                setGithubConsent(event.target.checked);
                if (event.target.checked) setShareWithMembers(true);
              }} /><span><b>위 내용을 GitHub에 공개하는 데 동의합니다</b><small>동의하지 않아도 DB에 제보할 수 있습니다.</small></span></label>
            </div>}
            <button className="cta"><Send size={17} /> {saving ? "접수 중…" : isSystemFeedback && githubConsent ? "DB 저장 및 GitHub 등록" : "제보 접수"}</button>
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
            feedbackFeed.map((item) => <FeedbackCard key={item.feedback_id} item={{ ...item, id: item.feedback_id }} visibility="회원 공개" editable={canManage ? feedback.find((source) => source.id === item.feedback_id) : undefined} saving={saving} onEdit={onEdit} onDelete={onDelete} onRetryPublish={(id) => void retryGithubPublish(id)} />)
          ) : myFeedback.length === 0 ? <Empty icon={<MessageSquareText />} title="아직 접수한 제보가 없습니다" description="작은 아이디어도 팀을 더 좋게 만듭니다." /> :
            myFeedback.map((item) => <FeedbackCard key={item.id} item={item} visibility={item.share_with_members ? "회원 공개" : "비공개"} editable={canManage ? item : undefined} publication={item} saving={saving} onEdit={onEdit} onDelete={onDelete} onRetryPublish={(id) => void retryGithubPublish(id)} />)}
        </div>
      </div>
    </section>
  );
}
