import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./season-rankings.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { buildSeasonRankings } = compiledModule.exports;

test("season awards count each event once and keep years and guests separate", () => {
  const members = [
    { id: "a", name: "가", status: "active", is_test_account: false },
    { id: "b", name: "나", status: "active", is_test_account: false },
    { id: "test", name: "시험", status: "active", is_test_account: true },
  ];
  const teams = [{ event_team_members: [{ profile_id: "a", goals: 8 }, { profile_id: "b", goals: 1 }] }];
  const events = [
    { id: "old", starts_at: "2025-12-28T00:00:00Z", event_teams: teams },
    { id: "one", starts_at: "2026-01-04T00:00:00Z", event_teams: teams, event_matches: [{ event_match_scorers: [{ profile_id: "a", goals: 2 }, { profile_id: null, goals: 3 }] }] },
    { id: "two", starts_at: "2026-01-11T00:00:00Z", event_teams: teams },
  ];
  const attendance = [
    { event_id: "one", member_id: "a", check_in_status: "present" },
    { event_id: "one", member_id: "a", check_in_status: "present" },
    { event_id: "two", member_id: "a", check_in_status: "late" },
    { event_id: "two", member_id: "b", check_in_status: "absent" },
    { event_id: "old", member_id: "b", check_in_status: "present" },
  ];
  const winners = [
    { event_id: "one", member_id: "a" }, { event_id: "one", member_id: "a" },
    { event_id: "two", member_id: "b" }, { event_id: "old", member_id: "a" },
    { event_id: "two", member_id: "test" },
  ];
  const result = buildSeasonRankings(2026, events, attendance, winners, members);
  assert.deepEqual(result.wins.map(({ member_id, count, rank }) => [member_id, count, rank]), [["a", 1, 1], ["b", 1, 1]]);
  assert.deepEqual(result.goals.map(({ member_id, count }) => [member_id, count]), [["a", 10], ["b", 1]]);
  assert.deepEqual(result.attendance.map(({ member_id, count }) => [member_id, count]), [["a", 2]]);
});

test("uses the Seoul calendar year for year-end events", () => {
  const profiles = [{ id: "a", name: "회원", status: "active", is_test_account: false }];
  const event = { id: "new-year", starts_at: "2025-12-31T23:00:00Z", event_teams: [] };
  const winners = [{ event_id: "new-year", member_id: "a" }];
  assert.equal(buildSeasonRankings(2026, [event], [], winners, profiles).wins[0].count, 1);
  assert.equal(buildSeasonRankings(2025, [event], [], winners, profiles).wins.length, 0);
});
