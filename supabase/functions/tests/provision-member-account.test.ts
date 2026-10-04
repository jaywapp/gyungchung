import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../provision-member-account/index.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const memberId = "41000000-0000-4000-8000-000000000001";

async function invoke({ operator = {}, member = {}, permission = true, linked = true } = {}) {
  const calls = { reset: 0, create: 0, remove: 0, profileUpdate: 0 };
  const operatorRow = { id: "operator", role: "manager", officer_title: "treasurer", is_system_admin: false, status: "active", ...operator };
  const memberRow = { id: memberId, name: "Fixture Member", phone: "01000000001", auth_user_id: linked ? "fixture-auth" : null, role: "member", officer_title: null, is_system_admin: false, status: "active", ...member };
  const adminClient = {
    from(table) {
      let update = false;
      let operatorQuery = false;
      const query = {
        select() { return query; },
        eq(column) { if (column === "auth_user_id" && !update) operatorQuery = true; return query; },
        update() { update = true; calls.profileUpdate++; return query; },
        async maybeSingle() {
          if (table === "officer_permissions") return { data: permission ? { permission: "members.manage" } : null, error: null };
          return { data: update ? { id: memberId } : operatorQuery ? operatorRow : memberRow, error: null };
        },
      };
      return query;
    },
    auth: { admin: {
      async updateUserById() { calls.reset++; return { error: null }; },
      async createUser(attributes) { assert.equal(attributes.app_metadata.member_provisioning_id, memberRow.id); assert.equal(attributes.user_metadata.member_id, memberRow.id); calls.create++; return { data: { user: { id: "new-fixture-auth" } }, error: null }; },
      async deleteUser() { calls.remove++; return { error: null }; },
    } },
  };
  const userClient = { auth: { async getUser() { return { data: { user: { id: "fixture-operator-auth" } }, error: null }; } } };
  let handler;
  runInNewContext(compiled, {
    Deno: { env: { get(key) { return key === "SUPABASE_URL" ? "https://fixture.invalid" : key === "SUPABASE_ANON_KEY" ? "fixture-public" : "fixture-service"; } }, serve(value) { handler = value; } },
    createClient(_url, key) { return key === "fixture-public" ? userClient : adminClient; },
    Request, Response,
  });
  const response = await handler(new Request("https://fixture.invalid/provision", {
    method: "POST", headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" }, body: JSON.stringify({ member_id: memberId }),
  }));
  return { status: response.status, body: await response.json(), calls };
}

test("member managers cannot reset or provision privileged accounts", async () => {
  for (const member of [
    { is_system_admin: true },
    { role: "manager", officer_title: "president" },
    { role: "manager", officer_title: "vice_president" },
    { role: "manager", officer_title: "treasurer" },
  ]) {
    for (const linked of [true, false]) {
      const result = await invoke({ member, linked });
      assert.equal(result.status, 403);
      assert.deepEqual(result.calls, { reset: 0, create: 0, remove: 0, profileUpdate: 0 });
    }
  }
});

test("member managers retain normal member account reset and provision", async () => {
  const reset = await invoke();
  assert.equal(reset.status, 200);
  assert.equal(reset.calls.reset, 1);
  assert.equal(reset.calls.create, 0);
  assert.equal(reset.calls.profileUpdate, 1);
  const provision = await invoke({ linked: false });
  assert.equal(provision.status, 200);
  assert.equal(provision.calls.create, 1);
  assert.equal(provision.calls.profileUpdate, 1);
});

test("active system administrators can manage protected accounts", async () => {
  for (const linked of [true, false]) {
    const result = await invoke({ operator: { is_system_admin: true, role: "member", officer_title: null }, member: { is_system_admin: true, role: "manager", officer_title: "president" }, linked });
    assert.equal(result.status, 200);
    assert.equal(result.calls.reset, linked ? 1 : 0);
    assert.equal(result.calls.create, linked ? 0 : 1);
  }
});

test("inactive and revoked member managers cannot change any account", async () => {
  for (const options of [{ operator: { status: "inactive", is_system_admin: true } }, { operator: { status: "pending" } }, { permission: false }, { operator: { role: "member", officer_title: null } }]) {
    const result = await invoke(options);
    assert.equal(result.status, 403);
    assert.equal(result.calls.reset + result.calls.create + result.calls.profileUpdate, 0);
  }
});