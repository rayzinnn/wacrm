BEGIN;

-- Synthetic Evolution roots/runs/steps; all state rolls back at the end.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_run_a uuid;
  v_run_reply uuid;
  v_run_send uuid;
  v_run_b uuid;
  v_contact_a uuid;
  v_conversation_a uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_event_a uuid;
  v_event_reply uuid;
  v_event_atomic uuid;
  v_event_send uuid;
  v_event_stale_root uuid;
  v_event_tenant uuid;
  v_dispatch_a uuid := pg_catalog.gen_random_uuid();
  v_dispatch_reply uuid := pg_catalog.gen_random_uuid();
  v_dispatch_atomic uuid := pg_catalog.gen_random_uuid();
  v_dispatch_send uuid := pg_catalog.gen_random_uuid();
  v_dispatch_stale_root uuid := pg_catalog.gen_random_uuid();
  v_dispatch_tenant uuid := pg_catalog.gen_random_uuid();
  v_step_a_1 uuid := pg_catalog.gen_random_uuid();
  v_step_a_2 uuid := pg_catalog.gen_random_uuid();
  v_step_reply uuid := pg_catalog.gen_random_uuid();
  v_step_reply_replay uuid := pg_catalog.gen_random_uuid();
  v_step_atomic uuid := pg_catalog.gen_random_uuid();
  v_step_send uuid := pg_catalog.gen_random_uuid();
  v_step_send_missing uuid := pg_catalog.gen_random_uuid();
  v_step_stale uuid := pg_catalog.gen_random_uuid();
  v_step_stale_root uuid := pg_catalog.gen_random_uuid();
  v_step_tenant uuid := pg_catalog.gen_random_uuid();
  v_root_token_a uuid := pg_catalog.gen_random_uuid();
  v_root_token_reply uuid := pg_catalog.gen_random_uuid();
  v_root_token_atomic uuid := pg_catalog.gen_random_uuid();
  v_root_token_send uuid := pg_catalog.gen_random_uuid();
  v_root_token_stale_root uuid := pg_catalog.gen_random_uuid();
  v_root_token_tenant uuid := pg_catalog.gen_random_uuid();
  v_step_token_a_1 uuid := pg_catalog.gen_random_uuid();
  v_step_token_a_2 uuid := pg_catalog.gen_random_uuid();
  v_step_token_reply uuid := pg_catalog.gen_random_uuid();
  v_step_token_reply_replay uuid := pg_catalog.gen_random_uuid();
  v_step_token_atomic uuid := pg_catalog.gen_random_uuid();
  v_step_token_send uuid := pg_catalog.gen_random_uuid();
  v_step_token_send_missing uuid := pg_catalog.gen_random_uuid();
  v_step_token_stale uuid := pg_catalog.gen_random_uuid();
  v_step_token_stale_root uuid := pg_catalog.gen_random_uuid();
  v_step_token_tenant uuid := pg_catalog.gen_random_uuid();
  v_send_attempt_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@flow-transition-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic flow transition A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@flow-transition-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic flow transition B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, entry_node_id)
  VALUES (v_user_a, v_account_a, 'Synthetic transition flow A', 'active', 'manual', 'node_a')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, entry_node_id)
  VALUES (v_user_b, v_account_b, 'Synthetic transition flow B', 'active', 'manual', 'tenant_node')
  RETURNING id INTO v_flow_b;

  INSERT INTO public.flow_runs (flow_id, account_id, user_id, status, current_node_key, transition_seq)
  VALUES (v_flow_a, v_account_a, v_user_a, 'active', 'node_a', 0)
  RETURNING id INTO v_run_a;
  INSERT INTO public.flow_runs (flow_id, account_id, user_id, status, current_node_key, transition_seq)
  VALUES (v_flow_a, v_account_a, v_user_a, 'active', 'after_reply', 1)
  RETURNING id INTO v_run_reply;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000123', 'Synthetic flow send contact')
  RETURNING id INTO v_contact_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open')
  RETURNING id INTO v_conversation_a;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (
    v_flow_a, v_account_a, v_user_a, v_contact_a, v_conversation_a,
    'active', 'send_node', 0
  ) RETURNING id INTO v_run_send;
  INSERT INTO public.flow_runs (flow_id, account_id, user_id, status, current_node_key, transition_seq)
  VALUES (v_flow_b, v_account_b, v_user_b, 'active', 'tenant_node', 0)
  RETURNING id INTO v_run_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_a, v_user_a, 'http://127.0.0.1:8080', 'flow-transition-a-' || v_user_a::text,
    'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_b, v_user_b, 'http://127.0.0.1:8080', 'flow-transition-b-' || v_user_b::text,
    'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'flow-transition:a:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'flow-transition:reply:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic reply"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_reply;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'flow-transition:atomic:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic atomic"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_atomic;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'flow-transition:send:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic send"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_send;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'flow-transition:stale-root:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic stale"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_stale_root;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_b, 'flow-transition:tenant:' || v_user_b::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic tenant"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_tenant;

  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, flow_id, user_id, flow_run_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES
    (v_dispatch_a, v_event_a, v_account_a, 'flow', v_flow_a, v_user_a, v_run_a, NULL, NULL,
     'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_a),
    (v_dispatch_reply, v_event_reply, v_account_a, 'flow', v_flow_a, v_user_a, v_run_reply, NULL, NULL,
     'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_reply),
    (v_dispatch_atomic, v_event_atomic, v_account_a, 'flow', v_flow_a, v_user_a, v_run_a, NULL, NULL,
     'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_atomic),
    (v_dispatch_send, v_event_send, v_account_a, 'flow', v_flow_a, v_user_a, v_run_send, v_contact_a, v_conversation_a,
     'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_send),
    (v_dispatch_stale_root, v_event_stale_root, v_account_a, 'flow', v_flow_a, v_user_a, v_run_a, NULL, NULL,
     'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_root_token_stale_root),
    (v_dispatch_tenant, v_event_tenant, v_account_b, 'flow', v_flow_b, v_user_b, v_run_b, NULL, NULL,
     'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_tenant);

  INSERT INTO public.evolution_send_attempts (
    id, account_id, connection_id, request_id, request_hash, conversation_id, outcome
  ) VALUES (
    v_send_attempt_id, v_account_a, v_connection_a,
    'evolution-step:' || v_step_send::text, 'synthetic-hash', v_conversation_a, 'pending'
  );

  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, lease_until, lease_token, request_id, send_attempt_id
  ) VALUES
    (v_step_a_1, v_dispatch_a, '0:node_a', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_a_1, 'evolution-step:' || v_step_a_1::text, NULL),
    (v_step_a_2, v_dispatch_a, '1:node_b', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_a_2, 'evolution-step:' || v_step_a_2::text, NULL),
    (v_step_reply, v_dispatch_reply, '1:wait_node', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_reply, 'evolution-step:' || v_step_reply::text, NULL),
    (v_step_reply_replay, v_dispatch_reply, '1:after_reply', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_reply_replay, 'evolution-step:' || v_step_reply_replay::text, NULL),
    (v_step_atomic, v_dispatch_atomic, '2:node_c', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_atomic, 'evolution-step:' || v_step_atomic::text, NULL),
    (v_step_send, v_dispatch_send, '0:send_node', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_send, 'evolution-step:' || v_step_send::text, v_send_attempt_id),
    (v_step_send_missing, v_dispatch_send, '0:send_node:missing-attempt', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_send_missing,
     'evolution-step:' || v_step_send_missing::text, NULL),
    (v_step_stale, v_dispatch_a, 'stale-step', 'processing', 1,
     pg_catalog.clock_timestamp() - interval '1 second', v_step_token_stale, 'evolution-step:' || v_step_stale::text, NULL),
    (v_step_stale_root, v_dispatch_stale_root, '2:node_c', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_stale_root, 'evolution-step:' || v_step_stale_root::text, NULL),
    (v_step_tenant, v_dispatch_tenant, 'tenant-step', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_tenant, 'evolution-step:' || v_step_tenant::text, NULL);

  -- A pre-existing reply checkpoint models a replay of the same inbound.
  INSERT INTO public.flow_run_events (
    flow_run_id, event_type, node_key, payload, evolution_event_id, transition_seq
  ) VALUES (
    v_run_reply, 'reply_received', 'wait_node', '{"reply":"synthetic"}'::jsonb, v_event_reply, 1
  );

  PERFORM pg_catalog.set_config('wacrm.flowtransition.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.flow_a', v_flow_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.run_a', v_run_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.run_reply', v_run_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.run_send', v_run_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.run_b', v_run_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_a', v_event_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_reply', v_event_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_atomic', v_event_atomic::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_send', v_event_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_stale_root', v_event_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.event_tenant', v_event_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_a', v_dispatch_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_reply', v_dispatch_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_atomic', v_dispatch_atomic::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_send', v_dispatch_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_stale_root', v_dispatch_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.dispatch_tenant', v_dispatch_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_a_1', v_step_a_1::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_a_2', v_step_a_2::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_reply', v_step_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_reply_replay', v_step_reply_replay::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_atomic', v_step_atomic::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_send', v_step_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_send_missing', v_step_send_missing::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_stale', v_step_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_stale_root', v_step_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_tenant', v_step_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_a', v_root_token_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_reply', v_root_token_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_atomic', v_root_token_atomic::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_send', v_root_token_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_stale_root', v_root_token_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.root_token_tenant', v_root_token_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_a_1', v_step_token_a_1::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_a_2', v_step_token_a_2::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_reply', v_step_token_reply::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_reply_replay', v_step_token_reply_replay::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_atomic', v_step_token_atomic::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_send', v_step_token_send::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_send_missing', v_step_token_send_missing::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_stale', v_step_token_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_stale_root', v_step_token_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.step_token_tenant', v_step_token_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowtransition.send_attempt', v_send_attempt_id::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.complete_evolution_flow_transition(uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text,jsonb,text,text,text)'::regprocedure;
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_function
          AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
     ) OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'flow transition function security/grants mismatch';
  END IF;
END;
$security_assertions$;

CREATE OR REPLACE FUNCTION public.t12_test_fail_flow_transition_step()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $test_function$
BEGIN
  IF OLD.state = 'processing' AND NEW.state = 'done'
     AND NEW.id::text = pg_catalog.current_setting('wacrm.flowtransition.step_atomic', true) THEN
    RAISE EXCEPTION 'synthetic step completion fault' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$test_function$;

CREATE TRIGGER t12_test_fail_flow_transition_step
BEFORE UPDATE OF state ON public.evolution_dispatch_steps
FOR EACH ROW EXECUTE FUNCTION public.t12_test_fail_flow_transition_step();

SET LOCAL ROLE service_role;
DO $transition_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.flowtransition.dispatch_a')::uuid;
  v_root_token uuid := current_setting('wacrm.flowtransition.root_token_a')::uuid;
  v_step_1 uuid := current_setting('wacrm.flowtransition.step_a_1')::uuid;
  v_step_token_1 uuid := current_setting('wacrm.flowtransition.step_token_a_1')::uuid;
  v_step_2 uuid := current_setting('wacrm.flowtransition.step_a_2')::uuid;
  v_step_token_2 uuid := current_setting('wacrm.flowtransition.step_token_a_2')::uuid;
  v_result record;
  v_run uuid := current_setting('wacrm.flowtransition.run_a')::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, v_root_token, v_step_1, v_step_token_1,
      v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 0,
      'invalid_type', 'node_a', '{}'::jsonb, 'node_b', 'active', NULL
    );
    RAISE EXCEPTION 'unsupported event type was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, v_root_token, v_step_1, v_step_token_1,
      v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 0,
      'node_entered', 'node_a', '{}'::jsonb, 'node_b', 'not_a_flow_status', NULL
    );
    RAISE EXCEPTION 'unsupported run status was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, v_root_token,
      current_setting('wacrm.flowtransition.step_stale')::uuid,
      current_setting('wacrm.flowtransition.step_token_stale')::uuid,
      v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 0,
      'node_entered', 'node_a', '{"marker":"stale-step"}'::jsonb, 'node_b', 'active', NULL
    );
    RAISE EXCEPTION 'expired step lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 0
     OR EXISTS (SELECT 1 FROM public.flow_run_events AS e
                 WHERE e.flow_run_id = v_run
                   AND e.evolution_event_id = current_setting('wacrm.flowtransition.event_a')::uuid) THEN
    RAISE EXCEPTION 'invalid request or stale step changed the run';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
    v_dispatch, v_root_token, v_step_1, v_step_token_1,
    v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 0,
    'node_entered', 'node_a', '{"marker":"transition-one"}'::jsonb, 'node_b', 'active', NULL
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'active'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'node_b'
     OR (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 1
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step_1) <> 'done'
     OR NOT EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.flow_run_id = v_run
          AND e.evolution_event_id = current_setting('wacrm.flowtransition.event_a')::uuid
          AND e.event_type = 'node_entered' AND e.transition_seq = 1
          AND e.node_key = 'node_a' AND e.payload = '{"marker":"transition-one"}'::jsonb
     ) THEN
    RAISE EXCEPTION 'first transition event/run/step were not committed together';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, v_root_token, v_step_2, v_step_token_2,
      v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 0,
      'error', NULL, '{"marker":"stale-sequence"}'::jsonb, 'node_c', 'active', NULL
    );
    RAISE EXCEPTION 'stale expected transition sequence was accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 1
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step_2) <> 'processing' THEN
    RAISE EXCEPTION 'stale expected sequence changed the run or step';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
    v_dispatch, v_root_token, v_step_2, v_step_token_2,
    v_run, current_setting('wacrm.flowtransition.event_a')::uuid, 1,
    'node_entered', 'node_b', '{"marker":"transition-two"}'::jsonb, 'node_c', 'active', NULL
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 2 OR v_result.status <> 'active'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'node_c'
     OR (SELECT count(*) FROM public.flow_run_events AS e
          WHERE e.flow_run_id = v_run
            AND e.evolution_event_id = current_setting('wacrm.flowtransition.event_a')::uuid
            AND e.event_type = 'node_entered' AND e.transition_seq IN (1, 2)) <> 2 THEN
    RAISE EXCEPTION 'two transitions for one Evolution event were not kept distinct';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      current_setting('wacrm.flowtransition.dispatch_stale_root')::uuid,
      current_setting('wacrm.flowtransition.root_token_stale_root')::uuid,
      current_setting('wacrm.flowtransition.step_stale_root')::uuid,
      current_setting('wacrm.flowtransition.step_token_stale_root')::uuid,
      v_run, current_setting('wacrm.flowtransition.event_stale_root')::uuid, 2,
      'node_entered', 'node_c', '{"marker":"stale-root"}'::jsonb, 'node_d', 'active', NULL
    );
    RAISE EXCEPTION 'expired root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      current_setting('wacrm.flowtransition.dispatch_tenant')::uuid,
      current_setting('wacrm.flowtransition.root_token_tenant')::uuid,
      current_setting('wacrm.flowtransition.step_tenant')::uuid,
      current_setting('wacrm.flowtransition.step_token_tenant')::uuid,
      v_run, current_setting('wacrm.flowtransition.event_tenant')::uuid, 0,
      'node_entered', 'tenant_node', '{"marker":"tenant"}'::jsonb, 'other', 'active', NULL
    );
    RAISE EXCEPTION 'cross-tenant flow run was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 2
     OR EXISTS (SELECT 1 FROM public.flow_run_events AS e
                 WHERE e.flow_run_id = v_run
                   AND e.evolution_event_id = current_setting('wacrm.flowtransition.event_tenant')::uuid) THEN
    RAISE EXCEPTION 'stale root or cross-tenant run changed state';
  END IF;
