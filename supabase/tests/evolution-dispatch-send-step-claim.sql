BEGIN;

-- Synthetic tenant fixture; every database change rolls back below.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_automation_id uuid;
  v_event_id uuid;
  v_dispatch_id uuid;
  v_root_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', v_user_id::text || '@fixture.invalid', '',
    pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T12 send-step claim synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080', 't12-send-step-' || v_user_id::text,
    'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret'
  ) RETURNING id INTO v_connection_id;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_id, v_account_id, '+15550000031', 'Synthetic send-step contact')
  RETURNING id INTO v_contact_id;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_id, v_account_id, v_contact_id, 'open')
  RETURNING id INTO v_conversation_id;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_id, v_account_id, 'T12 send-step claim synthetic', 'inbound_message', true)
  RETURNING id INTO v_automation_id;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_id, 't12:send-step-claim:' || v_user_id::text,
          '{"kind":"message"}'::jsonb, 'done', pg_catalog.clock_timestamp())
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user_id,
    v_contact_id, v_conversation_id, 'processing', 1,
    pg_catalog.clock_timestamp() + interval '2 minutes', v_root_token
  ) RETURNING id INTO v_dispatch_id;

  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.user', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.account', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.connection', v_connection_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.conversation', v_conversation_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.dispatch', v_dispatch_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12sendclaim.root_token', v_root_token::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_claim regprocedure := 'public.claim_evolution_dispatch_send_step(uuid,uuid,text,integer)'::regprocedure;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_claim) <>
       'p_dispatch_id uuid, p_dispatch_lease_token uuid, p_action_key text, p_lease_seconds integer DEFAULT 60'
     OR pg_catalog.pg_get_function_result(v_claim) <>
       'TABLE(step_id uuid, state text, lease_token uuid, request_id text, send_attempt_id uuid, should_execute boolean, lease_acquired boolean)'
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = v_claim
        AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
     )
     OR pg_catalog.has_function_privilege('anon', v_claim, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_claim, 'EXECUTE') THEN
    RAISE EXCEPTION 'send-step claim signature or privilege mismatch';
  END IF;

  IF pg_catalog.pg_get_function_arguments(
       'public.claim_evolution_dispatch_step(uuid,uuid,text,integer)'::regprocedure
     ) <> 'p_dispatch_id uuid, p_dispatch_lease_token uuid, p_action_key text, p_lease_seconds integer DEFAULT 60'
     OR pg_catalog.pg_get_function_result(
       'public.claim_evolution_dispatch_step(uuid,uuid,text,integer)'::regprocedure
     ) <> 'TABLE(step_id uuid, state text, lease_token uuid, request_id text, send_attempt_id uuid, should_execute boolean)' THEN
    RAISE EXCEPTION 'existing step claim signature changed';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_send_step(
      current_setting('wacrm.t12sendclaim.dispatch')::uuid,
      current_setting('wacrm.t12sendclaim.root_token')::uuid,
      'fixture:anon', 10
    );
    RAISE EXCEPTION 'anon executed claim_evolution_dispatch_send_step';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $claim_assertions$
