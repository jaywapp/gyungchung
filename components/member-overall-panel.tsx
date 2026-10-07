"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Profile } from "@/lib/types";
import { MemberOverallError, memberOverall, overallAxes, overallTargetSignature, parseMemberOverall, parseMemberOverallRows, parseOverallInputs, radarPoint, radarPolygon, type MemberOverall, type MemberOverallScores, type OverallAccess, type OverallAxis } from "@/lib/member-overall";
import "./member-overall.css";

export type MemberOverallPanelProps = { member: Profile; access: OverallAccess };
type Inputs = Record<OverallAxis, string>;
const zeroScores: MemberOverallScores = { pace: 0, shooting: 0, passing: 0, dribbling: 0, defending: 0, physical: 0 };
const scoreInputs = (scores: MemberOverallScores): Inputs => Object.fromEntries(overallAxes.map(({ key }) => [key, String(scores[key])])) as Inputs;
const defaultInputs = (): Inputs => scoreInputs(zeroScores);
type PanelState = { generation: number; status: "loading" | "ready" | "error" | "forbidden"; row: MemberOverall | null; inputs: Inputs; editing: boolean; busy: boolean; error: MemberOverallError | null; notice: string };

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
  const inputId = useId();
  const mountedRef = useRef(true);
  const mountTokenRef = useRef<object>({});
  const latestRef = useRef({ member, access });
  latestRef.current = { member, access };
  const eligible = Boolean(access.scope && access.isCurrent() && member.status === "active" && !member.is_test_account);
  const identity = JSON.stringify([access.scope, overallTargetSignature(member), eligible]);
  const contextRef = useRef({ identity, generation: 0 });
  const pendingRef = useRef<object | null>(null);
  if (contextRef.current.identity !== identity) {
    contextRef.current = { identity, generation: contextRef.current.generation + 1 };
    pendingRef.current = null;
  }
  const generation = contextRef.current.generation;
  const panelRef = useRef<HTMLElement>(null);
  const focusBoundaryRef = useRef({ identity, generation });
  const [state, setState] = useState<PanelState>({ generation: -1, status: "loading", row: null, inputs: defaultInputs(), editing: false, busy: false, error: null, notice: "" });
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
    setState({ generation, status: "loading", row: null, inputs: defaultInputs(), editing: false, busy: false, error: null, notice: "" });
    try {
      const rows = parseMemberOverallRows(await access.read([member.id], current), [member.id]);
      if (!current() || pendingRef.current !== request) return;
      const row = rows[0] ?? null;
      setState({ generation, status: "ready", row, inputs: scoreInputs(row ?? zeroScores), editing: false, busy: false, error: null, notice: "" });
    } catch (cause) {
      if (!current() || pendingRef.current !== request) return;
      const error = cause instanceof MemberOverallError ? cause : new MemberOverallError("unavailable");
      setState({ generation, status: error.kind === "forbidden" ? "forbidden" : "error", row: null, inputs: defaultInputs(), editing: false, busy: false, error, notice: "" });
    } finally { if (pendingRef.current === request) pendingRef.current = null; }
  };
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; mountTokenRef.current = {}; pendingRef.current = null; }; }, []);
  useEffect(() => {
    if (!eligible) { setState({ generation, status: "loading", row: null, inputs: defaultInputs(), editing: false, busy: false, error: null, notice: "" }); return; }
    void loadRef.current();
  }, [identity, eligible, generation]); // Scope and target changes invalidate data before this effect runs.
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== document.body || focusBoundaryRef.current.identity !== identity || focusBoundaryRef.current.generation !== generation || !focusCurrentRef.current() || !panelRef.current?.isConnected) return;
    panelRef.current.focus({ preventScroll: true });
  }, [identity, generation, visible?.status, visible?.editing]);
  const changeInput = (key: OverallAxis, value: string) => {
    if (!currentContext()() || pendingRef.current || !visible || visible.status !== "ready") return;
    setState((previous) => previous.generation === generation ? { ...previous, inputs: { ...previous.inputs, [key]: value }, error: previous.error?.kind === "invalid" ? null : previous.error, notice: "" } : previous);
  };
  const save = async () => {
    const current = currentContext();
    if (!current() || pendingRef.current || !visible || visible.status !== "ready" || !visible.editing || ["conflict", "unknown", "forbidden"].includes(visible.error?.kind ?? "")) return;
    let scores: MemberOverallScores;
    try { scores = parseOverallInputs(visible.inputs); }
    catch { setState((previous) => ({ ...previous, error: new MemberOverallError("invalid") })); return; }
    const request = {}; pendingRef.current = request;
    setState((previous) => ({ ...previous, busy: true, error: null, notice: "" }));
    try {
      const row = parseMemberOverall(await access.save(member.id, scores, visible.row?.revision ?? 0, current));
      if (!current() || pendingRef.current !== request) return;
      if (row.member_id !== member.id || row.revision !== (visible.row?.revision ?? 0) + 1 || overallAxes.some(({ key }) => row[key] !== scores[key])) throw new MemberOverallError("unknown");
      setState({ generation, status: "ready", row, inputs: scoreInputs(row), editing: false, busy: false, error: null, notice: "능력치를 저장했습니다." });
    } catch (cause) {
      if (!current() || pendingRef.current !== request) return;
      const error = cause instanceof MemberOverallError ? cause : new MemberOverallError("unknown");
      setState((previous) => error.kind === "forbidden" ? { generation, status: "forbidden", row: null, inputs: defaultInputs(), editing: false, busy: false, error, notice: "" } : { ...previous, busy: false, error });
    } finally { if (pendingRef.current === request) pendingRef.current = null; }
  };
  const edit = () => {
    if (!currentContext()() || pendingRef.current || !visible || visible.status !== "ready") return;
    setState((previous) => ({ ...previous, editing: true, error: null, notice: "" }));
  };
  const cancel = () => {
    if (!currentContext()() || pendingRef.current || !visible || visible.status !== "ready" || ["conflict", "unknown"].includes(visible.error?.kind ?? "")) return;
    setState((previous) => ({ ...previous, editing: false, inputs: scoreInputs(visible.row ?? zeroScores), error: null, notice: "" }));
  };
  if (!eligible) return null;
  if (visible?.status === "forbidden") return <p className="overall-error" role="alert">{visible.error?.message}</p>;
  return <section ref={panelRef} tabIndex={-1} className="member-overall-panel" aria-label={`${member.name} 능력치`}>
    <header className="overall-heading"><h3>회원 능력치</h3>{visible?.status === "ready" && <strong>오버롤 {memberOverall(visible.row ?? zeroScores)}<small> / 100</small></strong>}</header>
    {!visible || visible.status === "loading" ? <p className="overall-loading" role="status">능력치를 불러오는 중입니다.</p> : visible.status === "error" ? <><p className="overall-error" role="alert">{visible.error?.message}</p><button type="button" onClick={() => void load()}>다시 불러오기</button></> : <>
      <OverallRadar scores={visible.row ?? zeroScores} label={visible.row ? `${member.name}의 저장된 6개 능력치` : `${member.name}의 미평가 능력치: 각 항목 0점`} />
      {!visible.row && <p className="overall-note">아직 저장된 능력치가 없어 0으로 표시합니다. 수정 버튼을 눌러 입력할 수 있습니다.</p>}
      {visible.editing ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p id={`${inputId}-help`} className="overall-note">각 항목은 0~100 정수이며 비워 둔 항목은 0으로 저장됩니다. 오버롤은 6개 항목의 평균을 반올림합니다.</p>
        <div className="overall-inputs">{overallAxes.map(({ key, label }) => <label key={key} htmlFor={`${inputId}-${key}`}>{label}<input id={`${inputId}-${key}`} name={key} type="number" inputMode="numeric" min="0" max="100" step="1" value={visible.inputs[key]} disabled={visible.busy} aria-describedby={`${inputId}-help`} aria-invalid={visible.error?.kind === "invalid" || undefined} onChange={(event) => changeInput(key, event.target.value)} /></label>)}</div>
        {visible.error && <p className="overall-error" role="alert">{visible.error.message}</p>}
        <div className="overall-actions">{["conflict", "unknown"].includes(visible.error?.kind ?? "") ? <button type="button" onClick={() => void load()}>입력 대신 최신 값 불러오기</button> : <button type="submit" className="primary" disabled={visible.busy}>{visible.busy ? "저장 중…" : "능력치 저장"}</button>}{!["conflict", "unknown"].includes(visible.error?.kind ?? "") && <button type="button" disabled={visible.busy} onClick={cancel}>수정 취소</button>}</div>
      </form> : <button type="button" onClick={edit}>능력치 수정</button>}
      {visible.notice && <p className="overall-note" role="status">{visible.notice}</p>}
    </>}
  </section>;
}
