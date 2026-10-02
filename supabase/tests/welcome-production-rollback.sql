-- Production smoke checks use real PostgreSQL policies and RPCs.
-- Every fixture, permission change, and publication is rolled back in a subtransaction.
-- No account IDs, credentials, or member data are returned.
do $verification$
declare
  checks integer := 0;
  payload jsonb := '{"schemaVersion":1,"title":"Welcome verification","introduction":"Temporary verification","accountSteps":[{"title":"Account","body":"Ask the club"}],"officers":[],"android":{"enabled":true,"installSteps":[{"title":"Install","body":"Open APK"}]},"ios":{"status":"preparing","message":"Coming soon","url":""}}';
  actor integer;
  invalid jsonb;
  current_draft public.welcome_page_drafts;
  current_publication public.welcome_page_publications;
  first_published_at timestamptz;
begin
  begin
    if exists(select 1 from public.welcome_page_drafts) or exists(select 1 from public.welcome_page_publications) then
      raise exception 'Run this initial smoke check before initial content is published';
    end if;
    if exists(select 1 from public.profiles where id between '89810000-0000-0000-0000-000000000001' and '89810000-0000-0000-0000-000000000007')
      or exists(select 1 from auth.users where id between '89800000-0000-0000-0000-000000000001' and '89800000-0000-0000-0000-000000000007') then
      raise exception 'Verification identities already exist';
    end if;
    insert into public.profiles(id,name,phone,role,officer_title,fee_plan,status,is_system_admin) values
      ('89810000-0000-0000-0000-000000000001','Welcome QA President','010-8980-0001','manager','president',null,'active',false),
      ('89810000-0000-0000-0000-000000000002','Welcome QA Member','010-8980-0002','member',null,'monthly','active',false),
      ('89810000-0000-0000-0000-000000000003','Welcome QA Delegate','010-8980-0003','manager','vice_president',null,'active',false),
      ('89810000-0000-0000-0000-000000000004','Welcome QA Inactive','010-8980-0004','manager','president',null,'inactive',false),
      ('89810000-0000-0000-0000-000000000005','Welcome QA Unlinked','010-8980-0005','manager','president',null,'active',false),
      ('89810000-0000-0000-0000-000000000006','Welcome QA Admin','010-8980-0006','member',null,'monthly','active',true),
      ('89810000-0000-0000-0000-000000000007','Welcome QA Pending','010-8980-0007','manager','president',null,'pending',false);
    insert into auth.users(id,instance_id,aud,role,phone,raw_app_meta_data,raw_user_meta_data)
    select ('89800000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      '+82108980000'||n::text,'{}'::jsonb,
      jsonb_build_object('member_id','89810000-0000-0000-0000-'||lpad(n::text,12,'0'))
    from generate_series(1,7) as fixture(n);
    update public.profiles set auth_user_id=null where id='89810000-0000-0000-0000-000000000005';

    execute 'set local role anon';
    perform count(*) from public.welcome_page_publications;
    checks := checks+1;
    begin
      perform count(*) from public.welcome_page_drafts;
      raise exception 'Anonymous draft read was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    begin
      perform public.save_welcome_page_draft(payload,0);
      raise exception 'Anonymous save was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    begin
      perform public.publish_welcome_page(0);
      raise exception 'Anonymous publish was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    execute 'reset role';

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000001',true);
    if not private.has_permission('welcome.manage') then raise exception 'President permission missing'; end if;
    checks := checks+1;
    select * into current_draft from public.save_welcome_page_draft(payload,0);
    if current_draft.revision<>1 or current_draft.published_revision is not null then raise exception 'Save/publication separation failed'; end if;
    checks := checks+1;
    if exists(select 1 from public.welcome_page_publications) then raise exception 'Save changed publication'; end if;
    checks := checks+1;
    begin
      perform public.save_welcome_page_draft(payload,0);
      raise exception 'Stale save was allowed';
    exception when serialization_failure then checks := checks+1; end;
    begin
      perform public.publish_welcome_page(2);
      raise exception 'Stale publication was allowed';
    exception when serialization_failure then checks := checks+1; end;
    begin
      insert into public.welcome_page_drafts(id,content,revision) values(true,payload,2);
      raise exception 'Direct draft insert was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    begin
      update public.welcome_page_publications set content=payload;
      raise exception 'Direct publication update was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    select * into current_publication from public.publish_welcome_page(1);
    if current_publication.revision<>1 or current_publication.content<>payload then raise exception 'Publication failed'; end if;
    checks := checks+1;
    first_published_at := current_publication.published_at;
    select * into current_publication from public.publish_welcome_page(1);
    if current_publication.published_at<>first_published_at then raise exception 'Idempotent publication changed timestamp'; end if;
    checks := checks+1;
    begin
      perform private.validate_welcome_content(payload,true);
      raise exception 'Direct validator execution was allowed';
    exception when insufficient_privilege then checks := checks+1; end;
    execute 'reset role';

    foreach actor in array array[2,3,4,5,7] loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub','89800000-0000-0000-0000-'||lpad(actor::text,12,'0'),true);
      if private.has_permission('welcome.manage') then raise exception 'Unauthorized actor has permission'; end if;
      checks := checks+1;
      if exists(select 1 from public.welcome_page_drafts) then raise exception 'Unauthorized actor reads draft'; end if;
      checks := checks+1;
      begin
        perform public.save_welcome_page_draft(payload,1);
        raise exception 'Unauthorized actor saved';
      exception when insufficient_privilege then checks := checks+1; end;
      begin
        perform public.publish_welcome_page(1);
        raise exception 'Unauthorized actor published';
      exception when insufficient_privilege then checks := checks+1; end;
      if (select count(*) from public.welcome_page_publications)<>1 then raise exception 'Publication unavailable to member'; end if;
      checks := checks+1;
      execute 'reset role';
    end loop;

    insert into public.officer_permissions(officer_title,permission) values('vice_president','welcome.manage');
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000003',true);
    select * into current_draft from public.save_welcome_page_draft(payload,1);
    if current_draft.revision<>2 or current_draft.published_revision<>1 then raise exception 'Delegated save failed'; end if;
    checks := checks+1;
    if (select revision from public.welcome_page_publications where id)<>1 then raise exception 'Delegated save changed publication'; end if;
    checks := checks+1;
    execute 'reset role';
    delete from public.officer_permissions where officer_title='vice_president' and permission='welcome.manage';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000003',true);
    begin
      perform public.save_welcome_page_draft(payload,2);
      raise exception 'Revoked delegate saved';
    exception when insufficient_privilege then checks := checks+1; end;
    execute 'reset role';

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub','89800000-0000-0000-0000-000000000006',true);
    if not private.has_permission('welcome.manage') then raise exception 'System administrator permission missing'; end if;
    checks := checks+1;
    select * into current_publication from public.publish_welcome_page(2);
    if current_publication.revision<>2 then raise exception 'System administrator publication failed'; end if;
    checks := checks+1;
    execute 'reset role';

    for invalid in select value from jsonb_array_elements(jsonb_build_array(
      payload||'{"rules":{}}',payload||'{"privateNotes":"secret"}',
      jsonb_set(payload,'{ios,url}','"http://apps.apple.com/app/id123"'),
      jsonb_set(payload,'{ios,url}','"https://apps.apple.com.evil.test/app/id123"'),
      jsonb_set(payload,'{ios,status}','"released"'),
      jsonb_set(payload,'{title}','""')
    )) loop
      begin
        perform private.validate_welcome_content(invalid,true);
        raise exception 'Invalid content was accepted';
      exception when invalid_parameter_value then checks := checks+1; end;
    end loop;
    execute 'set local role anon';
    if (select revision from public.welcome_page_publications where id)<>2 then raise exception 'Anonymous publication unavailable'; end if;
    checks := checks+1;
    execute 'reset role';
    raise exception using errcode='P0099',message='Rollback successful verification';
  exception when sqlstate 'P0099' then null;
  end;
  perform set_config('welcome.verification',jsonb_build_object('checks',checks,'rolled_back',true)::text,true);
end;
$verification$;
select current_setting('welcome.verification')::jsonb as verification;
