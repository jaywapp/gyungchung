import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./rsvp.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const compiledModule = { exports: {} };
new Function("exports", "module", output.outputText)(compiledModule.exports, compiledModule);
const { applyRsvpStatus, beginRsvpSave, getRsvpCapacityWarning, getRsvpViewModel, restoreRsvpStatus } = compiledModule.exports;

const future = "2030-01-02T10:00:00.000Z";
const now = new Date("2030-01-01T10:00:00.000Z").getTime();
const readyMember = { isAuthenticated: true, memberStatus: "active", startsAt: future, now };

test("models going, not-going, and cancelled RSVP states consistently", () => {
  assert.deepEqual(getRsvpViewModel({ ...readyMember, status: "going" }), {
    state: "ready", label: "참석", message: "참석 예정으로 등록되어 있습니다.", canRespond: true,
  });
  assert.equal(getRsvpViewModel({ ...readyMember, status: "not_going" }).label, "불참");
  assert.equal(getRsvpViewModel({ ...readyMember, status: "undecided" }).label, "응답 없음");
  assert.equal(getRsvpViewModel({ ...readyMember, status: null }).label, "응답 없음");
});

test("explains signed-out, saving, membership, and closed states", () => {
  assert.equal(getRsvpViewModel({ ...readyMember, status: null, isAuthenticated: false }).state, "signed_out");
  assert.match(getRsvpViewModel({ ...readyMember, status: "going", isSaving: true }).message, /저장하는 중/);
  const restricted = getRsvpViewModel({
    ...readyMember,
    status: null,
    memberStatus: "pending",
    membershipRestrictionCopy: { label: "승인 대기", action: "운영진에게 승인 상태를 문의해 주세요." },
  });
  assert.equal(restricted.label, "승인 대기");
  assert.match(restricted.message, /승인 상태/);
  const closed = getRsvpViewModel({ ...readyMember, startsAt: "2030-01-01T09:59:59.000Z", status: "not_going" });
  assert.equal(closed.state, "closed");
  assert.match(closed.message, /마감/);
});

test("applies every RSVP transition and restores the previous row after failure", () => {
  const original = [{ event_id: "event-1", member_id: "member-1", status: "going", check_in_status: "present", checked_in_at: "2030-01-02", checked_in_by: "officer-1" }];
  const notGoing = applyRsvpStatus(original, "event-1", "member-1", "not_going");
  assert.equal(notGoing[0].status, "not_going");
  assert.equal(notGoing[0].check_in_status, "present");
  const cancelled = applyRsvpStatus(notGoing, "event-1", "member-1", "undecided");
  assert.equal(cancelled[0].status, "undecided");
  assert.deepEqual(restoreRsvpStatus(cancelled, "event-1", "member-1", original[0]), original);
  assert.deepEqual(restoreRsvpStatus(applyRsvpStatus([], "event-1", "member-1", "going"), "event-1", "member-1"), []);
});

test("blocks duplicate saves while allowing capacity overflow after a warning", () => {
  const pending = new Set();
  assert.equal(beginRsvpSave(pending, "event-1"), true);
  assert.equal(beginRsvpSave(pending, "event-1"), false);
  assert.match(getRsvpCapacityWarning({ status: "full", remaining: 0 }), /1명 초과/);
  assert.match(getRsvpCapacityWarning({ status: "over_capacity", remaining: -2 }), /3명 초과/);
  assert.equal(getRsvpCapacityWarning({ status: "available", remaining: 3 }), null);
});

test("shared controls expose accessible live and pressed states on all three screens", () => {
  const controls = readFileSync("components/rsvp-controls.tsx", "utf8");
  const clubhouse = readFileSync("components/clubhouse.tsx", "utf8");
  const detail = readFileSync("components/event-detail.tsx", "utf8");
  assert.match(controls, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(controls, /role="group" aria-label=/);
  assert.match(controls, /aria-pressed=/);
  assert.match(controls, /aria-busy=/);
  assert.match(controls, /aria-describedby=/);
  assert.equal((clubhouse.match(/<RsvpControls/g) ?? []).length, 2);
  assert.equal((detail.match(/<RsvpControls/g) ?? []).length, 1);
});