END;
$transition_assertions$;

DO $replay_assertion$
DECLARE
  v_result record;
  v_run uuid := current_setting('wacrm.flowtransition.run_reply')::uuid;
  v_event uuid := current_setting('wacrm.flowtransition.event_reply')::uuid;
  v_dispatch uuid := current_setting('wacrm.flowtransition.dispatch_reply')::uuid;
BEGIN
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
    v_dispatch, current_setting('wacrm.flowtransition.root_token_reply')::uuid,
    current_setting('wacrm.flowtransition.step_reply')::uuid,
    current_setting('wacrm.flowtransition.step_token_reply')::uuid,
    v_run, v_event, 0, 'reply_received', 'wait_node',
    '{"reply":"synthetic"}'::jsonb, 'after_reply', 'active', NULL
  );
  IF v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'active'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'after_reply'
     OR (SELECT count(*) FROM public.flow_run_events AS e
          WHERE e.flow_run_id = v_run AND e.evolution_event_id = v_event
            AND e.event_type = 'reply_received') <> 1
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s
          WHERE s.id = current_setting('wacrm.flowtransition.step_reply')::uuid) <> 'done' THEN
    RAISE EXCEPTION 'replayed reply advanced the flow or did not complete its fenced step';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
    v_dispatch, current_setting('wacrm.flowtransition.root_token_reply')::uuid,
    current_setting('wacrm.flowtransition.step_reply_replay')::uuid,
    current_setting('wacrm.flowtransition.step_token_reply_replay')::uuid,
    v_run, v_event, 1, 'reply_received', 'after_reply',
    '{"reply":"incompatible synthetic data"}'::jsonb, 'would_advance', 'active', NULL
  );
  IF v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'active'
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s
          WHERE s.id = current_setting('wacrm.flowtransition.step_reply_replay')::uuid) <> 'processing'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'after_reply' THEN
    RAISE EXCEPTION 'incompatible reply replay acknowledged a new step or changed the run';
  END IF;
