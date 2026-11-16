BEGIN;

-- Synthetic auth, account, connection and event fixtures are rolled back.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_old_token uuid := pg_catalog.gen_random_uuid();
  v_exhausted_pending_id uuid;
  v_exhausted_processing_id uuid;
  v_live_id uuid;
  v_future_id uuid;
  v_connection_event_id uuid;
  v_status_event_id uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T09 message claim synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080', 't09-message-claim-' || v_user_id::text,
    'synthetic-token', 'synthetic-webhook-secret'
  ) RETURNING id INTO v_connection_id;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at, created_at
  )
  SELECT v_connection_id, 'message:batch:' || series::text,
         pg_catalog.jsonb_build_object('kind','message','eventKey','message:batch:' || series::text),
         'pending', 0, '-infinity'::timestamptz,
         '2020-01-01 00:00:00+00'::timestamptz + series * interval '1 second'
    FROM pg_catalog.generate_series(1, 12) AS series;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_connection_id, 'message:expired', '{"kind":"message"}'::jsonb,
    'processing', 2, '-infinity'::timestamptz, v_old_token, '-infinity'::timestamptz
  );
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES (
    v_connection_id, 'message:future', '{"kind":"message"}'::jsonb,
    'pending', 0, 'infinity'::timestamptz
  ) RETURNING id INTO v_future_id;
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_connection_id, 'message:live', '{"kind":"message"}'::jsonb,
    'processing', 1, 'infinity'::timestamptz, v_old_token, '-infinity'::timestamptz
  ) RETURNING id INTO v_live_id;
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    next_attempt_at, lease_until, lease_token
  ) VALUES (
    v_connection_id, 'message:exhausted-pending', '{"kind":"message"}'::jsonb,
    'pending', 5, '-infinity'::timestamptz, '-infinity'::timestamptz, v_old_token
  ) RETURNING id INTO v_exhausted_pending_id;
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at, last_error_code
  ) VALUES (
    v_connection_id, 'message:exhausted-processing', '{"kind":"message"}'::jsonb,
    'processing', 5, '-infinity'::timestamptz, v_old_token, '-infinity'::timestamptz, 'prior_error'
  ) RETURNING id INTO v_exhausted_processing_id;
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES (
    v_connection_id, 'connection:unclaimed', '{"kind":"connection"}'::jsonb,
    'pending', 0, '-infinity'::timestamptz
  ) RETURNING id INTO v_connection_event_id;
  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES (
    v_connection_id, 'status:unclaimed', '{"kind":"status"}'::jsonb,
    'pending', 0, '-infinity'::timestamptz
  ) RETURNING id INTO v_status_event_id;

  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.user_id', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.connection_id', v_connection_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.old_token', v_old_token::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.future_id', v_future_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.live_id', v_live_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.exhausted_pending_id', v_exhausted_pending_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.exhausted_processing_id', v_exhausted_processing_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.connection_event_id', v_connection_event_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09messageclaim.status_event_id', v_status_event_id::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_proc regprocedure := 'public.claim_evolution_message_events(integer,integer)'::regprocedure;
  v_event_type regtype := 'public.evolution_events'::regtype;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_proc)
       <> 'p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_proc AND p.proretset AND p.prorettype = v_event_type
     )
     OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_proc AND (
       p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     )
  ) OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'message claim RPC security attributes or grants do not match the contract';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;

