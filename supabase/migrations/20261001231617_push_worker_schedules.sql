-- Provision Vault values separately; installing this migration never activates delivery.
create extension if not exists pg_net with schema extensions;

-- pg_net defaults to PUBLIC table access; queued headers contain the worker secret.
revoke all on table net.http_request_queue,net._http_response from public,anon,authenticated,service_role;
revoke all on sequence net.http_request_queue_id_seq from public,anon,authenticated,service_role;
revoke all on function net.http_post(text,jsonb,jsonb,jsonb,integer) from public,anon,authenticated,service_role;
grant all on table net.http_request_queue,net._http_response to postgres;
grant all on sequence net.http_request_queue_id_seq to postgres;
grant execute on function net.http_post(text,jsonb,jsonb,jsonb,integer) to postgres;

create or replace function private.invoke_notification_worker(action text) returns bigint
language plpgsql security definer set search_path='' as $$
declare worker_url text; worker_secret text;
begin
 if action is null or action not in ('dispatch','receipts') then
  raise exception 'Invalid notification worker action';
 end if;
 if not exists(select 1 from private.notification_runtime where enabled and allowed_project_id is not null
  and ((delivery_mode='test' and cardinality(test_auth_user_ids)>0)
   or (delivery_mode='production' and production_activated_at is not null))) then return null; end if;
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='gyungchung-push-worker-url';
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='gyungchung-push-worker-secret';
 if worker_url is distinct from 'https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker'
  or worker_secret is null or length(btrim(worker_secret))<32 or worker_secret~'[\r\n]' then return null; end if;
 return net.http_post(
  url:=worker_url,
  body:=jsonb_build_object('action',action),
  headers:=jsonb_build_object('Content-Type','application/json','x-push-worker-secret',worker_secret),
  timeout_milliseconds:=60000
 );
end; $$;

alter function private.invoke_notification_worker(text) owner to postgres;
revoke all on function private.invoke_notification_worker(text) from public,anon,authenticated,service_role;
grant execute on function private.invoke_notification_worker(text) to postgres;

-- Managed Postgres cannot alter cron usernames; cron.schedule uses the caller's role.
do $$
begin
 if current_user<>'postgres' then raise exception 'Push schedules must be installed as postgres'; end if;
end; $$;

-- Both jobs are committed inactive and owned by the administrative cron role.
select cron.alter_job(
 cron.schedule('gyungchung-push-dispatch','* * * * *',$cron$select private.invoke_notification_worker('dispatch');$cron$),
 active:=false
);
select cron.alter_job(
 cron.schedule('gyungchung-push-receipts','*/5 * * * *',$cron$select private.invoke_notification_worker('receipts');$cron$),
 active:=false
);
