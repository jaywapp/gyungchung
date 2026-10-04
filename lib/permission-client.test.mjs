import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleExports(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", output)(exports);
  return exports;
}
const access = moduleExports("./permission-access.ts");
const { ResourceRequests } = moduleExports("./resource-requests.ts");
const { publicLoadResources, memberLoadResources, getLoadErrors } = moduleExports("./load-state.ts");

function actualCallback(path, component, name, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const owner = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(owner);
  assert.ok(initializer, `${component}.${name} must exercise the production handler`);
  if (ts.isCallExpression(initializer)) initializer = initializer.arguments[0];
  const compiled = ts.transpileModule(`const callback = ${initializer.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn callback;`)(...Object.values(dependencies));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const profile = { id: "synthetic-member", auth_user_id: "owner-A", name: "Synthetic Officer", role: "manager", officer_title: "treasurer", is_system_admin: false, status: "active", must_change_password: false };
  const state = Object.fromEntries([...publicLoadResources, ...memberLoadResources, "rawGuestPlayers"].map((key) => [key, []]));
  const data = { profiles: [profile], officer_permissions: access.operationalPermissions.map((permission) => ({ officer_title: profile.officer_title, permission })), role_permissions: [], get_member_directory: [profile] };
  const errors = {};
  const gates = {};
  const reads = [];
  const reloads = [];
  const toasts = [];
  const requests = new ResourceRequests();
  const supabase = {
    from: query,
    rpc: query,
  };
  function query(resource) {
    const chain = {
      select: () => chain, order: () => chain, eq: () => chain,
      abortSignal: async () => {
        reads.push(resource);
        if (gates[resource]) await gates[resource].promise;
        return { data: data[resource] ?? [], error: errors[resource] ?? null };
      },
    };
    return chain;
  }
  const dependencies = {
    ...access, supabase, accessResources: ["profiles", "rolePermissions", "officerPermissions"],
    publicLoadResources, memberLoadResources, getLoadErrors,
    userRef: { current: { id: profile.auth_user_id } }, requestsRef: { current: requests },
    profileSourcesRef: { current: { directory: [], private: [] } },
    accessRef: { current: { owner: null, profile: null, officerRows: [], roleRows: [], permissions: new Set(), ready: false } },
    accessRequestRef: { current: null }, reloadRef: { current: async (resources) => { reloads.push(resources); } },
    rsvpPendingChangesRef: { current: new Map() }, mergePendingRsvpChanges: (rows) => rows,
    showToast: (...args) => toasts.push(args),
  };
  for (const key of [...Object.keys(state), "me", "memberLoading", "publicLoading", "loadErrors", "quickEditor", "winnerEvent", "pendingDelete", "pendingKick"]) {
    dependencies[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  }
  const loadMemberData = actualCallback("../components/clubhouse.tsx", "Clubhouse", "loadMemberData", dependencies);
  const loadPublicData = actualCallback("../components/clubhouse.tsx", "Clubhouse", "loadPublicData", dependencies);
  const verifyAccess = actualCallback("../components/clubhouse.tsx", "Clubhouse", "verifyAccess", { ...dependencies, loadMemberData });
  return { profile, state, data, errors, gates, reads, reloads, toasts, requests, dependencies, loadMemberData, loadPublicData, verifyAccess };
}

test("initial eighteen reads share authority queries with concurrent management verification", async () => {
  const f = fixture();
  f.gates.profiles = deferred();
  const initialMember = f.loadMemberData(f.dependencies.userRef.current, true);
  const initialPublic = f.loadPublicData(true);
  const first = f.verifyAccess();
  const second = f.verifyAccess();
  await Promise.resolve();
  assert.equal(f.reads.length, 18);
  for (const resource of ["profiles", "role_permissions", "officer_permissions"]) assert.equal(f.reads.filter((read) => read === resource).length, 1);
  f.gates.profiles.resolve();
  const results = await Promise.all([initialMember, initialPublic, first, second]);
  assert.equal(results[2].has("fees.manage"), true);
  assert.equal(results[3].has("fees.manage"), true);
  assert.equal(f.reads.length, 18);
});

test("an external fee revocation clears fee caches and the related editor without reloading every service", async () => {
  const f = fixture();
  f.data.profiles.push({ ...f.profile, id: "another-member", auth_user_id: "another-owner", name: "Synthetic Member", phone: "01000000001" });
  await f.loadMemberData(f.dependencies.userRef.current, true);
  const events = [{ id: "keep-events" }];
  f.state.events = events;
  f.state.fees = [{ id: "private-fee" }];
  f.state.guestFees = [{ id: "private-guest-fee" }];
  f.state.quickEditor = { type: "fees", row: { id: "private-fee" } };
  f.data.officer_permissions = f.data.officer_permissions.filter((row) => row.permission !== "fees.manage");
  const before = f.reads.length;
  const fresh = await f.verifyAccess();
  assert.equal(fresh.has("fees.manage"), false);
  assert.equal(fresh.has("events.manage"), true);
  assert.deepEqual(f.state.fees, []);
  assert.deepEqual(f.state.guestFees, []);
  assert.equal(f.state.quickEditor, null);
  assert.equal(f.state.events, events);
  assert.equal(f.state.profiles.find((profile) => profile.id === "another-member")?.phone, "01000000001", "remaining member management access must retain its freshly authorized roster");
  assert.deepEqual(f.reloads, [["fees", "guestFees", "memberDirectory"]]);
  assert.equal(f.reads.length - before, 3);
});

test("an offline authority read fails closed for writes while preserving the draft", async () => {
  const f = fixture();
  await f.loadMemberData(f.dependencies.userRef.current, true);
  const editor = { type: "fees", row: { id: "draft" } };
  f.state.quickEditor = editor;
  f.errors.profiles = { message: "Network unavailable" };
  assert.equal(await f.verifyAccess(), null);
  assert.equal(f.state.quickEditor, editor);
  assert.equal(f.dependencies.accessRef.current.permissions.has("fees.manage"), true);
  assert.equal(f.toasts.at(-1)[1], "error");
});

test("authority reads completing after an identity switch cannot authorize the new owner", async () => {
  const f = fixture();
  f.gates.profiles = deferred();
  const verifying = f.verifyAccess();
  await Promise.resolve();
  f.dependencies.userRef.current = { id: "owner-B" };
  f.requests.reset();
  f.gates.profiles.resolve();
  assert.equal(await verifying, null);
  assert.equal(f.dependencies.accessRef.current.ready, false);
  assert.deepEqual(f.state.profiles, []);
});

test("verified grants become unusable for follow-up writes after an identity switch", async () => {
  const f = fixture();
  const fresh = await f.verifyAccess();
  assert.equal(fresh.isCurrent(), true);
  f.dependencies.userRef.current = { id: "owner-B" };
  f.requests.reset();
  assert.equal(fresh.isCurrent(), false);
});

test("verified grants cannot continue a multi-step mutation after a later revocation", async () => {
  const f = fixture();
  const previous = await f.verifyAccess();
  f.data.officer_permissions = f.data.officer_permissions.filter((row) => row.permission !== "fees.manage");
  await f.verifyAccess();
  assert.equal(previous.isCurrent(), false);
});

function mutationFixture({ permissions = ["members.manage"], resultError = null, isNew = false, unavailable = false } = {}) {
  const state = { writes: [], saved: 0, closed: 0, errors: [], checks: 0, provisioned: 0, current: true };
  const row = isNew ? {} : { id: "synthetic-officer", role: "manager", officer_title: "president", fee_plan: null, is_system_admin: false };
  const fresh = Object.assign(new Set(permissions), { profiles: isNew ? [] : [row], isCurrent: () => state.current });
  const dependencies = {
    ...access, config: { type: "members" }, row, isEditingSelfSystemAdmin: false,
    savingRef: { current: false }, setSaving: (saving) => { state.saving = saving; },
    verifyAccess: async () => { state.checks++; return unavailable ? null : fresh; },
    onClose: () => { state.closed++; }, onSaved: () => { state.saved++; }, onError: (error) => state.errors.push(error),
    setFormDirty() {}, toErrorMessage: (error) => error.message,
    supabase: {
      from(table) {
        const chain = {
          update(payload) { state.writes.push({ table, payload }); return chain; },
          insert(payload) { state.writes.push({ table, payload }); return chain; },
          eq: () => chain, select: () => chain,
          single: async () => { state.afterWrite?.(); return { data: resultError ? null : { id: "created-profile" }, error: resultError }; },
        };
        return chain;
      },
      functions: { invoke: async () => { state.provisioned++; return { error: null }; } },
    },
  };
  const save = actualCallback("../components/admin-console.tsx", "AdminEditor", "save", dependencies);
  const fields = { name: "Synthetic Officer", phone: "01000000000", status: "active" };
  const fd = { get: (name) => fields[name] ?? null };
  return { state, dependencies, fresh, save, fd };
}

test("the production member save omits protected null fields for an ordinary member manager", async () => {
  const f = mutationFixture();
  await f.save(f.fd, null);
  assert.equal(f.state.saved, 1);
  assert.equal(f.state.writes.length, 1);
  for (const key of ["role", "fee_plan", "officer_title", "is_system_admin", "auth_user_id"]) assert.equal(key in f.state.writes[0].payload, false);
  assert.equal(f.state.writes[0].payload.name, "Synthetic Officer");
});

test("the production save does not write or discard a draft when fresh authorization is unavailable", async () => {
  const f = mutationFixture({ unavailable: true });
  await f.save(f.fd, null);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.saved, 0);
  assert.equal(f.state.closed, 0);
  assert.equal(f.dependencies.savingRef.current, false);
});