DO $claim_assertions$
DECLARE
  v_count integer;
  v_ids uuid[];
  v_row public.evolution_events%ROWTYPE;
  v_event_id uuid;
  v_token uuid;
  v_started timestamptz;
  v_delay double precision;
  v_future_id uuid := current_setting('wacrm.t09messageclaim.future_id')::uuid;
  v_live_id uuid := current_setting('wacrm.t09messageclaim.live_id')::uuid;
  v_exhausted_pending_id uuid := current_setting('wacrm.t09messageclaim.exhausted_pending_id')::uuid;
  v_exhausted_processing_id uuid := current_setting('wacrm.t09messageclaim.exhausted_processing_id')::uuid;
  v_connection_event_id uuid := current_setting('wacrm.t09messageclaim.connection_event_id')::uuid;
  v_status_event_id uuid := current_setting('wacrm.t09messageclaim.status_event_id')::uuid;
  v_old_token uuid := current_setting('wacrm.t09messageclaim.old_token')::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.connection_id <> current_setting('wacrm.t09messageclaim.connection_id')::uuid
       AND e.normalized_event ->> 'kind' = 'message'
       AND (
         (e.state = 'pending' AND e.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (e.state = 'processing' AND e.lease_until <= pg_catalog.clock_timestamp())
       )
  ) THEN
    RAISE EXCEPTION 'message claim test requires no due message events outside its rolled-back fixture';
  END IF;

  BEGIN
    PERFORM 1 FROM public.claim_evolution_message_events(0, 1);
    RAISE EXCEPTION 'zero message claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_message_events(11, 60);
    RAISE EXCEPTION 'message claim limit above ten was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_message_events(1, 0);
    RAISE EXCEPTION 'zero message lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_message_events(1, 61);
    RAISE EXCEPTION 'message lease duration above sixty was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT pg_catalog.count(*)::integer, pg_catalog.array_agg(c.id)
    INTO v_count, v_ids
    FROM public.claim_evolution_message_events(10, 30) AS c;
  IF v_count <> 10 OR EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = ANY(v_ids) AND e.normalized_event ->> 'kind' <> 'message'
  ) THEN
    RAISE EXCEPTION 'message claim did not return exactly ten message events';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
       WHERE e.event_key LIKE 'message:batch:%' AND e.state = 'processing' AND e.attempts = 1) <> 10
     OR (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
       WHERE e.event_key LIKE 'message:batch:%' AND e.state = 'pending' AND e.attempts = 0) <> 2
     OR EXISTS (
       SELECT 1 FROM public.evolution_events AS e
        WHERE e.id = ANY(v_ids)
          AND (e.lease_token IS NULL OR e.lease_until <= pg_catalog.clock_timestamp()
            OR e.lease_until > pg_catalog.clock_timestamp() + interval '31 seconds')
     ) THEN
    RAISE EXCEPTION 'message claim exceeded the limit or wrote invalid attempts/leases';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.claim_evolution_message_events(10, 60) AS c;
  IF v_count <> 3
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.event_key = 'message:expired'
       AND e.state = 'processing' AND e.attempts = 3 AND e.lease_token IS DISTINCT FROM v_old_token
       AND e.lease_until > pg_catalog.clock_timestamp())
     OR EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_future_id AND e.attempts <> 0)
     OR EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_live_id AND e.attempts <> 1) THEN
    RAISE EXCEPTION 'message claim did not reclaim only due pending/expired rows';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_exhausted_pending_id
       AND e.state = 'failed' AND e.attempts = 5 AND e.lease_until IS NULL AND e.lease_token IS NULL
       AND e.last_error_code = 'attempts_exhausted')
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_exhausted_processing_id
       AND e.state = 'failed' AND e.attempts = 5 AND e.lease_until IS NULL AND e.lease_token IS NULL
       AND e.last_error_code = 'prior_error')
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_connection_event_id
       AND e.state = 'pending' AND e.attempts = 0 AND e.lease_token IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_status_event_id
       AND e.state = 'pending' AND e.attempts = 0 AND e.lease_token IS NULL) THEN
    RAISE EXCEPTION 'message exhaustion or event-kind isolation is invalid';
  END IF;

  SELECT e.id, e.lease_token INTO STRICT v_event_id, v_token
    FROM public.evolution_events AS e
   WHERE e.event_key LIKE 'message:batch:%' AND e.state = 'processing' AND e.attempts = 1
   ORDER BY e.id
   LIMIT 1;
  v_started := pg_catalog.clock_timestamp();
  SELECT * INTO STRICT v_row
    FROM public.fail_evolution_event(v_event_id, v_token, 'synthetic_retry', true);
  v_delay := EXTRACT(EPOCH FROM (v_row.next_attempt_at - v_started));
  IF v_row.state <> 'pending' OR v_row.attempts <> 1 OR v_row.lease_token IS NOT NULL
     OR v_row.lease_until IS NOT NULL OR v_row.last_error_code <> 'synthetic_retry'
     OR v_delay < 4 OR v_delay > 6 THEN
    RAISE EXCEPTION 'generic fail_evolution_event did not schedule message retry';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_connection_event_id
       AND e.state = 'pending' AND e.attempts = 0 AND e.lease_token IS NULL) THEN
    RAISE EXCEPTION 'message claim touched the existing connection queue';
  END IF;
END;
$claim_assertions$;

RESET ROLE;
ROLLBACK;
