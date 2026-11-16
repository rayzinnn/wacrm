BEGIN;

-- All fixture rows and RPC mutations are synthetic and rolled back.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_automation_a uuid;
  v_automation_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_ai_a uuid;
  v_ai_b uuid;
  v_token_a uuid := pg_catalog.gen_random_uuid();
  v_token_b uuid := pg_catalog.gen_random_uuid();
  v_token_a_second uuid := pg_catalog.gen_random_uuid();
  v_token_a_third uuid := pg_catalog.gen_random_uuid();
  v_token_rollback uuid := pg_catalog.gen_random_uuid();
  v_token_stale uuid := pg_catalog.gen_random_uuid();
  v_token_expired uuid := pg_catalog.gen_random_uuid();
  v_token_media uuid := pg_catalog.gen_random_uuid();
  v_event_a uuid;
  v_event_a_replay uuid;
  v_event_a_second uuid;
  v_event_b uuid;
  v_event_rollback uuid;
  v_event_stale uuid;
  v_event_expired uuid;
  v_event_media uuid;
  v_event_status uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T09 inbound synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T09 inbound synthetic B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't09-apply-a-' || v_user_a::text, 'synthetic-a', 'synthetic-a')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (v_account_b, v_user_b, 'http://127.0.0.1:8080', 't09-apply-b-' || v_user_b::text, 'synthetic-b', 'synthetic-b')
  RETURNING id INTO v_connection_b;

  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T09 synthetic automation A', 'inbound_message', true)
  RETURNING id INTO v_automation_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_b, v_account_b, 'T09 synthetic automation B', 'inbound_message', true)
  RETURNING id INTO v_automation_b;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_a, v_account_a, 'T09 synthetic flow A', 'active', 'first_inbound_message')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_b, v_account_b, 'T09 synthetic flow B', 'active', 'first_inbound_message')
  RETURNING id INTO v_flow_b;
  INSERT INTO public.ai_configs (
    account_id, created_by, provider, model, api_key, is_active, auto_reply_enabled
  ) VALUES (v_account_a, v_user_a, 'openai', 'synthetic-model', 'synthetic-ciphertext-a', true, true)
  RETURNING id INTO v_ai_a;
  INSERT INTO public.ai_configs (
    account_id, created_by, provider, model, api_key, is_active, auto_reply_enabled
  ) VALUES (v_account_b, NULL, 'openai', 'synthetic-model', 'synthetic-ciphertext-b', true, true)
  RETURNING id INTO v_ai_b;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, lease_until, lease_token
  ) VALUES
    (v_connection_a, 'message:sha256:a1', jsonb_build_object(
      'kind','message','eventKey','message:sha256:a1','externalMessageId','t09-shared-external-id',
      'peer','15550000011@s.whatsapp.net','occurredAt','2026-11-16T18:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','first inbound','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_a),
    (v_connection_a, 'message:sha256:a-replay', jsonb_build_object(
      'kind','message','eventKey','message:sha256:a-replay','externalMessageId','t09-shared-external-id',
      'peer','15550000011@s.whatsapp.net','occurredAt','2026-11-16T18:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','first inbound','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_a_second),
    (v_connection_a, 'message:sha256:a2', jsonb_build_object(
      'kind','message','eventKey','message:sha256:a2','externalMessageId','t09-a-second-id',
      'peer','15550000011@s.whatsapp.net','occurredAt','2026-11-16T18:05:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','second inbound','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_a_third),
    (v_connection_b, 'message:sha256:b1', jsonb_build_object(
      'kind','message','eventKey','message:sha256:b1','externalMessageId','t09-shared-external-id',
      'peer','15550000011@s.whatsapp.net','occurredAt','2026-11-16T18:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','account B inbound','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_b),
    (v_connection_a, 'message:sha256:rollback', jsonb_build_object(
      'kind','message','eventKey','message:sha256:rollback','externalMessageId','t09-rollback-id',
      'peer','15550000099@s.whatsapp.net','occurredAt','2026-11-16T18:10:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','rollback probe','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_rollback),
    (v_connection_a, 'message:sha256:stale', jsonb_build_object(
      'kind','message','eventKey','message:sha256:stale','externalMessageId','t09-stale-id',
      'peer','15550000098@s.whatsapp.net','occurredAt','2026-11-16T18:11:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','stale lease','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_stale),
    (v_connection_a, 'message:sha256:expired', jsonb_build_object(
      'kind','message','eventKey','message:sha256:expired','externalMessageId','t09-expired-id',
      'peer','15550000097@s.whatsapp.net','occurredAt','2026-11-16T18:12:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','expired lease','mediaRef',NULL
    ), 'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_token_expired),
    (v_connection_a, 'message:sha256:media', jsonb_build_object(
      'kind','message','eventKey','message:sha256:media','externalMessageId','t09-media-id',
      'peer','15550000096@s.whatsapp.net','occurredAt','2026-11-16T18:13:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','image','text','unsupported','mediaRef','blocked'
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_media),
    (v_connection_a, 'status:sha256:unobserved', '{"kind":"status"}'::jsonb,
     'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', pg_catalog.gen_random_uuid());

  SELECT e.id INTO STRICT v_event_a FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:a1' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_a_replay FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:a-replay' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_a_second FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:a2' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_b FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:b1' AND e.connection_id = v_connection_b;
  SELECT e.id INTO STRICT v_event_rollback FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:rollback' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_stale FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:stale' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_expired FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:expired' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_media FROM public.evolution_events AS e WHERE e.event_key = 'message:sha256:media' AND e.connection_id = v_connection_a;
  SELECT e.id INTO STRICT v_event_status FROM public.evolution_events AS e WHERE e.event_key = 'status:sha256:unobserved' AND e.connection_id = v_connection_a;

  PERFORM set_config('wacrm.t09apply.user_a', v_user_a::text, true);
  PERFORM set_config('wacrm.t09apply.user_b', v_user_b::text, true);
  PERFORM set_config('wacrm.t09apply.account_a', v_account_a::text, true);
  PERFORM set_config('wacrm.t09apply.account_b', v_account_b::text, true);
  PERFORM set_config('wacrm.t09apply.connection_a', v_connection_a::text, true);
  PERFORM set_config('wacrm.t09apply.connection_b', v_connection_b::text, true);
  PERFORM set_config('wacrm.t09apply.automation_a', v_automation_a::text, true);
  PERFORM set_config('wacrm.t09apply.automation_b', v_automation_b::text, true);
  PERFORM set_config('wacrm.t09apply.flow_a', v_flow_a::text, true);
  PERFORM set_config('wacrm.t09apply.flow_b', v_flow_b::text, true);
  PERFORM set_config('wacrm.t09apply.ai_a', v_ai_a::text, true);
  PERFORM set_config('wacrm.t09apply.ai_b', v_ai_b::text, true);
  PERFORM set_config('wacrm.t09apply.event_a', v_event_a::text, true);
  PERFORM set_config('wacrm.t09apply.event_a_replay', v_event_a_replay::text, true);
  PERFORM set_config('wacrm.t09apply.event_a_second', v_event_a_second::text, true);
  PERFORM set_config('wacrm.t09apply.event_b', v_event_b::text, true);
  PERFORM set_config('wacrm.t09apply.event_rollback', v_event_rollback::text, true);
  PERFORM set_config('wacrm.t09apply.event_stale', v_event_stale::text, true);
  PERFORM set_config('wacrm.t09apply.event_expired', v_event_expired::text, true);
  PERFORM set_config('wacrm.t09apply.event_media', v_event_media::text, true);
  PERFORM set_config('wacrm.t09apply.event_status', v_event_status::text, true);
  PERFORM set_config('wacrm.t09apply.token_a', v_token_a::text, true);
  PERFORM set_config('wacrm.t09apply.token_b', v_token_b::text, true);
  PERFORM set_config('wacrm.t09apply.token_a_second', v_token_a_second::text, true);
  PERFORM set_config('wacrm.t09apply.token_a_third', v_token_a_third::text, true);
  PERFORM set_config('wacrm.t09apply.token_rollback', v_token_rollback::text, true);
  PERFORM set_config('wacrm.t09apply.token_stale', v_token_stale::text, true);
  PERFORM set_config('wacrm.t09apply.token_expired', v_token_expired::text, true);
  PERFORM set_config('wacrm.t09apply.token_media', v_token_media::text, true);
END;
$fixture_setup$;

DO $rpc_security_assertions$
DECLARE
  v_proc regprocedure := 'public.apply_evolution_event(uuid,uuid)'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_proc AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
  ) OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'apply_evolution_event security attributes or grants do not match the contract';
  END IF;
END;
$rpc_security_assertions$;

SET LOCAL ROLE service_role;

DO $apply_assertions$
DECLARE
  v_account_a uuid := current_setting('wacrm.t09apply.account_a')::uuid;
  v_account_b uuid := current_setting('wacrm.t09apply.account_b')::uuid;
  v_connection_a uuid := current_setting('wacrm.t09apply.connection_a')::uuid;
  v_connection_b uuid := current_setting('wacrm.t09apply.connection_b')::uuid;
  v_automation_a uuid := current_setting('wacrm.t09apply.automation_a')::uuid;
  v_automation_b uuid := current_setting('wacrm.t09apply.automation_b')::uuid;
  v_flow_a uuid := current_setting('wacrm.t09apply.flow_a')::uuid;
  v_flow_b uuid := current_setting('wacrm.t09apply.flow_b')::uuid;
  v_ai_a uuid := current_setting('wacrm.t09apply.ai_a')::uuid;
  v_ai_b uuid := current_setting('wacrm.t09apply.ai_b')::uuid;
  v_event_a uuid := current_setting('wacrm.t09apply.event_a')::uuid;
  v_event_a_replay uuid := current_setting('wacrm.t09apply.event_a_replay')::uuid;
  v_event_a_second uuid := current_setting('wacrm.t09apply.event_a_second')::uuid;
  v_event_b uuid := current_setting('wacrm.t09apply.event_b')::uuid;
  v_event_rollback uuid := current_setting('wacrm.t09apply.event_rollback')::uuid;
  v_event_stale uuid := current_setting('wacrm.t09apply.event_stale')::uuid;
  v_event_expired uuid := current_setting('wacrm.t09apply.event_expired')::uuid;
  v_event_media uuid := current_setting('wacrm.t09apply.event_media')::uuid;
  v_event_status uuid := current_setting('wacrm.t09apply.event_status')::uuid;
  v_token_a uuid := current_setting('wacrm.t09apply.token_a')::uuid;
  v_token_b uuid := current_setting('wacrm.t09apply.token_b')::uuid;
  v_token_a_second uuid := current_setting('wacrm.t09apply.token_a_second')::uuid;
  v_token_a_third uuid := current_setting('wacrm.t09apply.token_a_third')::uuid;
  v_token_rollback uuid := current_setting('wacrm.t09apply.token_rollback')::uuid;
  v_token_stale uuid := current_setting('wacrm.t09apply.token_stale')::uuid;
  v_token_expired uuid := current_setting('wacrm.t09apply.token_expired')::uuid;
  v_token_media uuid := current_setting('wacrm.t09apply.token_media')::uuid;
  v_outcome text;
  v_message_id uuid;
  v_reply_at timestamptz;
  v_contact_a uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_message_count integer;
  v_root_count integer;
  v_message text;
BEGIN
  SELECT r.outcome, r.message_row_id, r.retry_at
    INTO v_outcome, v_message_id, v_reply_at
    FROM public.apply_evolution_event(v_event_a, v_token_a) AS r;
  IF v_outcome <> 'applied' OR v_message_id IS NULL OR v_reply_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_a AND e.state = 'done' AND e.lease_token IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.messages AS m WHERE m.id = v_message_id AND m.sender_type = 'customer'
       AND m.content_type = 'text' AND m.content_text = 'first inbound' AND m.status = 'sent'
       AND m.message_id = 't09-shared-external-id' AND m.provider_connection_id = v_connection_a
       AND m.created_at = '2026-11-16T18:00:00.000Z'::timestamptz) THEN
    RAISE EXCEPTION 'new inbound text was not atomically persisted with a done event';
  END IF;
  SELECT c.id INTO STRICT v_contact_a FROM public.contacts AS c
   WHERE c.account_id = v_account_a AND c.phone_normalized = '15550000011';
  SELECT c.id, c.last_message_text INTO STRICT v_conversation_a, v_message
    FROM public.conversations AS c WHERE c.account_id = v_account_a AND c.contact_id = v_contact_a;
  IF v_message <> 'first inbound' OR NOT EXISTS (
    SELECT 1 FROM public.conversations AS c WHERE c.id = v_conversation_a AND c.unread_count = 1
      AND c.last_message_at IS NOT NULL AND c.last_inbound_at = '2026-11-16T18:00:00.000Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'new inbound did not update preview, unread, and inbound timestamp';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a) <> 3
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a AND d.account_id = v_account_a
       AND d.engine = 'automation' AND d.automation_id = v_automation_a AND d.user_id = (SELECT a.user_id FROM public.automations AS a WHERE a.id = v_automation_a)
       AND d.contact_id = v_contact_a AND d.conversation_id = v_conversation_a)
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a AND d.engine = 'flow' AND d.flow_id = v_flow_a)
     OR NOT EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a AND d.engine = 'ai' AND d.ai_config_id = v_ai_a
       AND d.user_id = (SELECT a.created_by FROM public.ai_configs AS a WHERE a.id = v_ai_a)) THEN
    RAISE EXCEPTION 'active automation, flow, and authored AI roots were not created for the new message';
  END IF;

  SELECT r.outcome, r.message_row_id INTO v_outcome, v_message_id
    FROM public.apply_evolution_event(v_event_a, pg_catalog.gen_random_uuid()) AS r;
  IF v_outcome <> 'duplicate' OR v_message_id IS NULL
     OR (SELECT c.unread_count FROM public.conversations AS c WHERE c.id = v_conversation_a) <> 1
     OR (SELECT c.last_message_text FROM public.conversations AS c WHERE c.id = v_conversation_a) <> 'first inbound'
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a) <> 3 THEN
    RAISE EXCEPTION 'terminal replay changed unread, preview, or dispatch roots';
  END IF;

  SELECT r.outcome, r.message_row_id INTO v_outcome, v_message_id
    FROM public.apply_evolution_event(v_event_a_replay, v_token_a_second) AS r;
  IF v_outcome <> 'duplicate' OR v_message_id IS NULL
     OR (SELECT c.unread_count FROM public.conversations AS c WHERE c.id = v_conversation_a) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.messages AS m WHERE m.provider_connection_id = v_connection_a AND m.message_id = 't09-shared-external-id') <> 1
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a_replay) THEN
    RAISE EXCEPTION 'external message ID replay created a second message, unread bump, or roots';
  END IF;

  SELECT r.outcome INTO STRICT v_outcome
    FROM public.apply_evolution_event(v_event_a_second, v_token_a_third) AS r;
  IF v_outcome <> 'applied'
     OR (SELECT c.unread_count FROM public.conversations AS c WHERE c.id = v_conversation_a) <> 2
     OR (SELECT c.last_message_text FROM public.conversations AS c WHERE c.id = v_conversation_a) <> 'second inbound'
     OR (SELECT c.last_inbound_at FROM public.conversations AS c WHERE c.id = v_conversation_a) <> '2026-11-16T18:05:00.000Z'::timestamptz
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_a_second) <> 3 THEN
    RAISE EXCEPTION 'second inbound did not bump unread/preview or create one root per active definition';
  END IF;

  SELECT r.outcome INTO STRICT v_outcome
    FROM public.apply_evolution_event(v_event_b, v_token_b) AS r;
  SELECT c.id INTO STRICT v_conversation_b FROM public.conversations AS c
   WHERE c.account_id = v_account_b AND c.contact_id = (
     SELECT t.id FROM public.contacts AS t WHERE t.account_id = v_account_b AND t.phone_normalized = '15550000011'
   );
  IF v_outcome <> 'applied'
     OR (SELECT pg_catalog.count(*) FROM public.contacts AS c WHERE c.phone_normalized = '15550000011') <> 2
     OR (SELECT pg_catalog.count(*) FROM public.messages AS m WHERE m.message_id = 't09-shared-external-id') <> 2
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_b) <> 2
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_b AND d.account_id <> v_account_b)
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_b AND d.engine = 'ai' AND d.ai_config_id = v_ai_b)
     OR NOT EXISTS (SELECT 1 FROM public.conversations AS c WHERE c.id = v_conversation_b AND c.unread_count = 1
       AND c.last_message_text = 'account B inbound') THEN
    RAISE EXCEPTION 'account isolation or null AI creator policy was not preserved';
  END IF;

  BEGIN
    PERFORM r.outcome FROM public.apply_evolution_event(v_event_rollback, v_token_rollback) AS r;
    RAISE EXCEPTION 'T09.apply.rollback';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'T09.apply.rollback' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_rollback AND e.state = 'processing' AND e.lease_token = v_token_rollback)
     OR EXISTS (SELECT 1 FROM public.messages AS m WHERE m.provider_connection_id = v_connection_a AND m.message_id = 't09-rollback-id')
     OR EXISTS (SELECT 1 FROM public.contacts AS c WHERE c.account_id = v_account_a AND c.phone_normalized = '15550000099')
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches AS d WHERE d.event_id = v_event_rollback) THEN
    RAISE EXCEPTION 'apply rollback left partial contact, message, root, or event state';
  END IF;
  SELECT r.outcome INTO STRICT v_outcome FROM public.apply_evolution_event(v_event_rollback, v_token_rollback) AS r;
  IF v_outcome <> 'applied'
     OR (SELECT c.unread_count FROM public.conversations AS c WHERE c.account_id = v_account_a
          AND c.contact_id = (SELECT t.id FROM public.contacts AS t WHERE t.account_id = v_account_a AND t.phone_normalized = '15550000099')) <> 1 THEN
    RAISE EXCEPTION 'message did not apply after rollback probe (outcome %)', v_outcome;
  END IF;

  BEGIN
    PERFORM r.outcome FROM public.apply_evolution_event(v_event_stale, pg_catalog.gen_random_uuid()) AS r;
    RAISE EXCEPTION 'T09.apply.stale_token';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  BEGIN
    PERFORM r.outcome FROM public.apply_evolution_event(v_event_expired, v_token_expired) AS r;
    RAISE EXCEPTION 'T09.apply.expired_lease';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.messages AS m WHERE m.message_id IN ('t09-stale-id','t09-expired-id'))
     OR EXISTS (SELECT 1 FROM public.contacts AS c WHERE c.account_id = v_account_a AND c.phone_normalized IN ('15550000098','15550000097'))
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_stale AND e.state = 'processing' AND e.lease_token = v_token_stale)
     OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_expired AND e.state = 'processing' AND e.lease_token = v_token_expired) THEN
    RAISE EXCEPTION 'stale or expired lease mutated inbound data';
  END IF;

  SELECT r.outcome INTO STRICT v_outcome FROM public.apply_evolution_event(v_event_media, v_token_media) AS r;
  IF v_outcome <> 'failed' OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_media AND e.state = 'failed' AND e.last_error_code = 'unsupported_message_content')
     OR EXISTS (SELECT 1 FROM public.messages AS m WHERE m.message_id = 't09-media-id') THEN
    RAISE EXCEPTION 'unobserved media was not blocked without a message';
  END IF;
  SELECT r.outcome INTO STRICT v_outcome FROM public.apply_evolution_event(v_event_status, (SELECT e.lease_token FROM public.evolution_events AS e WHERE e.id = v_event_status)) AS r;
  IF v_outcome <> 'failed' OR NOT EXISTS (SELECT 1 FROM public.evolution_events AS e WHERE e.id = v_event_status AND e.state = 'failed' AND e.last_error_code = 'unsupported_event_kind') THEN
    RAISE EXCEPTION 'unobserved status event was not blocked';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d
       WHERE d.account_id = v_account_a AND d.event_id IN (v_event_a, v_event_a_second, v_event_rollback)) <> 9
     OR (SELECT pg_catalog.count(*) FROM public.evolution_event_dispatches AS d
       WHERE d.account_id = v_account_b AND d.event_id = v_event_b) <> 2 THEN
    RAISE EXCEPTION 'dispatch roots were duplicated, missing, or crossed accounts';
  END IF;
END;
$apply_assertions$;

RESET ROLE;
ROLLBACK;
