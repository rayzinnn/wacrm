BEGIN;

-- Synthetic fixtures only; the enclosing transaction is rolled back below.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_run_a uuid;
  v_run_b uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_reply_event_a uuid;
  v_reply_event_b uuid;
  v_prompt_event_a uuid;
  v_dispatch_a uuid := pg_catalog.gen_random_uuid();
  v_dispatch_b uuid := pg_catalog.gen_random_uuid();
  v_step_a uuid := pg_catalog.gen_random_uuid();
  v_step_stale uuid := pg_catalog.gen_random_uuid();
  v_step_b uuid := pg_catalog.gen_random_uuid();
  v_root_token_a uuid := pg_catalog.gen_random_uuid();
  v_root_token_b uuid := pg_catalog.gen_random_uuid();
  v_step_token_a uuid := pg_catalog.gen_random_uuid();
  v_step_token_stale uuid := pg_catalog.gen_random_uuid();
  v_step_token_b uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@collect-input-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic collect input A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@collect-input-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic collect input B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, entry_node_id)
  VALUES (v_user_a, v_account_a, 'Synthetic collect input A', 'active', 'manual', 'collect')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, entry_node_id)
  VALUES (v_user_b, v_account_b, 'Synthetic collect input B', 'active', 'manual', 'collect')
  RETURNING id INTO v_flow_b;
  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config)
  VALUES
    (v_flow_a, 'collect', 'collect_input', '{"var_key":"reply","next_node_key":"after"}'::jsonb),
    (v_flow_a, 'after', 'end', '{}'::jsonb),
    (v_flow_b, 'collect', 'collect_input', '{"var_key":"reply","next_node_key":"after"}'::jsonb),
    (v_flow_b, 'after', 'end', '{}'::jsonb);

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES
    (v_user_a, v_account_a, '+15550000991', 'Synthetic collect input A')
  RETURNING id INTO v_contact_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES
    (v_user_b, v_account_b, '+15550000992', 'Synthetic collect input B')
  RETURNING id INTO v_contact_b;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open')
  RETURNING id INTO v_conversation_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_b, v_account_b, v_contact_b, 'open')
  RETURNING id INTO v_conversation_b;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq, vars
  ) VALUES (
    v_flow_a, v_account_a, v_user_a, v_contact_a, v_conversation_a,
    'active', 'collect', 1, '{"keep":"prior"}'::jsonb
  ) RETURNING id INTO v_run_a;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (
    v_flow_b, v_account_b, v_user_b, v_contact_b, v_conversation_b,
    'active', 'collect', 1
  ) RETURNING id INTO v_run_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_a, v_user_a, 'evolution', 'http://127.0.0.1:8080', 'collect-input-a', 'synthetic', 'synthetic')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_b, v_user_b, 'evolution', 'http://127.0.0.1:8080', 'collect-input-b', 'synthetic', 'synthetic')
  RETURNING id INTO v_connection_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'collect-input:reply:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"  synthetic reply  "}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_reply_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_a, 'collect-input:prompt:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":true,"text":"synthetic prompt"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_prompt_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES
    (v_connection_b, 'collect-input:reply:' || v_user_b::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic reply B"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_reply_event_b;

  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, flow_id, user_id, flow_run_id,
    contact_id, conversation_id, state, attempts, lease_until, lease_token
  ) VALUES
    (v_dispatch_a, v_reply_event_a, v_account_a, 'flow', v_flow_a, v_user_a, v_run_a,
     v_contact_a, v_conversation_a, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_a),
    (v_dispatch_b, v_reply_event_b, v_account_b, 'flow', v_flow_b, v_user_b, v_run_b,
     v_contact_b, v_conversation_b, 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_b);
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, lease_until, lease_token,
    request_id, send_attempt_id
  ) VALUES
    (v_step_a, v_dispatch_a, '1:collect', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_a,
     'evolution-step:' || v_step_a::text, NULL),
    (v_step_stale, v_dispatch_a, '0:collect', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_stale,
     'evolution-step:' || v_step_stale::text, NULL),
    (v_step_b, v_dispatch_b, '1:collect', 'processing', 1,
     pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_b,
     'evolution-step:' || v_step_b::text, NULL);

  PERFORM pg_catalog.set_config('wacrm.collect_input.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.run_a', v_run_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.run_b', v_run_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.event_a', v_reply_event_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.event_b', v_reply_event_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.prompt_event_a', v_prompt_event_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.dispatch_a', v_dispatch_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.dispatch_b', v_dispatch_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_a', v_step_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_stale', v_step_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_b', v_step_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.root_token_a', v_root_token_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.root_token_b', v_root_token_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_token_a', v_step_token_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_token_stale', v_step_token_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.collect_input.step_token_b', v_step_token_b::text, true);
END;
$fixture_setup$;

DO $contract_assertions$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.complete_evolution_flow_collect_input_reply(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)'
  );
BEGIN
  IF v_signature IS NULL
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Collect_input RPC signature or grants are invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_signature
       AND NOT p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
  ) THEN
    RAISE EXCEPTION 'Collect_input RPC must be SECURITY INVOKER with safe search_path';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS i
     WHERE i.indexrelid = 'public.flow_run_events_reply_event_key'::regclass
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'Reply event uniqueness fence is missing';
  END IF;
END;
$contract_assertions$;

