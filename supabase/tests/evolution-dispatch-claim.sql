BEGIN;

-- All synthetic users, accounts, roots and claim mutations roll back.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_automation_id uuid;
  v_event_id uuid;
  v_dispatch_id uuid;
  v_old_token uuid := pg_catalog.gen_random_uuid();
  v_future_id uuid;
  v_live_id uuid;
  v_cap_id uuid;
  v_exhausted_pending_id uuid;
  v_exhausted_processing_id uuid;
  v_batch_ids uuid[] := ARRAY[]::uuid[];
  v_state text;
  v_index integer;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T12 dispatch claim synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080', 't12-dispatch-claim-' || v_user_id::text,
    'synthetic-token', 'synthetic-webhook-secret'
  ) RETURNING id INTO v_connection_id;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_id, v_account_id, 'T12 dispatch claim synthetic', 'inbound_message', true)
  RETURNING id INTO v_automation_id;

  FOR v_index IN 1..12 LOOP
    INSERT INTO public.evolution_events (
      connection_id, event_key, normalized_event, state, processed_at, next_attempt_at,
      created_at
    ) VALUES (
      v_connection_id, 't12:batch:' || v_index::text,
      pg_catalog.jsonb_build_object('kind','message','eventKey','t12:batch:' || v_index::text),
      'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz,
      '2020-01-01 00:00:00+00'::timestamptz + v_index * interval '1 second'
    ) RETURNING id INTO v_event_id;
    INSERT INTO public.evolution_event_dispatches (
      event_id, account_id, engine, automation_id, user_id, state, attempts,
      next_attempt_at, created_at
    ) VALUES (
      v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'pending', 0,
      '-infinity'::timestamptz,
      '2020-01-01 00:00:00+00'::timestamptz + v_index * interval '1 second'
    ) RETURNING id INTO v_dispatch_id;
    v_batch_ids := pg_catalog.array_append(v_batch_ids, v_dispatch_id);
  END LOOP;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:expired', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'processing', 2,
    '-infinity'::timestamptz, v_old_token, '-infinity'::timestamptz
  );

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:future', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), 'infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts, next_attempt_at
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'pending', 0,
    'infinity'::timestamptz
  ) RETURNING id INTO v_future_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:live', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'processing', 2,
    'infinity'::timestamptz, v_old_token, '-infinity'::timestamptz
  ) RETURNING id INTO v_live_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:attempt-cap', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts, next_attempt_at
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'pending', 4,
    '-infinity'::timestamptz
  ) RETURNING id INTO v_cap_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:exhausted-pending', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'pending', 5,
    '-infinity'::timestamptz, v_old_token, '-infinity'::timestamptz
  ) RETURNING id INTO v_exhausted_pending_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
  VALUES (v_connection_id, 't12:exhausted-processing', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state, attempts,
    lease_until, lease_token, next_attempt_at, last_error_code
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, 'processing', 5,
    '-infinity'::timestamptz, v_old_token, '-infinity'::timestamptz, 'prior_error'
  ) RETURNING id INTO v_exhausted_processing_id;

  FOREACH v_state IN ARRAY ARRAY['done','skipped','failed','unknown'] LOOP
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
    VALUES (v_connection_id, 't12:terminal:' || v_state, '{"kind":"message"}'::jsonb,
            'done', pg_catalog.clock_timestamp(), '-infinity'::timestamptz)
    RETURNING id INTO v_event_id;
    INSERT INTO public.evolution_event_dispatches (
      event_id, account_id, engine, automation_id, user_id, state, attempts,
      last_error_code, result, next_attempt_at
    ) VALUES (
      v_event_id, v_account_id, 'automation', v_automation_id, v_user_id, v_state, 1,
      'keep_' || v_state, '{"fixture":"terminal"}'::jsonb, '-infinity'::timestamptz
    );
  END LOOP;

  PERFORM pg_catalog.set_config('wacrm.t12dispatch.user_id', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.connection_id', v_connection_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.automation_id', v_automation_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.batch_ids', v_batch_ids::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.old_token', v_old_token::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.future_id', v_future_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.live_id', v_live_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.cap_id', v_cap_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.exhausted_pending_id', v_exhausted_pending_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12dispatch.exhausted_processing_id', v_exhausted_processing_id::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_proc regprocedure := 'public.claim_evolution_dispatches(integer,integer)'::regprocedure;
  v_root regtype := 'public.evolution_event_dispatches'::regtype;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_proc)
       <> 'p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_proc AND p.proretset AND p.prorettype = v_root
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_proc AND (
          p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
        )
     )
     OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE')
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_root)
     OR pg_catalog.has_table_privilege('authenticated', v_root, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_root, 'UPDATE') THEN
    RAISE EXCEPTION 'dispatch claim signature, security, grants or table policy mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;

