BEGIN;

DO $test$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_ai_config_id uuid := pg_catalog.gen_random_uuid();
  v_ai_config_b uuid := pg_catalog.gen_random_uuid();
  v_contact_id uuid := pg_catalog.gen_random_uuid();
  v_conversation_id uuid := pg_catalog.gen_random_uuid();
  v_connection_id uuid := pg_catalog.gen_random_uuid();
  v_event_done uuid;
  v_event_interrupted uuid;
  v_event_handoff uuid;
  v_event_bad_config uuid;
  v_dispatch_done uuid := pg_catalog.gen_random_uuid();
  v_dispatch_interrupted uuid := pg_catalog.gen_random_uuid();
  v_dispatch_handoff uuid := pg_catalog.gen_random_uuid();
  v_dispatch_bad_config uuid := pg_catalog.gen_random_uuid();
  v_root_token_done uuid := pg_catalog.gen_random_uuid();
  v_root_token_interrupted uuid := pg_catalog.gen_random_uuid();
  v_root_token_handoff uuid := pg_catalog.gen_random_uuid();
  v_root_token_bad_config uuid := pg_catalog.gen_random_uuid();
  v_external_done text := 'synthetic-ai-done-' || pg_catalog.gen_random_uuid()::text;
  v_external_interrupted text := 'synthetic-ai-interrupted-' || pg_catalog.gen_random_uuid()::text;
  v_external_handoff text := 'synthetic-ai-handoff-' || pg_catalog.gen_random_uuid()::text;
  v_external_bad_config text := 'synthetic-ai-config-mismatch-' || pg_catalog.gen_random_uuid()::text;
  v_claim record;
  v_claim_replay record;
  v_handoff_claim record;
  v_completed_step public.evolution_dispatch_steps%ROWTYPE;
  v_handoff_result record;
  v_failed boolean;
  v_attempts integer;
  v_count integer;
  v_summary text := 'Synthetic deterministic handoff summary';
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@ai-reply-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic AI reply owner"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@ai-reply-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic AI reply agent"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;
  UPDATE public.profiles SET account_id = v_account_a, account_role = 'agent'
   WHERE user_id = v_user_b;

  INSERT INTO public.ai_configs (
    id, account_id, created_by, provider, model, api_key,
    is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id
  ) VALUES (
    v_ai_config_id, v_account_a, v_user_a, 'openai', 'synthetic-model', 'synthetic',
    true, true, 3, v_user_b
  );
  INSERT INTO public.ai_configs (
    id, account_id, created_by, provider, model, api_key,
    is_active, auto_reply_enabled, auto_reply_max_per_conversation
  ) VALUES (
    v_ai_config_b, v_account_b, v_user_b, 'openai', 'synthetic-model', 'synthetic',
    true, true, 3
  );
  INSERT INTO public.contacts (id, user_id, account_id, phone, name)
  VALUES (v_contact_id, v_user_a, v_account_a, '+15550000871', 'Synthetic AI reply contact');
  INSERT INTO public.conversations (id, user_id, account_id, contact_id, status)
  VALUES (v_conversation_id, v_user_a, v_account_a, v_contact_id, 'open');
  INSERT INTO public.whatsapp_connections (
    id, account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_connection_id, v_account_a, v_user_a, 'http://127.0.0.1:8080',
    'ai-reply-' || v_user_a::text, 'synthetic', 'synthetic'
  );

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_id, 'ai-reply:done:' || v_user_a::text,
    pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
      'sentByApi',false,'externalMessageId',v_external_done), 'done', pg_catalog.clock_timestamp())
  RETURNING id INTO v_event_done;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_id, 'ai-reply:interrupted:' || v_user_a::text,
    pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
      'sentByApi',false,'externalMessageId',v_external_interrupted), 'done', pg_catalog.clock_timestamp())
  RETURNING id INTO v_event_interrupted;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_id, 'ai-reply:handoff:' || v_user_a::text,
    pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
      'sentByApi',false,'externalMessageId',v_external_handoff), 'done', pg_catalog.clock_timestamp())
  RETURNING id INTO v_event_handoff;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_id, 'ai-reply:bad-config:' || v_user_a::text,
    pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
      'sentByApi',false,'externalMessageId',v_external_bad_config), 'done', pg_catalog.clock_timestamp())
  RETURNING id INTO v_event_bad_config;

  INSERT INTO public.messages (
    conversation_id, sender_type, content_type, content_text, message_id, provider_connection_id
  ) VALUES
    (v_conversation_id, 'customer', 'text', 'synthetic inbound', v_external_done, v_connection_id),
    (v_conversation_id, 'customer', 'text', 'synthetic inbound', v_external_interrupted, v_connection_id),
    (v_conversation_id, 'customer', 'text', 'synthetic inbound', v_external_handoff, v_connection_id);
  INSERT INTO public.messages (
    conversation_id, sender_type, content_type, content_text, message_id, provider_connection_id
  ) VALUES (
    v_conversation_id, 'customer', 'text', 'synthetic inbound', v_external_bad_config, v_connection_id
  );

  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, ai_config_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES
    (v_dispatch_done, v_event_done, v_account_a, 'ai', v_ai_config_id, v_user_a,
     v_contact_id, v_conversation_id, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_done),
    (v_dispatch_interrupted, v_event_interrupted, v_account_a, 'ai', v_ai_config_id, v_user_a,
     v_contact_id, v_conversation_id, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_interrupted),
    (v_dispatch_handoff, v_event_handoff, v_account_a, 'ai', v_ai_config_id, v_user_a,
     v_contact_id, v_conversation_id, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_handoff),
    (v_dispatch_bad_config, v_event_bad_config, v_account_a, 'ai', v_ai_config_b, v_user_a,
     v_contact_id, v_conversation_id, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_bad_config);

  SET LOCAL ROLE service_role;

  -- A stale/wrong root token or expired root lease must fail before inserting a step.
  v_failed := false;
  BEGIN
    PERFORM * FROM public.claim_evolution_ai_reply_generation(
      v_dispatch_interrupted, pg_catalog.gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (
       SELECT 1 FROM public.evolution_dispatch_steps AS s WHERE s.dispatch_id = v_dispatch_interrupted
     ) THEN
    RAISE EXCEPTION 'wrong root lease token mutated or authorized generation';
  END IF;
  UPDATE public.evolution_event_dispatches
     SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_dispatch_interrupted;
  v_failed := false;
  BEGIN
    PERFORM * FROM public.claim_evolution_ai_reply_generation(
      v_dispatch_interrupted, v_root_token_interrupted
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (
       SELECT 1 FROM public.evolution_dispatch_steps AS s WHERE s.dispatch_id = v_dispatch_interrupted
     ) THEN
    RAISE EXCEPTION 'expired root lease mutated or authorized generation';
  END IF;
  UPDATE public.evolution_event_dispatches
     SET lease_until = pg_catalog.clock_timestamp() + interval '5 minutes'
   WHERE id = v_dispatch_interrupted;

  -- A root cannot combine account A event lineage with account B AI config.
  v_failed := false;
  BEGIN
    PERFORM * FROM public.claim_evolution_ai_reply_generation(
      v_dispatch_bad_config, v_root_token_bad_config
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_failed := true;
  END;
  IF NOT v_failed OR EXISTS (
       SELECT 1 FROM public.evolution_dispatch_steps AS s WHERE s.dispatch_id = v_dispatch_bad_config
     ) THEN
    RAISE EXCEPTION 'AI config tenant mismatch mutated or authorized generation';
  END IF;

  SELECT * INTO STRICT v_claim
    FROM public.claim_evolution_ai_reply_generation(v_dispatch_done, v_root_token_done);
  IF NOT v_claim.should_generate OR NOT v_claim.lease_acquired
     OR v_claim.state <> 'processing'
     OR v_claim.request_id IS DISTINCT FROM 'evolution-step:' || v_claim.step_id::text THEN
    RAISE EXCEPTION 'first AI generation claim did not acquire the stable reply step';
  END IF;

  -- A duplicate active claim cannot authorize another provider request.
  SELECT * INTO STRICT v_claim_replay
    FROM public.claim_evolution_ai_reply_generation(v_dispatch_done, v_root_token_done);
  SELECT s.attempts INTO STRICT v_attempts
    FROM public.evolution_dispatch_steps AS s WHERE s.id = v_claim.step_id;
  IF v_claim_replay.should_generate OR v_claim_replay.lease_acquired
     OR v_claim_replay.step_id IS DISTINCT FROM v_claim.step_id
     OR v_attempts <> 1 THEN
    RAISE EXCEPTION 'duplicate active AI generation claim was authorized';
  END IF;

  v_completed_step := public.complete_evolution_dispatch_step(
    v_claim.step_id, v_root_token_done, v_claim.lease_token, 'done',
    v_claim.request_id, NULL,
    '{"text":"synthetic persisted reply","handoff":false}'::jsonb, NULL
  );
  SELECT * INTO STRICT v_claim_replay
    FROM public.claim_evolution_ai_reply_generation(v_dispatch_done, v_root_token_done);
  IF v_claim_replay.should_generate OR v_claim_replay.state <> 'done'
     OR v_claim_replay.result IS DISTINCT FROM v_completed_step.result THEN
    RAISE EXCEPTION 'persisted AI reply result was not returned on replay';
  END IF;

  SELECT * INTO STRICT v_claim
    FROM public.claim_evolution_ai_reply_generation(v_dispatch_interrupted, v_root_token_interrupted);
  UPDATE public.evolution_dispatch_steps
     SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_claim.step_id;
  SELECT * INTO STRICT v_claim_replay
    FROM public.claim_evolution_ai_reply_generation(v_dispatch_interrupted, v_root_token_interrupted);
  SELECT s.attempts INTO STRICT v_attempts
    FROM public.evolution_dispatch_steps AS s WHERE s.id = v_claim.step_id;
  IF v_claim_replay.should_generate OR v_claim_replay.lease_acquired
     OR v_claim_replay.state <> 'unknown' OR v_attempts <> 1 THEN
    RAISE EXCEPTION 'expired generation lease was retried instead of becoming unknown';
  END IF;

  SELECT * INTO STRICT v_handoff_claim
    FROM public.claim_evolution_dispatch_step(v_dispatch_handoff, v_root_token_handoff, 'reply:handoff');
  IF NOT v_handoff_claim.should_execute OR v_handoff_claim.state <> 'processing' THEN
    RAISE EXCEPTION 'AI handoff step was not claimed';
  END IF;
  SELECT * INTO STRICT v_handoff_result
    FROM public.complete_evolution_ai_handoff(
      v_dispatch_handoff, v_root_token_handoff,
      v_handoff_claim.step_id, v_handoff_claim.lease_token,
      v_summary, v_user_b
    );
  IF v_handoff_result.state <> 'done'
     OR NOT (SELECT c.ai_autoreply_disabled FROM public.conversations AS c WHERE c.id = v_conversation_id)
     OR (SELECT c.ai_handoff_summary FROM public.conversations AS c WHERE c.id = v_conversation_id) IS DISTINCT FROM v_summary
     OR (SELECT c.assigned_agent_id FROM public.conversations AS c WHERE c.id = v_conversation_id) IS DISTINCT FROM v_user_b THEN
    RAISE EXCEPTION 'AI handoff effect was not applied atomically';
  END IF;

  SELECT * INTO STRICT v_handoff_result
    FROM public.complete_evolution_ai_handoff(
      v_dispatch_handoff, v_root_token_handoff,
      v_handoff_claim.step_id, v_handoff_claim.lease_token,
      v_summary, v_user_b
    );
  IF v_handoff_result.state <> 'done' THEN
    RAISE EXCEPTION 'matching AI handoff replay did not return done';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM * FROM public.complete_evolution_ai_handoff(
      v_dispatch_handoff, v_root_token_handoff,
      v_handoff_claim.step_id, v_handoff_claim.lease_token,
      'different synthetic summary', v_user_b
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'divergent handoff replay was accepted';
  END IF;

  IF NOT has_function_privilege('service_role',
       'public.claim_evolution_ai_reply_generation(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.claim_evolution_ai_reply_generation(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_evolution_ai_reply_generation(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.complete_evolution_ai_handoff(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.complete_evolution_ai_handoff(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.complete_evolution_ai_handoff(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AI RPC execute grants are not restricted to service_role';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid IN (
          'public.claim_evolution_ai_reply_generation(uuid,uuid)'::regprocedure,
          'public.complete_evolution_ai_handoff(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure
        ) AND (p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     ) THEN
    RAISE EXCEPTION 'AI RPC SECURITY INVOKER or search_path invariant failed';
  END IF;

  RESET ROLE;
END;
$test$;

ROLLBACK;
