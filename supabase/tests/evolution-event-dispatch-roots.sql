BEGIN;

-- Synthetic catalog and key checks only. Everything is rolled back.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_event_id uuid;
  v_second_event_id uuid;
  v_automation_id uuid;
  v_flow_id uuid;
  v_ai_config_id uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated',
    v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T09 dispatch roots synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080',
    't09-roots-' || v_user_id::text,
    'synthetic-ciphertext', 'synthetic-webhook'
  ) RETURNING id INTO v_connection_id;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_id, 't09-roots-one', '{"kind":"message"}'::jsonb)
  RETURNING id INTO v_event_id;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (v_connection_id, 't09-roots-two', '{"kind":"message"}'::jsonb)
  RETURNING id INTO v_second_event_id;

  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_id, v_account_id, 'synthetic automation', 'inbound_message', true)
  RETURNING id INTO v_automation_id;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_id, v_account_id, 'synthetic flow', 'active', 'first_inbound_message')
  RETURNING id INTO v_flow_id;
  INSERT INTO public.ai_configs (
    account_id, created_by, provider, model, api_key, is_active, auto_reply_enabled
  ) VALUES (v_account_id, v_user_id, 'openai', 'synthetic-model', 'synthetic-ciphertext', true, true)
  RETURNING id INTO v_ai_config_id;

  PERFORM pg_catalog.set_config('wacrm.t09roots.user_id', v_user_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.event_id', v_event_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.second_event_id', v_second_event_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.automation_id', v_automation_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.flow_id', v_flow_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t09roots.ai_config_id', v_ai_config_id::text, true);
END;
$fixture_setup$;

DO $schema_assertions$
DECLARE
  v_constraint_count integer;
  v_index_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_constraint_count
    FROM pg_catalog.pg_constraint AS c
   WHERE c.conrelid = 'public.evolution_event_dispatches'::regclass
     AND c.conname IN (
       'evolution_event_dispatches_pkey',
       'evolution_event_dispatches_event_fkey',
       'evolution_event_dispatches_account_fkey',
       'evolution_event_dispatches_automation_fkey',
       'evolution_event_dispatches_flow_fkey',
       'evolution_event_dispatches_ai_config_fkey',
       'evolution_event_dispatches_user_fkey',
       'evolution_event_dispatches_contact_fkey',
       'evolution_event_dispatches_conversation_fkey',
       'evolution_event_dispatches_automation_log_fkey',
       'evolution_event_dispatches_flow_run_fkey',
       'evolution_event_dispatches_engine_check',
       'evolution_event_dispatches_definition_matches_engine',
       'evolution_event_dispatches_state_check',
       'evolution_event_dispatches_attempts_check'
     );
  SELECT pg_catalog.count(*)::integer INTO v_index_count
    FROM pg_catalog.pg_indexes AS i
   WHERE i.schemaname = 'public' AND i.tablename = 'evolution_event_dispatches'
     AND i.indexname IN (
       'evolution_dispatch_automation_event_key',
       'evolution_dispatch_flow_event_key',
       'evolution_dispatch_ai_event_key'
     ) AND i.indexdef LIKE 'CREATE UNIQUE INDEX%';

  IF v_constraint_count <> 15 OR v_index_count <> 3
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
              WHERE c.oid = 'public.evolution_event_dispatches'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p
                 WHERE p.schemaname = 'public' AND p.tablename = 'evolution_event_dispatches')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_event_dispatches', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_event_dispatches', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_event_dispatches', 'INSERT') THEN
    RAISE EXCEPTION 'dispatch root schema, RLS, indexes, or grants do not match the contract';
  END IF;
END;
$schema_assertions$;

SET LOCAL ROLE service_role;

DO $root_key_assertions$
DECLARE
  v_event_id uuid := current_setting('wacrm.t09roots.event_id')::uuid;
  v_second_event_id uuid := current_setting('wacrm.t09roots.second_event_id')::uuid;
  v_account_id uuid := current_setting('wacrm.t09roots.account_id')::uuid;
  v_user_id uuid := current_setting('wacrm.t09roots.user_id')::uuid;
  v_automation_id uuid := current_setting('wacrm.t09roots.automation_id')::uuid;
  v_flow_id uuid := current_setting('wacrm.t09roots.flow_id')::uuid;
  v_ai_config_id uuid := current_setting('wacrm.t09roots.ai_config_id')::uuid;
  v_root_id uuid;
  v_replay_id uuid;
BEGIN
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id
  ) VALUES (v_event_id, v_account_id, 'automation', v_automation_id, v_user_id)
  RETURNING id INTO v_root_id;

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, flow_id, user_id
  ) VALUES (v_event_id, v_account_id, 'flow', v_flow_id, v_user_id);
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, ai_config_id, user_id
  ) VALUES (v_event_id, v_account_id, 'ai', v_ai_config_id, v_user_id);

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id
  ) VALUES (v_second_event_id, v_account_id, 'automation', v_automation_id, v_user_id);

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id
  ) VALUES (v_event_id, v_account_id, 'automation', v_automation_id, v_user_id)
  ON CONFLICT (event_id, automation_id) WHERE engine = 'automation' DO NOTHING
  RETURNING id INTO v_replay_id;

  IF v_replay_id IS NOT NULL OR (SELECT pg_catalog.count(*)
       FROM public.evolution_event_dispatches AS d
      WHERE d.event_id = v_event_id AND d.engine = 'automation'
        AND d.automation_id = v_automation_id) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.id = v_root_id)
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_id) <> 3 THEN
    RAISE EXCEPTION 'dispatch root unique keys did not preserve one root per event/engine/definition';
  END IF;

  BEGIN
    INSERT INTO public.evolution_event_dispatches (
      event_id, account_id, engine, automation_id, flow_id, user_id
    ) VALUES (v_event_id, v_account_id, 'automation', v_automation_id, v_flow_id, v_user_id);
    RAISE EXCEPTION 'root with definitions that do not match engine was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    UPDATE public.evolution_event_dispatches AS d
       SET state = 'unsupported'
     WHERE d.id = v_root_id;
    RAISE EXCEPTION 'unsupported dispatch root state was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$root_key_assertions$;

RESET ROLE;
ROLLBACK;
