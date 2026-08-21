import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./mom-vote.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { getMomVoteEligibility, isMomVoteCandidate } = compiledModule.exports;

const eligibleMember = {
  isAuthenticated: true,
  memberStatus: "active",
  isPast: true,
  checkInStatus: "present",
};

test("MOM voting explains every unmet eligibility condition", () => {
  assert.deepEqual(getMomVoteEligibility({ ...eligibleMember, isAuthenticated: false }), {
    canVote: false,
    reason: "MOM 투표는 로그인 후 참여할 수 있습니다.",
    action: "login",
  });
  assert.equal(getMomVoteEligibility({ ...eligibleMember, memberStatus: "pending" }).canVote, false);
  assert.equal(getMomVoteEligibility({ ...eligibleMember, isPast: false }).canVote, false);
  assert.equal(
    getMomVoteEligibility({ ...eligibleMember, checkInStatus: null }).reason,
    "출석이 아직 기록되지 않았습니다. 운영진에게 출석 체크를 요청해 주세요.",
  );
  assert.match(getMomVoteEligibility({ ...eligibleMember, checkInStatus: "absent" }).reason ?? "", /결석으로 기록/);
});

test("present and late active members can vote", () => {
  assert.equal(getMomVoteEligibility(eligibleMember).canVote, true);
  assert.equal(getMomVoteEligibility({ ...eligibleMember, checkInStatus: "late" }).canVote, true);
});

test("MOM candidates exclude the voter, inactive members, and unchecked members", () => {
  const candidates = [
    { id: "voter", status: "active", checkInStatus: "present" },
    { id: "inactive", status: "inactive", checkInStatus: "present" },
    { id: "unchecked", status: "active", checkInStatus: null },
  ].filter((candidate) => isMomVoteCandidate({
    candidateProfileId: candidate.id,
    candidateStatus: candidate.status,
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
