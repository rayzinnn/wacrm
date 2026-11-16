BEGIN;

-- Synthetic wait queue, root/step leases, and atomic checkpoint; rollback-only.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_contact_a uuid;
  v_conversation_a uuid;
  v_contact_b uuid;
  v_conversation_b uuid;
  v_automation_a uuid;
  v_automation_b uuid;
  v_event_a uuid;
  v_event_stale uuid;
  v_dispatch_a uuid;
  v_dispatch_tenant uuid;
  v_dispatch_stale uuid;
  v_log_a uuid;
  v_step_wait uuid := pg_catalog.gen_random_uuid();
  v_step_wrong_type uuid := pg_catalog.gen_random_uuid();
  v_step_stale_root uuid := pg_catalog.gen_random_uuid();
  v_step_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_root_a uuid := pg_catalog.gen_random_uuid();
  v_token_root_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_root_stale uuid := pg_catalog.gen_random_uuid();
  v_token_wait uuid := pg_catalog.gen_random_uuid();
  v_token_wrong_type uuid := pg_catalog.gen_random_uuid();
  v_token_stale_root uuid := pg_catalog.gen_random_uuid();
  v_token_tenant uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@t12-wait-a.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 wait synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@t12-wait-b.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 wait synthetic B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles p WHERE p.user_id=v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles p WHERE p.user_id=v_user_b;

  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
      token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-wait-' || v_user_a::text,
          'synthetic', 'synthetic') RETURNING id INTO v_connection_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000071', 'Wait contact A') RETURNING id INTO v_contact_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open') RETURNING id INTO v_conversation_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_b, v_account_b, '+15550000072', 'Wait contact B') RETURNING id INTO v_contact_b;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_b, v_account_b, v_contact_b, 'open') RETURNING id INTO v_conversation_b;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 wait A', 'new_message_received', true)
  RETURNING id INTO v_automation_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_b, v_account_b, 'T12 wait B', 'new_message_received', true)
  RETURNING id INTO v_automation_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:wait:' || v_user_a::text,
    pg_catalog.jsonb_build_object(
      'kind','message','eventKey','t12:wait:' || v_user_a::text,
      'externalMessageId','t12-wait-' || v_user_a::text,
      'peer','15550000071@s.whatsapp.net','occurredAt','2026-11-16T18:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','synthetic wait message','mediaRef',NULL
    ), 'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:wait-stale:' || v_user_a::text,
    pg_catalog.jsonb_build_object(
      'kind','message','eventKey','t12:wait-stale:' || v_user_a::text,
      'externalMessageId','t12-wait-stale-' || v_user_a::text,
      'peer','15550000071@s.whatsapp.net','occurredAt','2026-11-16T18:01:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','synthetic stale wait','mediaRef',NULL
    ), 'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_stale;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text,
      message_id, provider_connection_id)
  VALUES
    (v_conversation_a, 'customer', 'text', 'synthetic wait message',
     't12-wait-' || v_user_a::text, v_connection_a),
    (v_conversation_a, 'customer', 'text', 'synthetic stale wait',
     't12-wait-stale-' || v_user_a::text, v_connection_a);

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_a, v_account_a, 'automation', v_automation_a, v_user_a,
      v_contact_a, v_conversation_a, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_root_a)
  RETURNING id INTO v_dispatch_a;
  INSERT INTO public.automation_logs (automation_id, account_id, user_id, contact_id,
      trigger_event, steps_executed, status, evolution_dispatch_id)
  VALUES (v_automation_a, v_account_a, v_user_a, v_contact_a,
      'new_message_received', '[]'::jsonb, 'partial', v_dispatch_a)
  RETURNING id INTO v_log_a;
  UPDATE public.evolution_event_dispatches SET automation_log_id=v_log_a WHERE id=v_dispatch_a;

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_a, v_account_b, 'automation', v_automation_b, v_user_b,
      v_contact_b, v_conversation_b, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_root_tenant)
  RETURNING id INTO v_dispatch_tenant;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_stale, v_account_a, 'automation', v_automation_a, v_user_a,
      v_contact_a, v_conversation_a, 'processing', 1,
      pg_catalog.clock_timestamp()-interval '1 second', v_token_root_stale)
  RETURNING id INTO v_dispatch_stale;

  INSERT INTO public.automation_steps (id, automation_id, step_type, step_config, position)
  VALUES
    (v_step_wait, v_automation_a, 'wait', '{"amount":0.5,"unit":"minutes"}'::jsonb, 4),
    (v_step_wrong_type, v_automation_a, 'update_contact_field', '{"field":"name","value":"x"}'::jsonb, 5),
    (v_step_stale_root, v_automation_a, 'wait', '{"amount":1,"unit":"hours"}'::jsonb, 6),
    (v_step_tenant, v_automation_b, 'wait', '{"amount":1,"unit":"hours"}'::jsonb, 4);
  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, state, attempts,
      lease_until, lease_token, request_id)
  VALUES
    (v_step_wait, v_dispatch_a, v_step_wait::text, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_wait, 'evolution-step:'||v_step_wait::text),
    (v_step_wrong_type, v_dispatch_a, v_step_wrong_type::text, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_wrong_type, 'evolution-step:'||v_step_wrong_type::text),
    (v_step_stale_root, v_dispatch_stale, v_step_stale_root::text, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_stale_root, 'evolution-step:'||v_step_stale_root::text),
    (v_step_tenant, v_dispatch_tenant, v_step_tenant::text, 'processing', 1,
      pg_catalog.clock_timestamp()+interval '5 minutes', v_token_tenant, 'evolution-step:'||v_step_tenant::text);

  PERFORM pg_catalog.set_config('wacrm.t12wait.user_a',v_user_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.user_b',v_user_b::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.account_a',v_account_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.account_b',v_account_b::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.contact_a',v_contact_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.conversation_a',v_conversation_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.automation_a',v_automation_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.log_a',v_log_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.event_a',v_event_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.dispatch_a',v_dispatch_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.dispatch_tenant',v_dispatch_tenant::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.dispatch_stale',v_dispatch_stale::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_root_a',v_token_root_a::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_root_tenant',v_token_root_tenant::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_root_stale',v_token_root_stale::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.step_wait',v_step_wait::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.step_wrong_type',v_step_wrong_type::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.step_stale_root',v_step_stale_root::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.step_tenant',v_step_tenant::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_wait',v_token_wait::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_wrong_type',v_token_wrong_type::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_stale_root',v_token_stale_root::text,true);
  PERFORM pg_catalog.set_config('wacrm.t12wait.token_tenant',v_token_tenant::text,true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.apply_evolution_automation_effect(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure;
BEGIN
  IF pg_catalog.pg_get_function_result(v_function) <> 'TABLE(step_id uuid, state text, result jsonb)'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_function
        AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_function,'EXECUTE') THEN
    RAISE EXCEPTION 'automation effect signature/security/grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;
DO $wait_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.t12wait.dispatch_a')::uuid;
  v_token_root uuid := current_setting('wacrm.t12wait.token_root_a')::uuid;
  v_step_wait uuid := current_setting('wacrm.t12wait.step_wait')::uuid;
  v_token_wait uuid := current_setting('wacrm.t12wait.token_wait')::uuid;
  v_pending_id uuid;
  v_result record;
  v_before timestamptz;
  v_after timestamptz;
BEGIN
  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch,v_token_root,v_step_wait,pg_catalog.gen_random_uuid(),'wait','{}'::jsonb);
    RAISE EXCEPTION 'stale wait step token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.automation_pending_executions e
      WHERE e.evolution_dispatch_step_id=v_step_wait)
     OR (SELECT s.state FROM public.evolution_dispatch_steps s WHERE s.id=v_step_wait)<>'processing' THEN
    RAISE EXCEPTION 'stale wait step changed queue or checkpoint';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch,v_token_root,
      current_setting('wacrm.t12wait.step_wrong_type')::uuid,
      current_setting('wacrm.t12wait.token_wrong_type')::uuid,
      'wait','{}'::jsonb);
    RAISE EXCEPTION 'non-wait persisted action was accepted as wait';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.automation_pending_executions e
      WHERE e.evolution_dispatch_step_id=current_setting('wacrm.t12wait.step_wrong_type')::uuid)
     OR (SELECT s.state FROM public.evolution_dispatch_steps s
          WHERE s.id=current_setting('wacrm.t12wait.step_wrong_type')::uuid)<>'processing' THEN
    RAISE EXCEPTION 'non-wait action changed queue or checkpoint';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch,v_token_root,v_step_wait,v_token_wait,'wait_for_reply','{}'::jsonb);
    RAISE EXCEPTION 'wait_for_reply was unexpectedly enabled';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  v_before := pg_catalog.clock_timestamp();
  SELECT * INTO STRICT v_result FROM public.apply_evolution_automation_effect(
    v_dispatch,v_token_root,v_step_wait,v_token_wait,'wait','{}'::jsonb);
  v_after := pg_catalog.clock_timestamp();
  v_pending_id := (v_result.result->>'pending_execution_id')::uuid;
  IF v_result.state<>'done' OR v_pending_id IS NULL
     OR (SELECT e.id FROM public.automation_pending_executions e
          WHERE e.evolution_dispatch_step_id=v_step_wait) IS DISTINCT FROM v_pending_id
     OR NOT EXISTS (
       SELECT 1 FROM public.automation_pending_executions e
        WHERE e.id=v_pending_id
          AND e.automation_id=current_setting('wacrm.t12wait.automation_a')::uuid
          AND e.account_id=current_setting('wacrm.t12wait.account_a')::uuid
          AND e.user_id=current_setting('wacrm.t12wait.user_a')::uuid
          AND e.contact_id=current_setting('wacrm.t12wait.contact_a')::uuid
          AND e.log_id=current_setting('wacrm.t12wait.log_a')::uuid
          AND e.parent_step_id IS NULL AND e.branch IS NULL
          AND e.next_step_position=5 AND e.context=pg_catalog.jsonb_build_object(
            'message_text','synthetic wait message',
            'conversation_id',current_setting('wacrm.t12wait.conversation_a'))
          AND e.parked_step_id=v_step_wait AND e.status='pending'
          AND e.run_at>=v_before+interval '29 seconds'
          AND e.run_at<=v_after+interval '30 seconds')
     OR (SELECT s.state FROM public.evolution_dispatch_steps s WHERE s.id=v_step_wait)<>'done' THEN
    RAISE EXCEPTION 'wait queue fields and step checkpoint were not committed atomically';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch,v_token_root,v_step_wait,v_token_wait,'wait','{}'::jsonb);
    RAISE EXCEPTION 'completed wait action replay was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.automation_pending_executions e
       WHERE e.evolution_dispatch_step_id=v_step_wait)<>1 THEN
    RAISE EXCEPTION 'wait replay created a second scheduled execution';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      current_setting('wacrm.t12wait.dispatch_tenant')::uuid,
      current_setting('wacrm.t12wait.token_root_tenant')::uuid,
      current_setting('wacrm.t12wait.step_tenant')::uuid,
      current_setting('wacrm.t12wait.token_tenant')::uuid,
      'wait','{}'::jsonb);
    RAISE EXCEPTION 'cross-account event/root wait was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.automation_pending_executions e
      WHERE e.evolution_dispatch_step_id=current_setting('wacrm.t12wait.step_tenant')::uuid)
     OR (SELECT s.state FROM public.evolution_dispatch_steps s
          WHERE s.id=current_setting('wacrm.t12wait.step_tenant')::uuid)<>'processing' THEN
    RAISE EXCEPTION 'cross-account wait changed queue or checkpoint';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      current_setting('wacrm.t12wait.dispatch_stale')::uuid,
      current_setting('wacrm.t12wait.token_root_stale')::uuid,
      current_setting('wacrm.t12wait.step_stale_root')::uuid,
      current_setting('wacrm.t12wait.token_stale_root')::uuid,
      'wait','{}'::jsonb);
    RAISE EXCEPTION 'expired wait root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.automation_pending_executions e
      WHERE e.evolution_dispatch_step_id=current_setting('wacrm.t12wait.step_stale_root')::uuid)
     OR (SELECT s.state FROM public.evolution_dispatch_steps s
          WHERE s.id=current_setting('wacrm.t12wait.step_stale_root')::uuid)<>'processing' THEN
    RAISE EXCEPTION 'expired root lease changed queue or checkpoint';
  END IF;
END;
$wait_assertions$;
RESET ROLE;

ROLLBACK;
