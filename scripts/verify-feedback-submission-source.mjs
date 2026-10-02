import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.PUSH_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const migration = await readFile(path.join(root, "supabase/migrations/20261002003502_feedback_submission_source.sql"), "utf8");
let checks = 0;

async function value(sql, args = []) { return (await db.query(sql, args)).rows[0]?.value; }
function equal(actual, expected, description) { assert.deepEqual(actual, expected, description); checks++; }

try {
  await db.exec(`
    create table public.feedback (
      id integer generated always as identity primary key,
      title text not null,
      status text not null default 'received',
      officer_response text
    );
    insert into public.feedback(title) values ('Existing report');
  `);
  await db.exec(migration);

  equal(await value("select submission_source value from public.feedback where title = 'Existing report'"), null, "existing reports have unknown source");
  equal(await value("select column_default value from information_schema.columns where table_schema = 'public' and table_name = 'feedback' and column_name = 'submission_source'"), null, "source has no default for older clients");

  await db.query("insert into public.feedback(title) values($1)", ["Old app report"]);
  await db.query("insert into public.feedback(title, submission_source) values($1, $2), ($3, $4)", ["Web report", "web", "App report", "app"]);
  equal(await value("select submission_source value from public.feedback where title = 'Old app report'"), null, "older app insert succeeds without source");
  equal(await value("select submission_source value from public.feedback where title = 'Web report'"), "web", "new web report stores source");
  equal(await value("select submission_source value from public.feedback where title = 'App report'"), "app", "new app report stores source");

  await assert.rejects(db.query("insert into public.feedback(title, submission_source) values($1, $2)", ["Invalid report", "desktop"]), /feedback_submission_source_valid/);
  checks++;
  equal(await value("select count(*)::integer value from public.feedback where title = 'Invalid report'"), 0, "invalid source does not persist");

  await db.query("update public.feedback set status = 'reviewing', officer_response = 'Under review' where title = 'Web report'");
  equal(await value("select submission_source value from public.feedback where title = 'Web report'"), "web", "manager response update preserves source");
  await db.query("update public.feedback set status = 'resolved' where title = 'App report'");
  equal(await value("select submission_source value from public.feedback where title = 'App report'"), "app", "status update preserves source");
  console.log(`Feedback submission source: ${checks} checks passed`);
} finally {
  await db.close();
}
