import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateVenuePresets(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0, "A nonempty preset array is required");
  const keys = new Set();
  const locations = new Set();
  for (const row of rows) {
    assert.match(row.preset_key, /^[a-z][a-z0-9-]{1,119}$/);
    assert.ok(!keys.has(row.preset_key), "Duplicate preset identity: " + row.preset_key);
    keys.add(row.preset_key);
    assert.ok(typeof row.name === "string" && row.name.trim() === row.name && row.name.length > 0 && row.name.length <= 120);
    assert.ok(typeof row.address === "string" && row.address.trim() === row.address && row.address.length > 0 && row.address.length <= 240);
    assert.ok(["광주시", "용인시", "성남시"].includes(row.city));
    assert.ok(row.address.startsWith("경기도 " + row.city + " "), "Address must belong to the requested city");
    const location = JSON.stringify([row.name, row.address]);
    assert.ok(!locations.has(location), "Duplicate named court: " + row.name);
    locations.add(location);
    assert.ok(Array.isArray(row.source_urls) && row.source_urls.length > 0 && row.source_urls.length <= 12);
    assert.equal(new Set(row.source_urls).size, row.source_urls.length);
    for (const url of row.source_urls) assert.equal(new URL(url).protocol, "https:");
    assert.match(row.source_checked_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(row.source_checked_at).toISOString().slice(0, 10), row.source_checked_at);
    assert.ok((row.latitude == null && row.longitude == null) ||
      (Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && row.latitude >= -90 && row.latitude <= 90 && row.longitude >= -180 && row.longitude <= 180));
    assert.ok(row.note == null || (typeof row.note === "string" && row.note.length <= 500));
    for (const alias of row.match_aliases ?? []) {
      assert.ok(typeof alias.name === "string" && alias.name.trim().length > 0);
      assert.ok(typeof alias.address === "string" && alias.address.trim().length > 0);
    }
  }
  return rows;
}

export function renderVenuePresetSeed(rows) {
  validateVenuePresets(rows);
  const payload = JSON.stringify(rows).replaceAll("'", "''");
  assert.ok(!payload.includes("$venue_presets$"), "Reserved migration delimiter in public data");
  return `-- Public location facts checked on ${rows[0].source_checked_at}; existing event snapshots remain unchanged.
-- Generated from data/venue-presets/regional-futsal.json by scripts/build-venue-preset-seed.mjs.
do $venue_presets$
declare
  preset jsonb;
  target_id uuid;
  matches integer;
begin
  for preset in select value from jsonb_array_elements('${payload}'::jsonb)
  loop
    target_id := null;
    select id into target_id from public.venues where preset_key = preset->>'preset_key';
    if target_id is null then
      select count(*), (array_agg(venue.id))[1] into matches, target_id
      from public.venues as venue
      where (venue.name = preset->>'name' and venue.address = preset->>'address')
        or exists (
          select 1 from jsonb_array_elements(coalesce(preset->'match_aliases', '[]'::jsonb)) as alias
          where venue.name = alias->>'name' and venue.address = alias->>'address'
        );
      if matches > 1 then raise exception 'Ambiguous existing venue for preset %', preset->>'preset_key'; end if;
      if target_id is not null and exists (
        select 1 from public.venues where id = target_id and preset_key is not null and preset_key <> preset->>'preset_key'
      ) then raise exception 'Existing venue has another preset identity: %', preset->>'preset_key'; end if;
    end if;
    if target_id is null then
      insert into public.venues(name, address, note, city, preset_key, source_urls, source_checked_at, latitude, longitude)
      values (preset->>'name', preset->>'address', preset->>'note', preset->>'city', preset->>'preset_key',
        array(select jsonb_array_elements_text(preset->'source_urls')), (preset->>'source_checked_at')::date,
        (preset->>'latitude')::double precision, (preset->>'longitude')::double precision);
    else
      update public.venues as venue
      set preset_key = preset->>'preset_key', city = coalesce(venue.city, preset->>'city'),
        source_urls = array(select distinct url from unnest(venue.source_urls || array(select jsonb_array_elements_text(preset->'source_urls'))) as url order by url),
        source_checked_at = greatest(venue.source_checked_at, (preset->>'source_checked_at')::date),
        latitude = coalesce(venue.latitude, (preset->>'latitude')::double precision),
        longitude = coalesce(venue.longitude, (preset->>'longitude')::double precision)
      where venue.id = target_id;
    end if;
  end loop;
end;
$venue_presets$;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.argv[2] && process.argv[3], "Usage: node scripts/build-venue-preset-seed.mjs <catalog.json> <migration.sql>");
  const rows = JSON.parse(await readFile(process.argv[2], "utf8"));
  await writeFile(process.argv[3], renderVenuePresetSeed(rows));
  console.log(JSON.stringify({ presets: rows.length, cities: rows.reduce((counts, row) => ({ ...counts, [row.city]: (counts[row.city] ?? 0) + 1 }), {}) }));
}
