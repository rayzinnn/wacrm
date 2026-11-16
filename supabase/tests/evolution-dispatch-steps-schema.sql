BEGIN;

-- Synthetic fixture rows and all schema checks are rolled back.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_automation_id uuid;
  v_event_a uuid;
  v_event_b uuid;
  v_dispatch_a uuid;
  v_dispatch_b uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T12 dispatch step schema synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080', 't12-steps-schema-' || v_user_id::text,
    'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret'
  ) RETURNING id INTO v_connection_id;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_id, v_account_id, 'T12 dispatch steps schema synthetic', 'inbound_message', true)
  RETURNING id INTO v_automation_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_id, 't12:steps:event-a', '{"kind":"message"}'::jsonb)
  RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_id, 't12:steps:event-b', '{"kind":"message"}'::jsonb)
  RETURNING id INTO v_event_b;

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id)
  VALUES (v_event_a, v_account_id, 'automation', v_automation_id, v_user_id)
  RETURNING id INTO v_dispatch_a;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id)
  VALUES (v_event_b, v_account_id, 'automation', v_automation_id, v_user_id)
  RETURNING id INTO v_dispatch_b;

  PERFORM pg_catalog.set_config('wacrm.t12steps.user_id', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12steps.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12steps.dispatch_a', v_dispatch_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12steps.dispatch_b', v_dispatch_b::text, true);
END;
$fixture_setup$;

