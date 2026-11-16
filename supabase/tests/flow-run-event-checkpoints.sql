BEGIN;

-- Synthetic flow/event fixtures, constraints, indexes, and RLS; rollback-only.
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
  v_connection_a uuid;
  v_event_a uuid;
  v_event_deleted uuid;
  v_legacy_event_id uuid;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@flow-checkpoint-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic flow checkpoint A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@flow-checkpoint-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic flow checkpoint B"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_a, v_account_a, 'Synthetic checkpoint flow A', 'draft', 'manual')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_b, v_account_b, 'Synthetic checkpoint flow B', 'draft', 'manual')
  RETURNING id INTO v_flow_b;

  INSERT INTO public.flow_runs (flow_id, account_id, user_id, status, current_node_key)
  VALUES (v_flow_a, v_account_a, v_user_a, 'active', 'synthetic-a')
  RETURNING id INTO v_run_a;
  INSERT INTO public.flow_runs (flow_id, account_id, user_id, status, current_node_key)
  VALUES (v_flow_b, v_account_b, v_user_b, 'active', 'synthetic-b')
  RETURNING id INTO v_run_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_a, v_user_a, 'http://127.0.0.1:8080', 'flow-checkpoint-' || v_user_a::text,
    'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_a, 'flow-checkpoint:' || v_user_a::text, '{"kind":"synthetic"}'::jsonb)
  RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_a, 'flow-checkpoint-delete:' || v_user_a::text, '{"kind":"synthetic"}'::jsonb)
  RETURNING id INTO v_event_deleted;

  -- Legacy inserts omit both new nullable columns and remain unchanged.
  INSERT INTO public.flow_run_events (flow_run_id, event_type, node_key, payload)
  VALUES (v_run_a, 'started', 'synthetic-a', '{"legacy":true}'::jsonb)
  RETURNING id INTO v_legacy_event_id;

  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.run_a', v_run_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.run_b', v_run_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.event_a', v_event_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.event_deleted', v_event_deleted::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowcheckpoint.legacy_event', v_legacy_event_id::text, true);
END;
$fixture_setup$;

