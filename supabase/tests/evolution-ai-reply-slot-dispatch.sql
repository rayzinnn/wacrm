BEGIN;

DO $test$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_ai_config_a uuid := pg_catalog.gen_random_uuid();
  v_contact_a uuid := pg_catalog.gen_random_uuid();
  v_contact_disabled uuid := pg_catalog.gen_random_uuid();
  v_contact_assigned uuid := pg_catalog.gen_random_uuid();
  v_conversation_a uuid := pg_catalog.gen_random_uuid();
  v_conversation_disabled uuid := pg_catalog.gen_random_uuid();
  v_conversation_assigned uuid := pg_catalog.gen_random_uuid();
  v_connection_a uuid := pg_catalog.gen_random_uuid();
  v_connection_b uuid := pg_catalog.gen_random_uuid();
  v_event_a uuid;
  v_event_cap uuid;
  v_event_disabled uuid;
  v_event_assigned uuid;
  v_event_tenant uuid;
  v_event_author uuid;
  v_dispatch_a uuid := pg_catalog.gen_random_uuid();
  v_dispatch_cap uuid := pg_catalog.gen_random_uuid();
  v_dispatch_disabled uuid := pg_catalog.gen_random_uuid();
  v_dispatch_assigned uuid := pg_catalog.gen_random_uuid();
  v_dispatch_tenant uuid := pg_catalog.gen_random_uuid();
  v_dispatch_author uuid := pg_catalog.gen_random_uuid();
  v_token_a uuid := pg_catalog.gen_random_uuid();
  v_token_cap uuid := pg_catalog.gen_random_uuid();
  v_token_disabled uuid := pg_catalog.gen_random_uuid();
  v_token_assigned uuid := pg_catalog.gen_random_uuid();
  v_token_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_author uuid := pg_catalog.gen_random_uuid();
  v_external_id text;
  v_count integer;
  v_result boolean;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@ai-slot-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic AI slot A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@ai-slot-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic AI slot B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;
  UPDATE public.profiles
     SET account_id = v_account_a,
         account_role = 'agent'
   WHERE user_id = v_user_b;

  INSERT INTO public.ai_configs (
    id, account_id, created_by, provider, model, api_key,
    is_active, auto_reply_enabled, auto_reply_max_per_conversation
  ) VALUES (
    v_ai_config_a, v_account_a, v_user_a, 'openai', 'synthetic-model', 'synthetic',
    true, true, 1
  );
  INSERT INTO public.contacts (id, user_id, account_id, phone, name)
  VALUES
    (v_contact_a, v_user_a, v_account_a, '+15550000991', 'Synthetic AI slot contact'),
    (v_contact_disabled, v_user_a, v_account_a, '+15550000992', 'Synthetic disabled contact'),
    (v_contact_assigned, v_user_a, v_account_a, '+15550000993', 'Synthetic assigned contact');
  INSERT INTO public.conversations (id, user_id, account_id, contact_id, status)
  VALUES
    (v_conversation_a, v_user_a, v_account_a, v_contact_a, 'open'),
    (v_conversation_disabled, v_user_a, v_account_a, v_contact_disabled, 'open'),
    (v_conversation_assigned, v_user_a, v_account_a, v_contact_assigned, 'open');
  UPDATE public.conversations
     SET ai_autoreply_disabled = true
   WHERE id = v_conversation_disabled;
  UPDATE public.conversations
     SET assigned_agent_id = v_user_a
   WHERE id = v_conversation_assigned;

  INSERT INTO public.whatsapp_connections (
    id, account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_connection_a, v_account_a, v_user_a, 'http://127.0.0.1:8080',
     'ai-slot-a-' || v_user_a::text, 'synthetic', 'synthetic'),
    (v_connection_b, v_account_b, v_user_b, 'http://127.0.0.1:8080',
     'ai-slot-b-' || v_user_b::text, 'synthetic', 'synthetic');

  v_external_id := 'ai-slot:' || v_user_a::text;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, v_external_id || ':first',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, v_external_id || ':cap',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_cap;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, v_external_id || ':disabled',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id || ':disabled'), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_disabled;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, v_external_id || ':assigned',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id || ':assigned'), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_assigned;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_b, v_external_id || ':tenant',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_tenant;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, v_external_id || ':author',
     pg_catalog.jsonb_build_object('kind','message','contentType','text','fromMe',false,
       'sentByApi',false,'externalMessageId',v_external_id), 'done', pg_catalog.clock_timestamp())
    RETURNING id INTO v_event_author;

  INSERT INTO public.messages (
    conversation_id, sender_type, content_type, message_id, provider_connection_id
  ) VALUES
    (v_conversation_a, 'customer', 'text', v_external_id, v_connection_a),
    (v_conversation_disabled, 'customer', 'text', v_external_id || ':disabled', v_connection_a),
    (v_conversation_assigned, 'customer', 'text', v_external_id || ':assigned', v_connection_a);

  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, ai_config_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES
    (v_dispatch_a, v_event_a, v_account_a, 'ai', v_ai_config_a, v_user_a,
     v_contact_a, v_conversation_a, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_a),
    (v_dispatch_cap, v_event_cap, v_account_a, 'ai', v_ai_config_a, v_user_a,
     v_contact_a, v_conversation_a, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_cap),
    (v_dispatch_disabled, v_event_disabled, v_account_a, 'ai', v_ai_config_a, v_user_a,
     v_contact_disabled, v_conversation_disabled, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_disabled),
    (v_dispatch_assigned, v_event_assigned, v_account_a, 'ai', v_ai_config_a, v_user_a,
     v_contact_assigned, v_conversation_assigned, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_assigned),
    (v_dispatch_tenant, v_event_tenant, v_account_a, 'ai', v_ai_config_a, v_user_a,
     v_contact_a, v_conversation_a, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_tenant),
    (v_dispatch_author, v_event_author, v_account_a, 'ai', v_ai_config_a, v_user_b,
     v_contact_a, v_conversation_a, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_token_author);

  EXECUTE 'SET LOCAL ROLE service_role';

  v_result := public.claim_ai_reply_slot_for_dispatch(v_dispatch_a, v_token_a, 1);
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first eligible claim did not acquire a slot';
  END IF;
  IF NOT (SELECT d.ai_slot_claimed FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch_a) THEN
    RAISE EXCEPTION 'first claim did not checkpoint ai_slot_claimed';
  END IF;

  -- Replay of the same root stays successful and consumes no second slot.
  v_result := public.claim_ai_reply_slot_for_dispatch(v_dispatch_a, v_token_a, 1);
  SELECT c.ai_reply_count INTO STRICT v_count
    FROM public.conversations AS c WHERE c.id = v_conversation_a;
  IF v_result IS DISTINCT FROM true OR v_count <> 1 THEN
    RAISE EXCEPTION 'same-root replay consumed another slot';
  END IF;

  -- A second root for the same conversation loses at the persisted cap.
  v_result := public.claim_ai_reply_slot_for_dispatch(v_dispatch_cap, v_token_cap, 1);
  IF v_result IS DISTINCT FROM false
     OR (SELECT d.ai_slot_claimed FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch_cap) THEN
    RAISE EXCEPTION 'per-conversation cap was not enforced across roots';
  END IF;

  -- The legacy eligibility gates remain active.
  IF public.claim_ai_reply_slot_for_dispatch(v_dispatch_disabled, v_token_disabled, 1)
     OR public.claim_ai_reply_slot_for_dispatch(v_dispatch_assigned, v_token_assigned, 1) THEN
    RAISE EXCEPTION 'disabled or assigned conversation acquired a slot';
  END IF;

  -- The caller cannot raise or lower the cap independently of ai_configs.
  v_failed := false;
  BEGIN
    PERFORM public.claim_ai_reply_slot_for_dispatch(v_dispatch_cap, v_token_cap, 2);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'mismatched caller cap was accepted';
  END IF;

  -- Stale lease, cross-account connection and mismatched root author fail closed.
  UPDATE public.evolution_event_dispatches
     SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_dispatch_cap;
  v_failed := false;
  BEGIN
    PERFORM public.claim_ai_reply_slot_for_dispatch(v_dispatch_cap, v_token_cap, 1);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'expired root lease was accepted';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.claim_ai_reply_slot_for_dispatch(v_dispatch_tenant, v_token_tenant, 1);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'cross-account event connection was accepted';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.claim_ai_reply_slot_for_dispatch(v_dispatch_author, v_token_author, 1);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'AI config author mismatch was accepted';
  END IF;

  RESET ROLE;

  IF NOT has_function_privilege('service_role',
       'public.claim_ai_reply_slot_for_dispatch(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.claim_ai_reply_slot_for_dispatch(uuid,uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_ai_reply_slot_for_dispatch(uuid,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AI slot RPC grants are not restricted to service_role';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc AS p
       WHERE p.oid = 'public.claim_ai_reply_slot_for_dispatch(uuid,uuid,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'AI slot RPC must remain SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = 'public.claim_ai_reply_slot_for_dispatch(uuid,uuid,integer)'::regprocedure
          AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     ) THEN
    RAISE EXCEPTION 'AI slot RPC search_path is not pinned';
  END IF;
END;
$test$;

ROLLBACK;
