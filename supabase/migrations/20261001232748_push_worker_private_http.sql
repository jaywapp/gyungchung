-- Use a synchronous request so worker authentication is never persisted in pg_net's public queue.
create extension if not exists http with schema extensions;

create table private.notification_worker_runs (
 id bigserial primary key,
 action text not null check(action in ('dispatch','receipts')),
 started_at timestamptz not null,
 finished_at timestamptz not null,
 http_status integer check(http_status between 100 and 599),
 processed integer check(processed between 0 and 100),
 error_code text check(error_code in ('http_failed','bad_response')),
 check(finished_at>=started_at),
 check((error_code is null and http_status is not null and http_status=200 and processed is not null) or (error_code is not null and processed is null))
);
create index notification_worker_runs_started_at_idx on private.notification_worker_runs(started_at);
alter table private.notification_worker_runs enable row level security;
revoke all on table private.notification_worker_runs from public,anon,authenticated,service_role;
revoke all on sequence private.notification_worker_runs_id_seq from public,anon,authenticated,service_role;
grant all on table private.notification_worker_runs to postgres;
grant all on sequence private.notification_worker_runs_id_seq to postgres;

create or replace function private.invoke_notification_worker(action text) returns bigint
language plpgsql security definer set search_path='' set client_min_messages='warning' set http.timeout_msec='60000' as $$
declare worker_url text; worker_secret text; response extensions.http_response; payload jsonb;
 started timestamptz; status integer; processed_count integer; failure text;
begin
 if action is null or action not in ('dispatch','receipts') then
  raise exception 'Invalid notification worker action';
 end if;
 if not exists(select 1 from private.notification_runtime where enabled and allowed_project_id is not null
  and ((delivery_mode='test' and cardinality(test_auth_user_ids)>0)
   or (delivery_mode='production' and production_activated_at is not null))) then return null; end if;
 -- pgsql-http emits optional headers at DEBUG2; reject any debug logging before reading credentials.
 if current_setting('log_min_messages') in ('debug1','debug2','debug3','debug4','debug5') then return null; end if;
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='gyungchung-push-worker-url';
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='gyungchung-push-worker-secret';
 if worker_url is distinct from 'https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker'
  or worker_secret is null or length(btrim(worker_secret))<32 or worker_secret~'[\r\n]' then return null; end if;
 started:=clock_timestamp();
 begin
  -- These options are supported by pgsql-http 1.6. Reset inherited session options first.
  perform extensions.http_reset_curlopt();
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5');
  perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1');
  perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2');
  -- Verify deployed libcurl redirect protections before activation; use standard Authorization only.
  select * into response from extensions.http(row(
   'POST',worker_url,
   array[row('Authorization','Bearer '||worker_secret)::extensions.http_header],
   'application/json',jsonb_build_object('action',action)::text
  )::extensions.http_request);
  if response.status between 100 and 599 then status:=response.status; end if;
 exception when others then
  failure:='http_failed';
 end;
 if failure is null then
  begin
   payload:=response.content::jsonb;
   if status is distinct from 200 or jsonb_typeof(payload) is distinct from 'object'
    or payload->>'action' is distinct from action or jsonb_typeof(payload->'processed') is distinct from 'number'
    or (payload->>'processed')!~'^(0|[1-9][0-9]{0,2})$' then
    failure:='bad_response';
   else
    processed_count:=(payload->>'processed')::integer;
    if processed_count>100 then processed_count:=null; failure:='bad_response'; end if;
   end if;
  exception when others then
   processed_count:=null; failure:='bad_response';
  end;
 end if;
 -- Neither request headers, response body, nor exception text are persisted or returned.
 delete from private.notification_worker_runs where started_at<started-interval '14 days';
 insert into private.notification_worker_runs(action,started_at,finished_at,http_status,processed,error_code)
 values(action,started,clock_timestamp(),status,processed_count,failure);
 return status::bigint;
end; $$;

alter function private.invoke_notification_worker(text) owner to postgres;
revoke all on function private.invoke_notification_worker(text) from public,anon,authenticated,service_role;
grant execute on function private.invoke_notification_worker(text) to postgres;

-- Preserve the existing cadence while activation remains an explicit deployment step.
select cron.alter_job(jobid,active:=false) from cron.job
 where jobname in ('gyungchung-push-dispatch','gyungchung-push-receipts');
