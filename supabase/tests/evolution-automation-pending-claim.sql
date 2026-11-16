BEGIN;

-- Synthetic Evolution waits and a legacy pending row; all changes roll back.
DO $pending_fixture$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection uuid;
  v_contact uuid;
  v_conversation uuid;
  v_automation uuid;
  v_event uuid;
  v_reply_event uuid;
  v_dispatch uuid;
  v_reply_dispatch uuid;
  v_log uuid;
  v_reply_log uuid;
  v_action uuid := pg_catalog.gen_random_uuid();
  v_reply_action uuid := pg_catalog.gen_random_uuid();
  v_ledger_step uuid := pg_catalog.gen_random_uuid();
  v_reply_ledger_step uuid := pg_catalog.gen_random_uuid();
  v_pending uuid := pg_catalog.gen_random_uuid();
  v_reply_pending uuid := pg_catalog.gen_random_uuid();
  v_legacy_pending uuid := pg_catalog.gen_random_uuid();
  v_root_token uuid := pg_catalog.gen_random_uuid();
  v_reply_root_token uuid := pg_catalog.gen_random_uuid();
  v_legacy_root_token uuid := pg_catalog.gen_random_uuid();
  v_bad_event uuid;
  v_bad_dispatch uuid;
  v_bad_log uuid;
  v_bad_action uuid := pg_catalog.gen_random_uuid();
  v_bad_ledger_step uuid := pg_catalog.gen_random_uuid();
  v_bad_pending uuid := pg_catalog.gen_random_uuid();
  v_bad_root_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@t12-pending-a.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 pending A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@t12-pending-b.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 pending B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-pending-' || v_user_a::text,
    'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000081', 'Pending synthetic') RETURNING id INTO v_contact;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact, 'open') RETURNING id INTO v_conversation;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 pending synthetic', 'inbound_message', true)
  RETURNING id INTO v_automation;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection, 't12:pending:' || v_user_a::text,
          '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false}'::jsonb,
          'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_event, v_account_a, 'automation', v_automation, v_user_a, v_contact, v_conversation,
    'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_root_token
  ) RETURNING id INTO v_dispatch;
  INSERT INTO public.automation_logs (
    automation_id, account_id, user_id, contact_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (v_automation, v_account_a, v_user_a, v_contact, 'inbound_message', '[]'::jsonb,
            'partial', v_dispatch) RETURNING id INTO v_log;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log WHERE id = v_dispatch;

  INSERT INTO public.automation_steps (id, automation_id, step_type, step_config, position)
  VALUES (v_action, v_automation, 'wait', '{"amount":1,"unit":"minutes"}'::jsonb, 4);
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, request_id, result
  ) VALUES (
    v_ledger_step, v_dispatch, v_action::text, 'done', 1,
    'evolution-step:' || v_ledger_step::text,
    pg_catalog.jsonb_build_object('pending_execution_id', v_pending, 'run_at', pg_catalog.now())
  );
  INSERT INTO public.automation_pending_executions (
    id, automation_id, account_id, user_id, contact_id, log_id, parent_step_id, branch,
    next_step_position, context, status, run_at, parked_step_id, evolution_dispatch_step_id
  ) VALUES (
    v_pending, v_automation, v_account_a, v_user_a, v_contact, v_log, NULL, NULL,
    5, pg_catalog.jsonb_build_object('message_text', 'synthetic', 'conversation_id', v_conversation),
    'pending', pg_catalog.clock_timestamp() + interval '2 minutes', v_action, v_ledger_step
  );

  -- Legacy pending rows have no Evolution ledger link and must remain untouched.
  INSERT INTO public.automation_pending_executions (
    id, automation_id, account_id, user_id, contact_id, log_id, parent_step_id, branch,
    next_step_position, context, status, run_at
  ) VALUES (
    v_legacy_pending, v_automation, v_account_a, v_user_a, v_contact, v_log, NULL, NULL,
    8, '{"legacy":"synthetic"}'::jsonb, 'pending', pg_catalog.clock_timestamp() - interval '1 second'
  );

  -- An awaiting_reply row is parked for a future reply-specific claimant, not
  -- the due-time wait claimant or either ordinary root claimant.
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection, 't12:pending-reply:' || v_user_a::text,
          '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false}'::jsonb,
          'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_reply_event;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_reply_event, v_account_a, 'automation', v_automation, v_user_a, v_contact, v_conversation,
    'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_reply_root_token
  ) RETURNING id INTO v_reply_dispatch;
  INSERT INTO public.automation_logs (
    automation_id, account_id, user_id, contact_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (v_automation, v_account_a, v_user_a, v_contact, 'inbound_message', '[]'::jsonb,
            'partial', v_reply_dispatch) RETURNING id INTO v_reply_log;
  UPDATE public.evolution_event_dispatches
     SET automation_log_id = v_reply_log WHERE id = v_reply_dispatch;
  INSERT INTO public.automation_steps (id, automation_id, step_type, step_config, position)
  VALUES (v_reply_action, v_automation, 'wait', '{"amount":1,"unit":"minutes"}'::jsonb, 6);
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, request_id, result
  ) VALUES (
    v_reply_ledger_step, v_reply_dispatch, v_reply_action::text, 'done', 1,
    'evolution-step:' || v_reply_ledger_step::text,
    pg_catalog.jsonb_build_object('pending_execution_id', v_reply_pending, 'run_at', pg_catalog.now())
  );
  INSERT INTO public.automation_pending_executions (
    id, automation_id, account_id, user_id, contact_id, log_id, parent_step_id, branch,
    next_step_position, context, status, run_at, parked_step_id, evolution_dispatch_step_id
  ) VALUES (
    v_reply_pending, v_automation, v_account_a, v_user_a, v_contact, v_reply_log, NULL, NULL,
    7, pg_catalog.jsonb_build_object('message_text', 'synthetic', 'conversation_id', v_conversation),
    'awaiting_reply', pg_catalog.clock_timestamp() + interval '24 hours',
    v_reply_action, v_reply_ledger_step
  );

  PERFORM pg_catalog.set_config('wacrm.t12pending.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.dispatch', v_dispatch::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.pending', v_pending::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.legacy_pending', v_legacy_pending::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.reply_dispatch', v_reply_dispatch::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.reply_pending', v_reply_pending::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.root_token', v_root_token::text, true);

  -- A second Evolution root has a valid step/log but a queue row whose tenant
  -- is forged to account B. The claim must reject it without taking a lease.
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection, 't12:pending-bad:' || v_user_a::text,
          '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false}'::jsonb,
          'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_bad_event;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id,
    state, attempts, lease_until, lease_token
  ) VALUES (
    v_bad_event, v_account_a, 'automation', v_automation, v_user_a, v_contact, v_conversation,
    'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_bad_root_token
  ) RETURNING id INTO v_bad_dispatch;
  INSERT INTO public.automation_logs (
    automation_id, account_id, user_id, contact_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (v_automation, v_account_a, v_user_a, v_contact, 'inbound_message', '[]'::jsonb,
            'partial', v_bad_dispatch) RETURNING id INTO v_bad_log;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_bad_log WHERE id = v_bad_dispatch;
  INSERT INTO public.automation_steps (id, automation_id, step_type, step_config, position)
  VALUES (v_bad_action, v_automation, 'wait', '{"amount":1,"unit":"minutes"}'::jsonb, 9);
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, request_id, result
  ) VALUES (
    v_bad_ledger_step, v_bad_dispatch, v_bad_action::text, 'done', 1,
    'evolution-step:' || v_bad_ledger_step::text,
    pg_catalog.jsonb_build_object('pending_execution_id', v_bad_pending, 'run_at', pg_catalog.now())
  );
  INSERT INTO public.automation_pending_executions (
    id, automation_id, account_id, user_id, contact_id, log_id, parent_step_id, branch,
    next_step_position, context, status, run_at, parked_step_id, evolution_dispatch_step_id
  ) VALUES (
    v_bad_pending, v_automation, v_account_b, v_user_a, v_contact, v_bad_log, NULL, NULL,
    10, pg_catalog.jsonb_build_object('message_text', 'synthetic', 'conversation_id', v_conversation),
    'pending', pg_catalog.clock_timestamp() + interval '2 minutes', v_bad_action, v_bad_ledger_step
  );
  PERFORM pg_catalog.set_config('wacrm.t12pending.bad_dispatch', v_bad_dispatch::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12pending.bad_pending', v_bad_pending::text, true);
END;
$pending_fixture$;

DO $security_assertions$
DECLARE
  v_claim regprocedure := 'public.claim_evolution_automation_pending_executions(integer,integer)'::regprocedure;
  v_complete regprocedure := 'public.complete_evolution_automation_pending_execution(uuid,uuid,uuid)'::regprocedure;
BEGIN
  IF pg_catalog.pg_get_function_result(v_claim) NOT LIKE 'TABLE(pending_execution_id uuid, dispatch_id uuid%'
     OR pg_catalog.pg_get_function_result(v_complete) <> 'TABLE(pending_execution_id uuid, status text, replayed boolean)'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid IN (v_claim, v_complete)
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon', v_claim, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_complete, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_complete, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_claim, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_complete, 'EXECUTE') THEN
    RAISE EXCEPTION 'pending claim/complete signature, security, or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;
DO $claim_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.t12pending.dispatch')::uuid;
  v_pending uuid := current_setting('wacrm.t12pending.pending')::uuid;
  v_legacy_pending uuid := current_setting('wacrm.t12pending.legacy_pending')::uuid;
  v_reply_dispatch uuid := current_setting('wacrm.t12pending.reply_dispatch')::uuid;
  v_reply_pending uuid := current_setting('wacrm.t12pending.reply_pending')::uuid;
  v_bad_dispatch uuid := current_setting('wacrm.t12pending.bad_dispatch')::uuid;
  v_bad_pending uuid := current_setting('wacrm.t12pending.bad_pending')::uuid;
  v_claim record;
  v_reclaimed record;
  v_ack record;
  v_count integer;
  v_old_pending_token uuid;
  v_old_dispatch_token uuid;
  v_bad_root_token_before uuid;
  v_bad_root_lease_before timestamptz;
  v_bad_root_token_after uuid;
  v_bad_root_lease_after timestamptz;
BEGIN
  BEGIN
    PERFORM * FROM public.claim_evolution_automation_pending_executions(0, 30);
    RAISE EXCEPTION 'invalid zero pending claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Both root claim APIs must leave roots parked by Evolution pending rows.
  SELECT pg_catalog.count(*) INTO v_count
    FROM public.claim_evolution_dispatches(10, 30) AS d
   WHERE d.id IN (v_dispatch, v_reply_dispatch);
  IF v_count <> 0 THEN RAISE EXCEPTION 'generic root claim took a parked Evolution root'; END IF;
  SELECT pg_catalog.count(*) INTO v_count
    FROM public.claim_evolution_automation_dispatches(10, 30) AS d
   WHERE d.id IN (v_dispatch, v_reply_dispatch);
  IF v_count <> 0 THEN RAISE EXCEPTION 'automation root claim took a parked Evolution root'; END IF;

  SELECT pg_catalog.count(*) INTO v_count
    FROM public.claim_evolution_automation_pending_executions(10, 30) AS p
   WHERE p.pending_execution_id = v_pending;
  IF v_count <> 0 THEN RAISE EXCEPTION 'future Evolution wait was claimed early'; END IF;

  UPDATE public.automation_pending_executions
     SET run_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_pending;
  SELECT * INTO STRICT v_claim
    FROM public.claim_evolution_automation_pending_executions(10, 30) AS p
   WHERE p.pending_execution_id = v_pending;
  IF v_claim.dispatch_id IS DISTINCT FROM v_dispatch
     OR v_claim.account_id IS DISTINCT FROM current_setting('wacrm.t12pending.account_a')::uuid
     OR v_claim.parked_step_id IS NULL
     OR v_claim.parent_step_id IS NOT NULL OR v_claim.branch IS NOT NULL
     OR v_claim.next_step_position <> 5
     OR v_claim.pending_lease_token IS NULL OR v_claim.dispatch_lease_token IS NULL
     OR v_claim.pending_lease_until <= pg_catalog.clock_timestamp()
     OR v_claim.dispatch_lease_until IS DISTINCT FROM v_claim.pending_lease_until
     OR (SELECT d.lease_token FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch)
          IS DISTINCT FROM v_claim.dispatch_lease_token
     OR (SELECT p.status FROM public.automation_pending_executions AS p WHERE p.id = v_pending)
          IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Evolution wait claim did not return its fenced cursor';
  END IF;
  v_old_pending_token := v_claim.pending_lease_token;
  v_old_dispatch_token := v_claim.dispatch_lease_token;

  -- A competing replay sees the active lease and cannot acquire the same row.
  SELECT pg_catalog.count(*) INTO v_count
    FROM public.claim_evolution_automation_pending_executions(10, 30) AS p
   WHERE p.pending_execution_id = v_pending;
  IF v_count <> 0 THEN RAISE EXCEPTION 'active pending lease was claimed twice'; END IF;

  -- Expiration rejects completion by the former token; reclaim rotates both fences.
  UPDATE public.automation_pending_executions
     SET evolution_claim_until = '-infinity'::timestamptz WHERE id = v_pending;
  UPDATE public.evolution_event_dispatches
     SET lease_until = '-infinity'::timestamptz WHERE id = v_dispatch;
  BEGIN
    PERFORM * FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_old_pending_token, v_old_dispatch_token
    );
    RAISE EXCEPTION 'expired wait lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  SELECT * INTO STRICT v_reclaimed
    FROM public.claim_evolution_automation_pending_executions(10, 30) AS p
   WHERE p.pending_execution_id = v_pending;
  IF v_reclaimed.pending_lease_token IS NULL
     OR v_reclaimed.dispatch_lease_token IS NULL
     OR v_reclaimed.pending_lease_token = v_old_pending_token
     OR v_reclaimed.dispatch_lease_token = v_old_dispatch_token
     OR v_reclaimed.next_step_position <> v_claim.next_step_position
     OR v_reclaimed.parent_step_id IS DISTINCT FROM v_claim.parent_step_id
     OR v_reclaimed.branch IS DISTINCT FROM v_claim.branch
     OR v_reclaimed.context IS DISTINCT FROM v_claim.context THEN
    RAISE EXCEPTION 'wait reclaim did not rotate leases while preserving cursor';
  END IF;
  BEGIN
    PERFORM * FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_old_pending_token, v_old_dispatch_token
    );
    RAISE EXCEPTION 'stale wait tokens completed a reclaimed pending row';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT * INTO STRICT v_ack
    FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_reclaimed.pending_lease_token, v_reclaimed.dispatch_lease_token
    );
  IF v_ack.status IS DISTINCT FROM 'done' OR v_ack.replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'fenced pending completion failed';
  END IF;
  SELECT * INTO STRICT v_ack
    FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_reclaimed.pending_lease_token, v_reclaimed.dispatch_lease_token
    );
  IF v_ack.status IS DISTINCT FROM 'done' OR v_ack.replayed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pending completion replay was not idempotent';
  END IF;
  BEGIN
    PERFORM * FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_old_pending_token, v_old_dispatch_token
    );
    RAISE EXCEPTION 'stale completion replay was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  PERFORM public.complete_evolution_dispatch(
    v_dispatch, v_reclaimed.dispatch_lease_token, 'done', NULL, NULL
  );
  SELECT * INTO STRICT v_ack
    FROM public.complete_evolution_automation_pending_execution(
      v_pending, v_reclaimed.pending_lease_token, v_reclaimed.dispatch_lease_token
    );
  IF v_ack.replayed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ack replay failed after root completion';
  END IF;

  IF (SELECT status FROM public.automation_pending_executions WHERE id = v_reply_pending)
       IS DISTINCT FROM 'awaiting_reply'
     OR (SELECT evolution_claim_token FROM public.automation_pending_executions WHERE id = v_reply_pending)
       IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.evolution_event_dispatches AS d
        WHERE d.id = v_reply_dispatch AND d.state IS DISTINCT FROM 'processing'
     ) THEN
    RAISE EXCEPTION 'awaiting_reply row was claimed or terminalized by due wait flow';
  END IF;
  IF (SELECT status FROM public.automation_pending_executions WHERE id = v_legacy_pending)
       IS DISTINCT FROM 'pending'
     OR (SELECT evolution_claim_token FROM public.automation_pending_executions WHERE id = v_legacy_pending)
       IS NOT NULL
     OR (SELECT evolution_claim_attempts FROM public.automation_pending_executions WHERE id = v_legacy_pending) <> 0 THEN
    RAISE EXCEPTION 'legacy pending row was touched';
  END IF;

  UPDATE public.evolution_event_dispatches
     SET lease_token = pg_catalog.gen_random_uuid(),
         lease_until = '-infinity'::timestamptz
   WHERE id = v_bad_dispatch;
  SELECT d.lease_token, d.lease_until
    INTO STRICT v_bad_root_token_before, v_bad_root_lease_before
    FROM public.evolution_event_dispatches AS d WHERE d.id = v_bad_dispatch;
  UPDATE public.automation_pending_executions
     SET run_at = pg_catalog.clock_timestamp() - interval '1 second'
   WHERE id = v_bad_pending;
  SELECT pg_catalog.count(*) INTO v_count
    FROM public.claim_evolution_automation_pending_executions(10, 30) AS p
   WHERE p.pending_execution_id = v_bad_pending;
  IF v_count <> 0 THEN RAISE EXCEPTION 'cross-account pending/root link was claimed'; END IF;
  SELECT d.lease_token, d.lease_until
    INTO STRICT v_bad_root_token_after, v_bad_root_lease_after
    FROM public.evolution_event_dispatches AS d WHERE d.id = v_bad_dispatch;
  IF (SELECT evolution_claim_token FROM public.automation_pending_executions WHERE id = v_bad_pending)
       IS NOT NULL
     OR (SELECT evolution_claim_attempts FROM public.automation_pending_executions WHERE id = v_bad_pending) <> 0
     OR v_bad_root_token_after IS DISTINCT FROM v_bad_root_token_before
     OR v_bad_root_lease_after IS DISTINCT FROM v_bad_root_lease_before THEN
    RAISE EXCEPTION 'tenant rejection mutated pending or root lease';
  END IF;
END;
$claim_assertions$;
RESET ROLE;

ROLLBACK;
