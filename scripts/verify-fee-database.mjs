import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.FEE_PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFile(path.join(root, name), "utf8");
const migrations = await readdir(path.join(root, "supabase/migrations"));
const matches = migrations.filter((name) => name.endsWith("_fix_fee_manager_policy_lookup.sql"));
assert.equal(matches.length, 1);
const migration = await read("supabase/migrations/" + matches[0]);
const accounts = await read("supabase/migrations/20260816111500_admin_managed_member_accounts.sql");
const basePolicy = await read("supabase/migrations/20260811123435_separate_system_admin_privilege.sql");
const baseDirectory = await read("supabase/migrations/20260909083249_require_linked_member_directory.sql");
function extractFunction(source, name) {
  const start = source.indexOf("create or replace function " + name + "(");
  assert.ok(start >= 0, "Existing function " + name);
  const end = source.indexOf("$$;", start);
  assert.ok(end > start);
  return source.slice(start, end + 3);
}
const memberId = (number) => "41010000-0000-0000-0000-" + String(number).padStart(12, "0");
const authId = (number) => "41000000-0000-0000-0000-" + String(number).padStart(12, "0");
const eventId = (number) => "42000000-0000-0000-0000-" + String(number).padStart(12, "0");
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function scalar(sql) { return (await db.query(sql)).rows[0]?.value; }
async function rejected(sql, pattern, label) { await assert.rejects(db.exec(sql), pattern, label); checks++; }
async function actor(number, role = "authenticated") {
  await db.exec("reset role; set request.jwt.claim.sub='" + (number ? authId(number) : "") + "'; set role " + role);
}
function fee(member, month, amount = 99999, type = "monthly", event = "null") {
  return "insert into public.fees(member_id,month,amount,fee_type,event_id) values('" + memberId(member) + "','" + month + "'," + amount + ",'" + type + "'," + event + ")";
}
try {
  await db.exec(await read("supabase/tests/fixtures/fee_domain.sql"));
  for (const name of ["private.current_profile_id", "private.has_permission"]) await db.exec(extractFunction(accounts, name));
  await db.exec(extractFunction(basePolicy, "public.apply_standard_fee_amount"));
  await db.exec(baseDirectory);
  await db.exec(`
    revoke all on function private.current_profile_id(), private.has_permission(text) from public, anon;
    grant execute on function private.current_profile_id(), private.has_permission(text) to authenticated, service_role;
    revoke execute on function public.apply_standard_fee_amount() from public, anon, authenticated;
    create trigger apply_standard_fee_amount_before_write before insert or update of member_id, fee_type, amount
      on public.fees for each row execute function public.apply_standard_fee_amount();
    create policy "Members read own profile" on public.profiles for select to authenticated
      using (auth_user_id = (select auth.uid()));
    create policy "Member managers read all profiles" on public.profiles for select to authenticated
      using (((not is_test_account) or (auth_user_id = (select auth.uid()))) and (select private.has_permission('members.manage')));
    create policy "Member managers update profiles" on public.profiles for update to authenticated
      using ((select private.has_permission('members.manage'))) with check ((select private.has_permission('members.manage')));
    create policy "Members read own fees" on public.fees for select to authenticated
      using (member_id = (select private.current_profile_id()) or (select private.has_permission('fees.manage')));
    create policy "Fee managers insert" on public.fees for insert to authenticated
      with check ((select private.has_permission('fees.manage')));
    create policy "Fee managers update" on public.fees for update to authenticated
      using ((select private.has_permission('fees.manage'))) with check ((select private.has_permission('fees.manage')));
    create policy "Fee managers delete" on public.fees for delete to authenticated
      using ((select private.has_permission('fees.manage')));
  `);
  const policies = (await db.query("select * from pg_policies order by tablename,policyname")).rows;
  await actor(1);
  equal(await scalar("select private.has_permission('fees.manage') as value"), true, "treasurer has fee permission");
  equal(await scalar("select private.has_permission('members.manage') as value"), false, "treasurer lacks member management");
  equal(await scalar("select count(*)::integer as value from public.profiles where id='" + memberId(3) + "'"), 0, "target profile is hidden by RLS");
  await rejected(fee(3, "2026-09-01"), /The member fee policy is not configured/, "reproduce reported failure with the real existing trigger");
  const baselineFields = Object.keys((await db.query("select * from public.get_member_directory() limit 1")).rows[0]);
  equal(baselineFields.includes("fee_plan"), false, "old roster omits the fee plan");

  await db.exec("reset role");
  await db.exec(migration);
  equal((await db.query("select * from pg_policies order by tablename,policyname")).rows, policies, "existing RLS is untouched");
  equal(await scalar("select prosecdef as value from pg_proc where oid='public.apply_standard_fee_amount()'::regprocedure"), false, "trigger remains an invoker");
  equal(await scalar("select prosecdef as value from pg_proc where oid='private.get_managed_fee_policy(uuid)'::regprocedure"), true, "minimal lookup runs privately");
  equal(await scalar("select has_function_privilege('anon','private.get_managed_fee_policy(uuid)','EXECUTE') as value"), false, "anon cannot call lookup");
  equal(await scalar("select has_function_privilege('service_role','private.get_managed_fee_policy(uuid)','EXECUTE') as value"), false, "service role does not gain lookup access");

  await actor(1);
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows, [{ role: "member", fee_plan: "monthly" }], "fee-only manager reads two policy fields");
  const directory = (await db.query("select * from public.get_member_directory()")).rows;
  equal(directory.find((row) => row.id === memberId(4)).fee_plan, "per_event", "treasurer can distinguish participation fees");
  equal(Object.keys(directory[0]), [...baselineFields, "fee_plan"], "only one compatible response field is added");
  equal(directory.some((row) => row.id === memberId(6)), false, "hidden accounts stay excluded");
  equal(directory.some((row) => row.id === memberId(9)), false, "inactive target roster stays excluded");
  equal(await scalar("select count(*)::integer as value from public.profiles where id<>'" + memberId(1) + "'"), 0, "private profile access stays unchanged");
  equal((await db.query("update public.profiles set phone='forbidden' where id='" + memberId(3) + "' returning id")).rows.length, 0, "treasurer cannot change another member profile");
  const monthly = (await db.query(fee(3, "2026-09-01") + " returning id, amount, created_at")).rows[0];
  equal(monthly.amount, 30000, "reported monthly insert succeeds at standard amount");
  const paid = (await db.query("insert into public.fees(id,member_id,month,amount,status,paid_at) values('" + monthly.id + "','" + memberId(3) + "','2026-09-01',1,'paid','2026-10-04T10:48:00Z') on conflict(id) do update set amount=excluded.amount,status=excluded.status,paid_at=excluded.paid_at returning id,amount,status,paid_at,created_at")).rows[0];
  equal(paid.id, monthly.id, "editor upsert preserves identity");
  equal(paid.created_at, monthly.created_at, "editor upsert preserves creation time");
  equal([paid.amount, paid.status], [30000, "paid"], "paid update keeps standard amount");
  equal(new Date(paid.paid_at).toISOString(), "2026-10-04T10:48:00.000Z", "payment timestamp is retained");
  await db.exec(fee(2, "2026-09-01"));
  equal(await scalar("select amount as value from public.fees where member_id='" + memberId(2) + "'"), 15000, "officer monthly amount stays 15000");
  await db.exec(fee(4, "2026-09-01", 99999, "participation", "'" + eventId(1) + "'"));
  equal(await scalar("select amount as value from public.fees where member_id='" + memberId(4) + "'"), 10000, "participation amount stays 10000");
  await rejected(fee(3, "2026-09-01"), /duplicate key/, "monthly uniqueness is preserved");
  await rejected(fee(4, "2026-09-01", 1, "participation", "'" + eventId(1) + "'"), /duplicate key/, "participation uniqueness is preserved");
  await rejected(fee(4, "2026-10-01"), /Per-event members use participation fees/, "participation members cannot receive monthly fees");
  await rejected(fee(3, "2026-09-01", 1, "participation", "'" + eventId(2) + "'"), /Monthly members use the monthly fee/, "monthly members cannot receive participation fees");
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(6) + "')")).rows.length, 0, "hidden test policy stays inaccessible");
  await rejected(fee(6, "2026-09-01"), /The member fee policy is not configured/, "treasurer cannot write a hidden test fee");

  await actor(5);
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows.length, 0, "ordinary members cannot read other fee policies");
  const memberDirectory = (await db.query("select * from public.get_member_directory()")).rows;
  equal(memberDirectory.find((row) => row.id === memberId(5)).fee_plan, "monthly", "own fee plan remains available");
  equal(memberDirectory.filter((row) => row.id !== memberId(5)).every((row) => row.fee_plan === null), true, "other fee plans stay redacted");
  await rejected(fee(5, "2026-10-01"), /row-level security/, "ordinary members cannot insert even their own fees");
  equal((await db.query("update public.fees set status='exempt' returning id")).rows.length, 0, "ordinary members cannot update fees");
  equal((await db.query("delete from public.fees returning id")).rows.length, 0, "ordinary members cannot delete fees");
  await actor(99);
  equal((await db.query("select * from public.get_member_directory()")).rows.length, 0, "unlinked users have no directory access");
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows.length, 0, "unlinked users have no policy access");
  await actor(0);
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows.length, 0, "no JWT identity denies lookup");
  await actor(0, "anon");
  await rejected("select * from private.get_managed_fee_policy('" + memberId(3) + "')", /permission denied/, "anonymous lookup denied");
  await rejected("select * from public.get_member_directory()", /permission denied/, "anonymous directory remains denied");
  for (const number of [7, 8]) {
    await actor(number);
    equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows.length, 0, "inactive or pending fee officer denied");
    await rejected(fee(3, "2026-10-01"), /The member fee policy is not configured/, "inactive or pending officer cannot insert");
  }
  await db.exec("reset role; delete from public.officer_permissions where officer_title='treasurer' and permission='fees.manage'");
  await actor(1);
  equal((await db.query("select * from private.get_managed_fee_policy('" + memberId(3) + "')")).rows.length, 0, "permission revocation applies immediately");
  equal((await db.query("select fee_plan from public.get_member_directory() where id='" + memberId(4) + "'")).rows[0].fee_plan, null, "revoked officer roster policy is redacted");
  equal((await db.query("update public.fees set status='exempt' returning id")).rows.length, 0, "revoked officer cannot update");

  await actor(2);
  await db.exec(fee(3, "2026-10-01"));
  equal(await scalar("select amount as value from public.fees where member_id='" + memberId(3) + "' and month='2026-10-01'"), 30000, "existing member-manager direct path still works");
  await actor(0, "service_role");
  await db.exec(fee(4, "2026-09-01", 1, "participation", "'" + eventId(2) + "'"));
  equal(await scalar("select amount as value from public.fees where event_id='" + eventId(2) + "'"), 10000, "trusted internal writes retain the direct lookup");
  await db.exec("reset role; set request.jwt.claim.sub=''");
  await db.exec(fee(3, "2026-11-01"));
  equal(await scalar("select amount as value from public.fees where month='2026-11-01'"), 30000, "trusted owner path works without a client identity");
  console.log(JSON.stringify({ passed: true, checks, baselineFailureReproduced: true, scope: "isolated PostgreSQL fee permission regression" }));
} finally {
  await db.close();
}