DO $schema_assertions$
DECLARE
  v_events regclass := 'public.flow_run_events'::regclass;
  v_reply_index oid := pg_catalog.to_regclass('public.flow_run_events_reply_event_key');
  v_transition_index oid := pg_catalog.to_regclass('public.flow_run_events_evolution_transition_key');
  v_policy_expression text;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = v_events AND a.attname = 'evolution_event_id'
          AND a.atttypid = 'uuid'::regtype AND NOT a.attnotnull AND NOT a.attisdropped
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = v_events AND a.attname = 'transition_seq'
          AND a.atttypid = 'integer'::regtype AND NOT a.attnotnull AND NOT a.attisdropped
     ) THEN
    RAISE EXCEPTION 'flow event checkpoint columns are missing or not nullable';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
        WHERE c.conrelid = v_events
          AND c.conname = 'flow_run_events_evolution_event_id_fkey'
          AND c.contype = 'f' AND c.confdeltype = 'n'
     ) THEN
    RAISE EXCEPTION 'Evolution event reference must use ON DELETE SET NULL';
  END IF;
  IF v_reply_index IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index AS i
        WHERE i.indexrelid = v_reply_index AND i.indisunique AND i.indisvalid
          AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%reply_received%'
          AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%evolution_event_id IS NOT NULL%'
     ) OR v_transition_index IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index AS i
        WHERE i.indexrelid = v_transition_index AND i.indisunique AND i.indisvalid
          AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%evolution_event_id IS NOT NULL%'
          AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) LIKE '%transition_seq IS NOT NULL%'
     ) THEN
    RAISE EXCEPTION 'Expected unique partial flow checkpoint indexes are missing';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'flow_run_events'
          AND indexname = 'idx_flow_run_events_run_type'
          AND indexdef LIKE '%(flow_run_id, event_type)%'
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND tablename = 'flow_run_events'
          AND indexname = 'idx_flow_run_events_run_time'
          AND indexdef LIKE '%(flow_run_id, created_at DESC)%'
     ) THEN
    RAISE EXCEPTION 'Legacy flow event indexes were not preserved';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_events) THEN
    RAISE EXCEPTION 'flow_run_events RLS was disabled';
  END IF;
  SELECT pg_catalog.pg_get_expr(p.polqual, p.polrelid)
    INTO v_policy_expression
    FROM pg_catalog.pg_policy AS p
   WHERE p.polrelid = v_events AND p.polname = 'flow_run_events_select';
  IF v_policy_expression IS NULL
     OR v_policy_expression NOT LIKE '%flow_runs%'
     OR v_policy_expression NOT LIKE '%is_account_member%' THEN
    RAISE EXCEPTION 'Existing flow event tenant policy was not preserved';
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.id = current_setting('wacrm.flowcheckpoint.legacy_event')::uuid
          AND (e.evolution_event_id IS NOT NULL OR e.transition_seq IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'Legacy event was unexpectedly rewritten';
  END IF;
END;
$schema_assertions$;

DO $uniqueness_assertions$
DECLARE
  v_run_a uuid := current_setting('wacrm.flowcheckpoint.run_a')::uuid;
  v_run_b uuid := current_setting('wacrm.flowcheckpoint.run_b')::uuid;
  v_event_a uuid := current_setting('wacrm.flowcheckpoint.event_a')::uuid;
BEGIN
  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id)
  VALUES (v_run_a, 'reply_received', v_event_a);

  -- Same reply event on the same run is a replay collision, even if a
  -- caller supplies a different transition sequence on the retry.
  BEGIN
    INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
    VALUES (v_run_a, 'reply_received', v_event_a, 99);
    RAISE EXCEPTION 'reply replay collision was not rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- The same event can belong to another run; uniqueness is scoped to run.
  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id)
  VALUES (v_run_b, 'reply_received', v_event_a);

  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
  VALUES (v_run_a, 'node_entered', v_event_a, 1);
  BEGIN
    INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
    VALUES (v_run_a, 'node_entered', v_event_a, 1);
    RAISE EXCEPTION 'transition replay collision was not rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- A later transition on the same event and a distinct event type at
  -- the same sequence are separate audit checkpoints.
  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
  VALUES (v_run_a, 'node_entered', v_event_a, 2),
         (v_run_a, 'message_sent', v_event_a, 1);

  -- NULL checkpoint values are deliberately outside the partial index,
  -- preserving legacy rows and non-transition audit events.
  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
  VALUES (v_run_a, 'node_entered', v_event_a, NULL),
         (v_run_a, 'node_entered', v_event_a, NULL),
         (v_run_a, 'node_entered', NULL, 7),
         (v_run_a, 'node_entered', NULL, 7);
END;
$uniqueness_assertions$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', current_setting('wacrm.flowcheckpoint.user_a'), true);
DO $tenant_assertion$
DECLARE
  v_run_a uuid := current_setting('wacrm.flowcheckpoint.run_a')::uuid;
  v_run_b uuid := current_setting('wacrm.flowcheckpoint.run_b')::uuid;
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.flow_run_events WHERE flow_run_id = v_run_a) < 1
     OR EXISTS (SELECT 1 FROM public.flow_run_events WHERE flow_run_id = v_run_b) THEN
    RAISE EXCEPTION 'flow event tenant RLS visibility changed';
  END IF;
END;
$tenant_assertion$;
RESET ROLE;

DO $foreign_key_assertion$
DECLARE
  v_event_deleted uuid := current_setting('wacrm.flowcheckpoint.event_deleted')::uuid;
  v_run_a uuid := current_setting('wacrm.flowcheckpoint.run_a')::uuid;
  v_event_row uuid;
BEGIN
  INSERT INTO public.flow_run_events (flow_run_id, event_type, evolution_event_id, transition_seq)
  VALUES (v_run_a, 'timeout', v_event_deleted, 100)
  RETURNING id INTO v_event_row;
  DELETE FROM public.evolution_events WHERE id = v_event_deleted;
  IF NOT EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.id = v_event_row AND e.evolution_event_id IS NULL AND e.transition_seq = 100
     ) THEN
    RAISE EXCEPTION 'Evolution event deletion did not preserve audit with null reference';
  END IF;
END;
$foreign_key_assertion$;

ROLLBACK;