END;
$replay_assertion$;

DO $send_attempt_assertions$
DECLARE
  v_result record;
  v_run uuid := current_setting('wacrm.flowtransition.run_send')::uuid;
  v_event uuid := current_setting('wacrm.flowtransition.event_send')::uuid;
  v_step uuid := current_setting('wacrm.flowtransition.step_send')::uuid;
  v_dispatch uuid := current_setting('wacrm.flowtransition.dispatch_send')::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, current_setting('wacrm.flowtransition.root_token_send')::uuid,
      current_setting('wacrm.flowtransition.step_send_missing')::uuid,
      current_setting('wacrm.flowtransition.step_token_send_missing')::uuid,
      v_run, v_event, 0, 'message_sent', 'send_node',
      '{"message":"synthetic"}'::jsonb, 'after_send', 'active', NULL
    );
    RAISE EXCEPTION 'message_sent without a send attempt was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, current_setting('wacrm.flowtransition.root_token_send')::uuid,
      v_step, current_setting('wacrm.flowtransition.step_token_send')::uuid,
      v_run, v_event, 0, 'message_sent', 'send_node',
      '{"message":"synthetic"}'::jsonb, 'after_send', 'active', NULL
    );
    RAISE EXCEPTION 'pending send attempt was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_send_attempts
     SET outcome = 'unknown'
   WHERE id = current_setting('wacrm.flowtransition.send_attempt')::uuid;
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_transition(
      v_dispatch, current_setting('wacrm.flowtransition.root_token_send')::uuid,
      v_step, current_setting('wacrm.flowtransition.step_token_send')::uuid,
      v_run, v_event, 0, 'message_sent', 'send_node',
      '{"message":"synthetic"}'::jsonb, 'after_send', 'active', NULL
    );
    RAISE EXCEPTION 'unknown send attempt was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 0
     OR EXISTS (SELECT 1 FROM public.flow_run_events AS e
                 WHERE e.flow_run_id = v_run AND e.evolution_event_id = v_event)
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step) <> 'processing'
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s
          WHERE s.id = current_setting('wacrm.flowtransition.step_send_missing')::uuid) <> 'processing' THEN
    RAISE EXCEPTION 'unaccepted send attempt changed Flow state';
  END IF;

  UPDATE public.evolution_send_attempts
     SET outcome = 'accepted'
   WHERE id = current_setting('wacrm.flowtransition.send_attempt')::uuid;
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
    v_dispatch, current_setting('wacrm.flowtransition.root_token_send')::uuid,
    v_step, current_setting('wacrm.flowtransition.step_token_send')::uuid,
    v_run, v_event, 0, 'message_sent', 'send_node',
    '{"message":"synthetic"}'::jsonb, 'after_send', 'active', NULL
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'active'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'after_send'
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step) <> 'done'
     OR NOT EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.flow_run_id = v_run AND e.evolution_event_id = v_event
          AND e.event_type = 'message_sent' AND e.transition_seq = 1
     ) THEN
    RAISE EXCEPTION 'accepted send attempt did not complete the Flow transition';
  END IF;
