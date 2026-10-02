-- Keep the signing key inside Vault; browsers can read only its public point.
create table private.web_push_configuration (
 singleton boolean primary key default true check(singleton),
 public_key text not null check(public_key ~ '^B[A-Za-z0-9_-]{86}$'),
 secret_id uuid not null unique,
 subject text not null default 'https://gyungchung.vercel.app' check(subject='https://gyungchung.vercel.app')
);
alter table private.web_push_configuration enable row level security;
revoke all on table private.web_push_configuration from public,anon,authenticated,service_role;
grant all on table private.web_push_configuration to postgres;

create function public.get_web_push_config() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config private.web_push_configuration%rowtype; signing_key text;
begin
 select * into config from private.web_push_configuration where singleton;
 if not found then return null; end if;
 select decrypted_secret into signing_key from vault.decrypted_secrets where id=config.secret_id;
 if signing_key is null or signing_key !~ '^[A-Za-z0-9_-]{43}$' then
  raise exception 'Web push signing configuration unavailable';
 end if;
 return jsonb_build_object('public_key',config.public_key,'private_key',signing_key,'subject',config.subject);
end; $$;
alter function public.get_web_push_config() owner to postgres;
revoke all on function public.get_web_push_config() from public,anon,authenticated,service_role;
grant execute on function public.get_web_push_config() to service_role;

