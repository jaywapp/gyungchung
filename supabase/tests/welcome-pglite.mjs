/** Runs the real pgTAP suite against an isolated, in-memory PostgreSQL engine.
 * Usage: node supabase/tests/welcome-pglite.mjs <pglite module path> [pgtap.sql.in path]
 * PGlite is intentionally an external verification dependency, not a product dependency.
 * This fixture models the existing authorization tables and loads their real functions
 * from migration sources. It does not replay the full Supabase migration history.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2]) throw new Error('Pass the external @electric-sql/pglite module path');
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const source = async (name) => readFile(path.join(root, 'supabase/migrations', name), 'utf8');
const rosterSource = await source('20260816111500_admin_managed_member_accounts.sql');
const officerSource = await source('20260811120839_add_officer_titles.sql');
function extractFunction(text, name) {
  const start = text.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`Missing existing function ${name}`);
  const end = text.indexOf('$$;', start);
  if (end < 0) throw new Error(`Unclosed existing function ${name}`);
  return text.slice(start, end + 3);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema public, auth, private to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create table auth.users (
      id uuid primary key, instance_id uuid, aud text, role text, phone text, email text,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb
    );
    create type public.account_role as enum ('member','manager','admin');
    create type public.officer_title as enum ('president','vice_president','treasurer');
    create type public.member_status as enum ('active','inactive','pending');
    create type public.member_fee_plan as enum ('monthly','exempt');
    create table public.profiles (
      id uuid primary key, auth_user_id uuid unique references auth.users(id),
      name text not null, phone text, email text, role public.account_role,
      officer_title public.officer_title, fee_plan public.member_fee_plan,
      status public.member_status, is_system_admin boolean not null default false,
      updated_at timestamptz not null default now(),
      constraint profiles_base_role_check check (role in ('member','manager')),
      constraint profiles_manager_officer_title_check check ((role = 'manager' and officer_title is not null) or (role <> 'manager' and officer_title is null)),
      constraint profiles_member_fee_plan_check check ((role = 'member' and fee_plan is not null) or (role <> 'member' and fee_plan is null))
    );
    create table public.role_permissions (
      role public.account_role not null, permission text not null,
      constraint role_permissions_permission_check check(permission in (
        'roles.manage','officers.manage','members.manage','fees.manage','notices.manage',
        'events.manage','feedback.manage','elections.manage','polls.manage','surveys.manage')),
      primary key(role,permission)
    );
    create table public.officer_permissions (
      officer_title public.officer_title not null, permission text not null,
      constraint officer_permissions_permission_check check(permission in (
        'officers.manage','members.manage','fees.manage','notices.manage',
        'events.manage','feedback.manage','elections.manage','polls.manage','surveys.manage')),
      primary key(officer_title,permission)
    );
    insert into public.role_permissions values ('admin','roles.manage'),('admin','officers.manage');
    insert into public.officer_permissions values ('president','officers.manage'),
      ('president','members.manage'),('president','events.manage'),
      ('vice_president','members.manage'),('vice_president','events.manage'),('treasurer','fees.manage');
    alter table public.profiles enable row level security;
    alter table public.role_permissions enable row level security;
    alter table public.officer_permissions enable row level security;
    grant select on public.role_permissions, public.officer_permissions to authenticated;
  `);
  for (const name of ['private.normalize_member_phone', 'public.prepare_member_profile',
    'public.handle_new_user', 'private.has_permission', 'private.is_active_member',
    'private.can_manage_officer_permission']) {
    await db.exec(extractFunction(rosterSource, name));
  }
  for (const name of ['public.protect_account_role_permissions', 'public.protect_officer_permissions']) {
    await db.exec(extractFunction(officerSource, name));
  }
  await db.exec(`
    revoke all on function private.has_permission(text) from public, anon;
    grant execute on function private.has_permission(text) to authenticated;
    create trigger prepare_member_profile_before_write before insert or update of name,phone
      on public.profiles for each row execute function public.prepare_member_profile();
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
    create trigger protect_account_role_permissions_before_write before insert or update or delete
      on public.role_permissions for each row execute function public.protect_account_role_permissions();
    create trigger protect_officer_permissions_before_write before insert or update or delete
      on public.officer_permissions for each row execute function public.protect_officer_permissions();
    create policy "Active members read officer permissions" on public.officer_permissions
      for select to authenticated using ((select private.is_active_member()));
  `);
  const pgtap = process.argv[3]
    ? await readFile(path.resolve(process.argv[3]), 'utf8')
    : await (await fetch('https://raw.githubusercontent.com/theory/pgtap/v1.3.4/sql/pgtap.sql.in')).text();
  await db.exec(pgtap.replaceAll('__VERSION__', '1.034').replaceAll('__OS__', 'PGlite'));
  await db.exec(await source('20261002005032_welcome_page.sql'));
  const testSql = await readFile(path.join(root, 'supabase/tests/database/welcome_page.test.sql'), 'utf8');
  // Also compare the actual SQL rejection fixtures against the client contract.
  const results = await db.exec(testSql.replace('rollback;',
    "select label, content, false as publishing from welcome_invalid_payloads; " +
    "select label, content, true as publishing from welcome_incomplete_publications; rollback;"));
  const tap = results.flatMap((result) => result.rows.flatMap((row) => Object.values(row)
    .filter((value) => typeof value === 'string' && /^(?:not ok|ok \d|1\.\.|#)/.test(value))));
  const failures = tap.filter((line) => /^not ok/m.test(line));
  const assertions = tap.filter((line) => /^ok \d/.test(line));
  for (const failure of failures) console.error(failure);
  console.log(`PGlite PostgreSQL + pgTAP 1.3.4: ${assertions.length} passed, ${failures.length} failed`);
  console.log(tap.find((line) => /^1\.\./.test(line)) ?? 'Missing TAP plan');
  if (failures.length || !assertions.length) process.exitCode = 1;
  const { isApprovedIosUrl, validateWelcomeContent } = await import(pathToFileURL(path.join(root, 'lib/welcome-content.ts')).href);
  const rejected = results.flatMap((result) => result.rows.filter((row) => Object.hasOwn(row, 'publishing')));
  for (const fixture of rejected) {
    if (validateWelcomeContent(fixture.content, fixture.publishing).length === 0) {
      throw new Error('SQL/TypeScript content validation differs: ' + fixture.label);
    }
  }
  const urls = [
    'https://testflight.apple.com/join/AbC123',
    'https://apps.apple.com/kr/app/id123',
    'https://apps.apple.com/app/../id123',
    'https://apps.apple.com/app/%EA%B0%80',
    'https://apps.apple.com/app/id123?campaign=club#download',
    'https://apps.apple.com/app/id123?',
    'https://apps.apple.com/app/id123#',
    '', 'https://apps.apple.com/', 'http://apps.apple.com/app/id123',
    'HTTPS://apps.apple.com/app/id123', 'https://Apps.Apple.com/app/id123',
    'https://apps.apple.com:443/app/id123', 'https://testflight.apple.com:80/join/abc',
    'https://user@apps.apple.com/app/id123', 'https://apps.apple.com.evil.test/app/id123',
    'https://apps.apple.com/app/가', 'https://apps.apple.com/app/<id123>',
    'https://apps.apple.com/app/id 123', 'https://apps.apple.com/app/id123\t',
    'https://apps.apple.com/app/id123\n', 'https://apps.apple.com/app/id123\r',
    'https://apps.apple.com/app/id123\r\n', 'https://apps.apple.com/app/\\id123',
    'https://apps.apple.com/app/id123#download\n', 'https://apps.apple.com/?app=id123',
  ];
  for (const url of urls) {
    const { rows } = await db.query('select private.welcome_approved_ios_url($1) as approved', [url]);
    if (rows[0].approved !== isApprovedIosUrl(url)) throw new Error('SQL/TypeScript URL policy differs: ' + JSON.stringify(url));
  }
  console.log('SQL/TypeScript contract parity: ' + rejected.length + ' invalid content fixtures and ' + urls.length + ' URL cases passed');
} catch (error) {
  console.error(error.message);
  console.error(JSON.stringify({ code: error.code, detail: error.detail, where: error.where, position: error.position }));
  process.exitCode = 1;
} finally {
  await db.close();
}
