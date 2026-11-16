BEGIN;

-- Synthetic tenant fixtures; all rows and RPC mutations roll back.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_contact_a uuid;
  v_conversation_a uuid;
  v_automation_active uuid;
  v_automation_inactive uuid;
  v_automation_foreign uuid;
  v_flow_active uuid;
  v_ai_config uuid;
  v_event_id uuid;
  v_dispatch_automation uuid;
  v_dispatch_inactive uuid;
  v_dispatch_foreign uuid;
  v_dispatch_flow uuid;
  v_dispatch_ai uuid;
  v_token_automation uuid := pg_catalog.gen_random_uuid();
  v_token_inactive uuid := pg_catalog.gen_random_uuid();
  v_token_foreign uuid := pg_catalog.gen_random_uuid();
  v_token_flow uuid := pg_catalog.gen_random_uuid();
  v_token_ai uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 start synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 start synthetic B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
                                            token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-start-' || v_user_a::text,
          'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000011', 'T12 start synthetic')
  RETURNING id INTO v_contact_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open')
  RETURNING id INTO v_conversation_a;

  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 start active automation', 'new_message_received', true)
  RETURNING id INTO v_automation_active;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 start inactive automation', 'new_message_received', true)
  RETURNING id INTO v_automation_inactive;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_b, v_account_b, 'T12 start foreign automation', 'new_message_received', true)
  RETURNING id INTO v_automation_foreign;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, entry_node_id)
  VALUES (v_user_a, v_account_a, 'T12 start active flow', 'active', 'keyword', 'entry')
  RETURNING id INTO v_flow_active;
  INSERT INTO public.ai_configs (account_id, created_by, provider, model, api_key,
                                 is_active, auto_reply_enabled)
  VALUES (v_account_a, v_user_a, 'openai', 'fixture-model', 'fixture-placeholder-not-a-secret', true, true)
  RETURNING id INTO v_ai_config;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:start:' || v_user_a::text,
          pg_catalog.jsonb_build_object(
            'kind', 'message', 'eventKey', 't12:start:' || v_user_a::text,
            'externalMessageId', 'fixture-message-' || v_user_a::text,
            'peer', '15550000011@s.whatsapp.net', 'occurredAt', pg_catalog.now()::text,
            'fromMe', false, 'sentByApi', false, 'contentType', 'text',
            'text', 'synthetic message', 'mediaRef', NULL
          ), 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text,
                               message_id, provider_connection_id)
  VALUES (v_conversation_a, 'customer', 'text', 'synthetic message',
          'fixture-message-' || v_user_a::text, v_connection_a);

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_active, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_token_automation)
  RETURNING id INTO v_dispatch_automation;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_inactive, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_token_inactive)
  RETURNING id INTO v_dispatch_inactive;
  UPDATE public.automations SET is_active = false WHERE id = v_automation_inactive;

  -- Valid FKs but definition belongs to another tenant.
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_foreign, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_token_foreign)
  RETURNING id INTO v_dispatch_foreign;

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, flow_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'flow', v_flow_active, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_token_flow)
  RETURNING id INTO v_dispatch_flow;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, ai_config_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'ai', v_ai_config, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_token_ai)
  RETURNING id INTO v_dispatch_ai;

  PERFORM pg_catalog.set_config('wacrm.t12start.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.user_b', v_user_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.dispatch_automation', v_dispatch_automation::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.dispatch_inactive', v_dispatch_inactive::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.dispatch_foreign', v_dispatch_foreign::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.dispatch_flow', v_dispatch_flow::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.dispatch_ai', v_dispatch_ai::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.token_automation', v_token_automation::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.token_inactive', v_token_inactive::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.token_foreign', v_token_foreign::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.token_flow', v_token_flow::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12start.token_ai', v_token_ai::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.start_evolution_event_dispatch(uuid,uuid)'::regprocedure;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_function) <>
       'p_dispatch_id uuid, p_lease_token uuid'
     OR pg_catalog.pg_get_function_result(v_function) <>
       'TABLE(dispatch_id uuid, automation_log_id uuid, flow_run_id uuid, state text)'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'start RPC signature, security, or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN
    PERFORM * FROM public.start_evolution_event_dispatch(
      current_setting('wacrm.t12start.dispatch_automation')::uuid,
      current_setting('wacrm.t12start.token_automation')::uuid
    );
    RAISE EXCEPTION 'anon executed start_evolution_event_dispatch';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $start_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.t12start.dispatch_automation')::uuid;
  v_token uuid := current_setting('wacrm.t12start.token_automation')::uuid;
  v_first record;
  v_second record;
  v_replay record;
  v_inactive record;
  v_flow record;
  v_ai record;
  v_new_token uuid := pg_catalog.gen_random_uuid();
  v_bad uuid := current_setting('wacrm.t12start.dispatch_foreign')::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.start_evolution_event_dispatch(v_dispatch, pg_catalog.gen_random_uuid());
    RAISE EXCEPTION 'stale root token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT * INTO STRICT v_first FROM public.start_evolution_event_dispatch(v_dispatch, v_token);
  SELECT * INTO STRICT v_second FROM public.start_evolution_event_dispatch(v_dispatch, v_token);
  IF v_first.state <> 'processing' OR v_first.automation_log_id IS NULL
     OR v_first.flow_run_id IS NOT NULL
     OR v_second.automation_log_id IS DISTINCT FROM v_first.automation_log_id THEN
    RAISE EXCEPTION 'automation start/replay did not return one stable log';
  END IF;
  IF (SELECT count(*) FROM public.automation_logs AS l
       WHERE l.evolution_dispatch_id = v_dispatch) <> 1 THEN
    RAISE EXCEPTION 'automation dispatch did not create exactly one linked log';
  END IF;

  -- Model a worker crash after the committed start: a reclaimed lease rotates
  -- the token, and replay under that token must return the same log ID.
  UPDATE public.evolution_event_dispatches
     SET lease_token = v_new_token,
         lease_until = pg_catalog.clock_timestamp() + interval '5 minutes',
         attempts = attempts + 1
   WHERE id = v_dispatch AND state = 'processing';
  SELECT * INTO STRICT v_replay FROM public.start_evolution_event_dispatch(v_dispatch, v_new_token);
  IF v_replay.automation_log_id IS DISTINCT FROM v_first.automation_log_id
     OR (SELECT count(*) FROM public.automation_logs AS l
          WHERE l.evolution_dispatch_id = v_dispatch) <> 1 THEN
    RAISE EXCEPTION 'crash replay duplicated or changed the automation log';
  END IF;

  SELECT * INTO STRICT v_inactive FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.t12start.dispatch_inactive')::uuid,
    current_setting('wacrm.t12start.token_inactive')::uuid
  );
  IF v_inactive.state <> 'skipped' OR v_inactive.automation_log_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.automation_logs AS l
                 WHERE l.evolution_dispatch_id = v_inactive.dispatch_id) THEN
    RAISE EXCEPTION 'inactive candidate was not skipped without a log';
  END IF;

  SELECT * INTO STRICT v_flow FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.t12start.dispatch_flow')::uuid,
    current_setting('wacrm.t12start.token_flow')::uuid
  );
  IF v_flow.state <> 'processing' OR v_flow.flow_run_id IS NULL
     OR v_flow.automation_log_id IS NOT NULL
     OR (SELECT count(*) FROM public.flow_runs AS r
          WHERE r.id = v_flow.flow_run_id AND r.flow_id = (
            SELECT d.flow_id FROM public.evolution_event_dispatches AS d WHERE d.id = v_flow.dispatch_id
          )) <> 1 THEN
    RAISE EXCEPTION 'flow start did not create/link exactly one run';
  END IF;
  SELECT * INTO STRICT v_replay FROM public.start_evolution_event_dispatch(
    v_flow.dispatch_id, current_setting('wacrm.t12start.token_flow')::uuid
  );
  IF v_replay.flow_run_id IS DISTINCT FROM v_flow.flow_run_id THEN
    RAISE EXCEPTION 'flow replay changed linked run';
  END IF;

  SELECT * INTO STRICT v_ai FROM public.start_evolution_event_dispatch(
    current_setting('wacrm.t12start.dispatch_ai')::uuid,
    current_setting('wacrm.t12start.token_ai')::uuid
  );
  IF v_ai.state <> 'processing' OR v_ai.automation_log_id IS NOT NULL OR v_ai.flow_run_id IS NOT NULL
     OR (SELECT count(*) FROM public.automation_logs AS l
          WHERE l.evolution_dispatch_id = v_ai.dispatch_id) <> 0 THEN
    RAISE EXCEPTION 'AI root created a synthetic execution row';
  END IF;

  BEGIN
    PERFORM * FROM public.start_evolution_event_dispatch(
      v_bad, current_setting('wacrm.t12start.token_foreign')::uuid
    );
    RAISE EXCEPTION 'foreign definition lineage was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$start_assertions$;
RESET ROLE;

ROLLBACK;
