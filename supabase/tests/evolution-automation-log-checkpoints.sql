BEGIN;

-- Synthetic two-tenant fixture. The enclosing transaction is rolled back below.
DO $checkpoint_fixture$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection uuid;
  v_automation uuid;
  v_event uuid;
  v_direct_event uuid;
  v_dispatch uuid;
  v_log uuid;
  v_direct_dispatch uuid;
  v_direct_log uuid;
  v_action uuid;
  v_step uuid;
  v_root_token uuid := pg_catalog.gen_random_uuid();
  v_direct_root_token uuid := pg_catalog.gen_random_uuid();
  v_step_token uuid := pg_catalog.gen_random_uuid();
  v_result jsonb := '{"applied":true,"synthetic":true}'::jsonb;
  v_appended boolean;
  v_log_status text;
  v_completed public.evolution_dispatch_steps%ROWTYPE;
  v_final record;
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 log checkpoint A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 log checkpoint B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-log-' || v_user_a::text,
    'synthetic-placeholder', 'synthetic-placeholder'
  ) RETURNING id INTO v_connection;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 log checkpoint synthetic', 'inbound_message', true)
  RETURNING id INTO v_automation;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (
    v_connection, 't12:log-checkpoint:' || v_user_a::text,
    '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false}'::jsonb,
    'done', pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_event;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_event, v_account_a, 'automation', v_automation, v_user_a,
    'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_root_token
  ) RETURNING id INTO v_dispatch;
  INSERT INTO public.automation_logs (
    automation_id, account_id, user_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (
    v_automation, v_account_a, v_user_a, 'inbound_message', '[]'::jsonb,
    'partial', v_dispatch
  ) RETURNING id INTO v_log;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log WHERE id = v_dispatch;
  INSERT INTO public.automation_steps (automation_id, step_type, step_config, position)
  VALUES (v_automation, 'add_tag', '{"tag_id":"00000000-0000-4000-8000-000000000001"}'::jsonb, 0)
  RETURNING id INTO v_action;
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, lease_until, lease_token, request_id
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_dispatch, v_action::text, 'processing', 1,
    pg_catalog.clock_timestamp() + interval '2 minutes', v_step_token, NULL
  ) RETURNING id INTO v_step;
  UPDATE public.evolution_dispatch_steps
     SET request_id = 'evolution-step:' || v_step::text
   WHERE id = v_step;

  -- Fences are required before the first append, even when other arguments
  -- and tenant links are valid.
  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, pg_catalog.gen_random_uuid(), v_log,
      v_step, v_step_token, 'done', v_result, NULL
    );
    RAISE EXCEPTION 'wrong root fence was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, v_log,
      v_step, pg_catalog.gen_random_uuid(), 'done', v_result, NULL
    );
    RAISE EXCEPTION 'wrong step fence was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_event_dispatches SET lease_until = '-infinity'::timestamptz WHERE id = v_dispatch;
  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, v_log,
      v_step, v_step_token, 'done', v_result, NULL
    );
    RAISE EXCEPTION 'expired root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_event_dispatches
     SET lease_until = pg_catalog.clock_timestamp() + interval '2 minutes'
   WHERE id = v_dispatch;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz WHERE id = v_step;
  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, v_log,
      v_step, v_step_token, 'done', v_result, NULL
    );
    RAISE EXCEPTION 'expired step lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_dispatch_steps
     SET lease_until = pg_catalog.clock_timestamp() + interval '2 minutes'
   WHERE id = v_step;

  -- The append is idempotent by ledger step ID and checks tenant/log lineage.
  SELECT x.appended INTO STRICT v_appended
    FROM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, v_log,
      v_step, v_step_token, 'done', v_result, NULL
    ) AS x;
  IF v_appended IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'first append did not insert';
  END IF;
  SELECT x.appended INTO STRICT v_appended
    FROM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, v_log,
      v_step, v_step_token, 'done', v_result, NULL
    ) AS x;
  IF v_appended IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'replay appended a duplicate';
  END IF;
  SELECT pg_catalog.jsonb_array_length(l.steps_executed) INTO STRICT v_count
    FROM public.automation_logs AS l WHERE l.id = v_log;
  IF v_count <> 1 THEN RAISE EXCEPTION 'replay duplicated log item'; END IF;

  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_b, v_dispatch, v_root_token, v_log,
      v_step, v_step_token, 'done', v_result, NULL
    );
    RAISE EXCEPTION 'wrong tenant was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.append_evolution_automation_step_log(
      v_account_a, v_dispatch, v_root_token, pg_catalog.gen_random_uuid(),
      v_step, v_step_token, 'done', v_result, NULL
    );
    RAISE EXCEPTION 'wrong log link was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  -- Existing step completion now appends before consuming the step lease.
  v_completed := public.complete_evolution_dispatch_step(
    v_step, v_root_token, v_step_token, 'done',
    'evolution-step:' || v_step::text, NULL, v_result, NULL
  );
  IF v_completed.state IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'step did not complete';
  END IF;
  SELECT pg_catalog.jsonb_array_length(l.steps_executed) INTO STRICT v_count
    FROM public.automation_logs AS l WHERE l.id = v_log;
  IF v_count <> 1 THEN RAISE EXCEPTION 'step completion duplicated log item'; END IF;
  v_completed := public.complete_evolution_dispatch_step(
    v_step, v_root_token, v_step_token, 'done',
    'evolution-step:' || v_step::text, NULL, v_result, NULL
  );
  IF v_completed.state IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'step completion replay did not return prior result';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_automation_dispatch(
      v_account_b, v_dispatch, v_root_token, 'done', NULL
    );
    RAISE EXCEPTION 'wrong tenant root finalization was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.complete_evolution_automation_dispatch(
      v_account_a, v_dispatch, pg_catalog.gen_random_uuid(), 'done', NULL
    );
    RAISE EXCEPTION 'wrong root finalization fence was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT * INTO STRICT v_final
    FROM public.complete_evolution_automation_dispatch(
      v_account_a, v_dispatch, v_root_token, 'done', NULL
    );
  IF v_final.dispatch_state IS DISTINCT FROM 'done'
     OR v_final.log_status IS DISTINCT FROM 'success'
     OR v_final.replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'root/log finalization mismatch';
  END IF;
  SELECT * INTO STRICT v_final
    FROM public.complete_evolution_automation_dispatch(
      v_account_a, v_dispatch, v_root_token, 'done', NULL
    );
  IF v_final.replayed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'root finalization replay was not idempotent';
  END IF;

  SELECT pg_catalog.jsonb_array_length(l.steps_executed) INTO STRICT v_count
    FROM public.automation_logs AS l WHERE l.id = v_log;
  IF v_count <> 1 THEN RAISE EXCEPTION 'final replay duplicated log item'; END IF;

  -- The established worker path completes the root through the same RPC and
  -- must finalize its linked automation log without a worker change.
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (
    v_connection, 't12:log-checkpoint-direct:' || v_user_a::text,
    '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false}'::jsonb,
    'done', pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_direct_event;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_direct_event, v_account_a, 'automation', v_automation, v_user_a,
    'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_direct_root_token
  ) RETURNING id INTO v_direct_dispatch;
  INSERT INTO public.automation_logs (
    automation_id, account_id, user_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (
    v_automation, v_account_a, v_user_a, 'inbound_message', '[]'::jsonb,
    'partial', v_direct_dispatch
  ) RETURNING id INTO v_direct_log;
  UPDATE public.evolution_event_dispatches
     SET automation_log_id = v_direct_log
   WHERE id = v_direct_dispatch;

  v_final := public.complete_evolution_dispatch(
    v_direct_dispatch, v_direct_root_token, 'done', NULL, NULL
  );
  IF v_final.state IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'direct root completion did not return done';
  END IF;
  SELECT l.status INTO STRICT v_log_status
    FROM public.automation_logs AS l WHERE l.id = v_direct_log;
  IF v_log_status IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'direct root completion did not finalize automation log';
  END IF;
END;
$checkpoint_fixture$;

ROLLBACK;
