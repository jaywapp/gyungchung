import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, imports = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("exports", "require", output)(exports, (name) => name.endsWith(".css") ? {} : imports[name] ?? require(name));
  return exports;
}
const domain = load("./member-overall.ts");
const member = (id = "member-a", extra = {}) => ({ id, name: `합성 회원 ${id}`, auth_user_id: null, status: "active", is_test_account: false, ...extra });
const scores = (value = 70) => Object.fromEntries(domain.overallAxes.map(({ key }) => [key, value]));
const row = (id = "member-a", value = 70, revision = 1) => ({ ...scores(value), member_id: id, revision, updated_at: "2026-10-07T01:00:00+00:00" });
const team = (ids) => ({ id: "team-a", team_name: "합성 팀", event_team_members: ids.map((id, index) => ({ id: `slot-${index}`, profile_id: id, guest_player_id: id ? null : "guest-a", participant_name: id ? `합성 회원 ${id}` : "합성 게스트" })) });
function deferred() { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

// Exercise the complete production component, including real JSX and hook callbacks.
// The hook adapter models commit/effect boundaries so stale rendering can be tested before effects.
function harness(path) {
  const slots = []; const effects = []; let cursor = 0; let nextEffects = []; let tree;
  const hooks = {
    useId: () => { const index = cursor++; return slots[index] ??= `test-${index}`; },
    useRef: (value) => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect: (callback, dependencies) => { const index = cursor++; const before = effects[index]; if (!before || dependencies.some((value, i) => !Object.is(value, before.dependencies[i]))) nextEffects.push({ index, callback, dependencies }); },
  };
  const componentModule = load(path, { react: hooks, "@/lib/member-overall": domain });
  const Component = componentModule.default;
  return {
    render(props) { cursor = 0; nextEffects = []; tree = Component(props); return renderToStaticMarkup(tree); },
    commit() { const pending = nextEffects; nextEffects = []; for (const effect of pending) { effects[effect.index]?.cleanup?.(); effects[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; } },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
    replayEffects() { for (const effect of effects) effect?.cleanup?.(); effects.length = 0; },
    find(type, predicate = () => true) { const matches = []; const visit = (node) => { if (!node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(visit); return; } if (node.type === type && predicate(node.props)) matches.push(node); visit(node.props?.children); }; visit(tree); return matches; },
  };
}
function fixture(path = "../components/member-overall-panel.tsx", extra = {}) {
  const calls = []; const state = { current: true };
  const access = { scope: "actor-A/1", version: 0, isCurrent: () => state.current, read: async (ids, current) => { calls.push(["read", ids, current]); return []; }, save: async (id, values, revision, current) => { calls.push(["save", id, values, revision, current]); return { ...row(id, 70, revision + 1), ...values }; }, ...extra };
  const view = harness(path); const props = { member: member(), access };
  return { view, props, access, calls, state, async ready() { view.render(props); view.commit(); await settle(); return view.render(props); }, edit() { view.find("button", (props) => props.children === "능력치 수정")[0].props.onClick(); view.render(props); view.commit(); }, async change(values) { for (const [key, value] of Object.entries(values)) { view.find("input", (props) => props.name === key)[0].props.onChange({ target: { value: String(value) } }); view.render(props); } }, async submit() { const form = view.find("form")[0]; form.props.onSubmit({ preventDefault() {} }); await settle(); } };
}

test("scores accept all six integer axes from zero to 100 and reject extra fields and malformed RPC rows", () => {
  assert.equal(domain.isOverallScores(scores(0)), true); assert.equal(domain.isOverallScores(scores(100)), true);
  for (const invalid of [{ ...scores(), pace: -1 }, { ...scores(), pace: 101 }, { ...scores(), pace: 1.5 }, { ...scores(), pace: "70" }, { ...scores(), extra: 1 }, { ...scores(), pace: null }, {}]) assert.equal(domain.isOverallScores(invalid), false);
  const inputs = Object.fromEntries(domain.overallAxes.map(({ key }) => [key, "70"]));
  assert.deepEqual(domain.parseOverallInputs(inputs), scores());
  for (const value of ["", "0"]) assert.deepEqual(domain.parseOverallInputs({ ...inputs, pace: value }), { ...scores(), pace: 0 });
  assert.deepEqual(domain.parseMemberOverallRows([row("member-a", 0)], ["member-a"]), [row("member-a", 0)]);
  for (const value of ["1.2", "1e2", " 70 ", "101", "-1"]) assert.throws(() => domain.parseOverallInputs({ ...inputs, pace: value }), domain.MemberOverallError);
  assert.deepEqual(domain.parseMemberOverallRows([row()], ["member-a"]), [row()]);
  for (const value of [null, {}, [row(), row()], [row("other")], [{ ...row(), revision: 0 }], [{ ...row(), updated_at: "invalid" }], [{ ...row(), physical: 50.2 }]]) assert.throws(() => domain.parseMemberOverallRows(value, ["member-a"]), domain.MemberOverallError);
});

test("member mean rounds once and team mean excludes guests and unrated members", () => {
  assert.equal(domain.memberOverall({ ...scores(70), physical: 73 }), 71);
  const summary = domain.summarizeTeamOverall(team(["a", "b", "missing", null]), [row("a", 71), row("b", 80), row("guest-a", 100)]);
  assert.equal(summary.average, 75.5); assert.equal(summary.rated, 2); assert.equal(summary.total, 4); assert.equal(summary.unrated, 2);
  assert.equal(domain.summarizeTeamOverall(team(["missing", null]), []).average, null);
  const zero = domain.summarizeTeamOverall(team(["a", "b", "missing", null]), [row("a", 0), row("b", 100)]);
  assert.equal(zero.average, 50); assert.equal(zero.rated, 2); assert.equal(zero.unrated, 2); assert.equal(domain.memberOverall(scores(0)), 0);
});

test("radar has six ordered vertices and real rendered numeric alternatives", () => {
  const { OverallRadar } = load("../components/member-overall-panel.tsx", { "@/lib/member-overall": domain });
  const html = renderToStaticMarkup(React.createElement(OverallRadar, { scores: scores(71), label: "합성 회원 능력치" }));
  assert.match(html, /viewBox="0 0 260 260"/); assert.match(html, /role="img"/); assert.match(html, /<dl/);
  assert.equal((html.match(/<dt>/g) ?? []).length, 6); assert.equal((html.match(/<dd>71/g) ?? []).length, 6);
  assert.equal(domain.radarPolygon(scores()).split(" ").length, 6); assert.deepEqual(domain.radarPoint(0, 100), { x: 130, y: 50 });
});

test("team summary renders counts, one-decimal averages, guest exclusion and selection preview", async () => {
  const f = fixture("../components/team-overall-summary.tsx", { read: async () => [row("a", 71), row("b", 80)] }); f.props = { teams: [team(["a", "b", "missing", null])], targetProfiles: [member("a"), member("b"), member("missing")], access: f.access };
  f.view.render(f.props); f.view.commit(); await settle(); const html = f.view.render(f.props);
  assert.match(html, /평균 75.5/); assert.match(html, /평가 2명 \/ 전체 4명/); assert.match(html, /미평가 2명/); assert.match(html, /게스트/);
  const preview = fixture("../components/team-overall-summary.tsx", { read: async () => [row("a", 71)] }); preview.props = { teams: [], targetProfiles: [member("a"), member("b")], selectedProfiles: [member("a"), member("b")], access: preview.access }; preview.view.render(preview.props); preview.view.commit(); await settle(); const previewHtml = preview.view.render(preview.props); assert.match(previewHtml, /합성 회원 a/); assert.match(previewHtml, /71/); assert.match(previewHtml, /미평가/);
});

test("team version and membership changes hide stale scores before effects and revoked access does not read", async () => {
  const f = fixture("../components/team-overall-summary.tsx", { read: async () => [row("a", 87)] }); f.props = { teams: [team(["a"])], targetProfiles: [member("a"), member("b")], access: f.access }; f.view.render(f.props); f.view.commit(); await settle(); assert.match(f.view.render(f.props), /평균 87.0/);
  f.props.access = { ...f.access, version: 1 }; assert.doesNotMatch(f.view.render(f.props), /평균 87.0/); f.view.commit(); await settle(); assert.match(f.view.render(f.props), /평균 87.0/);
  f.props.teams = [team(["a", "b"])]; assert.doesNotMatch(f.view.render(f.props), /평균 87.0/);
  const denied = fixture("../components/team-overall-summary.tsx"); denied.state.current = false; denied.props = { teams: [team(["a"])], targetProfiles: [member("a")], access: denied.access }; assert.equal(denied.view.render(denied.props), ""); denied.view.commit(); await settle(); assert.equal(denied.calls.length, 0);
});

test("late panel reads cannot cross target or actor generations before replacement effects", async () => {
  for (const change of [(f) => { f.props.member = member("other"); }, (f) => { f.props.access = { ...f.access, scope: "actor-B/2" }; }]) {
    const gate = deferred(); const f = fixture(undefined, { read: () => gate.promise }); f.view.render(f.props); f.view.commit(); change(f); f.view.render(f.props);
    f.props.member = member(); f.props.access = f.access; f.view.render(f.props); gate.resolve([row("member-a", 87)]); await settle(); assert.doesNotMatch(f.view.render(f.props), /오버롤 87/);
  }
});

test("team empty evaluation is distinct from loading and RPC failure", async () => {
  const empty = fixture("../components/team-overall-summary.tsx"); empty.props = { teams: [team(["a", null])], targetProfiles: [member("a")], access: empty.access }; assert.doesNotMatch(empty.view.render(empty.props), /미평가 2명/); empty.view.commit(); await settle(); const html = empty.view.render(empty.props); assert.match(html, /평균 없음/); assert.match(html, /평가 0명 \/ 전체 2명/); assert.match(html, /미평가 2명/);
  const failed = fixture("../components/team-overall-summary.tsx", { read: async () => { throw new domain.MemberOverallError("unavailable"); } }); failed.props = { teams: [team(["a"])], targetProfiles: [member("a")], access: failed.access }; failed.view.render(failed.props); failed.view.commit(); await settle(); const failedHtml = failed.view.render(failed.props); assert.match(failedHtml, /다시 불러오기/); assert.doesNotMatch(failedHtml, /평균 없음|평가 0명/);
});

test("saved team target inactivity, hidden state and directory removal immediately invalidate rated counts and averages", async () => {
  for (const targetProfiles of [[member("a", { status: "inactive" })], [member("a", { is_test_account: true })], []]) {
    let reads = 0;
    const f = fixture("../components/team-overall-summary.tsx", { read: async () => { reads++; return [row("a", 87)]; } });
    f.props = { teams: [team(["a", null])], targetProfiles: [member("a")], access: f.access };
    f.view.render(f.props); f.view.commit(); await settle(); assert.match(f.view.render(f.props), /평균 87.0/);
    f.props.targetProfiles = targetProfiles;
    const beforeEffects = f.view.render(f.props); assert.doesNotMatch(beforeEffects, /평균 87.0|평가 1명/);
    f.view.commit(); await settle(); const updated = f.view.render(f.props);
    assert.match(updated, /평균 없음/); assert.match(updated, /평가 0명 \/ 전체 2명/); assert.match(updated, /미평가 2명/); assert.doesNotMatch(updated, />87</); assert.equal(reads, 1);
  }
});

test("target lifecycle ABA rejects pending team replies even before replacement effects", async () => {
  for (const targetProfiles of [[member("a", { status: "inactive" })], [member("a", { is_test_account: true })], [], [member("a", { auth_user_id: "relinked" })]]) {
    const gate = deferred(); const guards = [];
    const f = fixture("../components/team-overall-summary.tsx", { read: (ids, current) => { guards.push(current); return gate.promise; } });
    f.props = { teams: [team(["a"])], targetProfiles: [member("a")], access: f.access };
    f.view.render(f.props); f.view.commit(); f.props.targetProfiles = targetProfiles; f.view.render(f.props);
    assert.equal(guards[0](), false);
    f.props.targetProfiles = [member("a")]; assert.doesNotMatch(f.view.render(f.props), /평균 87.0|평가 1명/); assert.equal(guards[0](), false);
    gate.resolve([row("a", 87)]); await settle(); assert.doesNotMatch(f.view.render(f.props), /평균 87.0|평가 1명/);
  }
});

test("team read rechecks target stamps when a profile changes without an intervening render", async () => {
  const gate = deferred(); const targets = [member("a")]; let guard;
  const f = fixture("../components/team-overall-summary.tsx", { read: (ids, current) => { guard = current; return gate.promise; } });
  f.props = { teams: [team(["a"])], targetProfiles: targets, access: f.access }; f.view.render(f.props); f.view.commit();
  targets[0].status = "inactive"; assert.equal(guard(), false); gate.resolve([row("a", 87)]); await settle(); assert.doesNotMatch(f.view.render(f.props), /평균 87.0|평가 1명/);
});

test("selected preview uses the full current directory as target authority", async () => {
  const calls = [];
  const f = fixture("../components/team-overall-summary.tsx", { read: async (ids) => { calls.push(ids); return [row("a", 87)]; } });
  f.props = { teams: [], targetProfiles: [member("a"), member("b", { status: "inactive" }), member("c", { is_test_account: true })], selectedProfiles: [member("a"), member("b"), member("c"), member("missing")], access: f.access };
  f.view.render(f.props); f.view.commit(); await settle(); const html = f.view.render(f.props);
  assert.deepEqual(calls, [["a"]]); assert.match(html, /합성 회원 a/); assert.doesNotMatch(html, /합성 회원 b|합성 회원 c|합성 회원 missing/);
  f.props.targetProfiles = [member("a", { is_test_account: true })]; assert.doesNotMatch(f.view.render(f.props), />87</);
});

async function withFocusDocument(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const body = {}; const document = { body, activeElement: {} };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  try { await run(document); }
  finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document; }
}
function attachFocusPanel(view, document, calls) {
  const section = view.find("section")[0]; assert.equal(section.props.tabIndex, -1);
  const node = { isConnected: true, focus: (options) => { calls.push(options); document.activeElement = node; } };
  section.props.ref.current = node; return node;
}

test("member and team retry subtree replacement restore body focus to a stable section without stealing user focus", async () => {
  await withFocusDocument(async (document) => {
    for (const path of ["../components/member-overall-panel.tsx", "../components/team-overall-summary.tsx"]) {
      const focusCalls = []; let reads = 0; const userFocused = {}; document.activeElement = userFocused;
      const f = fixture(path, { read: async () => { if (++reads === 1) throw new domain.MemberOverallError("unavailable"); return [row()]; } });
      if (path.includes("team-")) f.props = { teams: [team(["member-a"])], targetProfiles: [member()], access: f.access };
      f.view.render(f.props); const node = attachFocusPanel(f.view, document, focusCalls); f.view.commit(); await settle();
      f.view.render(f.props); f.view.commit(); assert.equal(focusCalls.length, 0); assert.equal(document.activeElement, userFocused);
      f.view.find("button", (props) => props.children === "다시 불러오기")[0].props.onClick();
      document.activeElement = document.body;
      f.view.render(f.props); assert.equal(f.view.find("section")[0].props.ref.current, node); f.view.commit();
      assert.equal(document.activeElement, node); assert.deepEqual(focusCalls, [{ preventScroll: true }]);
      await settle(); document.activeElement = userFocused; f.view.render(f.props); f.view.commit();
      assert.equal(document.activeElement, userFocused); assert.equal(focusCalls.length, 1);
    }
  });
});

test("focus recovery cannot cross actor or target contexts, an unmount or a disconnected panel", async () => {
  await withFocusDocument(async (document) => {
    for (const path of ["../components/member-overall-panel.tsx", "../components/team-overall-summary.tsx"]) {
      for (const change of ["actor", "target", "unmount", "disconnected"]) {
        document.activeElement = {}; const calls = []; const f = fixture(path);
        if (path.includes("team-")) f.props = { teams: [team(["member-a"])], targetProfiles: [member()], access: f.access };
        f.view.render(f.props); const node = attachFocusPanel(f.view, document, calls); f.view.commit(); await settle();
        if (change === "actor") f.props.access = { ...f.access, scope: "actor-B/2" };
        if (change === "target") { if (path.includes("team-")) f.props.targetProfiles = [member("member-a", { auth_user_id: "changed" })]; else f.props.member = member("other"); }
        if (change === "unmount") f.view.unmount();
        if (change === "disconnected") node.isConnected = false;
        document.activeElement = document.body; f.view.render(f.props); f.view.commit(); await settle(); f.view.render(f.props); f.view.commit();
        assert.equal(calls.length, 0, `${path} ${change}`); assert.equal(document.activeElement, document.body);
      }
    }
  });
});


test("mixed zone overall panel always shows zero graph without an editor and distinguishes lookup failures", async () => {
  const f=fixture(); const html=await f.ready();
  assert.match(html,/아직 믹스트존 평가가 없어/); assert.match(html,/오버롤 0/); assert.match(html,/<svg/); assert.equal((html.match(/<dd>0/g)??[]).length,6); assert.equal(f.view.find("input").length,0); assert.equal(f.view.find("form").length,0); assert.doesNotMatch(html,/능력치 수정/);
  const rated=fixture(undefined,{read:async()=>[{...row(),response_count:14,event_count:4}]}); const ratedHtml=await rated.ready();assert.match(ratedHtml,/평가 14건 · 일정 4개/);assert.match(ratedHtml,/최근 평가가 있는 10개 일정/);assert.match(ratedHtml,/오버롤 70/);assert.equal(rated.view.find("button").length,0);
  const failed=fixture(undefined,{read:async()=>{throw Error('synthetic failure')}});const failedHtml=await failed.ready();assert.match(failedHtml,/다시 불러오기/);assert.doesNotMatch(failedHtml,/<svg|오버롤 0/);
});
test("mixed zone aggregate parser requires positive consistent sample metadata",()=>{
  const aggregate={...row(),response_count:14,event_count:4};assert.deepEqual(domain.parseMixedZoneOveralls([aggregate]),[aggregate]);
  for(const patch of [{response_count:undefined},{event_count:undefined},{response_count:0},{event_count:0},{event_count:11},{event_count:15},{response_count:1.5}])assert.throws(()=>domain.parseMixedZoneOveralls([{...aggregate,...patch}]),domain.MemberOverallError);
});
test("read only overall panel refreshes on aggregate version changes and rejects old generation replies",async()=>{
  let reads=0;const f=fixture(undefined,{read:async()=>{reads++;return[row('member-a',reads===1?70:80)]}});await f.ready();f.props.access={...f.access,version:1};assert.doesNotMatch(f.view.render(f.props),/오버롤 70/);f.view.commit();await settle();assert.match(f.view.render(f.props),/오버롤 80/);assert.equal(reads,2);
  const gate=deferred();let count=0;const strict=fixture(undefined,{read:async()=>++count===1?gate.promise:[row('member-a',76)]});strict.view.render(strict.props);strict.view.commit();strict.view.replayEffects();strict.view.render(strict.props);strict.view.commit();await settle();gate.resolve([row('member-a',87)]);await settle();assert.match(strict.view.render(strict.props),/오버롤 76/);assert.doesNotMatch(strict.view.render(strict.props),/오버롤 87/);
});
test("overall access revocation and actor ABA immediately hide aggregate results",async()=>{
  for(const mutate of [f=>{f.props.access={...f.access,scope:'actor-B/2'}},f=>{f.props.member=member('other')},f=>{f.state.current=false},f=>{f.props.member=member('member-a',{status:'inactive'})}]){
    const f=fixture(undefined,{read:async()=>[row('member-a',87)]});await f.ready();mutate(f);assert.doesNotMatch(f.view.render(f.props),/오버롤 87/);f.props.access=f.access;f.props.member=member();f.state.current=true;assert.doesNotMatch(f.view.render(f.props),/오버롤 87/);
  }
  const gate=deferred();const f=fixture(undefined,{read:()=>gate.promise});f.view.render(f.props);f.view.commit();f.view.unmount();gate.resolve([row('member-a',87)]);await settle();assert.doesNotMatch(f.view.render(f.props),/오버롤 87/);
});
