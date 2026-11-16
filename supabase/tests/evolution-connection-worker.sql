BEGIN;

-- All users, accounts, connections, events and worker mutations below are
-- synthetic and rolled back. No live account fixture is updated.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_reclaim_id uuid;
  v_exhausted_ids uuid[];
  v_retry_id uuid;
  v_atomic_id uuid;
  v_monotonic_id uuid;
  v_wrong_kind_id uuid;
  v_kind_connection_id uuid;
  v_exhausted_message_id uuid;
  v_exhausted_message_token uuid := pg_catalog.gen_random_uuid();
  v_infinite_time_id uuid;
  v_invalid_state_id uuid;
  v_old_token uuid := pg_catalog.gen_random_uuid();
  v_batch_ids uuid[];
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated',
    v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T09.c1 disposable connection worker"}'::jsonb
  );

  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080',
    't09-c1-' || v_user_id::text,
    'synthetic-token-ciphertext', 'synthetic-webhook-ciphertext'
  ) RETURNING id INTO v_connection_id;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    next_attempt_at, created_at
  )
  SELECT v_connection_id, 't09-batch-' || series::text,
         pg_catalog.jsonb_build_object('kind', 'connection', 'eventKey', 't09-batch-' || series::text),
         'pending', 0, '-infinity'::timestamptz, '-infinity'::timestamptz
    FROM pg_catalog.generate_series(1, 12) AS series;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at
  )
  SELECT v_connection_id, 't09-exhausted-' || series::text,
         '{"kind":"connection"}'::jsonb, 'processing', 5,
         '-infinity'::timestamptz, pg_catalog.gen_random_uuid(),
         '-infinity'::timestamptz
    FROM pg_catalog.generate_series(1, 11) AS series;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_connection_id, 't09-reclaim', '{"kind":"connection"}'::jsonb,
    'processing', 1, '-infinity'::timestamptz, v_old_token,
    pg_catalog.clock_timestamp() - interval '2 days'
  ) RETURNING id INTO v_reclaim_id;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES (
    v_connection_id, 't09-retry', '{"kind":"connection"}'::jsonb,
    'pending', 0, 'infinity'::timestamptz
  ) RETURNING id INTO v_retry_id;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES
    (v_connection_id, 't09-atomic', '{"kind":"connection"}'::jsonb, 'pending', 0, 'infinity'::timestamptz),
    (v_connection_id, 't09-monotonic', '{"kind":"connection"}'::jsonb, 'pending', 0, 'infinity'::timestamptz),
    (v_connection_id, 't09-wrong-kind', '{"kind":"message"}'::jsonb, 'pending', 0, 'infinity'::timestamptz),
    (v_connection_id, 't09-infinite-time', '{"kind":"connection"}'::jsonb, 'pending', 0, 'infinity'::timestamptz),
    (v_connection_id, 't09-invalid-state', '{"kind":"connection"}'::jsonb, 'pending', 0, 'infinity'::timestamptz);

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, next_attempt_at
  ) VALUES (
    v_connection_id, 't09-kind-connection', '{"kind":"connection"}'::jsonb,
    'pending', 0, 'infinity'::timestamptz
  ) RETURNING id INTO v_kind_connection_id;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, next_attempt_at
  ) VALUES (
    v_connection_id, 't09-message-exhausted', '{"kind":"message"}'::jsonb,
    'processing', 5, '-infinity'::timestamptz, v_exhausted_message_token,
    'infinity'::timestamptz
  ) RETURNING id INTO v_exhausted_message_id;

  SELECT pg_catalog.array_agg(e.id ORDER BY e.event_key) INTO v_batch_ids
    FROM public.evolution_events AS e
   WHERE e.connection_id = v_connection_id AND e.event_key LIKE 't09-batch-%';
  SELECT pg_catalog.array_agg(e.id ORDER BY e.event_key) INTO v_exhausted_ids
    FROM public.evolution_events AS e
   WHERE e.connection_id = v_connection_id AND e.event_key LIKE 't09-exhausted-%';
  SELECT e.id INTO STRICT v_atomic_id FROM public.evolution_events AS e WHERE e.connection_id = v_connection_id AND e.event_key = 't09-atomic';
  SELECT e.id INTO STRICT v_monotonic_id FROM public.evolution_events AS e WHERE e.connection_id = v_connection_id AND e.event_key = 't09-monotonic';
  SELECT e.id INTO STRICT v_wrong_kind_id FROM public.evolution_events AS e WHERE e.connection_id = v_connection_id AND e.event_key = 't09-wrong-kind';
  SELECT e.id INTO STRICT v_infinite_time_id FROM public.evolution_events AS e WHERE e.connection_id = v_connection_id AND e.event_key = 't09-infinite-time';
  SELECT e.id INTO STRICT v_invalid_state_id FROM public.evolution_events AS e WHERE e.connection_id = v_connection_id AND e.event_key = 't09-invalid-state';

  PERFORM pg_catalog.set_config('wacrm.t09c1.user_id', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.connection_id', v_connection_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.batch_ids', v_batch_ids::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.exhausted_ids', v_exhausted_ids::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.reclaim_id', v_reclaim_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.old_token', v_old_token::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.retry_id', v_retry_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.atomic_id', v_atomic_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.monotonic_id', v_monotonic_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.wrong_kind_id', v_wrong_kind_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.infinite_time_id', v_infinite_time_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.invalid_state_id', v_invalid_state_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.kind_connection_id', v_kind_connection_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.exhausted_message_id', v_exhausted_message_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09c1.exhausted_message_token', v_exhausted_message_token::text, true);
