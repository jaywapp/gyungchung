"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Attendance, Event, Profile } from "@/lib/types";
import { overallAxes, type OverallAxis } from "@/lib/member-overall";
import { emptyMixedZoneInputs, getMixedZoneWindow, isMixedZoneScores, isMixedZoneTarget, mixedZoneEligibility, mixedZoneEventSignature, mixedZoneMemberSignature, MixedZoneError, parseMixedZoneEntry, parseMixedZoneRows, type MixedZoneAccess, type MixedZoneEntry, type MixedZoneInputs } from "@/lib/mixed-zone";
import "./mixed-zone.css";

type Props = { event: Event; profiles: Profile[]; attendance: Attendance[]; actor: Profile | null; owner: string | null; access: MixedZoneAccess | null; pending: boolean; onRetry: () => void };
type PanelState = { generation: number; status: "loading" | "ready" | "error" | "forbidden"; rows: MixedZoneEntry[]; selected: string; inputs: MixedZoneInputs; busy: boolean; error: MixedZoneError | null; notice: string };
const initialState = (generation: number): PanelState => ({ generation, status: "loading", rows: [], selected: "", inputs: emptyMixedZoneInputs(), busy: false, error: null, notice: "" });
const entryInputs = (entry?: MixedZoneEntry): MixedZoneInputs => entry ? Object.fromEntries(overallAxes.map(({ key }) => [key, entry[key]])) as MixedZoneInputs : emptyMixedZoneInputs();
const dataSignature = ({ event, profiles, attendance, actor, owner }: Props) => JSON.stringify([owner, mixedZoneMemberSignature(actor), mixedZoneEventSignature(event), profiles.map(mixedZoneMemberSignature), attendance.filter((row) => row.event_id === event.id).map((row) => [row.member_id, row.check_in_status, row.checked_in_at])]);

