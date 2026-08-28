create table private.mcp_audit_logs (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  occurred_at timestamptz not null default now(),
  operator_profile_id uuid not null references public.profiles(id) on delete restrict,
  oauth_client_id text not null check (char_length(oauth_client_id) between 1 and 500),
  entrypoint text not null check (entrypoint in ('api', 'mcp')),
  operation text not null check (char_length(operation) between 1 and 100),
  outcome text not null check (outcome in ('success', 'denied', 'error')),
  duration_ms integer not null check (duration_ms >= 0),
  returned_count integer not null check (returned_count >= 0),
  sensitive_fields_accessed boolean not null default false
);

create index mcp_audit_logs_occurred_at_idx
on private.mcp_audit_logs (occurred_at desc);

create index mcp_audit_logs_operator_idx
on private.mcp_audit_logs (operator_profile_id, occurred_at desc);

revoke all on private.mcp_audit_logs from public, anon, authenticated, service_role;

create or replace function private.prune_expired_mcp_audit_logs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.mcp_audit_logs
  where occurred_at < now() - interval '90 days';
  return new;
end;
$$;

revoke all on function private.prune_expired_mcp_audit_logs()
from public, anon, authenticated, service_role;

create trigger prune_expired_mcp_audit_logs_after_insert
after insert on private.mcp_audit_logs
for each statement execute function private.prune_expired_mcp_audit_logs();

create or replace function public.mcp_write_audit(
  audit_request_id uuid,
  audit_operation text,
  audit_entrypoint text,
  audit_outcome text,
  audit_duration_ms integer,
  audit_returned_count integer,
  audit_sensitive_fields_accessed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  actor_client_id text;
begin
  select profile.id
  into actor_profile_id
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'active'::public.member_status
    and (
      profile.is_system_admin
      or (
        profile.role = 'manager'::public.account_role
        and exists (
          select 1
          from public.officer_permissions as permission
          where permission.officer_title = profile.officer_title
        )
      )
    );

  actor_client_id := nullif((select auth.jwt() ->> 'client_id'), '');
  if actor_profile_id is null or actor_client_id is null then
    raise exception 'An active OAuth-authenticated operator is required';
  end if;

  insert into private.mcp_audit_logs (
    request_id,
    operator_profile_id,
    oauth_client_id,
    entrypoint,
    operation,
    outcome,
    duration_ms,
    returned_count,
    sensitive_fields_accessed
  ) values (
    audit_request_id,
    actor_profile_id,
    actor_client_id,
    audit_entrypoint,
    audit_operation,
    audit_outcome,
    audit_duration_ms,
    audit_returned_count,
    audit_sensitive_fields_accessed
  );
end;
$$;

revoke all on function public.mcp_write_audit(uuid, text, text, text, integer, integer, boolean)
from public, anon, service_role;
grant execute on function public.mcp_write_audit(uuid, text, text, text, integer, integer, boolean)
to authenticated;

create or replace function public.mcp_admin_list_profiles(include_test_accounts boolean default false)
returns table (
  id uuid,
  auth_user_id uuid,
  name text,
  email text,
  phone text,
  role public.account_role,
  officer_title public.officer_title,
  is_system_admin boolean,
  is_test_account boolean,
  fee_plan public.member_fee_plan,
  "position" text,
  jersey_number integer,
  joined_at date,
  status public.member_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_is_system_admin boolean;
begin
  if not (select private.has_permission('members.manage')) then
    raise exception 'Member management permission is required';
  end if;

  select profile.is_system_admin
  into actor_is_system_admin
  from public.profiles as profile
  where profile.auth_user_id = (select auth.uid())
    and profile.status = 'active'::public.member_status;

  if include_test_accounts and not coalesce(actor_is_system_admin, false) then
    raise exception 'Only a system administrator can include test accounts';
  end if;

  return query
  select
    profile.id,
    profile.auth_user_id,
    profile.name,
    profile.email,
    profile.phone,
    profile.role,
    profile.officer_title,
    profile.is_system_admin,
    profile.is_test_account,
    profile.fee_plan,
    profile.position,
    profile.jersey_number,
    profile.joined_at,
    profile.status
  from public.profiles as profile
  where include_test_accounts or not profile.is_test_account
  order by profile.name, profile.id;
end;
$$;

revoke all on function public.mcp_admin_list_profiles(boolean)
from public, anon, service_role;
grant execute on function public.mcp_admin_list_profiles(boolean)
to authenticated;

create or replace function public.mcp_admin_participation_results(target_form_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_kind public.participation_kind;
begin
  select form.kind
  into target_kind
  from public.participation_forms as form
  where form.id = target_form_id;

  if target_kind is null then
    raise exception 'Participation form not found';
  end if;

  if target_kind = 'election' and not (select private.has_permission('elections.manage')) then
    raise exception 'Election management permission is required';
  elsif target_kind = 'poll' and not (select private.has_permission('polls.manage')) then
    raise exception 'Poll management permission is required';
  elsif target_kind = 'survey' and not (select private.has_permission('surveys.manage')) then
    raise exception 'Survey management permission is required';
  end if;

  return private.aggregate_participation_results(target_form_id);
end;
$$;

revoke all on function public.mcp_admin_participation_results(uuid)
from public, anon, service_role;
grant execute on function public.mcp_admin_participation_results(uuid)
to authenticated;