END;
$fixture_setup$;

DO $rpc_security_assertions$
DECLARE
  v_proc regprocedure;
  v_count integer := 0;
BEGIN
  FOREACH v_proc IN ARRAY ARRAY[
    'public.claim_evolution_events(integer,integer)'::regprocedure,
    'public.fail_evolution_event(uuid,uuid,text,boolean)'::regprocedure,
    'public.complete_evolution_connection_event(uuid,uuid,text,timestamptz)'::regprocedure
  ] LOOP
    v_count := v_count + 1;
    IF pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
      RAISE EXCEPTION 'Worker RPC grants do not restrict execute to service_role';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
       WHERE p.oid = v_proc AND (
         p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
       )
    ) THEN
      RAISE EXCEPTION 'Worker RPC must be SECURITY INVOKER with fixed search_path';
    END IF;
  END LOOP;

  IF v_count <> 3
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.evolution_events'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p WHERE p.schemaname = 'public' AND p.tablename = 'evolution_events')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_events', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_events', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_events', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_events', 'UPDATE') THEN
    RAISE EXCEPTION 'evolution_events RLS/table grants do not match the service-only contract';
  END IF;
END;
$rpc_security_assertions$;

SET LOCAL ROLE service_role;

DO $worker_assertions$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_event public.evolution_events%ROWTYPE;
  v_expected integer;
  v_started timestamptz;
  v_seconds double precision;
  v_old_token uuid := current_setting('wacrm.t09c1.old_token')::uuid;
  v_token uuid;
  v_second_token uuid;
  v_connection_id uuid := current_setting('wacrm.t09c1.connection_id')::uuid;
  v_reclaim_id uuid := current_setting('wacrm.t09c1.reclaim_id')::uuid;
  v_retry_id uuid := current_setting('wacrm.t09c1.retry_id')::uuid;
  v_atomic_id uuid := current_setting('wacrm.t09c1.atomic_id')::uuid;
  v_monotonic_id uuid := current_setting('wacrm.t09c1.monotonic_id')::uuid;
  v_wrong_kind_id uuid := current_setting('wacrm.t09c1.wrong_kind_id')::uuid;
  v_kind_connection_id uuid := current_setting('wacrm.t09c1.kind_connection_id')::uuid;
  v_exhausted_message_id uuid := current_setting('wacrm.t09c1.exhausted_message_id')::uuid;
  v_exhausted_message_token uuid := current_setting('wacrm.t09c1.exhausted_message_token')::uuid;
  v_infinite_time_id uuid := current_setting('wacrm.t09c1.infinite_time_id')::uuid;
  v_invalid_state_id uuid := current_setting('wacrm.t09c1.invalid_state_id')::uuid;
  v_exhausted_ids uuid[] := current_setting('wacrm.t09c1.exhausted_ids')::uuid[];
  v_checked_at timestamptz;
  v_state text;
  v_state_checked_at timestamptz;
  v_outcome text;
  v_error_code text;
  v_message text;
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_events(0, 1);
    RAISE EXCEPTION 'zero claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_events(11, 60);
    RAISE EXCEPTION 'claim limit above ten was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_events(1, 0);
    RAISE EXCEPTION 'zero lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_events(1, 61);
    RAISE EXCEPTION 'lease duration above sixty was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT pg_catalog.array_agg(c.id), pg_catalog.count(*)::integer
    INTO v_ids, v_count FROM public.claim_evolution_events(10, 60) AS c;
  IF v_count <> 10 OR EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = ANY(v_ids) AND e.event_key NOT LIKE 't09-batch-%'
  ) THEN
    RAISE EXCEPTION 'claim did not return exactly ten due fixture rows';
  END IF;
  IF (SELECT pg_catalog.count(DISTINCT e.lease_token) FROM public.evolution_events AS e WHERE e.id = ANY(v_ids)) <> 10
     OR EXISTS (
       SELECT 1 FROM public.evolution_events AS e
        WHERE e.id = ANY(v_ids)
          AND (e.attempts <> 1 OR e.state <> 'processing' OR e.lease_until <= pg_catalog.clock_timestamp()
               OR e.lease_until > pg_catalog.clock_timestamp() + interval '61 seconds')
     ) THEN
    RAISE EXCEPTION 'claim attempts, fresh lease token, or lease duration is invalid';
  END IF;

  UPDATE public.evolution_events AS e
     SET next_attempt_at = 'infinity'::timestamptz
   WHERE e.id = ANY(current_setting('wacrm.t09c1.batch_ids')::uuid[])
     AND e.state = 'pending';
  IF (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
       WHERE e.id = ANY(v_exhausted_ids) AND e.state = 'failed' AND e.attempts = 5) <> 10
     OR EXISTS (
       SELECT 1 FROM public.evolution_events AS e
        WHERE e.id = ANY(v_exhausted_ids) AND e.id = ANY(v_ids)
     )
     OR (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
          WHERE e.id = ANY(v_exhausted_ids) AND e.state = 'processing' AND e.lease_until <= pg_catalog.clock_timestamp()) <> 1 THEN
    RAISE EXCEPTION 'expired fifth-lease cleanup mismatch (failed %, claimed %, remaining %)',
      (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
        WHERE e.id = ANY(v_exhausted_ids) AND e.state = 'failed' AND e.attempts = 5),
      (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
        WHERE e.id = ANY(v_exhausted_ids) AND e.id = ANY(v_ids)),
      (SELECT pg_catalog.count(*) FROM public.evolution_events AS e
        WHERE e.id = ANY(v_exhausted_ids) AND e.state = 'processing' AND e.lease_until <= pg_catalog.clock_timestamp());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_exhausted_message_id AND e.state = 'processing' AND e.attempts = 5
       AND e.lease_token = v_exhausted_message_token AND e.lease_until <= pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'connection worker exhausted cleanup changed a message event';
  END IF;

  -- The next call cleans the eleventh exhausted row and can then claim
  -- the separately expired reclaim fixture in the same bounded batch.
  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_reclaim_id OR v_event.attempts <> 2 OR v_event.lease_token = v_old_token
     OR EXISTS (
       SELECT 1 FROM public.evolution_events AS e
        WHERE e.id = ANY(v_exhausted_ids) AND e.state <> 'failed'
     ) THEN
    RAISE EXCEPTION 'expired lease was not reclaimed with incremented attempt and new token';
  END IF;
  v_token := v_event.lease_token;

  BEGIN
    PERFORM outcome FROM public.complete_evolution_connection_event(
      v_reclaim_id, v_old_token, 'connected', pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'old lease token unexpectedly completed reclaimed event';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_evolution_event(v_reclaim_id, v_old_token, 'stale_worker', true);
    RAISE EXCEPTION 'old lease token unexpectedly failed reclaimed event';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_evolution_event(pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), 'missing_event', false);
    RAISE EXCEPTION 'missing event did not return P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  UPDATE public.evolution_events AS e
     SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE e.id = v_reclaim_id;
  BEGIN
    PERFORM public.fail_evolution_event(v_reclaim_id, v_token, 'expired_worker', true);
    RAISE EXCEPTION 'expired current lease unexpectedly failed event';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  BEGIN
    PERFORM outcome FROM public.complete_evolution_connection_event(
      v_reclaim_id, v_token, 'connected', pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'expired current lease unexpectedly completed event';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;

  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_reclaim_id OR v_event.attempts <> 3 OR v_event.lease_token = v_token THEN
    RAISE EXCEPTION 'second reclaim did not fence the prior lease token';
  END IF;
  SELECT * INTO STRICT v_event FROM public.fail_evolution_event(
    v_reclaim_id, v_event.lease_token, 'worker_stopped', false
  );
  IF v_event.state <> 'failed' OR v_event.lease_token IS NOT NULL OR v_event.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'permanent failure was not terminalized and cleared';
  END IF;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_retry_id;
  FOR v_expected IN 1..5 LOOP
    SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
    IF v_event.id <> v_retry_id OR v_event.attempts <> v_expected THEN
      RAISE EXCEPTION 'retry event claim count was incorrect';
    END IF;
    v_started := pg_catalog.clock_timestamp();
    IF v_expected = 1 THEN
      SELECT * INTO STRICT v_event FROM public.fail_evolution_event(
        v_retry_id, v_event.lease_token, 'private payload with spaces', true
      );
    ELSE
      SELECT * INTO STRICT v_event FROM public.fail_evolution_event(
        v_retry_id, v_event.lease_token, 'transient_error', true
      );
    END IF;

    IF v_expected < 5 THEN
      v_seconds := EXTRACT(epoch FROM (v_event.next_attempt_at - v_started));
      IF v_event.state <> 'pending'
         OR pg_catalog.abs(v_seconds - CASE v_expected WHEN 1 THEN 5 WHEN 2 THEN 15 WHEN 3 THEN 60 ELSE 300 END) > 0.5 THEN
        RAISE EXCEPTION 'retry backoff did not match 5/15/60/300 seconds';
      END IF;
      UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_retry_id;
    ELSE
      IF v_event.state <> 'failed' THEN
        RAISE EXCEPTION 'fifth retryable failure did not become terminal';
      END IF;
    END IF;
    IF v_event.last_error_code !~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
      RAISE EXCEPTION 'stored worker error code was not sanitized';
    END IF;
    IF v_expected = 1 AND v_event.last_error_code <> 'worker_error' THEN
      RAISE EXCEPTION 'unsafe worker error code was not replaced with generic code';
    END IF;
  END LOOP;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_atomic_id;
  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_atomic_id THEN RAISE EXCEPTION 'atomicity fixture was not claimed'; END IF;
  v_token := v_event.lease_token;
  v_checked_at := pg_catalog.clock_timestamp();

  BEGIN
    SELECT c.outcome INTO STRICT v_outcome FROM public.complete_evolution_connection_event(
      v_atomic_id, v_token, 'connected', v_checked_at
    ) AS c;
    IF v_outcome <> 'applied' THEN RAISE EXCEPTION 'expected applied outcome inside rollback probe'; END IF;
    RAISE EXCEPTION 'T09.atomicity.rollback';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'T09.atomicity.rollback' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_atomic_id AND e.state = 'processing' AND e.lease_token = v_token
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_connections AS c
     WHERE c.id = v_connection_id AND (c.state <> 'disconnected' OR c.state_checked_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'rollback probe left only part of the state transition committed';
  END IF;

  SELECT c.outcome INTO STRICT v_outcome FROM public.complete_evolution_connection_event(
    v_atomic_id, v_token, 'connected', v_checked_at
  ) AS c;
  IF v_outcome <> 'applied' OR NOT EXISTS (
    SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_atomic_id AND e.state = 'done'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.whatsapp_connections AS c
     WHERE c.id = v_connection_id AND c.state = 'connected' AND c.state_checked_at = v_checked_at
  ) THEN
    RAISE EXCEPTION 'connection state and terminal event did not complete atomically';
  END IF;

  SELECT c.outcome INTO STRICT v_outcome FROM public.complete_evolution_connection_event(
    v_atomic_id, pg_catalog.gen_random_uuid(), 'unknown', 'infinity'::timestamptz
  ) AS c;
  IF v_outcome <> 'duplicate' OR NOT EXISTS (
    SELECT 1 FROM public.whatsapp_connections AS c
     WHERE c.id = v_connection_id AND c.state = 'connected' AND c.state_checked_at = v_checked_at
  ) THEN
    RAISE EXCEPTION 'terminal event replay was not a no-op duplicate';
  END IF;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_monotonic_id;
  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_monotonic_id THEN RAISE EXCEPTION 'monotonicity fixture was not claimed'; END IF;
  SELECT c.outcome INTO STRICT v_outcome FROM public.complete_evolution_connection_event(
    v_monotonic_id, v_event.lease_token, 'disconnected', v_checked_at - interval '1 second'
  ) AS c;
  SELECT c.state, c.state_checked_at INTO STRICT v_state, v_state_checked_at
    FROM public.whatsapp_connections AS c WHERE c.id = v_connection_id;
  IF v_outcome <> 'applied' OR v_state <> 'connected' OR v_state_checked_at <> v_checked_at THEN
    RAISE EXCEPTION 'older checked_at regressed the stored connection state';
  END IF;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_wrong_kind_id;
  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_kind_connection_id;
  SELECT pg_catalog.array_agg(c.id), pg_catalog.count(*)::integer
    INTO v_ids, v_count FROM public.claim_evolution_events(10, 30) AS c;
  IF v_count <> 1 OR v_ids[1] <> v_kind_connection_id OR NOT EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_wrong_kind_id AND e.state = 'pending' AND e.attempts = 0
       AND e.lease_until IS NULL AND e.lease_token IS NULL
  ) THEN
    RAISE EXCEPTION 'connection worker claimed a message event or missed the eligible connection event';
  END IF;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_infinite_time_id;
  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_infinite_time_id THEN RAISE EXCEPTION 'infinite-time fixture was not claimed'; END IF;
  BEGIN
    PERFORM outcome FROM public.complete_evolution_connection_event(
      v_infinite_time_id, v_event.lease_token, 'connected', 'infinity'::timestamptz
    );
    RAISE EXCEPTION 'infinite observation time was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  UPDATE public.evolution_events AS e SET next_attempt_at = '-infinity'::timestamptz WHERE e.id = v_invalid_state_id;
  SELECT * INTO STRICT v_event FROM public.claim_evolution_events(1, 30);
  IF v_event.id <> v_invalid_state_id THEN RAISE EXCEPTION 'invalid-state fixture was not claimed'; END IF;
  BEGIN
    PERFORM outcome FROM public.complete_evolution_connection_event(
      v_invalid_state_id, v_event.lease_token, 'open', pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'invalid connection state was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$worker_assertions$;

RESET ROLE;
ROLLBACK;
