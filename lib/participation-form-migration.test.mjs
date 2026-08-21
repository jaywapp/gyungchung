import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260821212512_atomic_participation_form_editor.sql", "utf8");

test("participation form writes use one invoker RPC with explicit grants", () => {
  assert.match(migration, /create or replace function public\.save_participation_form\([\s\S]*?security invoker/);
  assert.match(migration, /revoke execute on function public\.save_participation_form\(uuid, jsonb, jsonb, boolean\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.save_participation_form\(uuid, jsonb, jsonb, boolean\) to authenticated/);
});

test("answered form policy is enforced inside the database transaction", () => {
  assert.match(migration, /Answered questions cannot be deleted/);
  assert.match(migration, /Answered question type cannot be changed/);
  assert.match(migration, /Answered option cannot be deleted/);
  assert.match(migration, /Answered option label cannot be changed/);
  assert.match(migration, /Answered optional question cannot become required/);
  assert.match(migration, /New questions on an answered form must be optional/);
  assert.match(migration, /Answered question prompt change needs confirmation/);
  assert.match(migration, /create trigger protect_answered_participation_question_before_write/);
  assert.match(migration, /create trigger protect_answered_participation_option_before_write/);
  assert.match(migration, /create trigger protect_answered_participation_form_before_delete/);
  assert.match(migration, /Answered participation forms cannot be deleted/);
});

test("editing and submitting the same form share a transaction lock", () => {
  const locks = migration.match(/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(target_form_id::text, 0\)\)/g) ?? [];
  assert.equal(locks.length, 2);
});

test("submission RPC still enforces required questions while optional answers may be absent", () => {
  assert.match(migration, /where q\.form_id = target_form_id and q\.is_required/);
  assert.match(migration, /not exists \(select 1 from jsonb_array_elements\(submitted_answers\)/);
});
