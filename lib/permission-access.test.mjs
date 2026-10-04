import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("./permission-access.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { getEffectivePermissions, canManageMemberAccount, canManageSection, canEditManagedRecord, getMemberMutationPayload, isPermissionError, operationalPermissions, getRevokedManagementResources, resolveGuestFeeNames } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const manager = { role: "manager", officer_title: "vice_president", status: "active", is_system_admin: false, must_change_password: false };
const rows = operationalPermissions.map((permission) => ({ officer_title: "vice_president", permission }));
test("all nine team services are configurable and a saved exclusion stays excluded", () => {
  assert.equal(getEffectivePermissions(manager, rows, []).size, 9);
  const excluded = getEffectivePermissions(manager, rows.filter((row) => row.permission !== "fees.manage"), []);
  assert.equal(excluded.size, 8);
  assert.equal(excluded.has("fees.manage"), false);
});
test("officers cannot acquire system permissions from stale title rows", () => {
  const permissions = getEffectivePermissions(manager, [...rows, { officer_title: "vice_president", permission: "roles.manage" }, { officer_title: "vice_president", permission: "officers.manage" }], []);
  assert.equal(permissions.has("roles.manage"), false);
  assert.equal(permissions.has("officers.manage"), false);
  assert.equal(canManageSection(permissions, "permissions"), false);
});
test("inactive pending unlinked and password-restricted accounts have no management access", () => {
  for (const profile of [null, { ...manager, status: "inactive" }, { ...manager, status: "pending" }, { ...manager, must_change_password: true }, { ...manager, role: "member", officer_title: null }]) assert.equal(getEffectivePermissions(profile, rows, []).size, 0);
});
test("active system administrators retain all services and system configuration", () => {
  const permissions = getEffectivePermissions({ ...manager, role: "member", officer_title: null, is_system_admin: true }, [], []);
  assert.equal(permissions.size, 10);
  assert.equal(canManageSection(permissions, "permissions"), true);
  assert.equal(canManageMemberAccount(permissions, { role: "manager", is_system_admin: true }), true);
});
test("normal account managers cannot reset privileged accounts", () => {
  const permissions = new Set(["members.manage"]);
  assert.equal(canManageMemberAccount(permissions, { role: "member", is_system_admin: false }), true);
  for (const target of [{ role: "manager", is_system_admin: false }, { role: "member", is_system_admin: true }]) assert.equal(canManageMemberAccount(permissions, target), false);
  assert.equal(canManageMemberAccount(new Set(), { role: "member", is_system_admin: false }), false);
});
test("participation operations honor each form kind", () => {
  const permissions = new Set(["polls.manage"]);
  assert.equal(canManageSection(permissions, "forms"), true);
  assert.equal(canManageSection(permissions, "forms", "poll"), true);
  for (const kind of ["election", "survey", "invalid"]) assert.equal(canManageSection(permissions, "forms", kind), false);
});
test("ordinary profile edits omit protected fields and preserve an officer's null fee plan", () => {
  const fields = { name: "Fixture Officer", phone: "01000000000", role: "manager", officer_title: "treasurer", fee_plan: null, is_system_admin: false, auth_user_id: "fixture" };
  assert.deepEqual(getMemberMutationPayload(fields, false, false), { name: fields.name, phone: fields.phone });
  assert.equal(getMemberMutationPayload(fields, true, false).fee_plan, null);
  assert.deepEqual(getMemberMutationPayload(fields, false, true), { name: fields.name, phone: fields.phone, role: "member", officer_title: null, fee_plan: "monthly", is_system_admin: false });
});
test("permission refusals and zero-row writes trigger a permission refresh", () => {
  assert.equal(isPermissionError({ code: "42501" }), true);
  assert.equal(isPermissionError({ code: "PGRST116" }), true);
  assert.equal(isPermissionError({ message: "new row violates row-level security" }), true);
  assert.equal(isPermissionError({ code: "23505" }), false);
});

test("member managers can edit ordinary officers but not system administrator profiles", () => {
  const permissions = new Set(["members.manage"]);
  assert.equal(canEditManagedRecord(permissions, "members", { role: "manager", is_system_admin: false }), true);
  assert.equal(canEditManagedRecord(permissions, "members", { role: "member", is_system_admin: true }), false);
});

test("a fee exclusion invalidates only fee and directory data", () => {
  assert.deepEqual(getRevokedManagementResources(new Set(["fees.manage", "events.manage"]), new Set(["events.manage"])), ["fees", "guestFees", "memberDirectory"]);
  assert.deepEqual(getRevokedManagementResources(new Set(["events.manage"]), new Set(["events.manage", "fees.manage"])), []);
});

test("fee managers resolve guest names from the matching event snapshot without guest-directory access", () => {
  const fees = [{ event_id: "one", guest_player_id: "guest", guest_players: null }, { event_id: "two", guest_player_id: "guest", guest_players: null }, { event_id: "three", guest_player_id: "guest", guest_players: { name: "Directory name" } }];
  const events = [{ id: "one", event_guest_players: [{ guest_player_id: "guest", guest_name: "First snapshot" }] }, { id: "two", event_guest_players: [{ guest_player_id: "guest", guest_name: "Second snapshot" }] }];
  assert.deepEqual(resolveGuestFeeNames(fees, events).map((fee) => fee.guest_players.name), ["First snapshot", "Second snapshot", "Directory name"]);
  assert.equal(fees[0].guest_players, null);
});