create function public.initialize_web_push_config(target_public_key text,target_private_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing jsonb; signing_secret_id uuid; public_bytes bytea; private_bytes bytea;
begin
 -- All first writers use the same transaction lock and re-read after acquiring it.
 perform pg_advisory_xact_lock(782649521371::bigint);
 existing:=public.get_web_push_config();
 if existing is not null then return existing; end if;
 if target_public_key is null or target_public_key !~ '^B[A-Za-z0-9_-]{86}$'
  or target_private_key is null or target_private_key !~ '^[A-Za-z0-9_-]{43}$' then
  raise exception 'Invalid web push signing configuration';
 end if;
 public_bytes:=decode(translate(target_public_key,'-_','+/')||'=','base64');
 private_bytes:=decode(translate(target_private_key,'-_','+/')||'=','base64');
 if octet_length(public_bytes)<>65 or get_byte(public_bytes,0)<>4 or octet_length(private_bytes)<>32
  or replace(translate(encode(public_bytes,'base64'),'+/','-_'),E'\n','')<>target_public_key||'='
  or replace(translate(encode(private_bytes,'base64'),'+/','-_'),E'\n','')<>target_private_key||'='
  or private_bytes=decode(repeat('00',32),'hex') then
  raise exception 'Invalid web push signing configuration';
 end if;
 begin
  signing_secret_id:=vault.create_secret(target_private_key,'gyungchung-web-push-vapid-private-key','Web push signing key');
  insert into private.web_push_configuration(public_key,secret_id) values(target_public_key,signing_secret_id);
 exception when others then
  -- Vault errors must never echo the candidate key into an RPC response.
  raise exception 'Web push signing initialization failed';
 end;
 return public.get_web_push_config();
end; $$;
alter function public.initialize_web_push_config(text,text) owner to postgres;
revoke all on function public.initialize_web_push_config(text,text) from public,anon,authenticated,service_role;
grant execute on function public.initialize_web_push_config(text,text) to service_role;

create function public.get_web_push_public_key() returns text
language sql stable security definer set search_path='' as $$
 select public_key from private.web_push_configuration where singleton;
$$;
alter function public.get_web_push_public_key() owner to postgres;
revoke all on function public.get_web_push_public_key() from public,anon,authenticated,service_role;
grant execute on function public.get_web_push_public_key() to anon,authenticated,service_role;

-- Synchronous HTTP keeps the shared worker credential out of pg_net's public queue.
create table private.web_notification_worker_runs (
 id bigserial primary key, started_at timestamptz not null, finished_at timestamptz not null,
 http_status integer check(http_status between 100 and 599), processed integer check(processed between 0 and 100),
 error_code text check(error_code in ('http_failed','bad_response')),
 check(finished_at>=started_at),
 check((error_code is null and http_status=200 and processed is not null and http_status is not null)
  or (error_code is not null and processed is null))
);
create index web_notification_worker_runs_started_at_idx on private.web_notification_worker_runs(started_at);
alter table private.web_notification_worker_runs enable row level security;
revoke all on table private.web_notification_worker_runs from public,anon,authenticated,service_role;
revoke all on sequence private.web_notification_worker_runs_id_seq from public,anon,authenticated,service_role;
grant all on table private.web_notification_worker_runs to postgres;
grant all on sequence private.web_notification_worker_runs_id_seq to postgres;

create function private.invoke_web_notification_worker(force_initialization boolean default false) returns bigint
language plpgsql security definer set search_path='' set client_min_messages='warning' as $$
declare worker_url text; worker_secret text; response extensions.http_response; payload jsonb;
 started timestamptz; status integer; processed_count integer; failure text; runtime private.web_push_runtime%rowtype;
begin
 if force_initialization is null then return null; end if;
 -- Hold the disabled state through bootstrap so activation cannot race its HTTP request.
 select * into runtime from private.web_push_runtime where singleton for share;
 if not found then return null; end if;
 if force_initialization then
  -- The authenticated worker loads configuration before its disabled delivery gate.
  if runtime.enabled then return null; end if;
 else
  if not runtime.enabled or runtime.activated_at is null then return null; end if;
 end if;
 if current_setting('log_min_messages') in ('debug1','debug2','debug3','debug4','debug5') then return null; end if;
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='gyungchung-push-worker-url';
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='gyungchung-push-worker-secret';
 if worker_url is distinct from 'https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/push-worker'
  or worker_secret is null or length(btrim(worker_secret))<32 or worker_secret~'[\r\n]' then return null; end if;
 worker_url:='https://pamvwzgqkzgsygslmfqo.supabase.co/functions/v1/web-push-worker';
 started:=clock_timestamp();
 begin
  perform extensions.http_reset_curlopt();
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','60000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5');
  perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1');
  perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2');
  select * into response from extensions.http(row(
   'POST',worker_url,array[row('Authorization','Bearer '||worker_secret)::extensions.http_header],
   'application/json',jsonb_build_object('action','dispatch')::text
  )::extensions.http_request);
  if response.status between 100 and 599 then status:=response.status; end if;
 exception when others then
  failure:='http_failed';
 end;
 if failure is null then
  begin
   payload:=response.content::jsonb;
   if status is distinct from 200 or jsonb_typeof(payload) is distinct from 'object'
    or payload->>'action' is distinct from 'dispatch' or jsonb_typeof(payload->'processed') is distinct from 'number'
    or (payload->>'processed')!~'^(0|[1-9][0-9]{0,2})$' then
    failure:='bad_response';
   else
    processed_count:=(payload->>'processed')::integer;
    if processed_count>100 or (force_initialization and processed_count<>0) then processed_count:=null; failure:='bad_response'; end if;
   end if;
  exception when others then
   processed_count:=null; failure:='bad_response';
  end;
 end if;
 delete from private.web_notification_worker_runs where started_at<started-interval '14 days';
 insert into private.web_notification_worker_runs(started_at,finished_at,http_status,processed,error_code)
 values(started,clock_timestamp(),status,processed_count,failure);
 return status::bigint;
end; $$;
alter function private.invoke_web_notification_worker(boolean) owner to postgres;
revoke all on function private.invoke_web_notification_worker(boolean) from public,anon,authenticated,service_role;
grant execute on function private.invoke_web_notification_worker(boolean) to postgres;

select cron.schedule('gyungchung-web-push-dispatch','* * * * *','select private.invoke_web_notification_worker()');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='gyungchung-web-push-dispatch';
