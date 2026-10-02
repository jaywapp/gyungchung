import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderVenuePresetSeed, validateVenuePresets } from "./build-venue-preset-seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.VENUE_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const rows = JSON.parse(await readFile(path.join(root, "data/venue-presets/regional-futsal.json"), "utf8"));
const migrationDir = path.join(root, "supabase/migrations");
const migrationFiles = await readdir(migrationDir);
async function migration(suffix) {
  const matches = migrationFiles.filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1);
  return readFile(path.join(migrationDir, matches[0]), "utf8");
}
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function value(sql, args = []) { return (await db.query(sql, args)).rows[0]?.value; }
async function rejected(sql, pattern) { await assert.rejects(db.exec(sql), pattern); checks++; }

try {
  validateVenuePresets(rows);
  equal(await migration("_seed_regional_futsal_venues.sql"), renderVenuePresetSeed(rows), "committed seed matches catalog");
  for (const invalid of [
    [{ ...rows[0], city: "광주광역시" }],
    [rows[0], rows[0]],
    [{ ...rows[0], source_urls: ["http://example.com"] }],
    [{ ...rows[0], longitude: null, latitude: 37 }],
    [{ ...rows[0], name: "$venue_presets$" }],
  ]) { assert.throws(() => renderVenuePresetSeed(invalid)); checks++; }

  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create table public.profiles(id uuid primary key);
    insert into public.profiles values ('00000000-0000-0000-0000-000000000001');
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function private.current_profile_id() returns uuid language sql as $$
      select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function private.has_permission(text) returns boolean language sql as $$
      select coalesce(current_setting('venue.fixture_manager', true), '') = 'true' $$;
    grant usage on schema private to authenticated;
    grant execute on function private.current_profile_id(), private.has_permission(text) to authenticated;
    create table public.events(id uuid primary key default gen_random_uuid(), venue text, address text);
    insert into public.events(venue, address) values ('세븐풋살장', '오포로171번길 17-19');
  `);
  await db.exec(await migration("_add_venue_directory.sql"));
  const currentFunctions = await migration("_admin_managed_member_accounts.sql");
  const prepare = currentFunctions.match(/create or replace function public\.prepare_venue\(\)[\s\S]*?\$\$;/)?.[0];
  assert.ok(prepare, "use actual current venue trigger");
  await db.exec(prepare);
  await db.exec("update public.venues set note = 'Existing manager note', created_by = '00000000-0000-0000-0000-000000000001'");
  const original = (await db.query("select id, name, address, note, created_by, created_at from public.venues")).rows[0];
  const snapshot = await value("select to_jsonb(e) value from public.events e");
  await db.exec(await migration("_venue_preset_provenance.sql"));
  const seed = await migration("_seed_regional_futsal_venues.sql");
  await db.exec(seed);
  equal(await value("select count(*)::integer value from public.venues"), rows.length, "existing venue is reused");
  equal((await db.query("select id, name, address, note, created_by, created_at from public.venues where preset_key='iamground-1220'")).rows[0], original, "original manual fields and identity preserved");
  equal(await value("select to_jsonb(e) value from public.events e"), snapshot, "event snapshots and foreign key untouched");
  equal(await value("select city value from public.venues where preset_key='iamground-1220'"), "광주시", "short original address gains city search metadata");
  equal(await value("select count(*)::integer value from public.venues where preset_key is null or city is null or cardinality(source_urls)=0 or source_checked_at is null"), 0, "all imported rows have provenance");
  equal(await value("select count(*)::integer value from public.venues where preset_key like 'iamground-%'"), 66, "training courts excluded");
  const ids = await value("select jsonb_object_agg(preset_key, id) value from public.venues");
  await db.exec(seed);
  equal(await value("select jsonb_object_agg(preset_key, id) value from public.venues"), ids, "reimport preserves every identity");
  await db.exec("update public.venues set name='Manager revised name', address='Manager revised address', note='Revised note' where preset_key='iamground-1220'");
  await db.exec(seed);
  equal(await value("select jsonb_build_array(name,address,note) value from public.venues where preset_key='iamground-1220'"), ["Manager revised name", "Manager revised address", "Revised note"], "stable key preserves subsequent manager edits");
  equal(await value("select to_jsonb(e) value from public.events e"), snapshot, "reimport never rewrites events");

  await rejected("update public.venues set longitude=null where preset_key='iamground-1220'", /venues_coordinates_check/);
  await rejected("update public.venues set latitude=91 where preset_key='iamground-1220'", /venues_coordinates_check/);
  await rejected("update public.venues set source_urls='{}' where preset_key='iamground-1220'", /venues_preset_provenance_check/);
  await rejected("update public.venues set preset_key='INVALID KEY' where preset_key='iamground-1220'", /check constraint/);
  await rejected("update public.venues set source_urls=ARRAY[null::text] where preset_key='iamground-1220'", /check constraint/);
  await db.exec("set role anon");
  equal(await value("select count(*)::integer value from public.venues"), rows.length, "anonymous existing reader can read directory");
  await rejected("insert into public.venues(name) values('Forbidden anonymous venue')", /permission denied/);
  await db.exec("reset role; set role authenticated; set venue.fixture_manager='false'");
  await rejected("insert into public.venues(name) values('Forbidden member venue')", /row-level security/);
  equal((await db.query("update public.venues set note='Forbidden' returning id")).rows.length, 0, "member cannot update venue");
  equal((await db.query("delete from public.venues returning id")).rows.length, 0, "member cannot delete venue");
  await db.exec("set venue.fixture_manager='true'; insert into public.venues(name,address) values('  Manual venue  ','  Manual address  ')");
  equal(await value("select jsonb_build_array(name,address,city,preset_key,source_urls) value from public.venues where name='Manual venue'"), ["Manual venue", "Manual address", null, null, []], "manager manual entry remains valid without preset metadata");
  await db.exec("update public.venues set note='Manager note' where name='Manual venue'");
  equal(await value("select note value from public.venues where name='Manual venue'"), "Manager note", "manager can edit manual venue");
  await db.exec("reset role");
  const quoted = { ...rows[0], preset_key: "verification-quoted", name: "Quoted ' court" };
  await db.exec(renderVenuePresetSeed([quoted]));
  equal(await value("select name value from public.venues where preset_key='verification-quoted'"), quoted.name, "public apostrophe is safely escaped");
  await rejected(renderVenuePresetSeed([{ ...quoted, preset_key: "verification-ambiguous", name: "Unmatched", match_aliases: [
    { name: quoted.name, address: quoted.address }, { name: "Manual venue", address: "Manual address" },
  ] }]), /Ambiguous existing venue/);
  equal(await value("select count(*)::integer value from public.venues where preset_key='verification-ambiguous'"), 0, "ambiguous import rolls back");
  console.log(JSON.stringify({ checks, presets: rows.length, cities: rows.reduce((totals, row) => ({ ...totals, [row.city]: (totals[row.city] ?? 0) + 1 }), {}) }));
} finally { await db.close(); }
