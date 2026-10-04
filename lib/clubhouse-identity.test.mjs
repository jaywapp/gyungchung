import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(path, stubs = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  new Function("exports", "require", output.outputText)(exports, (name) => stubs[name] ?? require(name));
  return exports;
}
const { ResourceRequests } = compile("./resource-requests.ts");
const MemberHome = compile("../components/member-home.tsx", {
  "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "@/lib/event-capacity": { getEventCapacity: (capacity, members, guests) => ({ capacity, totalCount: members + guests, remaining: capacity - members - guests }) },
  "@/lib/event-date": { eventDatePath: () => "/events/21000103" },
  "@/lib/participation-deadline": { formatDeadline: () => "", isParticipationClosed: () => false },
  "@/lib/member-directory": { nameInitials: (name) => name },
  "@/components/rsvp-controls": { RsvpControls: () => null },
  "@/components/club-nav": { MemberAvatar: () => null, tabPaths: { events: "/events", notices: "/notices", fees: "/fees", rankings: "/rankings", participation: "/participation" } },
  "@/components/section-states": { LoadError: () => null, SectionSkeleton: () => null },
}).default;

const source = readFileSync(new URL("../components/clubhouse.tsx", import.meta.url), "utf8");
const callbackBody = /supabase\.auth\.onAuthStateChange\(\(event, session\) => \{([\s\S]*?)\n    \}\);/.exec(source)?.[1];
assert.ok(callbackBody, "the regression must exercise the actual auth callback");
const privateMarker = "SYNTHETIC_PRIVATE_A";
const oldProfile = { id: "member-A", auth_user_id: "owner-A", name: privateMarker, status: "active" };
const event = { id: "event", title: "Synthetic", starts_at: "2100-01-03T00:00:00Z", venue: "Venue", capacity: 18, event_guest_players: [] };
const arrayNames = ["profiles", "fees", "guestFees", "attendance", "feedback", "feedbackFeed", "submissions", "rolePermissions", "officerPermissions", "rawGuestPlayers", "winners", "momVotes", "momResults", "events", "venues", "notices", "forms"];
const dialogNames = ["quickEditor", "winnerEvent", "pendingDelete", "pendingKick"];

function fixture() {
  const requests = new ResourceRequests();
  const state = Object.fromEntries(arrayNames.map((name) => [name, [{ name: privateMarker }]]));
  state.profiles = [oldProfile];
  state.attendance = [{ event_id: event.id, member_id: oldProfile.id, status: "going" }];
  state.events = [{ ...event, event_teams: [{ event_team_members: [{ participant_name: privateMarker }] }] }];
  state.forms = [{ participation_questions: [{ participation_options: [{ label: privateMarker }] }] }];
  for (const name of dialogNames) state[name] = { name: privateMarker };
  Object.assign(state, { me: oldProfile, user: { id: "owner-A" }, publicLoading: false, memberLoading: false, authLoading: false, authError: false, rsvpPendingEventIds: new Set([event.id]) });
  const refs = {
    avatarBusyRef: { current: false },
    userRef: { current: state.user },
    accessRef: { current: { ready: true, owner: state.user.id, permissions: new Set(["members.manage"]) } },
    accessRequestRef: { current: null },
    profileSourcesRef: { current: { directory: [oldProfile], private: [oldProfile] } },
    rsvpPendingEventIdsRef: { current: new Set([event.id]) },
    rsvpPendingChangesRef: { current: new Map([[event.id, { memberId: oldProfile.id, status: "going" }]]) },
  };
  const dependencies = { ...refs, avatarCache: { clear() { state.avatarCacheCleared = true; } }, requests, active: true, pendingTimer: 1, window: { clearTimeout() {} }, webPush: null, queueMicrotask, verifyAccess: async () => { state.permissionRefreshes = (state.permissionRefreshes ?? 0) + 1; } };
  for (const name of [...arrayNames, ...dialogNames, "me", "user", "publicLoading", "memberLoading", "authLoading", "authError", "rsvpPendingEventIds"]) {
    dependencies[`set${name[0].toUpperCase()}${name.slice(1)}`] = (value) => { state[name] = typeof value === "function" ? value(state[name]) : value; };
  }
  const callback = new Function(...Object.keys(dependencies), `return (event, session) => {${callbackBody}};`)(...Object.values(dependencies));
  return { state, refs, requests, callback };
}

function home(state, profile = null) {
  return renderToStaticMarkup(React.createElement(MemberHome, {
    profile, publicLoading: state.publicLoading, sessionPending: state.memberLoading,
    upcoming: event, profiles: state.profiles, attendance: state.attendance, notices: [], forms: [],
    feeStanding: null, rankings: { goals: [], wins: [] }, eventLoadError: false, noticeLoadError: false, feeLoadError: false, rsvpPending: false,
    onAttendance() {}, onLogin() {}, onRetry() {},
  }));
}

for (const nextProfile of [null, { id: "member-B", auth_user_id: "owner-B", name: "Synthetic B", status: "pending" }]) {
  test(`a new ${nextProfile ? "pending" : "unlinked"} owner never renders the previous owner's member data while public queries finish first`, async () => {
    const { state, refs, requests, callback } = fixture();
    const previousRead = await requests.load("profiles", "owner-A", () => Promise.resolve({ data: [oldProfile], error: null }));
    assert.ok(home({ ...state, me: null, memberLoading: true }).includes(`title="${privateMarker}"`), "the actual home renderer exposes stale attendance if its arrays are retained");
    callback("SIGNED_IN", { user: { id: "owner-B" } });
    for (const name of arrayNames) assert.deepEqual(state[name], [], `${name} must be cleared in the identity callback`);
    for (const name of dialogNames) assert.equal(state[name], null, `${name} must not retain an old owner's row`);
    assert.equal(state.me, null);
    assert.equal(state.publicLoading, true);
    assert.equal(state.memberLoading, true);
    assert.equal(refs.userRef.current.id, "owner-B");
    assert.equal(state.avatarCacheCleared, true);
    assert.deepEqual(refs.profileSourcesRef.current, { directory: [], private: [] });
    assert.equal(refs.rsvpPendingEventIdsRef.current.size, 0);
    assert.equal(refs.rsvpPendingChangesRef.current.size, 0);
    assert.equal(previousRead.isCurrent(), false);
    // Model the new owner's public batch completing before their member batch.
    state.publicLoading = false;
    state.events = [event];
    assert.equal(home(state, nextProfile).includes(privateMarker), false);
  });
}

test("a token refresh keeps the same owner data until the permission refresh completes", async () => {
  const { state, refs, requests, callback } = fixture();
  const previousRead = await requests.load("profiles", "owner-A", () => Promise.resolve({ data: [oldProfile], error: null }));
  const snapshot = { ...state };
  callback("TOKEN_REFRESHED", { user: { id: "owner-A" } });
  for (const name of [...arrayNames, ...dialogNames, "me"]) assert.equal(state[name], snapshot[name]);
  assert.equal(state.publicLoading, false);
  assert.equal(state.memberLoading, false);
  assert.equal(previousRead.isCurrent(), true);
  assert.equal(refs.rsvpPendingEventIdsRef.current.size, 1);
  await Promise.resolve();
  assert.equal(state.permissionRefreshes, 1);
});