END;
$send_attempt_assertions$;

DO $atomicity_assertion$
DECLARE
  v_result record;
  v_run uuid := current_setting('wacrm.flowtransition.run_a')::uuid;
  v_event uuid := current_setting('wacrm.flowtransition.event_atomic')::uuid;
  v_step uuid := current_setting('wacrm.flowtransition.step_atomic')::uuid;
BEGIN
  BEGIN
    SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_transition(
      current_setting('wacrm.flowtransition.dispatch_atomic')::uuid,
      current_setting('wacrm.flowtransition.root_token_atomic')::uuid,
      v_step, current_setting('wacrm.flowtransition.step_token_atomic')::uuid,
      v_run, v_event, 2, 'node_entered', 'node_c',
      '{"marker":"atomic-failure"}'::jsonb, 'node_d', 'active', NULL
    );
    RAISE EXCEPTION 'synthetic step completion fault was not triggered' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 2
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'node_c'
     OR EXISTS (SELECT 1 FROM public.flow_run_events AS e
                 WHERE e.flow_run_id = v_run AND e.evolution_event_id = v_event)
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step) <> 'processing' THEN
    RAISE EXCEPTION 'failed step checkpoint left a partial Flow transition';
  END IF;
END;
$atomicity_assertion$;

RESET ROLE;
ROLLBACK;