DO $claim_assertions$
DECLARE
  v_count integer;
  v_ids uuid[];
  v_id uuid;
  v_token_count integer;
  v_future_id uuid := current_setting('wacrm.t12dispatch.future_id')::uuid;
  v_live_id uuid := current_setting('wacrm.t12dispatch.live_id')::uuid;
  v_cap_id uuid := current_setting('wacrm.t12dispatch.cap_id')::uuid;
  v_exhausted_pending_id uuid := current_setting('wacrm.t12dispatch.exhausted_pending_id')::uuid;
  v_exhausted_processing_id uuid := current_setting('wacrm.t12dispatch.exhausted_processing_id')::uuid;
  v_account_id uuid := current_setting('wacrm.t12dispatch.account_id')::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.evolution_event_dispatches AS d
     WHERE d.account_id <> v_account_id
       AND (
         (d.state = 'pending' AND d.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (d.state = 'processing' AND d.lease_until <= pg_catalog.clock_timestamp())
       )
  ) THEN
    RAISE EXCEPTION 'dispatch claim test requires no due roots outside its rolled-back fixture';
  END IF;

  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(0, 1);
    RAISE EXCEPTION 'zero dispatch claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(11, 60);
    RAISE EXCEPTION 'dispatch claim limit above ten was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(1, 0);
    RAISE EXCEPTION 'zero dispatch lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(1, 61);
    RAISE EXCEPTION 'dispatch lease duration above sixty was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(NULL, 1);
    RAISE EXCEPTION 'null dispatch claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_dispatches(1, NULL);
    RAISE EXCEPTION 'null dispatch lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT pg_catalog.count(*)::integer, pg_catalog.array_agg(c.id)
    INTO v_count, v_ids
    FROM public.claim_evolution_dispatches(10, 30) AS c;
  IF v_count <> 10 OR EXISTS (
    SELECT 1 FROM public.evolution_event_dispatches AS d
     WHERE d.id = ANY(v_ids) AND (d.account_id <> v_account_id OR d.state <> 'processing' OR d.attempts <> 1)
  ) THEN
    RAISE EXCEPTION 'dispatch claim did not return exactly ten newly leased roots';
  END IF;
  SELECT pg_catalog.count(DISTINCT d.lease_token)::integer INTO v_token_count
    FROM public.evolution_event_dispatches AS d WHERE d.id = ANY(v_ids);
  IF v_token_count <> 10 OR EXISTS (
    SELECT 1 FROM public.evolution_event_dispatches AS d
     WHERE d.id = ANY(v_ids)
       AND (d.lease_token IS NULL OR d.lease_until <= pg_catalog.clock_timestamp()
         OR d.lease_until > pg_catalog.clock_timestamp() + interval '31 seconds')
  ) OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d
         WHERE d.id = ANY(current_setting('wacrm.t12dispatch.batch_ids')::uuid[])
           AND d.state = 'pending' AND d.attempts = 0) <> 2 THEN
    RAISE EXCEPTION 'dispatch claim token, lease or batch limit is invalid';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.claim_evolution_dispatches(10, 60) AS c;
  IF v_count <> 4
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d
       WHERE d.event_id = (SELECT e.id FROM public.evolution_events AS e WHERE e.event_key = 't12:expired')
         AND d.state = 'processing' AND d.attempts = 3
         AND d.lease_token IS DISTINCT FROM current_setting('wacrm.t12dispatch.old_token')::uuid
         AND d.lease_until > pg_catalog.clock_timestamp())
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d
       WHERE d.id = v_cap_id AND d.state = 'processing' AND d.attempts = 5
         AND d.lease_token IS NOT NULL AND d.lease_until > pg_catalog.clock_timestamp()) THEN
    RAISE EXCEPTION 'expired lease reclaim or attempts-five cap failed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.id = v_exhausted_pending_id
       AND d.state = 'failed' AND d.attempts = 5 AND d.lease_until IS NULL AND d.lease_token IS NULL
       AND d.last_error_code = 'attempts_exhausted')
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.id = v_exhausted_processing_id
       AND d.state = 'failed' AND d.attempts = 5 AND d.lease_until IS NULL AND d.lease_token IS NULL
       AND d.last_error_code = 'prior_error')
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.id = v_future_id
       AND d.state = 'pending' AND d.attempts = 0)
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.id = v_live_id
       AND d.state = 'processing' AND d.attempts = 2 AND d.lease_token = current_setting('wacrm.t12dispatch.old_token')::uuid)
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d
          WHERE d.account_id = v_account_id AND d.state IN ('done','skipped','failed','unknown')
            AND d.last_error_code LIKE 'keep_%' AND d.result = '{"fixture":"terminal"}'::jsonb) <> 4 THEN
    RAISE EXCEPTION 'exhaustion cleanup, due filtering or terminal-state preservation failed';
  END IF;
END;
$claim_assertions$;

RESET ROLE;
ROLLBACK;