DECLARE
  v_dispatch_id uuid := current_setting('wacrm.t12sendclaim.dispatch')::uuid;
  v_root_token uuid := current_setting('wacrm.t12sendclaim.root_token')::uuid;
  v_user_id uuid := current_setting('wacrm.t12sendclaim.user')::uuid;
  v_connection_id uuid := current_setting('wacrm.t12sendclaim.connection')::uuid;
  v_conversation_id uuid := current_setting('wacrm.t12sendclaim.conversation')::uuid;
  v_claim record;
  v_active record;
  v_recovered record;
  v_reservation record;
  v_capped record;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_attempt_id uuid;
  v_cap_step_id uuid := pg_catalog.gen_random_uuid();
  v_old_token uuid;
  v_new_token uuid;
  v_previous_token uuid;
  v_attempts integer;
  v_request_id text;
  v_recovery_index integer;
  v_hash text := pg_catalog.repeat('a', 64);
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:bad-limit', 0);
    RAISE EXCEPTION 'zero step lease duration was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:bad-limit', 61);
    RAISE EXCEPTION 'step lease duration above 60 was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- A newly inserted step is both newly leased and eligible for one transport.
  SELECT * INTO STRICT v_claim
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:pending-send', 60);
  IF v_claim.state <> 'processing' OR NOT v_claim.should_execute OR NOT v_claim.lease_acquired
     OR v_claim.request_id <> 'evolution-step:' || v_claim.step_id::text
     OR v_claim.lease_token IS NULL OR v_claim.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'new send step claim did not return fresh lease and stable request key';
  END IF;
  v_old_token := v_claim.lease_token;
  v_request_id := v_claim.request_id;
  SELECT s.attempts INTO STRICT v_attempts
    FROM public.evolution_dispatch_steps AS s WHERE s.id = v_claim.step_id;

  -- Use the real reservation RPC with synthetic content; transport is never called by SQL.
  SELECT * INTO STRICT v_reservation
    FROM public.reserve_evolution_send(
      v_connection_id, v_request_id, v_hash, v_conversation_id, 'bot', v_user_id,
      '{"content_type":"text","content_text":"synthetic recovery fixture"}'::jsonb
    );
  IF NOT v_reservation.should_send OR v_reservation.outcome <> 'pending'
     OR v_reservation.attempt_id IS NULL OR v_reservation.message_row_id IS NULL THEN
    RAISE EXCEPTION 'synthetic send reservation did not create one pending attempt';
  END IF;
  v_attempt_id := v_reservation.attempt_id;
  v_step := public.complete_evolution_dispatch_step(
    v_claim.step_id, v_root_token, v_old_token, 'processing', v_request_id,
    v_attempt_id, NULL, NULL
  );
  IF v_step.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'synthetic reservation was not linked to its dispatch step';
  END IF;

  -- A currently live lease belongs to its holder: no lease acquired, no transport permission.
  SELECT * INTO STRICT v_active
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:pending-send', 60);
  IF v_active.state <> 'processing' OR v_active.lease_acquired OR v_active.should_execute
     OR v_active.lease_token IS DISTINCT FROM v_old_token
     OR v_active.send_attempt_id IS DISTINCT FROM v_attempt_id
     OR v_active.request_id IS DISTINCT FROM v_request_id THEN
    RAISE EXCEPTION 'active send-step lease was reported as newly acquired or executable';
  END IF;

  -- Recovery-only leases do not consume the five transport attempts.
  UPDATE public.evolution_dispatch_steps
     SET attempts = 5, lease_until = '-infinity'::timestamptz
   WHERE id = v_claim.step_id;
  v_attempts := 5;
  v_previous_token := v_old_token;
  FOR v_recovery_index IN 1..6 LOOP
    UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
     WHERE id = v_claim.step_id;
    SELECT * INTO STRICT v_recovered
      FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:pending-send', 60);
    IF v_recovered.state <> 'processing' OR NOT v_recovered.lease_acquired OR v_recovered.should_execute
       OR v_recovered.lease_token IS NULL OR v_recovered.lease_token = v_previous_token
       OR v_recovered.send_attempt_id IS DISTINCT FROM v_attempt_id
       OR v_recovered.request_id IS DISTINCT FROM v_request_id
       OR (SELECT s.attempts FROM public.evolution_dispatch_steps AS s WHERE s.id = v_claim.step_id) <> v_attempts THEN
      RAISE EXCEPTION 'recovery lease % was terminalized, counted, or authorized for POST', v_recovery_index;
    END IF;
    v_previous_token := v_recovered.lease_token;
  END LOOP;
  v_new_token := v_previous_token;

  BEGIN
    PERFORM public.complete_evolution_dispatch_step(
      v_claim.step_id, v_root_token, v_old_token, 'done', v_request_id,
      v_attempt_id, NULL, NULL
    );
    RAISE EXCEPTION 'stale pre-recovery token completed the step';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT * INTO STRICT v_active
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:pending-send', 60);
  IF v_active.lease_acquired OR v_active.should_execute
     OR v_active.lease_token IS DISTINCT FROM v_new_token
     OR v_active.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'recovery lease was claimable by a second worker';
  END IF;

  -- Replaying the stable reservation is read-only with respect to transport authorization.
  SELECT * INTO STRICT v_reservation
    FROM public.reserve_evolution_send(
      v_connection_id, v_request_id, v_hash, v_conversation_id, 'bot', v_user_id,
      '{"content_type":"text","content_text":"synthetic recovery fixture"}'::jsonb
    );
  IF v_reservation.attempt_id IS DISTINCT FROM v_attempt_id
     OR v_reservation.outcome <> 'pending' OR v_reservation.should_send THEN
    RAISE EXCEPTION 'pending reservation replay authorized another POST';
  END IF;

  -- Existing reservation policy changes pending to unknown after 120 seconds, still without POST.
  UPDATE public.evolution_send_attempts
     SET created_at = pg_catalog.clock_timestamp() - interval '121 seconds'
   WHERE id = v_attempt_id;
  SELECT * INTO STRICT v_reservation
    FROM public.reserve_evolution_send(
      v_connection_id, v_request_id, v_hash, v_conversation_id, 'bot', v_user_id,
      '{"content_type":"text","content_text":"synthetic recovery fixture"}'::jsonb
    );
  IF v_reservation.attempt_id IS DISTINCT FROM v_attempt_id
     OR v_reservation.outcome <> 'unknown' OR v_reservation.should_send THEN
    RAISE EXCEPTION 'expired pending reservation did not become non-sendable unknown';
  END IF;

  v_step := public.complete_evolution_dispatch_step(
    v_claim.step_id, v_root_token, v_new_token, 'unknown', v_request_id,
    v_attempt_id, NULL, 'delivery_unknown'
  );
  IF v_step.state <> 'unknown' OR v_step.send_attempt_id IS DISTINCT FROM v_attempt_id
     OR v_step.lease_token IS NOT NULL OR v_step.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'unknown attempt was not terminally linked under the recovered lease';
  END IF;

  SELECT * INTO STRICT v_active
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:pending-send', 60);
  IF v_active.state <> 'unknown' OR v_active.lease_acquired OR v_active.should_execute
     OR v_active.send_attempt_id IS DISTINCT FROM v_attempt_id THEN
    RAISE EXCEPTION 'terminal unknown replay authorized another transport';
  END IF;

  -- A first claim with no reservation still consumes the fifth transport attempt; expiry exhausts it.
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, attempts, next_attempt_at, request_id
  ) VALUES (
    v_cap_step_id, v_dispatch_id, 'fixture:transport-cap', 4, '-infinity'::timestamptz,
    'evolution-step:' || v_cap_step_id::text
  );
  SELECT * INTO STRICT v_capped
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:transport-cap', 60);
  IF v_capped.state <> 'processing' OR NOT v_capped.lease_acquired OR NOT v_capped.should_execute
     OR (SELECT s.attempts FROM public.evolution_dispatch_steps AS s WHERE s.id = v_cap_step_id) <> 5 THEN
    RAISE EXCEPTION 'fifth transport-cap claim was not permitted exactly once';
  END IF;
  UPDATE public.evolution_dispatch_steps SET lease_until = '-infinity'::timestamptz
   WHERE id = v_cap_step_id;
  SELECT * INTO STRICT v_capped
    FROM public.claim_evolution_dispatch_send_step(v_dispatch_id, v_root_token, 'fixture:transport-cap', 60);
  IF v_capped.state <> 'failed' OR v_capped.lease_acquired OR v_capped.should_execute
     OR (SELECT s.attempts FROM public.evolution_dispatch_steps AS s WHERE s.id = v_cap_step_id) <> 5 THEN
    RAISE EXCEPTION 'transport-authorizing attempt cap was not enforced';
  END IF;
END;
$claim_assertions$;

RESET ROLE;
ROLLBACK;
