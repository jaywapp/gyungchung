"use client";

import { useEffect, useRef, useState } from "react";
import type { EventTeam, Profile } from "@/lib/types";
import { MemberOverallError, memberOverall, overallTargetsSignature, parseMemberOverallRows, summarizeTeamOverall, type MemberOverall, type OverallAccess } from "@/lib/member-overall";
import "./member-overall.css";

export type TeamOverallSummaryProps = { teams: EventTeam[]; access: OverallAccess; targetProfiles: Profile[]; selectedProfiles?: Profile[] };
type SummaryState = { generation: number; status: "loading" | "ready" | "error"; rows: MemberOverall[]; error: string };

export default function TeamOverallSummary({ teams, access, targetProfiles, selectedProfiles = [] }: TeamOverallSummaryProps) {
  const eligible = Boolean(access.scope && access.isCurrent());
  const targetIndex = new Map(targetProfiles.map((member) => [member.id, member]));
  const activeIds = new Set(targetProfiles.filter((member) => member.status === "active" && !member.is_test_account).map((member) => member.id));
  const profiles = selectedProfiles.flatMap((selected) => { const latest = targetIndex.get(selected.id); return latest && activeIds.has(latest.id) ? [latest] : []; });
  const targetIds = [...new Set([...teams.flatMap((team) => team.event_team_members.flatMap((member) => member.profile_id && !member.guest_player_id ? [member.profile_id] : [])), ...selectedProfiles.map((member) => member.id)])].sort();
  const targetSignature = overallTargetsSignature(targetIds, targetProfiles);
  const ids = targetIds.filter((id) => activeIds.has(id));
  const signature = JSON.stringify([targetSignature, teams.map((team) => [team.id, team.event_team_members.map((member) => [member.id, member.profile_id, member.guest_player_id])])]);
  const identity = JSON.stringify([access.scope, access.version, signature, eligible]);
  const contextRef = useRef({ identity, generation: 0 });
  const latestRef = useRef(access); latestRef.current = access;
  const targetsRef = useRef(targetProfiles); targetsRef.current = targetProfiles;
  const mountedRef = useRef(true);
  const mountTokenRef = useRef<object>({});
  const pendingRef = useRef<object | null>(null);
  if (contextRef.current.identity !== identity) { contextRef.current = { identity, generation: contextRef.current.generation + 1 }; pendingRef.current = null; }
  const generation = contextRef.current.generation;
  const panelRef = useRef<HTMLElement>(null);
  const focusBoundaryRef = useRef({ identity, generation });
  const [state, setState] = useState<SummaryState>({ generation: -1, status: "loading", rows: [], error: "" });
  const visible = state.generation === generation ? state : null;
  const currentRows = visible?.rows.filter((row) => activeIds.has(row.member_id)) ?? [];
  const load = async () => {
    const mountToken = mountTokenRef.current;
    const current = () => mountedRef.current && mountTokenRef.current === mountToken && contextRef.current.generation === generation && access.isCurrent() && latestRef.current.isCurrent() && latestRef.current.scope === access.scope && overallTargetsSignature(targetIds, targetsRef.current) === targetSignature;
    if (!eligible || !current() || pendingRef.current) return;
    const request = {}; pendingRef.current = request;
    setState({ generation, status: "loading", rows: [], error: "" });
    try {
      const rows = ids.length ? parseMemberOverallRows(await access.read(ids, current), ids) : [];
      if (!current() || pendingRef.current !== request) return;
      setState({ generation, status: "ready", rows, error: "" });
    } catch (cause) {
      if (!current() || pendingRef.current !== request) return;
      setState({ generation, status: "error", rows: [], error: cause instanceof MemberOverallError ? cause.message : "팀 능력치를 불러오지 못했습니다. 다시 시도해 주세요." });
    } finally { if (pendingRef.current === request) pendingRef.current = null; }
  };
  const loadRef = useRef(load); loadRef.current = load;
  const focusCurrentRef = useRef<() => boolean>(() => false);
  focusCurrentRef.current = () => mountedRef.current && contextRef.current.generation === generation && access.isCurrent() && latestRef.current.isCurrent() && latestRef.current.scope === access.scope && overallTargetsSignature(targetIds, targetsRef.current) === targetSignature;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; mountTokenRef.current = {}; pendingRef.current = null; }; }, []);
  useEffect(() => {
    if (!eligible) { setState({ generation, status: "loading", rows: [], error: "" }); return; }
    void loadRef.current();
  }, [identity, eligible, generation]);
  useEffect(() => {
    if (typeof document === "undefined" || document.activeElement !== document.body || focusBoundaryRef.current.identity !== identity || focusBoundaryRef.current.generation !== generation || !focusCurrentRef.current() || !panelRef.current?.isConnected) return;
    panelRef.current.focus({ preventScroll: true });
  }, [identity, generation, visible?.status]);
  if (!eligible) return null;
  return <section ref={panelRef} tabIndex={-1} className="team-overall-summary" aria-label="팀 편성 능력치 참고">
    <h3>능력치 참고</h3>
    {!visible || visible.status === "loading" ? <p className="overall-loading" role="status">선수 능력치를 불러오는 중입니다.</p> : visible.status === "error" ? <><p className="overall-error" role="alert">{visible.error}</p><button type="button" onClick={() => void load()}>다시 불러오기</button></> : <>
      <p className="overall-note">평가된 회원의 오버롤만 팀 평균에 포함합니다. 미평가 회원과 게스트는 평균에서 제외됩니다.</p>
      {teams.length ? <div className="overall-teams">{teams.map((team) => {
        const summary = summarizeTeamOverall(team, currentRows);
        return <div className="overall-team" key={team.id}><h4>{team.team_name}<strong>{summary.average === null ? "평균 없음" : `평균 ${summary.average.toFixed(1)}`}</strong></h4><p className="overall-note">평가 {summary.rated}명 / 전체 {summary.total}명 · 미평가 {summary.unrated}명</p><ul className="overall-player-list">{summary.members.map(({ member, overall }) => <li key={member.id}><span>{member.participant_name}{member.guest_player_id && <small> 게스트</small>}</span><strong>{overall ? memberOverall(overall) : "미평가"}</strong></li>)}</ul></div>;
      })}</div> : profiles.length ? <ul className="overall-player-list">{profiles.map((member) => {
        const row = currentRows.find((row) => row.member_id === member.id);
        return <li key={member.id}><span>{member.name}</span><strong>{row ? memberOverall(row) : "미평가"}</strong></li>;
      })}</ul> : <p className="overall-note">회원을 선택하거나 팀을 편성하면 능력치 참고 자료를 확인할 수 있습니다.</p>}
    </>}
  </section>;
}
