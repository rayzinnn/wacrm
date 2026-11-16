BEGIN;

-- Two synthetic accounts, definitions, events and dispatch roots; all changes roll back.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_automation_a uuid;
  v_automation_b uuid;
  v_event_id uuid;
  v_done_id uuid;
  v_skipped_id uuid;
  v_failed_id uuid;
  v_unknown_id uuid;
  v_bad_tenant_id uuid;
  v_bad_definition_id uuid;
  v_token_done uuid := pg_catalog.gen_random_uuid();
  v_token_skipped uuid := pg_catalog.gen_random_uuid();
  v_token_failed uuid := pg_catalog.gen_random_uuid();
  v_token_unknown uuid := pg_catalog.gen_random_uuid();
  v_token_bad_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_bad_definition uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 complete synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 complete synthetic B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
                                            token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-complete-' || v_user_a::text,
          'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 complete synthetic A', 'inbound_message', true)
  RETURNING id INTO v_automation_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_b, v_account_b, 'T12 complete synthetic B', 'inbound_message', true)
  RETURNING id INTO v_automation_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:complete:done', '{"kind":"message"}'::jsonb, 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_a, v_user_a,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_done)
  RETURNING id INTO v_done_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:complete:skipped', '{"kind":"message"}'::jsonb, 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_a, v_user_a,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_skipped)
  RETURNING id INTO v_skipped_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:complete:failed', '{"kind":"message"}'::jsonb, 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_a, v_user_a,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_failed)
  RETURNING id INTO v_failed_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:complete:unknown', '{"kind":"message"}'::jsonb, 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_a, v_user_a,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_unknown)
  RETURNING id INTO v_unknown_id;

  -- FKs pass, while event/connection and account/definition lineages do not.
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES ((SELECT e.id FROM public.evolution_events AS e WHERE e.event_key = 't12:complete:done'),
          v_account_b, 'automation', v_automation_b, v_user_b,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_bad_tenant)
  RETURNING id INTO v_bad_tenant_id;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:complete:bad-definition', '{"kind":"message"}'::jsonb, 'done', pg_catalog.now())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id,
                                                  state, attempts, lease_until, lease_token)
  VALUES (v_event_id, v_account_a, 'automation', v_automation_b, v_user_a,
          'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_token_bad_definition)
  RETURNING id INTO v_bad_definition_id;

  PERFORM pg_catalog.set_config('wacrm.t12complete.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.done_id', v_done_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.skipped_id', v_skipped_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.failed_id', v_failed_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.unknown_id', v_unknown_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.bad_tenant_id', v_bad_tenant_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.bad_definition_id', v_bad_definition_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_done', v_token_done::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_skipped', v_token_skipped::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_failed', v_token_failed::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_unknown', v_token_unknown::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_bad_tenant', v_token_bad_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12complete.token_bad_definition', v_token_bad_definition::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.complete_evolution_dispatch(uuid,uuid,text,jsonb,text)'::regprocedure;
  v_table regclass := 'public.evolution_event_dispatches'::regclass;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_function) <>
       'p_dispatch_id uuid, p_lease_token uuid, p_state text, p_result jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text'
     OR pg_catalog.pg_get_function_result(v_function) <> 'evolution_event_dispatches'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'public' AND p.tablename = 'evolution_event_dispatches')
     OR pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE') THEN
    RAISE EXCEPTION 'root completion signature, security, or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN
    PERFORM public.complete_evolution_dispatch(
      current_setting('wacrm.t12complete.done_id')::uuid,
      current_setting('wacrm.t12complete.token_done')::uuid, 'done'
    );
    RAISE EXCEPTION 'anon executed complete_evolution_dispatch';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $completion_assertions$