test("the production save closes the editor without writing after management permission is revoked", async () => {
  const f = mutationFixture({ permissions: [] });
  await f.save(f.fd, null);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.saved, 0);
  assert.equal(f.state.closed, 1);
});

test("a zero-row production update refreshes authorization and never announces success", async () => {
  const f = mutationFixture({ resultError: { code: "PGRST116", message: "No affected row" } });
  await f.save(f.fd, null);
  assert.equal(f.state.saved, 0);
  assert.equal(f.state.closed, 0);
  assert.equal(f.state.checks, 2);
  assert.deepEqual(f.state.errors, ["No affected row"]);
});

test("an account switch after profile creation stops the follow-up account provisioning request", async () => {
  const f = mutationFixture({ isNew: true });
  f.state.afterWrite = () => { f.state.current = false; };
  await f.save(f.fd, null);
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.provisioned, 0);
  assert.equal(f.state.saved, 0);
});

test("the production account reset rejects an officer target before invoking the Edge Function", async () => {
  const f = mutationFixture();
  const reset = actualCallback("../components/admin-console.tsx", "AdminEditor", "confirmPasswordReset", { ...f.dependencies, accountTarget: f.dependencies.row, setPasswordResetOpen() {} });
  await reset();
  assert.equal(f.state.provisioned, 0);
  assert.equal(f.state.saved, 0);
  assert.equal(f.state.errors.length, 1);
});

test("a target promoted to system administrator since the editor opened cannot be edited", async () => {
  const f = mutationFixture();
  f.fresh.profiles = [{ ...f.dependencies.row, is_system_admin: true }];
  await f.save(f.fd, null);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.closed, 1);
});
