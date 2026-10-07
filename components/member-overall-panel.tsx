"use client";

import { useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/types";
import { MemberOverallError, memberOverall, overallAxes, overallTargetSignature, parseMemberOverallRows, radarPoint, radarPolygon, type MemberOverall, type MemberOverallScores, type OverallAccess } from "@/lib/member-overall";
import "./member-overall.css";

export type MemberOverallPanelProps = { member: Profile; access: OverallAccess };
const zeroScores: MemberOverallScores = { pace: 0, shooting: 0, passing: 0, dribbling: 0, defending: 0, physical: 0 };
type PanelState = { generation: number; status: "loading" | "ready" | "error" | "forbidden"; row: MemberOverall | null; error: MemberOverallError | null; };

export function OverallRadar({ scores, label }: { scores: MemberOverallScores; label: string }) {
  return <div className="overall-radar">
    <svg viewBox="0 0 260 260" role="img" aria-label={label}>
      <title>{label}</title>
      {[25, 50, 75, 100].map((level) => <polygon key={level} className="overall-radar-grid" points={radarPolygon(Object.fromEntries(overallAxes.map(({ key }) => [key, level])) as MemberOverallScores)} />)}
      {overallAxes.map(({ key, label }, index) => {
        const end = radarPoint(index, 100); const caption = radarPoint(index, 100, 112);
        return <g key={key}><line className="overall-radar-axis" x1="130" y1="130" x2={end.x} y2={end.y} /><text x={caption.x} y={caption.y} textAnchor="middle" dominantBaseline="middle">{label}</text></g>;
      })}
      <polygon className="overall-radar-value" points={radarPolygon(scores)} />
    </svg>
    <dl className="overall-values">{overallAxes.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{scores[key]}</dd></div>)}</dl>
  </div>;
}

export default function MemberOverallPanel({ member, access }: MemberOverallPanelProps) {
  const mountedRef = useRef(true);
  const mountTokenRef = useRef<object>({});
  const latestRef = useRef({ member, access });
  latestRef.current = { member, access };
  const eligible = Boolean(access.scope && access.isCurrent() && member.status === "active" && !member.is_test_account);
  const identity = JSON.stringify([access.scope, access.version, overallTargetSignature(member), eligible]);
  const contextRef = useRef({ identity, generation: 0 });
  const pendingRef = useRef<object | null>(null);
  if (contextRef.current.identity !== identity) {
    contextRef.current = { identity, generation: contextRef.current.generation + 1 };
    pendingRef.current = null;
  }
  const generation = contextRef.current.generation;
  const panelRef = useRef<HTMLElement>(null);
  const focusBoundaryRef = useRef({ identity, generation });
  const [state, setState] = useState<PanelState>({ generation: -1, status: "loading", row: null, error: null });
  const visible = state.generation === generation ? state : null;
  const currentContext = () => {
    const actorAccess = access; const signature = overallTargetSignature(member); const capturedGeneration = generation; const mountToken = mountTokenRef.current;
    return () => mountedRef.current && mountTokenRef.current === mountToken && contextRef.current.generation === capturedGeneration && latestRef.current.access.scope === actorAccess.scope && actorAccess.isCurrent() && latestRef.current.access.isCurrent() && overallTargetSignature(latestRef.current.member) === signature && latestRef.current.member.status === "active" && !latestRef.current.member.is_test_account;
  };
  const focusCurrentRef = useRef(currentContext()); focusCurrentRef.current = currentContext();
  const load = async () => {
    const current = currentContext();
    if (!current() || pendingRef.current) return;
    const request = {}; pendingRef.current = request;
    setState({ generation, status: "loading", row: null, error: null });
    try {
      const rows = parseMemberOverallRows(await access.read([member.id], current), [member.id]);
      if (!current() || pendingRef.current !== request) return;
      const row = rows[0] ?? null;
      setState({ generation, status: "ready", row, error: null });
    } catch (cause) {
      if (!current() || pendingRef.current !== request) return;
      const error = cause instanceof MemberOverallError ? cause : new MemberOverallError("unavailable");
      setState({ generation, status: error.kind === "forbidden" ? "forbidden" : "error", row: null, error });
    } finally { if (pendingRef.current === request) pendingRef.current = null; }
  };
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; mountTokenRef.current = {}; pendingRef.current = null; }; }, []);
  useEffect(() => {
    if (!eligible) { setState({ generation, status: "loading", row: null, error: null }); return; }
    void loadRef.current();
  }, [identity, eligible, generation]); // Scope and target changes invalidate data before this effect runs.
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== document.body || focusBoundaryRef.current.identity !== identity || focusBoundaryRef.current.generation !== generation || !focusCurrentRef.current() || !panelRef.current?.isConnected) return;
    panelRef.current.focus({ preventScroll: true });
  }, [identity, generation, visible?.status]);
  if (!eligible) return null;
  if (visible?.status === "forbidden") return <p className="overall-error" role="alert">{visible.error?.message}</p>;
  return <section ref={panelRef} tabIndex={-1} className="member-overall-panel" aria-label={`${member.name} 능력치`}>
    <header className="overall-heading"><h3>회원 능력치</h3>{visible?.status === "ready" && <strong>오버롤 {memberOverall(visible.row ?? zeroScores)}<small> / 100</small></strong>}</header>
    {!visible || visible.status === "loading" ? <p className="overall-loading" role="status">능력치를 불러오는 중입니다.</p> : visible.status === "error" ? <><p className="overall-error" role="alert">{visible.error?.message}</p><button type="button" onClick={() => void load()}>다시 불러오기</button></> : <>
      <OverallRadar scores={visible.row ?? zeroScores} label={visible.row ? `${member.name}의 믹스트존 집계 6개 능력치` : `${member.name}의 미평가 능력치: 각 항목 0점`} />
      <p className="overall-note">믹스트존 평가를 바탕으로 최근 평가가 있는 10개 일정의 능력치를 집계합니다. 일정별 평균에 같은 비중을 적용하며 1~5점을 100점 척도로 환산합니다.</p>
      {visible.row ? <p className="overall-note">평가 {visible.row.response_count ?? 0}건 · 일정 {visible.row.event_count ?? 0}개</p> : <p className="overall-note">아직 믹스트존 평가가 없어 0으로 표시합니다. 팀 평균 계산에서는 미평가 회원으로 처리합니다.</p>}
    </>}
  </section>;
}