DO $catalog_assertions$
DECLARE
  v_table regclass := 'public.evolution_dispatch_steps'::regclass;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p
       WHERE p.schemaname = 'public' AND p.tablename = 'evolution_dispatch_steps')
     OR pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('anon', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('anon', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('anon', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('anon', v_table, 'TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'TRIGGER')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'TRUNCATE')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'REFERENCES')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'TRIGGER') THEN
    RAISE EXCEPTION 'dispatch steps RLS/policies/grants do not match the service-only contract';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = 'public.automation_logs'::regclass
         AND a.attname = 'evolution_dispatch_id' AND NOT a.attnotnull AND NOT a.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = 'public.automation_logs'::regclass
         AND c.conname = 'automation_logs_evolution_dispatch_id_fkey'
         AND c.contype = 'f' AND c.confdeltype = 'n'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = 'public.automation_logs'::regclass
         AND c.conname = 'automation_logs_evolution_dispatch_id_key'
         AND c.contype = 'u'
     ) THEN
    RAISE EXCEPTION 'automation_logs inverse dispatch link is missing or has the wrong null/delete semantics';
  END IF;
END;
$catalog_assertions$;

SET LOCAL ROLE anon;
DO $anon_isolation$
BEGIN
  BEGIN
    PERFORM 1 FROM public.evolution_dispatch_steps LIMIT 1;
    RAISE EXCEPTION 'anon read dispatch steps';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_isolation$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_isolation$
BEGIN
  BEGIN
    PERFORM 1 FROM public.evolution_dispatch_steps LIMIT 1;
    RAISE EXCEPTION 'authenticated read dispatch steps';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_isolation$;
RESET ROLE;

SET LOCAL ROLE service_role;

DO $constraint_assertions$
DECLARE
  v_dispatch_a uuid := current_setting('wacrm.t12steps.dispatch_a')::uuid;
  v_dispatch_b uuid := current_setting('wacrm.t12steps.dispatch_b')::uuid;
  v_automation_id uuid := (SELECT d.automation_id FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch_a);
  v_user_id uuid := current_setting('wacrm.t12steps.user_id')::uuid;
  v_account_id uuid := current_setting('wacrm.t12steps.account_id')::uuid;
  v_log_a uuid;
  v_log_b uuid;
  v_step_id uuid;
  v_count integer;
BEGIN
  -- The inverse FK intentionally forms a cycle with the root's nullable log FK:
  -- create roots first, create logs second, then set root.automation_log_id.
  INSERT INTO public.automation_logs (
    automation_id, user_id, account_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (
    v_automation_id, v_user_id, v_account_id, 't12-schema-fixture', '[]'::jsonb,
    'partial', v_dispatch_a
  ) RETURNING id INTO v_log_a;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log_a WHERE id = v_dispatch_a;

  INSERT INTO public.automation_logs (
    automation_id, user_id, account_id, trigger_event, steps_executed,
    status, evolution_dispatch_id
  ) VALUES (
    v_automation_id, v_user_id, v_account_id, 't12-schema-fixture', '[]'::jsonb,
    'partial', v_dispatch_b
  ) RETURNING id INTO v_log_b;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log_b WHERE id = v_dispatch_b;

  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_event_dispatches AS d
    JOIN public.automation_logs AS l ON l.id = d.automation_log_id
    WHERE d.id = v_dispatch_a AND l.evolution_dispatch_id = d.id
  ) THEN
    RAISE EXCEPTION 'root/log inverse links were not established in the documented insertion order';
  END IF;

  BEGIN
    INSERT INTO public.automation_logs (
      automation_id, user_id, account_id, trigger_event, steps_executed,
      status, evolution_dispatch_id
    ) VALUES (
      v_automation_id, v_user_id, v_account_id, 't12-schema-duplicate', '[]'::jsonb,
      'partial', v_dispatch_b
    );
    RAISE EXCEPTION 'duplicate evolution_dispatch_id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.automation_logs (
    automation_id, user_id, account_id, trigger_event, steps_executed, status
  ) VALUES (
    v_automation_id, v_user_id, v_account_id, 't12-schema-nullable', '[]'::jsonb,
    'partial'
  );

  INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key)
  VALUES (v_dispatch_a, 'fixture:defaults')
  RETURNING id INTO v_step_id;
  IF NOT EXISTS (SELECT 1 FROM public.evolution_dispatch_steps AS s WHERE s.id = v_step_id
       AND s.state = 'pending' AND s.attempts = 0 AND s.lease_until IS NULL
       AND s.lease_token IS NULL AND s.request_id IS NULL AND s.result IS NULL
       AND s.last_error_code IS NULL AND s.created_at IS NOT NULL AND s.updated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'dispatch step defaults do not match the schema contract';
  END IF;

  INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key)
  VALUES (v_dispatch_a, 'fixture:null-request-a'), (v_dispatch_a, 'fixture:null-request-b');
  IF (SELECT pg_catalog.count(*) FROM public.evolution_dispatch_steps AS s
       WHERE s.dispatch_id = v_dispatch_a AND s.request_id IS NULL) <> 3 THEN
    RAISE EXCEPTION 'nullable request IDs do not allow multiple local-only steps';
  END IF;

  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key)
    VALUES (v_dispatch_a, 'fixture:defaults');
    RAISE EXCEPTION 'duplicate (dispatch_id, action_key) was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, request_id)
  VALUES (v_dispatch_a, 'fixture:request-a', 't12-request-unique-synthetic');
  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, request_id)
    VALUES (v_dispatch_b, 'fixture:request-b', 't12-request-unique-synthetic');
    RAISE EXCEPTION 'duplicate non-null request_id was accepted across dispatches';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, state)
    VALUES (v_dispatch_a, 'fixture:invalid-state', 'waiting');
    RAISE EXCEPTION 'unsupported dispatch step state was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, attempts)
    VALUES (v_dispatch_a, 'fixture:invalid-attempts', 6);
    RAISE EXCEPTION 'dispatch step attempts above five were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key, send_attempt_id)
    VALUES (v_dispatch_a, 'fixture:invalid-send-attempt', pg_catalog.gen_random_uuid());
    RAISE EXCEPTION 'unknown send_attempt_id was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key)
    VALUES (pg_catalog.gen_random_uuid(), 'fixture:invalid-dispatch');
    RAISE EXCEPTION 'unknown dispatch_id was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO public.evolution_dispatch_steps (dispatch_id, action_key)
  VALUES (v_dispatch_b, 'fixture:cascade');
  DELETE FROM public.evolution_event_dispatches WHERE id = v_dispatch_b;
  SELECT pg_catalog.count(*)::integer INTO v_count
    FROM public.evolution_dispatch_steps AS s WHERE s.dispatch_id = v_dispatch_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'deleting a dispatch root did not cascade to its steps';
  END IF;
  IF (SELECT l.evolution_dispatch_id FROM public.automation_logs AS l WHERE l.id = v_log_b) IS NOT NULL THEN
    RAISE EXCEPTION 'deleting a dispatch root did not SET NULL on the inverse log FK';
  END IF;

  DELETE FROM public.automation_logs WHERE id = v_log_a;
  IF (SELECT d.automation_log_id FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch_a) IS NOT NULL THEN
    RAISE EXCEPTION 'deleting an automation log did not SET NULL on the root FK';
  END IF;
END;
$constraint_assertions$;

RESET ROLE;
ROLLBACK;
