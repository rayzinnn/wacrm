BEGIN;

-- Synthetic tenant fixtures and all RPC mutations roll back at the end.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_automation_a uuid;
  v_automation_b uuid;
  v_event_id uuid;
  v_dispatch_id uuid;
  v_bad_dispatch_id uuid;
  v_root_token uuid := pg_catalog.gen_random_uuid();
  v_bad_root_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 step RPC synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 step RPC synthetic B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
                                            token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-step-rpc-a-' || v_user_a::text,
          'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
                                            token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_b, v_user_b, 'http://127.0.0.1:8080', 't12-step-rpc-b-' || v_user_b::text,
          'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret')
  RETURNING id INTO v_connection_b;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000001', 'Synthetic A') RETURNING id INTO v_contact_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_b, v_account_b, '+15550000002', 'Synthetic B') RETURNING id INTO v_contact_b;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open') RETURNING id INTO v_conversation_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_b, v_account_b, v_contact_b, 'open') RETURNING id INTO v_conversation_b;

  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 step RPC synthetic A', 'inbound_message', true)
  RETURNING id INTO v_automation_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_b, v_account_b, 'T12 step RPC synthetic B', 'inbound_message', true)
  RETURNING id INTO v_automation_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:step-rpc:main', '{"kind":"message"}'::jsonb,
          'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_event_id, v_account_a, 'automation', v_automation_a, v_user_a, v_contact_a,
    v_conversation_a, 'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_root_token
  ) RETURNING id INTO v_dispatch_id;

  -- Valid FKs but wrong tenant lineage: connection/event belong to A; root/definition belong to B.
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_event_id, v_account_b, 'automation', v_automation_b, v_user_b,
    'processing', 1, pg_catalog.clock_timestamp() + interval '2 minutes', v_bad_root_token
  ) RETURNING id INTO v_bad_dispatch_id;

  PERFORM pg_catalog.set_config('wacrm.t12step.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.user_b', v_user_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.connection_a', v_connection_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.connection_b', v_connection_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.conversation_a', v_conversation_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.conversation_b', v_conversation_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.automation_a', v_automation_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.dispatch', v_dispatch_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.bad_dispatch', v_bad_dispatch_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.root_token', v_root_token::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12step.bad_root_token', v_bad_root_token::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_claim regprocedure := 'public.claim_evolution_dispatch_step(uuid,uuid,text,integer)'::regprocedure;
  v_complete regprocedure := 'public.complete_evolution_dispatch_step(uuid,uuid,uuid,text,text,uuid,jsonb,text)'::regprocedure;
  v_table regclass := 'public.evolution_dispatch_steps'::regclass;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_claim) <>
       'p_dispatch_id uuid, p_dispatch_lease_token uuid, p_action_key text, p_lease_seconds integer DEFAULT 60'
     OR pg_catalog.pg_get_function_result(v_claim) <>
       'TABLE(step_id uuid, state text, lease_token uuid, request_id text, send_attempt_id uuid, should_execute boolean)'
     OR pg_catalog.pg_get_function_arguments(v_complete) <>
       'p_step_id uuid, p_dispatch_lease_token uuid, p_lease_token uuid, p_state text, p_request_id text DEFAULT NULL::text, p_send_attempt_id uuid DEFAULT NULL::uuid, p_result jsonb DEFAULT NULL::jsonb, p_error_code text DEFAULT NULL::text'
     OR pg_catalog.pg_get_function_result(v_complete) <> 'evolution_dispatch_steps'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid IN (v_claim, v_complete)
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon', v_claim, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_complete, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_complete, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_claim, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_complete, 'EXECUTE')
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'public' AND p.tablename = 'evolution_dispatch_steps')
     OR pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE') THEN
    RAISE EXCEPTION 'step RPC signature, security, or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(
      current_setting('wacrm.t12step.dispatch')::uuid,
      current_setting('wacrm.t12step.root_token')::uuid,
      'fixture:anon', 10
    );
    RAISE EXCEPTION 'anon executed claim_evolution_dispatch_step';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $rpc_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.t12step.dispatch')::uuid;
  v_root_token uuid := current_setting('wacrm.t12step.root_token')::uuid;
  v_claim record;
  v_retry record;
  v_send record;
  v_cap record;
  v_fence record;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_attempt_id uuid;
  v_foreign_attempt_id uuid;
  v_cap_step_id uuid := pg_catalog.gen_random_uuid();
  v_wrong_token uuid := pg_catalog.gen_random_uuid();
  v_account_b uuid := current_setting('wacrm.t12step.account_b')::uuid;
  v_connection_b uuid := current_setting('wacrm.t12step.connection_b')::uuid;
  v_conversation_b uuid := current_setting('wacrm.t12step.conversation_b')::uuid;
  v_automation_a uuid := current_setting('wacrm.t12step.automation_a')::uuid;
  v_bad_dispatch uuid := current_setting('wacrm.t12step.bad_dispatch')::uuid;
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:bad-limit', 0);
    RAISE EXCEPTION 'zero step lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:bad-limit', 61);
    RAISE EXCEPTION 'step lease duration above 60 was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(v_dispatch, v_wrong_token, 'fixture:stale-root', 10);
    RAISE EXCEPTION 'stale root token was accepted by claim';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(v_bad_dispatch,
      current_setting('wacrm.t12step.bad_root_token')::uuid, 'fixture:wrong-tenant', 10);
    RAISE EXCEPTION 'cross-tenant event/root lineage was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  SELECT * INTO STRICT v_claim
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:normal', 10);
  IF v_claim.state <> 'processing' OR NOT v_claim.should_execute
     OR v_claim.request_id <> 'evolution-step:' || v_claim.step_id::text
     OR v_claim.lease_token IS NULL THEN
    RAISE EXCEPTION 'new step did not receive a fenced claim and stable request ID';
  END IF;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:normal', 10);
  IF v_retry.step_id <> v_claim.step_id OR v_retry.should_execute
     OR v_retry.lease_token IS DISTINCT FROM v_claim.lease_token THEN
    RAISE EXCEPTION 'live step lease was claimed or authorized twice';
  END IF;

  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_claim.step_id, v_root_token,
      v_wrong_token, 'done', NULL, NULL, '{"ok":true}'::jsonb, NULL);
    RAISE EXCEPTION 'stale step token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_claim.step_id;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:normal', 10);
  IF v_retry.step_id <> v_claim.step_id OR NOT v_retry.should_execute
     OR v_retry.lease_token IS NULL OR v_retry.lease_token = v_claim.lease_token
     OR (SELECT attempts FROM public.evolution_dispatch_steps WHERE id = v_claim.step_id) <> 2 THEN
    RAISE EXCEPTION 'expired step lease was not reclaimed with a new token/attempt';
  END IF;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_claim.step_id;
  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_claim.step_id, v_root_token,
      v_retry.lease_token, 'done', v_retry.request_id, NULL, NULL, NULL);
    RAISE EXCEPTION 'expired step lease was accepted by complete';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:normal', 10);
  IF NOT v_retry.should_execute OR v_retry.lease_token IS NULL
     OR v_retry.lease_token = v_claim.lease_token
     OR (SELECT attempts FROM public.evolution_dispatch_steps WHERE id = v_claim.step_id) <> 3 THEN
    RAISE EXCEPTION 'second expired lease reclaim did not fence a new attempt';
  END IF;
  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_claim.step_id, v_root_token,
      v_retry.lease_token, 'done', 'not-the-stable-request', NULL, NULL, NULL);
    RAISE EXCEPTION 'arbitrary request ID was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  v_step := public.complete_evolution_dispatch_step(v_claim.step_id, v_root_token,
    v_retry.lease_token, 'done', v_retry.request_id, NULL,
    '{"checkpoint":"synthetic"}'::jsonb, NULL);
  IF v_step.state <> 'done' OR v_step.result <> '{"checkpoint":"synthetic"}'::jsonb
     OR v_step.lease_token IS NOT NULL OR v_step.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'successful step completion did not persist result and clear lease';
  END IF;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:normal', 10);
  IF v_retry.state <> 'done' OR v_retry.should_execute THEN
    RAISE EXCEPTION 'terminal step replay authorized execution';
  END IF;

  -- Retry/backoff and sanitized error behavior.
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:retry', 10);
  v_step := public.complete_evolution_dispatch_step(v_retry.step_id, v_root_token,
    v_retry.lease_token, 'pending', v_retry.request_id, NULL, NULL,
    'unsafe error text - not a credential');
  IF v_step.state <> 'pending' OR v_step.last_error_code <> 'worker_error'
     OR v_step.lease_token IS NOT NULL
     OR v_step.next_attempt_at < pg_catalog.clock_timestamp() + interval '4 seconds'
     OR v_step.next_attempt_at > pg_catalog.clock_timestamp() + interval '6 seconds' THEN
    RAISE EXCEPTION 'transient step completion did not back off or sanitize error: state=%, error=%, token=%, next=%, now=%',
      v_step.state, v_step.last_error_code, v_step.lease_token, v_step.next_attempt_at, pg_catalog.clock_timestamp();
  END IF;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:retry', 10);
  IF v_retry.state <> 'pending' OR v_retry.should_execute THEN
    RAISE EXCEPTION 'step before next_attempt_at was claimable';
  END IF;

  -- Attempt five can be claimed, but its expired lease becomes terminal failed.
  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, attempts, next_attempt_at, request_id)
  VALUES (v_cap_step_id, v_dispatch, 'fixture:cap', 4, '-infinity'::timestamptz,
          'evolution-step:' || v_cap_step_id::text);
  SELECT * INTO STRICT v_cap
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:cap', 10);
  IF NOT v_cap.should_execute OR
     (SELECT attempts FROM public.evolution_dispatch_steps WHERE id = v_cap.step_id) <> 5 THEN
    RAISE EXCEPTION 'fifth step attempt was not permitted exactly once';
  END IF;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_cap.step_id;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:cap', 10);
  IF v_retry.state <> 'failed' OR v_retry.should_execute
     OR (SELECT attempts FROM public.evolution_dispatch_steps WHERE id = v_cap.step_id) <> 5
     OR (SELECT last_error_code FROM public.evolution_dispatch_steps WHERE id = v_cap.step_id) <> 'attempts_exhausted' THEN
    RAISE EXCEPTION 'attempt-five expiry was not marked failed';
  END IF;

  -- Wrong tenant send attempt cannot attach to a step even with the matching request ID.
  SELECT * INTO STRICT v_send
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:send-pending', 10);
  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, request_id, request_hash, conversation_id, outcome
  ) VALUES (
    v_account_b, v_connection_b, v_send.request_id, repeat('a', 64), v_conversation_b, 'pending'
  ) RETURNING id INTO v_foreign_attempt_id;
  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_send.step_id, v_root_token,
      v_send.lease_token, 'processing', v_send.request_id, v_foreign_attempt_id, NULL, NULL);
    RAISE EXCEPTION 'cross-tenant send attempt was attached';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, request_id, request_hash, conversation_id, outcome
  ) VALUES (
    current_setting('wacrm.t12step.account_a')::uuid,
    current_setting('wacrm.t12step.connection_a')::uuid,
    v_send.request_id, repeat('b', 64), current_setting('wacrm.t12step.conversation_a')::uuid,
    'pending'
  ) RETURNING id INTO v_attempt_id;
  v_step := public.complete_evolution_dispatch_step(v_send.step_id, v_root_token,
    v_send.lease_token, 'processing', v_send.request_id, v_attempt_id, NULL, NULL);
  IF v_step.send_attempt_id IS DISTINCT FROM v_attempt_id OR v_step.request_id <> v_send.request_id THEN
    RAISE EXCEPTION 'send attempt reservation was not fenced to the step';
  END IF;

  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_send.step_id;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:send-pending', 10);
  IF v_retry.should_execute OR v_retry.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'pending send attempt claim mismatch: execute=%, returned_attempt=%, expected_attempt=%, state=%',
      v_retry.should_execute, v_retry.send_attempt_id, v_attempt_id, v_retry.state;
  END IF;
  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_send.step_id, v_root_token,
      v_retry.lease_token, 'pending', v_send.request_id, v_attempt_id, NULL, 'temporary');
    RAISE EXCEPTION 'step with a send attempt entered retry-pending state';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  UPDATE public.evolution_send_attempts SET outcome = 'unknown' WHERE id = v_attempt_id;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_send.step_id;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:send-pending', 10);
  IF v_retry.should_execute OR v_retry.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'unknown send attempt authorized a second POST';
  END IF;
  v_step := public.complete_evolution_dispatch_step(v_send.step_id, v_root_token,
    v_retry.lease_token, 'unknown', v_send.request_id, v_attempt_id, NULL,
    'possible_remote_acceptance');
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:send-pending', 10);
  IF v_retry.state <> 'unknown' OR v_retry.should_execute THEN
    RAISE EXCEPTION 'unknown step replay authorized execution';
  END IF;

  -- An attempt inserted after claim but before link is found by account/request key.
  SELECT * INTO STRICT v_send
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:orphan-reservation', 10);
  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, request_id, request_hash, conversation_id, outcome
  ) VALUES (
    current_setting('wacrm.t12step.account_a')::uuid,
    current_setting('wacrm.t12step.connection_a')::uuid,
    v_send.request_id, repeat('c', 64), current_setting('wacrm.t12step.conversation_a')::uuid,
    'pending'
  ) RETURNING id INTO v_attempt_id;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_send.step_id;
  SELECT * INTO STRICT v_retry
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:orphan-reservation', 10);
  IF v_retry.should_execute OR v_retry.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'unlinked reservation was not discovered before a possible re-send';
  END IF;

  -- Both RPCs reject an expired root lease, even if the step token is current.
  SELECT * INTO STRICT v_fence
    FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:root-fence', 10);
  UPDATE public.evolution_event_dispatches SET lease_until = '-infinity'::timestamptz WHERE id = v_dispatch;
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_step(v_dispatch, v_root_token, 'fixture:root-fence', 10);
    RAISE EXCEPTION 'expired root lease was accepted by claim';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.complete_evolution_dispatch_step(v_fence.step_id, v_root_token,
      v_fence.lease_token, 'done', v_fence.request_id, NULL, NULL, NULL);
    RAISE EXCEPTION 'expired root lease was accepted by complete';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$rpc_assertions$;

RESET ROLE;
ROLLBACK;