export default function MixedZonePanel(props: Props) {
  const { event, profiles, attendance, actor, owner, access, pending, onRetry } = props;
  const inputId = useId();
  const [now, setNow] = useState(() => Date.now());
  const latestRef = useRef(props); latestRef.current = props;
  const mountedRef = useRef(true), mountTokenRef = useRef<object>({}), requestRef = useRef<object | null>(null);
  const eligibility = mixedZoneEligibility(actor, owner, event, attendance, now);
  const eligible = !pending && Boolean(access?.scope && access.isCurrent()) && eligibility.canRead;
  const identity = JSON.stringify([access?.scope, dataSignature(props), eligible]);
  const contextRef = useRef({ identity, generation: 0 });
  if (contextRef.current.identity !== identity) { contextRef.current = { identity, generation: contextRef.current.generation + 1 }; requestRef.current = null; }
  const generation = contextRef.current.generation;
  const selectionRef = useRef({ memberId: "", generation: 0 });
  const selectionGeneration = selectionRef.current.generation;
  const panelRef = useRef<HTMLElement>(null);
  const focusBoundaryRef = useRef({ identity, generation });
  const [state, setState] = useState<PanelState>(() => initialState(-1));
  const visible = state.generation === generation ? state : null;
  const targets = profiles.filter((member) => isMixedZoneTarget(member, actor?.id ?? null, event.id, attendance)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const selectedTarget = targets.find((member) => member.id === visible?.selected);
  const currentContext = (targetId?: string, writing = false) => {
    const signature = dataSignature(props), scope = access?.scope, mountToken = mountTokenRef.current, capturedGeneration = generation;
    return () => {
      const latest = latestRef.current;
      if (!mountedRef.current || mountTokenRef.current !== mountToken || contextRef.current.generation !== capturedGeneration || latest.pending || !access?.isCurrent() || latest.access?.scope !== scope || !latest.access?.isCurrent() || dataSignature(latest) !== signature) return false;
      const fresh = mixedZoneEligibility(latest.actor, latest.owner, latest.event, latest.attendance, Date.now());
      if (!fresh.canRead || (writing && !fresh.canWrite)) return false;
      if (targetId) { if (selectionRef.current.memberId !== targetId || selectionRef.current.generation !== selectionGeneration) return false; const target = latest.profiles.find((member) => member.id === targetId); if (!target || !isMixedZoneTarget(target, latest.actor?.id ?? null, latest.event.id, latest.attendance)) return false; }
      return true;
    };
  };
  const load = async (refresh = false) => {
    const current = currentContext();
    if (!access || !current() || requestRef.current) return;
    const request = {}; requestRef.current = request;
    selectionRef.current = { memberId: "", generation: selectionRef.current.generation + 1 };
    setState(initialState(generation));
    try {
      if (refresh) { await access.refreshWindow(); if (!current() || requestRef.current !== request) return; }
      const rows = parseMixedZoneRows(await access.read(event.id, current), event.id);
      if (!current() || requestRef.current !== request) return;
      setState({ ...initialState(generation), status: "ready", rows });
    } catch (cause) {
      if (!current() || requestRef.current !== request) return;
      const error = cause instanceof MixedZoneError ? cause : new MixedZoneError("unavailable");
      setState({ ...initialState(generation), status: error.kind === "forbidden" ? "forbidden" : "error", error });
    } finally { if (requestRef.current === request) requestRef.current = null; }
  };
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; mountTokenRef.current = {}; requestRef.current = null; }; }, []);
  useEffect(() => { if (eligible) void loadRef.current(); else setState(initialState(generation)); }, [identity, eligible, generation, access?.version]);
  const focusCurrentRef = useRef(currentContext()); focusCurrentRef.current = currentContext();
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== document.body || focusBoundaryRef.current.identity !== identity || focusBoundaryRef.current.generation !== generation || !focusCurrentRef.current() || !panelRef.current?.isConnected) return;
    panelRef.current.focus({ preventScroll: true });
  }, [identity, generation, visible?.status]);
  const previousWindowRef = useRef(getMixedZoneWindow(event, now).state);
  const lastReadAtRef = useRef(Date.now());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = (returning = false) => {
      const time = Date.now(), windowState = getMixedZoneWindow(latestRef.current.event, time).state;
      const crossed = previousWindowRef.current !== windowState;
      previousWindowRef.current = windowState;
      setNow(time);
      if (crossed || (returning && time - lastReadAtRef.current >= 60_000)) { lastReadAtRef.current = time; void loadRef.current(true); }
    };
    const windowState = getMixedZoneWindow(event, now);
    const boundaries = [windowState.opensAt, windowState.closesAt].filter((value): value is number => value !== null && value > now);
    const delay = Math.max(1, Math.min(60_000, ...boundaries.map((value) => value - now)) - (Date.now() - now));
    const timer = window.setTimeout(() => tick(), delay);
    const focus = () => tick(true), visibility = () => { if (document.visibilityState === "visible") tick(true); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, [now, identity, event]);
  const select = (memberId: string) => {
    if (!currentContext()() || requestRef.current || visible?.status !== "ready" || (memberId && !targets.some((member) => member.id === memberId)) || ["conflict", "unknown", "forbidden"].includes(visible.error?.kind ?? "")) return;
    selectionRef.current = { memberId, generation: selectionRef.current.generation + 1 };
    setState((previous) => ({ ...previous, selected: memberId, inputs: entryInputs(previous.rows.find((row) => row.member_id === memberId)), error: null, notice: "" }));
  };
  const change = (key: OverallAxis, value: number) => {
    if (!selectedTarget || !currentContext(selectedTarget.id, true)() || requestRef.current || visible?.status !== "ready" || ["conflict", "unknown", "forbidden"].includes(visible.error?.kind ?? "")) return;
    setState((previous) => ({ ...previous, inputs: { ...previous.inputs, [key]: value }, error: null, notice: "" }));
  };
  const save = async () => {
    const targetId = visible?.selected;
    if (selectionRef.current.memberId !== targetId || selectionRef.current.generation !== selectionGeneration) return;
    if (!access || !targetId || requestRef.current || visible?.status !== "ready" || ["conflict", "unknown", "forbidden"].includes(visible.error?.kind ?? "")) return;
    const writeCurrent = currentContext(targetId, true), current = currentContext(targetId);
    if (!writeCurrent()) { setNow(Date.now()); return; }
    const scores = { ...visible.inputs };
    if (!isMixedZoneScores(scores)) { setState((previous) => ({ ...previous, error: new MixedZoneError("invalid") })); return; }
    const revision = visible.rows.find((row) => row.member_id === targetId)?.revision ?? 0;
    const request = {}; requestRef.current = request;
    setState((previous) => ({ ...previous, busy: true, error: null, notice: "" }));
    try {
      const row = parseMixedZoneEntry(await access.save(event.id, targetId, scores, revision, current));
      if (!current() || requestRef.current !== request) return;
      if (row.event_id !== event.id || row.member_id !== targetId || row.revision !== revision + 1 || overallAxes.some(({ key }) => row[key] !== scores[key])) throw new MixedZoneError("unknown");
      setState((previous) => ({ ...previous, rows: [...previous.rows.filter((entry) => entry.member_id !== targetId), row], inputs: entryInputs(row), busy: false, notice: "믹스트존 평가를 저장했습니다." }));
    } catch (cause) {
      if (!current() || requestRef.current !== request) return;
      const error = cause instanceof MixedZoneError ? cause : new MixedZoneError("unknown");
      setState((previous) => error.kind === "forbidden" ? { ...initialState(generation), status: "forbidden", error } : { ...previous, busy: false, error });
    } finally { if (requestRef.current === request) { requestRef.current = null; if (current()) setNow(Date.now()); } }
  };
  if (!owner) return null;
  const windowState = getMixedZoneWindow(event, now);
  const blocked = !eligibility.canWrite || visible?.busy || ["conflict", "unknown", "forbidden"].includes(visible?.error?.kind ?? "");
  const row = visible?.rows.find((entry) => entry.member_id === visible.selected);
  return <section ref={panelRef} tabIndex={-1} className="event-detail-block mixed-zone-panel" aria-labelledby={inputId + "-heading"} aria-busy={visible?.busy || undefined}>
    <h3 id={inputId + "-heading"}>믹스트존</h3>
    <p className="mixed-zone-description">함께 뛴 회원의 여섯 능력치를 1~5점으로 평가해 주세요. 평가할 회원을 자유롭게 선택할 수 있으며, 내가 작성한 내용만 확인할 수 있습니다.</p>
    {windowState.closesAt !== null && <p className="mixed-zone-period">작성 마감 <time dateTime={new Date(windowState.closesAt).toISOString()}>{new Date(windowState.closesAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> · 종료 후 {windowState.days}일</p>}
    {pending ? <p role="status">작성 자격을 확인하는 중입니다.</p> : !eligible ? <p className="event-detail-gate">{eligibility.reason ?? "계정과 일정 정보를 다시 불러와 주세요."} <button type="button" className="text-link" onClick={onRetry}>다시 불러오기</button></p> : !visible || visible.status === "loading" ? <p role="status">내가 작성한 내용을 불러오는 중입니다.</p> : visible.status === "error" || visible.status === "forbidden" ? <><p className="mixed-zone-error" role="alert">{visible.error?.message}</p><button type="button" onClick={() => void load(true)}>작성 내용 다시 불러오기</button></> : <>
      {eligibility.reason && <p className="event-detail-gate">{eligibility.reason}</p>}
      {targets.length === 0 ? <p className="event-detail-gate">평가할 수 있는 다른 출석 회원이 없습니다.</p> : <>
        <div className="mixed-zone-target"><label htmlFor={inputId + "-target"}>평가할 회원</label><select id={inputId + "-target"} value={visible.selected} disabled={visible.busy || ["conflict", "unknown"].includes(visible.error?.kind ?? "")} onChange={(event) => select(event.target.value)}><option value="">회원을 선택해 주세요</option>{targets.map((member) => <option key={member.id} value={member.id}>{member.name}{visible.rows.some((entry) => entry.member_id === member.id) ? " · 작성 완료" : ""}</option>)}</select></div>
        {selectedTarget && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <p id={inputId + "-help"} className="mixed-zone-description">{selectedTarget.name} · {row ? "내가 작성한 평가" : "아직 작성하지 않은 평가"}. 모든 항목을 선택해야 저장할 수 있습니다.</p>
          <div className="mixed-zone-scores">{overallAxes.map(({ key, label }) => <fieldset key={key} disabled={blocked} aria-describedby={inputId + "-help"}><legend>{label}</legend><div className="mixed-zone-scale">{[1, 2, 3, 4, 5].map((value) => <label key={value}><input type="radio" name={inputId + "-" + key} value={value} checked={visible.inputs[key] === value} aria-label={label + " " + value + "점"} onChange={() => change(key, value)} /><span>{value}</span></label>)}</div></fieldset>)}</div>
          {visible.error && <p className="mixed-zone-error" role="alert">{visible.error.message}</p>}
          <div className="mixed-zone-actions">{["conflict", "unknown"].includes(visible.error?.kind ?? "") ? <button type="button" onClick={() => void load(true)}>작성 내용 다시 불러오기</button> : eligibility.canWrite && <button type="submit" className="primary" disabled={Boolean(blocked) || !isMixedZoneScores(visible.inputs)}>{visible.busy ? "저장 중…" : row ? "평가 수정 저장" : "평가 저장"}</button>}</div>
          {row && <p className="mixed-zone-period">저장일 <time dateTime={row.updated_at}>{new Date(row.updated_at).toLocaleString("ko-KR")}</time></p>}
        </form>}
      </>}
      {visible.notice && <p className="mixed-zone-description" role="status">{visible.notice}</p>}
    </>}
  </section>;
}
