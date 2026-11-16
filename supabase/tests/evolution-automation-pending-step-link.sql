BEGIN;

-- Synthetic queue/schema fixtures; the test is intentionally rollback-only.
DO $assertions$
DECLARE
  v_user uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_automation_id uuid;
  v_connection_id uuid;
  v_event_id uuid;
  v_dispatch_id uuid;
  v_dispatch_step_id uuid;
  v_pending_id uuid;
  v_legacy_pending_a uuid;
  v_legacy_pending_b uuid;
  v_column_not_null boolean;
  v_fk_delete_action "char";
  v_fk_validated boolean;
  v_unique_exists boolean;
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_policy_count integer;
  v_constraint_name text;
BEGIN
  SELECT a.attnotnull INTO STRICT v_column_not_null
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.automation_pending_executions'::regclass
     AND a.attname = 'evolution_dispatch_step_id'
     AND NOT a.attisdropped;
  IF v_column_not_null THEN
    RAISE EXCEPTION 'evolution_dispatch_step_id must remain nullable';
  END IF;

  SELECT c.confdeltype, c.convalidated INTO STRICT v_fk_delete_action, v_fk_validated
    FROM pg_catalog.pg_constraint AS c
   WHERE c.conrelid = 'public.automation_pending_executions'::regclass
     AND c.conname = 'automation_pending_executions_evolution_dispatch_step_fkey'
     AND c.contype = 'f';
  IF v_fk_delete_action <> 'n' OR NOT v_fk_validated THEN
    RAISE EXCEPTION 'dispatch step foreign key must be validated with ON DELETE SET NULL';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
     WHERE c.conrelid = 'public.automation_pending_executions'::regclass
       AND c.conname = 'automation_pending_executions_evolution_dispatch_step_key'
       AND c.contype = 'u'
  ) INTO v_unique_exists;
  IF NOT v_unique_exists THEN
    RAISE EXCEPTION 'named unique constraint for dispatch step is missing';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO STRICT v_rls_enabled, v_rls_forced
    FROM pg_catalog.pg_class AS c
   WHERE c.oid = 'public.automation_pending_executions'::regclass;
  SELECT pg_catalog.count(*)::integer INTO v_policy_count
    FROM pg_catalog.pg_policies AS p
   WHERE p.schemaname = 'public' AND p.tablename = 'automation_pending_executions';
  IF NOT v_rls_enabled OR v_rls_forced OR v_policy_count <> 0 THEN
    RAISE EXCEPTION 'automation pending queue RLS state or policies changed';
  END IF;
  IF NOT has_table_privilege('anon','public.automation_pending_executions','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated','public.automation_pending_executions','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role','public.automation_pending_executions','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'automation pending queue table grants changed';
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user, 'authenticated', 'authenticated', v_user::text || '@t12-pending.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T12 pending queue synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user, v_account_id, 'T12 pending queue synthetic', 'new_message_received', true)
  RETURNING id INTO v_automation_id;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user, 'http://127.0.0.1:8080', 't12-pending-' || v_user::text,
    'synthetic-fixture', 'synthetic-fixture'
  ) RETURNING id INTO v_connection_id;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (
    v_connection_id, 't12:pending:' || v_user::text,
    pg_catalog.jsonb_build_object('kind','message','externalMessageId','synthetic'),
    'done', pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, state
  ) VALUES (
    v_event_id, v_account_id, 'automation', v_automation_id, v_user, 'pending'
  ) RETURNING id INTO v_dispatch_id;
  INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, request_id)
  VALUES (v_dispatch_id, 't12-pending-fixture', 'synthetic-step:' || v_user::text)
  RETURNING id INTO v_dispatch_step_id;

  INSERT INTO public.automation_pending_executions (
    automation_id, account_id, user_id, next_step_position, run_at, evolution_dispatch_step_id
  ) VALUES (
    v_automation_id, v_account_id, v_user, 1, pg_catalog.clock_timestamp(), v_dispatch_step_id
  ) RETURNING id INTO v_pending_id;

  BEGIN
    INSERT INTO public.automation_pending_executions (
      automation_id, account_id, user_id, next_step_position, run_at, evolution_dispatch_step_id
    ) VALUES (
      v_automation_id, v_account_id, v_user, 2, pg_catalog.clock_timestamp(), v_dispatch_step_id
    );
    RAISE EXCEPTION 'duplicate dispatch-step linkage was accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name <> 'automation_pending_executions_evolution_dispatch_step_key' THEN
      RAISE EXCEPTION 'duplicate linkage failed on unexpected constraint %', v_constraint_name;
    END IF;
  END;

  BEGIN
    INSERT INTO public.automation_pending_executions (
      automation_id, account_id, user_id, next_step_position, run_at,
      evolution_dispatch_step_id
    ) VALUES (
      v_automation_id, v_account_id, v_user, 3, pg_catalog.clock_timestamp(),
      pg_catalog.gen_random_uuid()
    );
    RAISE EXCEPTION 'unknown dispatch-step foreign key was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name <> 'automation_pending_executions_evolution_dispatch_step_fkey' THEN
      RAISE EXCEPTION 'foreign-key rejection came from unexpected constraint %', v_constraint_name;
    END IF;
  END;

  INSERT INTO public.automation_pending_executions (
    automation_id, account_id, user_id, next_step_position, run_at, evolution_dispatch_step_id
  ) VALUES (
    v_automation_id, v_account_id, v_user, 4, pg_catalog.clock_timestamp(), NULL
  ) RETURNING id INTO v_legacy_pending_a;
  INSERT INTO public.automation_pending_executions (
    automation_id, account_id, user_id, next_step_position, run_at, evolution_dispatch_step_id
  ) VALUES (
    v_automation_id, v_account_id, v_user, 5, pg_catalog.clock_timestamp(), NULL
  ) RETURNING id INTO v_legacy_pending_b;
  IF (SELECT pg_catalog.count(*) FROM public.automation_pending_executions AS e
       WHERE e.automation_id = v_automation_id AND e.evolution_dispatch_step_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'multiple legacy NULL rows were not preserved';
  END IF;

  DELETE FROM public.evolution_dispatch_steps AS s WHERE s.id = v_dispatch_step_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_pending_executions AS e
     WHERE e.id = v_pending_id AND e.evolution_dispatch_step_id IS NULL
  ) THEN
    RAISE EXCEPTION 'deleting dispatch step did not preserve queue row and set linkage NULL';
  END IF;
END;
$assertions$;

ROLLBACK;
