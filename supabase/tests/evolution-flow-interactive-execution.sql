BEGIN;

-- All rows, including synthetic auth users, are rolled back. No provider calls.
DO $fixture$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_connection_a uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_contact_list uuid;
  v_conversation_list uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_run_a uuid;
  v_run_b uuid;
  v_run_list uuid;
  v_event_list_start uuid := gen_random_uuid();
  v_event_list_reply uuid := gen_random_uuid();
  v_event_start uuid := gen_random_uuid();
  v_event_reply uuid := gen_random_uuid();
  v_event_tenant uuid := gen_random_uuid();
  v_dispatch_list_start uuid := gen_random_uuid();
  v_dispatch_list_reply uuid := gen_random_uuid();
  v_dispatch_start uuid := gen_random_uuid();
  v_dispatch_reply uuid := gen_random_uuid();
  v_dispatch_tenant uuid := gen_random_uuid();
  v_step_list_prompt uuid := gen_random_uuid();
  v_step_list_reply uuid := gen_random_uuid();
  v_step_prompt uuid := gen_random_uuid();
  v_step_reply uuid := gen_random_uuid();
  v_step_tenant uuid := gen_random_uuid();
  v_list_attempt uuid := gen_random_uuid();
  v_list_prompt_message uuid := gen_random_uuid();
  v_prompt_attempt uuid := gen_random_uuid();
  v_prompt_message uuid := gen_random_uuid();
  v_root_token_list_start uuid := gen_random_uuid();
  v_root_token_list_reply uuid := gen_random_uuid();
  v_root_token_start uuid := gen_random_uuid();
  v_root_token_reply uuid := gen_random_uuid();
  v_root_token_tenant uuid := gen_random_uuid();
  v_step_token_list_prompt uuid := gen_random_uuid();
  v_step_token_list_reply uuid := gen_random_uuid();
  v_step_token_prompt uuid := gen_random_uuid();
  v_step_token_reply uuid := gen_random_uuid();
  v_step_token_tenant uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
  VALUES
    (v_user_a,'authenticated','authenticated',v_user_a::text || '@flow-interactive-a.invalid','',now(),
     '{"provider":"email","providers":["email"]}','{"full_name":"Synthetic Flow A"}'),
    (v_user_b,'authenticated','authenticated',v_user_b::text || '@flow-interactive-b.invalid','',now(),
     '{"provider":"email","providers":["email"]}','{"full_name":"Synthetic Flow B"}');
  SELECT account_id INTO STRICT v_account_a FROM public.profiles WHERE user_id=v_user_a;
  SELECT account_id INTO STRICT v_account_b FROM public.profiles WHERE user_id=v_user_b;

  INSERT INTO public.flows(user_id,account_id,name,status,trigger_type,trigger_config,entry_node_id)
  VALUES(v_user_a,v_account_a,'Synthetic Interactive A','active','keyword','{"keywords":["synthetic"]}','buttons') RETURNING id INTO v_flow_a;
  INSERT INTO public.flows(user_id,account_id,name,status,trigger_type,trigger_config,entry_node_id)
  VALUES(v_user_b,v_account_b,'Synthetic Interactive B','active','keyword','{"keywords":["synthetic"]}','buttons') RETURNING id INTO v_flow_b;
  INSERT INTO public.flow_nodes(flow_id,node_key,node_type,config) VALUES
    (v_flow_a,'buttons','send_buttons','{"buttons":[{"reply_id":"BTN_NEXT","title":"Continue","next_node_key":"end"},{"reply_id":"BTN_OTHER","title":"Other","next_node_key":"end"}]}'::jsonb),
    (v_flow_a,'list','send_list','{"sections":[{"rows":[{"reply_id":"ROW_NEXT","title":"Details","next_node_key":"end"}]}]}'::jsonb),
    (v_flow_a,'end','end','{}'::jsonb),
    (v_flow_b,'buttons','send_buttons','{"buttons":[{"reply_id":"BTN_NEXT","title":"Continue","next_node_key":"end"}]}'::jsonb),
    (v_flow_b,'end','end','{}'::jsonb);
  INSERT INTO public.whatsapp_connections(account_id,created_by,provider,base_url,instance_name,token_encrypted,webhook_secret_encrypted)
  VALUES(v_account_a,v_user_a,'evolution','http://127.0.0.1:8080','synthetic-flow-interactive','synthetic','synthetic') RETURNING id INTO v_connection_a;
  INSERT INTO public.contacts(user_id,account_id,phone,name) VALUES
    (v_user_a,v_account_a,'+15550009001','Synthetic A') RETURNING id INTO v_contact_a;
  INSERT INTO public.contacts(user_id,account_id,phone,name) VALUES
    (v_user_b,v_account_b,'+15550009002','Synthetic B') RETURNING id INTO v_contact_b;
  INSERT INTO public.conversations(user_id,account_id,contact_id,status) VALUES
    (v_user_a,v_account_a,v_contact_a,'open') RETURNING id INTO v_conversation_a;
  INSERT INTO public.conversations(user_id,account_id,contact_id,status) VALUES
    (v_user_b,v_account_b,v_contact_b,'open') RETURNING id INTO v_conversation_b;
  INSERT INTO public.contacts(user_id,account_id,phone,name) VALUES
    (v_user_a,v_account_a,'+15550009003','Synthetic list') RETURNING id INTO v_contact_list;
  INSERT INTO public.conversations(user_id,account_id,contact_id,status) VALUES
    (v_user_a,v_account_a,v_contact_list,'open') RETURNING id INTO v_conversation_list;
  INSERT INTO public.flow_runs(flow_id,account_id,user_id,contact_id,conversation_id,status,current_node_key,transition_seq)
  VALUES(v_flow_a,v_account_a,v_user_a,v_contact_a,v_conversation_a,'active','buttons',0) RETURNING id INTO v_run_a;
  INSERT INTO public.flow_runs(flow_id,account_id,user_id,contact_id,conversation_id,status,current_node_key,transition_seq)
  VALUES(v_flow_a,v_account_a,v_user_a,v_contact_list,v_conversation_list,'active','list',0) RETURNING id INTO v_run_list;
  INSERT INTO public.flow_runs(flow_id,account_id,user_id,contact_id,conversation_id,status,current_node_key,transition_seq)
  VALUES(v_flow_b,v_account_b,v_user_b,v_contact_b,v_conversation_b,'active','buttons',0) RETURNING id INTO v_run_b;

  INSERT INTO public.evolution_events(id,connection_id,event_key,normalized_event,state,attempts,processed_at)
  VALUES
    (v_event_list_start,v_connection_a,'message:synthetic-list-start',jsonb_build_object(
      'kind','message','contentType','text','text','synthetic trigger','externalMessageId','SYNTHETIC_LIST_START',
      'fromMe',false,'sentByApi',false,'peer','15550009003@s.whatsapp.net','occurredAt',now()),'done',1,now()),
    (v_event_list_reply,v_connection_a,'message:synthetic-list-reply',jsonb_build_object(
      'kind','message','contentType','interactive','text','Details','externalMessageId','SYNTHETIC_LIST_REPLY',
      'interactiveReplyId','ROW_NEXT','interactiveReplyKind','list','fromMe',false,'sentByApi',false,
      'peer','15550009003@s.whatsapp.net','occurredAt',now()+interval '2 seconds'),'done',1,now()),
    (v_event_start,v_connection_a,'message:synthetic-start',jsonb_build_object(
      'kind','message','contentType','text','text','synthetic trigger','externalMessageId','SYNTHETIC_START',
      'fromMe',false,'sentByApi',false,'peer','15550009001@s.whatsapp.net','occurredAt',now()),'done',1,now()),
    (v_event_reply,v_connection_a,'message:synthetic-reply',jsonb_build_object(
      'kind','message','contentType','interactive','text','Continue','externalMessageId','SYNTHETIC_REPLY',
      'interactiveReplyId','BTN_NEXT','interactiveReplyKind','button','fromMe',false,'sentByApi',false,
      'peer','15550009001@s.whatsapp.net','occurredAt',now()+interval '2 seconds'),'done',1,now()),
    (v_event_tenant,v_connection_a,'message:synthetic-tenant',jsonb_build_object(
      'kind','message','contentType','interactive','text','Continue','externalMessageId','SYNTHETIC_TENANT',
      'interactiveReplyId','BTN_NEXT','interactiveReplyKind','button','fromMe',false,'sentByApi',false,
      'peer','15550009002@s.whatsapp.net','occurredAt',now()+interval '2 seconds'),'done',1,now());
  INSERT INTO public.messages(conversation_id,sender_type,sender_id,content_type,content_text,interactive_reply_id,message_id,status,created_at,provider_connection_id)
  VALUES
    (v_conversation_list,'customer',v_user_a,'text','synthetic trigger',NULL,'SYNTHETIC_LIST_START','sent',now(),v_connection_a),
    (v_conversation_list,'customer',v_user_a,'interactive','Details','ROW_NEXT','SYNTHETIC_LIST_REPLY','sent',now()+interval '2 seconds',v_connection_a),
    (v_conversation_a,'customer',v_user_a,'text','synthetic trigger',NULL,'SYNTHETIC_START','sent',now(),v_connection_a),
    (v_conversation_a,'customer',v_user_a,'interactive','Continue','BTN_NEXT','SYNTHETIC_REPLY','sent',now()+interval '2 seconds',v_connection_a);

  INSERT INTO public.evolution_event_dispatches(id,event_id,account_id,engine,flow_id,user_id,flow_run_id,contact_id,conversation_id,state,attempts,lease_until,lease_token)
  VALUES
    (v_dispatch_list_start,v_event_list_start,v_account_a,'flow',v_flow_a,v_user_a,v_run_list,v_contact_list,v_conversation_list,'processing',1,now()+interval '5 minutes',v_root_token_list_start),
    (v_dispatch_list_reply,v_event_list_reply,v_account_a,'flow',v_flow_a,v_user_a,v_run_list,v_contact_list,v_conversation_list,'processing',1,now()+interval '5 minutes',v_root_token_list_reply),
    (v_dispatch_start,v_event_start,v_account_a,'flow',v_flow_a,v_user_a,v_run_a,v_contact_a,v_conversation_a,'processing',1,now()+interval '5 minutes',v_root_token_start),
    (v_dispatch_reply,v_event_reply,v_account_a,'flow',v_flow_a,v_user_a,v_run_a,v_contact_a,v_conversation_a,'processing',1,now()+interval '5 minutes',v_root_token_reply),
    (v_dispatch_tenant,v_event_tenant,v_account_b,'flow',v_flow_b,v_user_b,v_run_b,v_contact_b,v_conversation_b,'processing',1,now()+interval '5 minutes',v_root_token_tenant);

  INSERT INTO public.messages(id,conversation_id,sender_type,sender_id,content_type,content_text,interactive_payload,message_id,status,created_at,provider_connection_id)
  VALUES(v_list_prompt_message,v_conversation_list,'bot',v_user_a,'interactive','Choose one',
    jsonb_build_object('kind','list','requestId','evolution-step:' || v_step_list_prompt::text,'sections',jsonb_build_array(jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('id','ROW_NEXT','title','Details'))))),
    'SYNTHETIC_LIST_PROMPT','sent',now()-interval '1 second',v_connection_a),
    (v_prompt_message,v_conversation_a,'bot',v_user_a,'interactive','Choose one',
    jsonb_build_object('kind','buttons','requestId','evolution-step:' || v_step_prompt::text,'buttons',jsonb_build_array(jsonb_build_object('id','BTN_NEXT','displayText','Continue'),jsonb_build_object('id','BTN_OTHER','displayText','Other'))),
    'SYNTHETIC_PROMPT','sent',now()-interval '1 second',v_connection_a);
  INSERT INTO public.evolution_send_attempts(id,account_id,connection_id,request_id,request_hash,conversation_id,message_row_id,external_message_id,outcome)
  VALUES(v_list_attempt,v_account_a,v_connection_a,'evolution-step:' || v_step_list_prompt::text,repeat('b',64),v_conversation_list,v_list_prompt_message,'SYNTHETIC_LIST_PROMPT','accepted'),
    (v_prompt_attempt,v_account_a,v_connection_a,'evolution-step:' || v_step_prompt::text,repeat('a',64),v_conversation_a,v_prompt_message,'SYNTHETIC_PROMPT','accepted');
  INSERT INTO public.evolution_dispatch_steps(id,dispatch_id,action_key,state,attempts,lease_until,lease_token,request_id,send_attempt_id)
  VALUES(v_step_list_prompt,v_dispatch_list_start,'0:list','processing',1,now()+interval '5 minutes',v_step_token_list_prompt,'evolution-step:' || v_step_list_prompt::text,v_list_attempt),
    (v_step_prompt,v_dispatch_start,'0:buttons','processing',1,now()+interval '5 minutes',v_step_token_prompt,'evolution-step:' || v_step_prompt::text,v_prompt_attempt);
  INSERT INTO public.evolution_dispatch_steps(id,dispatch_id,action_key,state,attempts,lease_until,lease_token,request_id)
  VALUES
    (v_step_list_reply,v_dispatch_list_reply,'1:list','processing',1,now()+interval '5 minutes',v_step_token_list_reply,'evolution-step:' || v_step_list_reply::text),
    (v_step_reply,v_dispatch_reply,'1:buttons','processing',1,now()+interval '5 minutes',v_step_token_reply,'evolution-step:' || v_step_reply::text),
    (v_step_tenant,v_dispatch_tenant,'0:buttons','processing',1,now()+interval '5 minutes',v_step_token_tenant,'evolution-step:' || v_step_tenant::text);

  PERFORM set_config('wacrm.flow_interactive.run_list',v_run_list::text,true);
  PERFORM set_config('wacrm.flow_interactive.dispatch_list_start',v_dispatch_list_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.dispatch_list_reply',v_dispatch_list_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_list_prompt',v_step_list_prompt::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_list_reply',v_step_list_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.event_list_start',v_event_list_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.event_list_reply',v_event_list_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.root_token_list_start',v_root_token_list_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.root_token_list_reply',v_root_token_list_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_token_list_prompt',v_step_token_list_prompt::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_token_list_reply',v_step_token_list_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.user_a',v_user_a::text,true);
  PERFORM set_config('wacrm.flow_interactive.user_b',v_user_b::text,true);
  PERFORM set_config('wacrm.flow_interactive.account_a',v_account_a::text,true);
  PERFORM set_config('wacrm.flow_interactive.flow_a',v_flow_a::text,true);
  PERFORM set_config('wacrm.flow_interactive.run_a',v_run_a::text,true);
  PERFORM set_config('wacrm.flow_interactive.run_b',v_run_b::text,true);
  PERFORM set_config('wacrm.flow_interactive.conversation_a',v_conversation_a::text,true);
  PERFORM set_config('wacrm.flow_interactive.event_start',v_event_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.event_reply',v_event_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.dispatch_start',v_dispatch_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.dispatch_reply',v_dispatch_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.dispatch_tenant',v_dispatch_tenant::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_prompt',v_step_prompt::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_reply',v_step_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_tenant',v_step_tenant::text,true);
  PERFORM set_config('wacrm.flow_interactive.root_token_start',v_root_token_start::text,true);
  PERFORM set_config('wacrm.flow_interactive.root_token_reply',v_root_token_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.root_token_tenant',v_root_token_tenant::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_token_prompt',v_step_token_prompt::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_token_reply',v_step_token_reply::text,true);
  PERFORM set_config('wacrm.flow_interactive.step_token_tenant',v_step_token_tenant::text,true);
END;
$fixture$;

SET LOCAL ROLE service_role;

DO $assertions$
DECLARE
  v_result record;
  v_dispatch uuid := current_setting('wacrm.flow_interactive.dispatch_start')::uuid;
  v_run uuid := current_setting('wacrm.flow_interactive.run_a')::uuid;
  v_event uuid := current_setting('wacrm.flow_interactive.event_start')::uuid;
  v_step uuid := current_setting('wacrm.flow_interactive.step_prompt')::uuid;
BEGIN
  SELECT * INTO STRICT v_result FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.flow_interactive.dispatch_list_start')::uuid,
    current_setting('wacrm.flow_interactive.root_token_list_start')::uuid);
  IF v_result.flow_run_id <> current_setting('wacrm.flow_interactive.run_list')::uuid THEN
    RAISE EXCEPTION 'List root did not reuse its linked Flow run';
  END IF;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_prompt(
    current_setting('wacrm.flow_interactive.dispatch_list_start')::uuid,
    current_setting('wacrm.flow_interactive.root_token_list_start')::uuid,
    current_setting('wacrm.flow_interactive.step_list_prompt')::uuid,
    current_setting('wacrm.flow_interactive.step_token_list_prompt')::uuid,
    current_setting('wacrm.flow_interactive.run_list')::uuid,
    current_setting('wacrm.flow_interactive.event_list_start')::uuid,0,'list');
  IF NOT v_result.applied OR v_result.transition_seq <> 1 THEN
    RAISE EXCEPTION 'Accepted list prompt was not checkpointed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evolution_event_dispatches WHERE event_id IN (
       current_setting('wacrm.flow_interactive.event_list_start')::uuid,
       current_setting('wacrm.flow_interactive.event_list_reply')::uuid) AND engine <> 'flow') THEN
    RAISE EXCEPTION 'Interactive Flow created an automation or AI root';
  END IF;
  SELECT * INTO STRICT v_result FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.flow_interactive.dispatch_list_reply')::uuid,
    current_setting('wacrm.flow_interactive.root_token_list_reply')::uuid);
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_reply(
    current_setting('wacrm.flow_interactive.dispatch_list_reply')::uuid,
    current_setting('wacrm.flow_interactive.root_token_list_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_list_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_token_list_reply')::uuid,
    current_setting('wacrm.flow_interactive.run_list')::uuid,
    current_setting('wacrm.flow_interactive.event_list_reply')::uuid,1,'list');
  IF NOT v_result.applied OR v_result.next_node_key <> 'end' THEN
    RAISE EXCEPTION 'List reply did not advance to the exact configured target';
  END IF;

  SELECT * INTO STRICT v_result FROM public.start_evolution_event_dispatch(
    v_dispatch,current_setting('wacrm.flow_interactive.root_token_start')::uuid);
  IF v_result.flow_run_id <> v_run OR v_result.state <> 'processing'
     OR (SELECT count(*) FROM public.flow_runs WHERE account_id=current_setting('wacrm.flow_interactive.account_a')::uuid AND contact_id=(SELECT contact_id FROM public.flow_runs WHERE id=v_run) AND status='active') <> 1 THEN
    RAISE EXCEPTION 'Interactive linked Flow root did not reuse its run exclusively';
  END IF;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_prompt(
    v_dispatch,current_setting('wacrm.flow_interactive.root_token_start')::uuid,
    v_step,current_setting('wacrm.flow_interactive.step_token_prompt')::uuid,
    v_run,v_event,0,'buttons');
  IF NOT v_result.applied OR v_result.transition_seq <> 1
     OR (SELECT current_node_key FROM public.flow_runs WHERE id=v_run) <> 'buttons'
     OR (SELECT last_prompt_message_id FROM public.flow_runs WHERE id=v_run) IS DISTINCT FROM v_result.prompt_message_id
     OR (SELECT count(*) FROM public.flow_run_events WHERE flow_run_id=v_run AND evolution_event_id=v_event AND event_type='message_sent') <> 1 THEN
    RAISE EXCEPTION 'Accepted interactive prompt was not checkpointed atomically';
  END IF;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_prompt(
    v_dispatch,current_setting('wacrm.flow_interactive.root_token_start')::uuid,
    v_step,current_setting('wacrm.flow_interactive.step_token_prompt')::uuid,
    v_run,v_event,0,'buttons');
  IF v_result.applied OR v_result.transition_seq <> 1 THEN
    RAISE EXCEPTION 'Interactive prompt replay was not idempotent';
  END IF;

  SELECT * INTO STRICT v_result FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.flow_interactive.dispatch_reply')::uuid,
    current_setting('wacrm.flow_interactive.root_token_reply')::uuid);
  IF v_result.flow_run_id <> v_run OR v_result.state <> 'processing' THEN
    RAISE EXCEPTION 'Interactive reply root did not reuse linked Flow run';
  END IF;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_reply(
    current_setting('wacrm.flow_interactive.dispatch_reply')::uuid,
    current_setting('wacrm.flow_interactive.root_token_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_token_reply')::uuid,
    v_run,current_setting('wacrm.flow_interactive.event_reply')::uuid,1,'buttons');
  IF NOT v_result.applied OR v_result.transition_seq <> 2 OR v_result.next_node_key <> 'end'
     OR (SELECT current_node_key FROM public.flow_runs WHERE id=v_run) <> 'end'
     OR (SELECT count(*) FROM public.flow_run_events WHERE flow_run_id=v_run AND evolution_event_id=current_setting('wacrm.flow_interactive.event_reply')::uuid AND event_type='reply_received') <> 1
     OR EXISTS (SELECT 1 FROM public.flow_run_events WHERE flow_run_id=v_run AND evolution_event_id=current_setting('wacrm.flow_interactive.event_reply')::uuid AND (payload ? 'text' OR payload ? 'reply_id')) THEN
    RAISE EXCEPTION 'Interactive choice did not advance once with a redacted audit payload';
  END IF;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_interactive_reply(
    current_setting('wacrm.flow_interactive.dispatch_reply')::uuid,
    current_setting('wacrm.flow_interactive.root_token_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_reply')::uuid,
    current_setting('wacrm.flow_interactive.step_token_reply')::uuid,
    v_run,current_setting('wacrm.flow_interactive.event_reply')::uuid,1,'buttons');
  IF v_result.applied OR v_result.transition_seq <> 2
     OR (SELECT count(*) FROM public.flow_run_events WHERE flow_run_id=v_run AND evolution_event_id=current_setting('wacrm.flow_interactive.event_reply')::uuid AND event_type='reply_received') <> 1 THEN
    RAISE EXCEPTION 'Interactive reply replay advanced more than once';
  END IF;

  BEGIN
    PERFORM public.start_evolution_event_dispatch(
      current_setting('wacrm.flow_interactive.dispatch_tenant')::uuid,
      current_setting('wacrm.flow_interactive.root_token_tenant')::uuid);
    RAISE EXCEPTION 'Cross-tenant interactive root unexpectedly started';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.complete_evolution_flow_interactive_reply(
      current_setting('wacrm.flow_interactive.dispatch_reply')::uuid,
      gen_random_uuid(),current_setting('wacrm.flow_interactive.step_reply')::uuid,
      current_setting('wacrm.flow_interactive.step_token_reply')::uuid,
      v_run,current_setting('wacrm.flow_interactive.event_reply')::uuid,1,'buttons');
    RAISE EXCEPTION 'Stale root lease unexpectedly advanced interactive Flow';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END;
$assertions$;

DO $security$
DECLARE
  v_start regprocedure := 'public.start_evolution_event_dispatch(uuid,uuid)'::regprocedure;
  v_prompt regprocedure := 'public.complete_evolution_flow_interactive_prompt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure;
  v_reply regprocedure := 'public.complete_evolution_flow_interactive_reply(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure;
  v_event_guard regprocedure := 'public.is_valid_evolution_flow_interactive_event(uuid,uuid)'::regprocedure;
  v_start_guard regprocedure := 'public.is_valid_evolution_flow_interactive_start(uuid,uuid)'::regprocedure;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (v_start,v_prompt,v_reply,v_event_guard,v_start_guard)
             AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR has_function_privilege('anon',v_prompt,'EXECUTE')
     OR has_function_privilege('authenticated',v_reply,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_prompt,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_reply,'EXECUTE')
     OR has_function_privilege('authenticated',v_event_guard,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_event_guard,'EXECUTE')
     OR has_function_privilege('anon',v_start_guard,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_start_guard,'EXECUTE') THEN
    RAISE EXCEPTION 'Flow interactive execution RPC security mismatch';
  END IF;
END;
$security$;

ROLLBACK;