DO $prompt_required$
DECLARE
  v_run uuid := current_setting('wacrm.collect_input.run_a')::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_collect_input_reply(
      current_setting('wacrm.collect_input.dispatch_a')::uuid,
      current_setting('wacrm.collect_input.root_token_a')::uuid,
      current_setting('wacrm.collect_input.step_a')::uuid,
      current_setting('wacrm.collect_input.step_token_a')::uuid,
      v_run,
      current_setting('wacrm.collect_input.event_a')::uuid,
      1,
      'collect'
    );
    RAISE EXCEPTION 'Reply without a registered prompt was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 1
     OR EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.flow_run_id = v_run
          AND e.event_type = 'reply_received'
          AND e.evolution_event_id = current_setting('wacrm.collect_input.event_a')::uuid
     ) THEN
    RAISE EXCEPTION 'Missing prompt validation mutated the Flow run';
  END IF;
END;
$prompt_required$;

INSERT INTO public.flow_run_events (
  flow_run_id, event_type, node_key, payload, evolution_event_id, transition_seq
)
VALUES (
  current_setting('wacrm.collect_input.run_a')::uuid,
  'message_sent', 'collect', '{}'::jsonb,
  current_setting('wacrm.collect_input.prompt_event_a')::uuid, 1
);

DO $stale_and_tenant_assertions$
BEGIN
  BEGIN
    PERFORM * FROM public.complete_evolution_flow_collect_input_reply(
      current_setting('wacrm.collect_input.dispatch_a')::uuid,
      current_setting('wacrm.collect_input.root_token_a')::uuid,
      current_setting('wacrm.collect_input.step_stale')::uuid,
      current_setting('wacrm.collect_input.step_token_stale')::uuid,
      current_setting('wacrm.collect_input.run_a')::uuid,
      current_setting('wacrm.collect_input.event_a')::uuid,
      0,
      'collect'
    );
    RAISE EXCEPTION 'Stale transition sequence was accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_collect_input_reply(
      current_setting('wacrm.collect_input.dispatch_b')::uuid,
      current_setting('wacrm.collect_input.root_token_b')::uuid,
      current_setting('wacrm.collect_input.step_b')::uuid,
      current_setting('wacrm.collect_input.step_token_b')::uuid,
      current_setting('wacrm.collect_input.run_a')::uuid,
      current_setting('wacrm.collect_input.event_a')::uuid,
      1,
      'collect'
    );
    RAISE EXCEPTION 'Cross-account Flow run/event was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT r.transition_seq FROM public.flow_runs AS r
       WHERE r.id = current_setting('wacrm.collect_input.run_a')::uuid) <> 1
     OR EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.flow_run_id = current_setting('wacrm.collect_input.run_a')::uuid
          AND e.event_type = 'reply_received'
          AND e.evolution_event_id = current_setting('wacrm.collect_input.event_a')::uuid
     ) THEN
    RAISE EXCEPTION 'Rejected stale/tenant calls mutated the Flow run';
  END IF;
END;
$stale_and_tenant_assertions$;

DO $capture_and_replay$
DECLARE
  v_result record;
  v_run uuid := current_setting('wacrm.collect_input.run_a')::uuid;
  v_event uuid := current_setting('wacrm.collect_input.event_a')::uuid;
  v_step uuid := current_setting('wacrm.collect_input.step_a')::uuid;
BEGIN
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_collect_input_reply(
    current_setting('wacrm.collect_input.dispatch_a')::uuid,
    current_setting('wacrm.collect_input.root_token_a')::uuid,
    v_step,
    current_setting('wacrm.collect_input.step_token_a')::uuid,
    v_run,
    v_event,
    1,
    'collect'
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 2 OR v_result.status <> 'active'
     OR (SELECT r.current_node_key FROM public.flow_runs AS r WHERE r.id = v_run) <> 'after'
     OR (SELECT r.vars FROM public.flow_runs AS r WHERE r.id = v_run)
          IS DISTINCT FROM '{"keep":"prior","reply":"synthetic reply"}'::jsonb
     OR (SELECT count(*) FROM public.flow_run_events AS e
          WHERE e.flow_run_id = v_run AND e.event_type = 'reply_received'
            AND e.evolution_event_id = v_event) <> 1
     OR (SELECT e.payload FROM public.flow_run_events AS e
          WHERE e.flow_run_id = v_run AND e.event_type = 'reply_received'
            AND e.evolution_event_id = v_event) IS DISTINCT FROM '{}'::jsonb
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step) <> 'done'
     OR (SELECT s.result->>'event_id' FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step)
          IS DISTINCT FROM v_event::text THEN
    RAISE EXCEPTION 'Collect_input capture did not atomically persist its checkpoint';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_collect_input_reply(
    current_setting('wacrm.collect_input.dispatch_a')::uuid,
    current_setting('wacrm.collect_input.root_token_a')::uuid,
    v_step,
    current_setting('wacrm.collect_input.step_token_a')::uuid,
    v_run,
    v_event,
    1,
    'collect'
  );
  IF v_result.applied OR v_result.transition_seq <> 2 OR v_result.status <> 'active'
     OR (SELECT r.transition_seq FROM public.flow_runs AS r WHERE r.id = v_run) <> 2
     OR (SELECT count(*) FROM public.flow_run_events AS e
          WHERE e.flow_run_id = v_run AND e.event_type = 'reply_received'
            AND e.evolution_event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'Collect_input replay advanced or duplicated the reply';
  END IF;

  BEGIN
    INSERT INTO public.flow_run_events (
      flow_run_id, event_type, node_key, payload, evolution_event_id, transition_seq
    ) VALUES (v_run, 'reply_received', 'collect', '{}'::jsonb, v_event, 3);
    RAISE EXCEPTION 'Reply uniqueness index accepted a duplicate event';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$capture_and_replay$;

ROLLBACK;
