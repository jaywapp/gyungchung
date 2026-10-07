-- Apply after the existing profile/phone fixture setup. Synthetic records only.
alter table public.officer_permissions add constraint officer_permissions_permission_check
check (permission in (
  'members.manage', 'fees.manage', 'notices.manage', 'events.manage',
  'feedback.manage', 'elections.manage', 'polls.manage', 'surveys.manage', 'welcome.manage'
));
insert into public.officer_permissions values ('vice_president', 'members.manage');
insert into auth.users(id)
select ('51000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid
from generate_series(13,21) as number;
insert into public.profiles (
  id, auth_user_id, name, phone, role, officer_title, fee_plan, status,
  is_system_admin, is_test_account, must_change_password
)
select ('51010000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 20 then null else ('51000000-0000-0000-0000-' || lpad(number::text, 12, '0'))::uuid end,
  'Overall Fixture ' || number, '+82105100' || lpad(number::text, 4, '0'),
  case when number in (13,14,15,16,20) then 'manager'::public.account_role else 'member'::public.account_role end,
  case when number in (13,14,15,16,20) then 'vice_president'::public.officer_title else null end,
  case when number in (13,14,15,16,20) then null else 'monthly'::public.member_fee_plan end,
  case when number = 16 then 'pending'::public.member_status
    when number = 17 then 'inactive'::public.member_status else 'active'::public.member_status end,
  number in (18,19), number in (14,19), number in (15,18)
from generate_series(13,21) as number;
