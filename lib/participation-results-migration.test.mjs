import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260822000000_publish_participation_results.sql", "utf8");

test("result RPC only exposes closed, explicitly public aggregates", () => {
  assert.match(migration, /create or replace function public\.get_participation_results\(target_form_id uuid\)/);
  assert.match(migration, /f\.status = 'closed'::public\.participation_status/);
  assert.match(migration, /f\.show_results/);
  assert.match(migration, /f\.ends_at is null or f\.ends_at <= now\(\)/);
  assert.match(migration, /grant execute on function public\.get_participation_results\(uuid\) to authenticated/);
});

test("aggregate function returns counts without participant identity or free-text answers", () => {
  assert.match(migration, /private\.aggregate_participation_results/);
  assert.match(migration, /'response_count'/);
  assert.match(migration, /'options'/);
  assert.doesNotMatch(migration, /participant_id/);
  assert.doesNotMatch(migration, /a\.answer #>> '\{\}'[^\n]*'label'/);
});
