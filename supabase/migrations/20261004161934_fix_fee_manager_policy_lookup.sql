-- Read only the fee policy needed by an authorized fee manager.
-- Profile RLS continues to protect contact and account information.
create function private.get_managed_fee_policy(target_member_id uuid)
returns table (role public.account_role, fee_plan public.member_fee_plan)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role, profile.fee_plan
  from public.profiles as profile
  where profile.id = target_member_id
    and not profile.is_test_account
    and (select auth.uid()) is not null
    and (select private.has_permission('fees.manage'));
$$;

revoke all on function private.get_managed_fee_policy(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.get_managed_fee_policy(uuid) to authenticated;

-- Keep the trigger as an invoker. Existing own-profile and trusted internal
-- writes retain their direct lookup; fee-only managers use the guarded lookup.
create or replace function public.apply_standard_fee_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member_role public.account_role;
  member_plan public.member_fee_plan;
begin
  select profile.role, profile.fee_plan
  into member_role, member_plan
  from public.profiles as profile
  where profile.id = new.member_id;

  if not found then
    select policy.role, policy.fee_plan
    into member_role, member_plan
    from private.get_managed_fee_policy(new.member_id) as policy;
  end if;

  if member_role = 'manager'::public.account_role then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Officers use the monthly officer fee';
    end if;
    new.amount := 15000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'monthly'::public.member_fee_plan
  then
    if new.fee_type <> 'monthly'::public.fee_type then
      raise exception 'Monthly members use the monthly fee';
    end if;
    new.amount := 30000;
  elsif member_role = 'member'::public.account_role
    and member_plan = 'per_event'::public.member_fee_plan
  then
    if new.fee_type <> 'participation'::public.fee_type then
      raise exception 'Per-event members use participation fees';
    end if;
    new.amount := 10000;
  else
    raise exception 'The member fee policy is not configured';
  end if;

  return new;
end;
$$;

revoke execute on function public.apply_standard_fee_amount()
from public, anon, authenticated;

-- Add only the fee plan to the existing roster response, gated by the same
-- fee permission. Existing web/mobile callers merge this additive field.
drop function public.get_member_directory();
create function public.get_member_directory()
returns table (
  id uuid,
  name text,
  role public.account_role,
  officer_title public.officer_title,
  is_system_admin boolean,
  "position" text,
  jersey_number integer,
  joined_at date,
  status public.member_status,
  fee_plan public.member_fee_plan
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.name,
    profile.role,
    profile.officer_title,
    profile.is_system_admin,
    profile.position,
    profile.jersey_number,
    profile.joined_at,
    profile.status,
    case when (select private.has_permission('fees.manage'))
        or profile.id = (select private.current_profile_id())
      then profile.fee_plan else null end
  from public.profiles as profile
  where (select auth.uid()) is not null
    and (select private.current_profile_id()) is not null
    and profile.status = 'active'::public.member_status
    and not profile.is_test_account
  order by profile.name;
$$;

revoke all on function public.get_member_directory() from public, anon;
grant execute on function public.get_member_directory() to authenticated;

notify pgrst, 'reload schema';
