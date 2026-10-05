import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./mom-vote.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { getMomVoteEligibility, isMomVoteCandidate, getMomVotingWindow, getMomClockDelay, getEventTimingPayload, shiftEventTiming } = compiledModule.exports;

const eligibleMember = {
  isAuthenticated: true,
  memberStatus: "active",
  isLinked: true,
  mustChangePassword: false,
  isTestAccount: false,
  window: { state: "open" },
  checkInStatus: "present",
};

test("MOM voting explains every unmet eligibility condition", () => {
  assert.deepEqual(getMomVoteEligibility({ ...eligibleMember, isAuthenticated: false }), {
    canVote: false,
    reason: "Player of the Match 투표는 로그인 후 참여할 수 있습니다.",
    action: "login",
  });
  assert.equal(getMomVoteEligibility({ ...eligibleMember, memberStatus: "pending" }).canVote, false);
  assert.equal(getMomVoteEligibility({ ...eligibleMember, window: { state: "waiting" } }).canVote, false);
  assert.equal(
    getMomVoteEligibility({ ...eligibleMember, checkInStatus: null }).reason,
    "출석이 아직 기록되지 않았습니다. 운영진에게 출석 체크를 요청해 주세요.",
  );
  assert.match(getMomVoteEligibility({ ...eligibleMember, checkInStatus: "absent" }).reason ?? "", /결석으로 기록/);
});

test("linked active non-test members with changed password can vote only in an open window", () => {
  for (const patch of [{ isLinked: false }, { mustChangePassword: true }, { isTestAccount: true }, { window: { state: "closed" } }, { window: { state: "unknown" } }]) assert.equal(getMomVoteEligibility({ ...eligibleMember, ...patch }).canVote, false);
  assert.equal(getMomVoteEligibility(eligibleMember).canVote, true);
  assert.equal(getMomVoteEligibility({ ...eligibleMember, checkInStatus: "late" }).canVote, true);
});

test("MOM candidates exclude the voter, inactive members, and unchecked members", () => {
  const candidates = [
    { id: "voter", status: "active", checkInStatus: "present" },
    { id: "inactive", status: "inactive", checkInStatus: "present" },
    { id: "unchecked", status: "active", checkInStatus: null },
    { id: "test", status: "active", isTestAccount: true, checkInStatus: "present" },
  ].filter((candidate) => isMomVoteCandidate({
    candidateProfileId: candidate.id,
    candidateStatus: candidate.status,
    candidateIsTest: candidate.isTestAccount,
    voterProfileId: "voter",
    checkInStatus: candidate.checkInStatus,
  }));

  assert.deepEqual(candidates, []);
  assert.equal(isMomVoteCandidate({
    candidateProfileId: "late-member",
    candidateStatus: "active",
    voterProfileId: "voter",
    checkInStatus: "late",
  }), true);
});

const starts = Date.parse("2026-10-04T08:00:00+09:00");
const event = { starts_at: new Date(starts).toISOString(), ends_at: null, mom_voting_days: 3 };
test("default end and 72-hour voting period use inclusive open and exclusive close boundaries", () => {
  const end = starts + 2 * 3600000;
  const close = end + 72 * 3600000;
  assert.equal(getMomVotingWindow(event, end - 1).state, "waiting");
  assert.equal(getMomVotingWindow(event, end).state, "open");
  assert.equal(getMomVotingWindow(event, close - 1).state, "open");
  assert.equal(getMomVotingWindow(event, close).state, "closed");
  assert.equal(getMomVotingWindow(event, end).defaultEnd, true);
  assert.equal(getMomClockDelay([event], close - 10), 10);
});

test("explicit end overrides default and malformed or legacy projections stay unknown", () => {
  const explicit = { ...event, ends_at: new Date(starts + 4 * 3600000).toISOString(), mom_voting_days: 1 };
  assert.equal(getMomVotingWindow(explicit, starts + 3 * 3600000).state, "waiting");
  assert.equal(getMomVotingWindow(explicit, starts + 28 * 3600000).state, "closed");
  for (const candidate of [{ starts_at: event.starts_at }, { ...event, ends_at: undefined }, { ...event, ends_at: event.starts_at }, { ...event, ends_at: "invalid" }, { ...event, mom_voting_days: undefined }, { ...event, mom_voting_days: 0 }, { ...event, mom_voting_days: 31 }, { ...event, mom_voting_days: 1.5 }, { ...event, mom_voting_days: "3" }]) assert.equal(getMomVotingWindow(candidate, starts).state, "unknown");
});

test("timing form validates end and integer period while weekly copies retain event duration", () => {
  const timing = getEventTimingPayload("2026-10-04T08:00:00+09:00", "2026-10-04T10:30:00+09:00", "30");
  assert.equal(timing.mom_voting_days, 30);
  const shifted = shiftEventTiming({ ...timing, title: "Synthetic weekly event" }, new Date(starts + 7 * 86400000));
  assert.equal(Date.parse(shifted.ends_at) - Date.parse(shifted.starts_at), 2.5 * 3600000);
  assert.equal(shifted.title, "Synthetic weekly event");
  assert.equal(shiftEventTiming({ ...event }, new Date(starts + 7 * 86400000)).ends_at, null);
  for (const days of ["", "0", "31", "1.5", "not-a-number"]) assert.throws(() => getEventTimingPayload(event.starts_at, "", days), /1~30/);
  assert.throws(() => getEventTimingPayload(event.starts_at, event.starts_at, "3"), /종료 시간/);
  assert.throws(() => getEventTimingPayload("invalid", "", "3"), /시작 시간/);
});

test("changing end or voting days recalculates the window and can reopen a closed event", () => {
  const now = starts + 80 * 3600000;
  assert.equal(getMomVotingWindow(event, now).state, "closed");
  assert.equal(getMomVotingWindow({ ...event, mom_voting_days: 4 }, now).state, "open");
  assert.equal(getMomVotingWindow({ ...event, ends_at: new Date(starts + 10 * 3600000).toISOString() }, now).state, "open");
});