DECLARE
  v_done_id uuid := current_setting('wacrm.t12complete.done_id')::uuid;
  v_done_token uuid := current_setting('wacrm.t12complete.token_done')::uuid;
  v_result public.evolution_event_dispatches%ROWTYPE;
  v_pending_step_id uuid := pg_catalog.gen_random_uuid();
  v_processing_step_id uuid := pg_catalog.gen_random_uuid();
  v_skipped_id uuid := current_setting('wacrm.t12complete.skipped_id')::uuid;
  v_failed_id uuid := current_setting('wacrm.t12complete.failed_id')::uuid;
  v_unknown_id uuid := current_setting('wacrm.t12complete.unknown_id')::uuid;
  v_bad_tenant_id uuid := current_setting('wacrm.t12complete.bad_tenant_id')::uuid;
  v_bad_definition_id uuid := current_setting('wacrm.t12complete.bad_definition_id')::uuid;
BEGIN
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, v_done_token, 'processing');
    RAISE EXCEPTION 'non-terminal root state was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, v_done_token, 'done', '{}'::jsonb, NULL);
    RAISE EXCEPTION 'undefined JSON result was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, pg_catalog.gen_random_uuid(), 'done');
    RAISE EXCEPTION 'stale root token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_bad_tenant_id,
      current_setting('wacrm.t12complete.token_bad_tenant')::uuid, 'done');
    RAISE EXCEPTION 'event/connection cross-account lineage was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_bad_definition_id,
      current_setting('wacrm.t12complete.token_bad_definition')::uuid, 'done');
    RAISE EXCEPTION 'cross-account definition lineage was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, state)
  VALUES (v_pending_step_id, v_done_id, 'fixture:pending', 'pending');
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, v_done_token, 'done');
    RAISE EXCEPTION 'root completed while a pending step existed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d
      WHERE d.id = v_done_id AND d.state = 'processing' AND d.lease_token = v_done_token
        AND d.result IS NULL AND d.lease_until > pg_catalog.clock_timestamp()) THEN
    RAISE EXCEPTION 'blocked completion mutated the root';
  END IF;

  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, state)
  VALUES (v_processing_step_id, v_done_id, 'fixture:processing', 'processing');
  UPDATE public.evolution_dispatch_steps SET state = 'skipped' WHERE id = v_pending_step_id;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, v_done_token, 'done');
    RAISE EXCEPTION 'root completed while a processing step existed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_dispatch_steps SET state = 'done' WHERE id = v_processing_step_id;
  v_result := public.complete_evolution_dispatch(v_done_id, v_done_token, 'done');
  IF v_result.state <> 'done' OR v_result.result IS NOT NULL
     OR v_result.last_error_code IS NOT NULL
     OR v_result.lease_token IS NOT NULL OR v_result.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'done root completion persisted a result or retained a lease';
  END IF;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_done_id, v_done_token, 'done');
    RAISE EXCEPTION 'terminal root replay was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  v_result := public.complete_evolution_dispatch(v_skipped_id,
    current_setting('wacrm.t12complete.token_skipped')::uuid, 'skipped');
  IF v_result.state <> 'skipped' OR v_result.result IS NOT NULL
     OR v_result.lease_token IS NOT NULL OR v_result.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'skipped root completion state is incorrect';
  END IF;
  v_result := public.complete_evolution_dispatch(v_failed_id,
    current_setting('wacrm.t12complete.token_failed')::uuid, 'failed', NULL,
    'unsafe error text - not a credential');
  IF v_result.state <> 'failed' OR v_result.last_error_code <> 'worker_error'
     OR v_result.result IS NOT NULL THEN
    RAISE EXCEPTION 'failed root error was not sanitized or result was persisted';
  END IF;
  v_result := public.complete_evolution_dispatch(v_unknown_id,
    current_setting('wacrm.t12complete.token_unknown')::uuid, 'unknown', NULL, 'remote_timeout');
  IF v_result.state <> 'unknown' OR v_result.last_error_code <> 'remote_timeout'
     OR v_result.result IS NOT NULL THEN
    RAISE EXCEPTION 'unknown root completion did not preserve its safe error code';
  END IF;

  UPDATE public.evolution_event_dispatches SET lease_until = '-infinity'::timestamptz
   WHERE id = v_unknown_id;
  BEGIN
    PERFORM public.complete_evolution_dispatch(v_unknown_id,
      current_setting('wacrm.t12complete.token_unknown')::uuid, 'unknown');
    RAISE EXCEPTION 'expired root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$completion_assertions$;

RESET ROLE;
ROLLBACK;
