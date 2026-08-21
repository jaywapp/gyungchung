import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260821135553_atomic_permission_batch.sql", import.meta.url), "utf8");

test("hardens the permission RPC and removes direct table writes", () => {
  assert.match(migration, /create or replace function public\.apply_officer_permission_batch\(permission_changes jsonb\)/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function public\.apply_officer_permission_batch\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.apply_officer_permission_batch\(jsonb\)\s+to authenticated/);
  assert.match(migration, /revoke insert, update, delete on public\.officer_permissions from authenticated/);
});

test("rolls stale batches back and protects administrator access in the database", () => {
  assert.match(migration, /errcode = '40001'[\s\S]*Officer permissions changed while this batch was pending/);
  assert.match(migration, /get diagnostics affected_rows = row_count/);
  assert.match(migration, /order by profile\.id\s+for update/);
  assert.match(migration, /System administrators cannot remove their own access/);
  assert.match(migration, /At least one active system administrator is required/);
});
