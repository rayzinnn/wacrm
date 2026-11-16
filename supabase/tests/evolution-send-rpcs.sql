-- Synthetic fixtures only. Functional cases are enclosed in one rollback-only
-- transaction and never create evolution_events or call an external provider.

CREATE TEMP TABLE t06c1_snapshot_before (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_digest text NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.t06c1_snapshot_before
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.provider || '|' || t.base_url || '|' || t.instance_name, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.evolution_send_attempts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_send_attempts AS t
UNION ALL
SELECT 'public.evolution_events', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.connection_id::text || '|' || t.event_key || '|' || t.normalized_event::text || '|' || t.created_at::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_events AS t;

BEGIN;

-- RED before the RPC migration: signatures are intentionally checked first.
DO $rpc_presence_assertion$
BEGIN
  IF pg_catalog.to_regprocedure('public.reserve_evolution_send(uuid,text,text,uuid,text,uuid,jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('public.complete_evolution_send(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'T06.c1 send RPCs are missing';
  END IF;
END;
$rpc_presence_assertion$;

DO $fixture_setup$
DECLARE
  v_user_one uuid := pg_catalog.gen_random_uuid();
  v_user_two uuid := pg_catalog.gen_random_uuid();
  v_account_one uuid;
  v_account_two uuid;
  v_contact_one uuid;
  v_contact_one_two uuid;
  v_contact_two uuid;
  v_connection_one uuid;
  v_connection_two uuid;
  v_conversation_one uuid;
  v_conversation_one_two uuid;
  v_conversation_two uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_one, 'authenticated', 'authenticated', v_user_one::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.c1 synthetic account one"}'::jsonb),
    (v_user_two, 'authenticated', 'authenticated', v_user_two::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.c1 synthetic account two"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_one FROM public.profiles AS p WHERE p.user_id = v_user_one;
  SELECT p.account_id INTO STRICT v_account_two FROM public.profiles AS p WHERE p.user_id = v_user_two;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES
    (v_user_one, v_account_one, '+15550000011', 'T06.c1 synthetic one'),
    (v_user_one, v_account_one, '+15550000012', 'T06.c1 synthetic one two'),
    (v_user_two, v_account_two, '+15550000013', 'T06.c1 synthetic two');
  SELECT c.id INTO STRICT v_contact_one FROM public.contacts AS c WHERE c.account_id = v_account_one AND c.name = 'T06.c1 synthetic one';
  SELECT c.id INTO STRICT v_contact_one_two FROM public.contacts AS c WHERE c.account_id = v_account_one AND c.name = 'T06.c1 synthetic one two';
  SELECT c.id INTO STRICT v_contact_two FROM public.contacts AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_one, v_user_one, 'http://127.0.0.1:8080', 't06-c1-one-' || v_user_one::text,
     'synthetic-ciphertext-one', 'synthetic-webhook-one'),
    (v_account_two, v_user_two, 'http://127.0.0.1:8080', 't06-c1-two-' || v_user_two::text,
     'synthetic-ciphertext-two', 'synthetic-webhook-two');
  SELECT c.id INTO STRICT v_connection_one FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_one;
  SELECT c.id INTO STRICT v_connection_two FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES
    (v_user_one, v_account_one, v_contact_one, 'open'),
    (v_user_one, v_account_one, v_contact_one_two, 'open'),
    (v_user_two, v_account_two, v_contact_two, 'open');
  SELECT c.id INTO STRICT v_conversation_one FROM public.conversations AS c WHERE c.account_id = v_account_one AND c.contact_id = v_contact_one;
  SELECT c.id INTO STRICT v_conversation_one_two FROM public.conversations AS c WHERE c.account_id = v_account_one AND c.contact_id = v_contact_one_two;
  SELECT c.id INTO STRICT v_conversation_two FROM public.conversations AS c WHERE c.account_id = v_account_two;

  PERFORM pg_catalog.set_config('wacrm.t06c1.user_one', v_user_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.user_two', v_user_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.account_one', v_account_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.account_two', v_account_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.connection_one', v_connection_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.connection_two', v_connection_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.conversation_one', v_conversation_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.conversation_one_two', v_conversation_one_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06c1.conversation_two', v_conversation_two::text, true);
END;
$fixture_setup$;

DO $catalog_and_acl_assertions$
DECLARE
  v_reserve regprocedure := 'public.reserve_evolution_send(uuid,text,text,uuid,text,uuid,jsonb)'::regprocedure;
  v_complete regprocedure := 'public.complete_evolution_send(uuid,text,text,text)'::regprocedure;
  v_guard regprocedure := 'public.guard_message_provider_connection_namespace()'::regprocedure;
  v_tracker regprocedure := 'public.track_conversation_message_times()'::regprocedure;
  v_reserve_def text;
  v_complete_def text;
  v_reserve_conversation_pos integer;
  v_reserve_attempt_pos integer;
  v_complete_connection_pos integer;
  v_complete_conversation_pos integer;
  v_complete_attempt_pos integer;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_reserve AND NOT p.prosecdef
          AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_complete AND NOT p.prosecdef
          AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     ) THEN
    RAISE EXCEPTION 'send RPCs must be SECURITY INVOKER with fixed search_path';
  END IF;

  v_reserve_def := pg_catalog.pg_get_functiondef(v_reserve);
  v_complete_def := pg_catalog.pg_get_functiondef(v_complete);
  v_reserve_conversation_pos := pg_catalog.strpos(v_reserve_def, 'T06.c1 lock-order: connection is locked above');
  v_reserve_attempt_pos := pg_catalog.strpos(v_reserve_def, 'T06.c1 lock-order: attempt follows the conversation lock');
  v_complete_connection_pos := pg_catalog.strpos(v_complete_def, 'T06.c1 lock-order 1: connection');
  v_complete_conversation_pos := pg_catalog.strpos(v_complete_def, 'T06.c1 lock-order 2: conversation FOR UPDATE');
  v_complete_attempt_pos := pg_catalog.strpos(v_complete_def, 'T06.c1 lock-order 3: attempt');
  IF v_reserve_conversation_pos = 0 OR v_reserve_attempt_pos <= v_reserve_conversation_pos
     OR v_complete_connection_pos = 0
     OR v_complete_conversation_pos <= v_complete_connection_pos
     OR v_complete_attempt_pos <= v_complete_conversation_pos THEN
    RAISE EXCEPTION 'reserve/complete lock order must be connection, conversation, attempt';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_reserve, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_complete, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_reserve, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_reserve, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_complete, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_complete, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
        WHERE p.oid IN (v_reserve, v_complete)
          AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'send RPC EXECUTE must be restricted to service_role';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_guard, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_guard, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_guard, 'EXECUTE') THEN
    RAISE EXCEPTION 'namespace guard EXECUTE ACL was not restricted';
  END IF;

  IF pg_catalog.pg_get_userbyid((SELECT p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = v_tracker)) <> 'postgres'
     OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc AS p WHERE p.oid = v_tracker)
     OR NOT (SELECT p.proconfig @> ARRAY['search_path=public'] FROM pg_catalog.pg_proc AS p WHERE p.oid = v_tracker)
     OR NOT pg_catalog.has_function_privilege('service_role', v_tracker, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_tracker, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_tracker, 'EXECUTE') THEN
    RAISE EXCEPTION 'existing message-time trigger owner/grants/security attributes changed';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.evolution_send_attempts'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p WHERE p.schemaname = 'public' AND p.tablename = 'evolution_send_attempts')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_send_attempts', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_send_attempts', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'UPDATE') THEN
    RAISE EXCEPTION 'send attempt table RLS/grants changed unexpectedly';
  END IF;
END;
$catalog_and_acl_assertions$;

SET LOCAL ROLE anon;
DO $anon_rpc_denial$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM r.attempt_id
      FROM public.reserve_evolution_send(
        pg_catalog.gen_random_uuid(), 'anon', pg_catalog.repeat('a', 64), pg_catalog.gen_random_uuid(),
        'agent', pg_catalog.gen_random_uuid(), '{"content_type":"text"}'::jsonb
      ) AS r;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'anon executed reserve_evolution_send'; END IF;
END;
$anon_rpc_denial$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_legacy_and_rpc_denial$
DECLARE
  v_user_one uuid := pg_catalog.current_setting('wacrm.t06c1.user_one')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06c1.conversation_one')::uuid;
  v_message_id uuid;
  v_denied boolean := false;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_one::text, true);
  BEGIN
    PERFORM r.attempt_id
      FROM public.reserve_evolution_send(
        pg_catalog.gen_random_uuid(), 'authenticated', pg_catalog.repeat('a', 64), pg_catalog.gen_random_uuid(),
        'agent', v_user_one, '{"content_type":"text"}'::jsonb
      ) AS r;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated executed reserve_evolution_send'; END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text, status, created_at
  ) VALUES (
    v_conversation_one, 'agent', v_user_one, 'text', 'T06.c1 legacy authenticated insert', 'sent',
    pg_catalog.clock_timestamp() - interval '5 minutes'
  ) RETURNING id INTO v_message_id;
  UPDATE public.messages
     SET content_text = 'T06.c1 legacy authenticated edit'
   WHERE id = v_message_id AND provider_connection_id IS NULL;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_message_id AND m.provider_connection_id IS NULL
       AND m.content_text = 'T06.c1 legacy authenticated edit'
  ) THEN
    RAISE EXCEPTION 'legacy authenticated INSERT/UPDATE failed after guard EXECUTE revoke';
  END IF;
  PERFORM pg_catalog.set_config('wacrm.t06c1.legacy_message_id', v_message_id::text, true);
END;
$authenticated_legacy_and_rpc_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $send_rpc_assertions$
DECLARE
  v_user_one uuid := pg_catalog.current_setting('wacrm.t06c1.user_one')::uuid;
  v_user_two uuid := pg_catalog.current_setting('wacrm.t06c1.user_two')::uuid;
  v_account_one uuid := pg_catalog.current_setting('wacrm.t06c1.account_one')::uuid;
  v_connection_one uuid := pg_catalog.current_setting('wacrm.t06c1.connection_one')::uuid;
  v_connection_two uuid := pg_catalog.current_setting('wacrm.t06c1.connection_two')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06c1.conversation_one')::uuid;
  v_conversation_one_two uuid := pg_catalog.current_setting('wacrm.t06c1.conversation_one_two')::uuid;
  v_conversation_two uuid := pg_catalog.current_setting('wacrm.t06c1.conversation_two')::uuid;
  v_legacy_message_id uuid := pg_catalog.current_setting('wacrm.t06c1.legacy_message_id')::uuid;
  v_hash text := pg_catalog.repeat('a', 64);
  v_main_request text := 't06-c1-main-' || pg_catalog.gen_random_uuid()::text;
  v_main_payload jsonb := '{"content_type":"text","content_text":"main lifecycle fixture"}'::jsonb;
  v_attempt_id uuid;
  v_message_id uuid;
  v_outcome text;
  v_should_send boolean;
  v_main_external_id text := 't06-c1-remote-' || pg_catalog.gen_random_uuid()::text;
  v_main_metric timestamptz;
  v_baseline_metric timestamptz;
  v_reject_attempt uuid;
  v_reject_message uuid;
  v_unknown_attempt uuid;
  v_unknown_message uuid;
  v_collision_attempt uuid;
  v_collision_message uuid;
  v_cross_account_attempt uuid;
  v_cross_account_message uuid;
  v_bad_payload jsonb;
  v_bad_request text;
  v_bad_hash text;
  v_denied boolean;
BEGIN
  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text, status, created_at
  ) VALUES (
    v_conversation_one, 'agent', v_user_one, 'text', 'T06.c1 response metric baseline', 'sent',
    pg_catalog.clock_timestamp()
  );
  SELECT c.last_reply_at INTO STRICT v_baseline_metric
    FROM public.conversations AS c WHERE c.id = v_conversation_one;

  SELECT r.attempt_id, r.message_row_id, r.outcome, r.should_send
    INTO v_attempt_id, v_message_id, v_outcome, v_should_send
    FROM public.reserve_evolution_send(
      v_connection_one, v_main_request, pg_catalog.upper(v_hash), v_conversation_one,
      'agent', v_user_one, v_main_payload
    ) AS r;
  IF v_attempt_id IS NULL OR v_message_id IS NULL OR v_outcome <> 'pending' OR NOT v_should_send THEN
    RAISE EXCEPTION 'initial reserve did not create one pending winner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_message_id AND m.conversation_id = v_conversation_one
       AND m.provider_connection_id = v_connection_one AND m.sender_type = 'agent'
       AND m.sender_id = v_user_one AND m.content_type = 'text'
       AND m.content_text = 'main lifecycle fixture' AND m.message_id IS NULL
       AND m.status = 'sending' AND NOT m.ai_generated
  ) OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_attempt_id AND a.account_id = v_account_one
       AND a.connection_id = v_connection_one AND a.conversation_id = v_conversation_one
       AND a.message_row_id = v_message_id AND a.request_hash = v_hash
       AND a.outcome = 'pending'
  ) THEN
    RAISE EXCEPTION 'reserve did not atomically link attempt and sending message';
  END IF;
  IF (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_baseline_metric THEN
    RAISE EXCEPTION 'Evolution sending reservation advanced last_reply_at';
  END IF;

  SELECT r.attempt_id, r.message_row_id, r.outcome, r.should_send
    INTO v_attempt_id, v_message_id, v_outcome, v_should_send
    FROM public.reserve_evolution_send(
      v_connection_one, v_main_request, v_hash, v_conversation_one,
      'agent', v_user_one, v_main_payload
    ) AS r;
  IF v_outcome <> 'pending' OR v_should_send OR v_attempt_id IS NULL OR v_message_id IS NULL THEN
    RAISE EXCEPTION 'same account/request/hash did not replay the existing reservation';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_one, v_main_request, pg_catalog.repeat('b', 64), v_conversation_one,
      'agent', v_user_one, v_main_payload
    ) AS r;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'request_id with divergent hash was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_one, v_main_request, v_hash, v_conversation_one_two,
      'agent', v_user_one, v_main_payload
    ) AS r;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'request_id with divergent conversation was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_two, 't06-c1-cross-connection-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one, 'agent', v_user_one, v_main_payload
    ) AS r;
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'cross-account connection/conversation reserve was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-cross-author-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one, 'agent', v_user_two, v_main_payload
    ) AS r;
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'cross-account author was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-invalid-sender-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one, 'customer', v_user_one, v_main_payload
    ) AS r;
  EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'customer sender type was accepted for outbound reserve'; END IF;

  FOR v_bad_payload IN
    SELECT p.value
      FROM pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(
      '{}'::jsonb,
      '{"content_type":"image"}'::jsonb,
      '{"content_type":"text","unexpected":true}'::jsonb,
      '{"content_type":"text","content_text":12}'::jsonb,
      '{"content_type":"text","media_url":"https://invalid.example/file"}'::jsonb,
      '{"content_type":"text","media_type":"image/png"}'::jsonb,
      '{"content_type":"text","template_name":"disabled"}'::jsonb,
      '{"content_type":"text","interactive_reply_id":"disabled"}'::jsonb,
      '{"content_type":"text","interactive_payload":{}}'::jsonb,
      '{"content_type":"text","ai_generated":null}'::jsonb,
      '{"content_type":"text","ai_generated":"true"}'::jsonb,
      '{"content_type":"text","reply_to_message_id":12}'::jsonb,
      '{"content_type":"text","reply_to_message_id":"invalid-uuid"}'::jsonb,
      '[]'::jsonb,
      'null'::jsonb
    )) AS p(value)
  LOOP
    v_denied := false;
    BEGIN
      PERFORM r.attempt_id FROM public.reserve_evolution_send(
        v_connection_one, 't06-c1-invalid-payload-' || pg_catalog.gen_random_uuid()::text,
        v_hash, v_conversation_one, 'agent', v_user_one, v_bad_payload
      ) AS r;
    EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'invalid or unsupported payload was accepted'; END IF;
  END LOOP;

  FOR v_bad_request IN SELECT pg_catalog.unnest(ARRAY['', '   ', pg_catalog.repeat('x', 201)])
  LOOP
    v_denied := false;
    BEGIN
      PERFORM r.attempt_id FROM public.reserve_evolution_send(
        v_connection_one, v_bad_request, v_hash, v_conversation_one,
        'agent', v_user_one, v_main_payload
      ) AS r;
    EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'empty or oversized request_id was accepted'; END IF;
  END LOOP;

  FOR v_bad_hash IN SELECT pg_catalog.unnest(ARRAY['', pg_catalog.repeat('a', 63), pg_catalog.repeat('g', 64)])
  LOOP
    v_denied := false;
    BEGIN
      PERFORM r.attempt_id FROM public.reserve_evolution_send(
        v_connection_one, 't06-c1-invalid-hash-' || pg_catalog.gen_random_uuid()::text,
        v_bad_hash, v_conversation_one, 'agent', v_user_one, v_main_payload
      ) AS r;
    EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'non-SHA256-hex request_hash was accepted'; END IF;
  END LOOP;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-bad-reply-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one_two, 'agent', v_user_one,
      pg_catalog.jsonb_build_object('content_type', 'text', 'reply_to_message_id', v_legacy_message_id::text)
    ) AS r;
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'reply target from another conversation was accepted'; END IF;

  UPDATE public.evolution_send_attempts AS a
     SET created_at = pg_catalog.clock_timestamp() - interval '121 seconds'
   WHERE a.id = v_attempt_id;
  SELECT r.attempt_id, r.message_row_id, r.outcome, r.should_send
    INTO v_attempt_id, v_message_id, v_outcome, v_should_send
    FROM public.reserve_evolution_send(
      v_connection_one, v_main_request, v_hash, v_conversation_one,
      'agent', v_user_one, v_main_payload
    ) AS r;
  IF v_outcome <> 'unknown' OR v_should_send OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_attempt_id AND a.error_code = 'pending_expired'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_message_id AND m.status = 'sending' AND m.message_id IS NULL
  ) OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_baseline_metric THEN
    RAISE EXCEPTION 'stale pending replay did not become unknown without resending or changing response time';
  END IF;

  UPDATE public.messages AS m
     SET created_at = pg_catalog.clock_timestamp() + interval '1 hour'
   WHERE m.id = v_message_id;
  SELECT r.attempt_id, r.outcome, r.message_row_id
    INTO v_attempt_id, v_outcome, v_message_id
    FROM public.complete_evolution_send(v_attempt_id, 'accepted', v_main_external_id, NULL) AS r;
  IF v_outcome <> 'accepted' OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_message_id AND m.status = 'sent'
       AND m.message_id = v_main_external_id AND m.provider_connection_id = v_connection_one
       AND m.error_code IS NULL AND m.error_title IS NULL AND m.error_details IS NULL
  ) THEN
    RAISE EXCEPTION 'unknown reconciliation to accepted did not set remote ID and sent state safely';
  END IF;
  SELECT c.last_reply_at INTO STRICT v_main_metric
    FROM public.conversations AS c WHERE c.id = v_conversation_one;
  IF v_main_metric <> (SELECT m.created_at FROM public.messages AS m WHERE m.id = v_message_id)
     OR v_main_metric IS NOT DISTINCT FROM v_baseline_metric THEN
    RAISE EXCEPTION 'Evolution accepted transition did not advance response metric from message created_at';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.complete_evolution_send(v_attempt_id, 'accepted', '', NULL) AS r;
  EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'empty accepted external ID was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.complete_evolution_send(v_attempt_id, 'rejected', NULL, 'different_terminal') AS r;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_denied := true;
  END;
  IF NOT v_denied OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_attempt_id AND a.outcome = 'accepted' AND a.external_message_id = v_main_external_id
  ) THEN
    RAISE EXCEPTION 'conflicting terminal completion changed an accepted attempt';
  END IF;

  UPDATE public.messages AS m SET status = 'delivered' WHERE m.id = v_message_id;
  UPDATE public.messages AS m SET status = 'read' WHERE m.id = v_message_id;
  PERFORM r.attempt_id FROM public.complete_evolution_send(v_attempt_id, 'accepted', v_main_external_id, NULL) AS r;
  IF (SELECT m.status FROM public.messages AS m WHERE m.id = v_message_id) <> 'read'
     OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_main_metric THEN
    RAISE EXCEPTION 'accepted replay regressed read status or response metric';
  END IF;

  SELECT r.attempt_id, r.message_row_id INTO v_reject_attempt, v_reject_message
    FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-rejected-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one, 'agent', v_user_one,
      '{"content_type":"text","content_text":"rejected fixture"}'::jsonb
    ) AS r;
  UPDATE public.messages AS m SET created_at = pg_catalog.clock_timestamp() + interval '2 hours' WHERE m.id = v_reject_message;
  SELECT r.outcome INTO v_outcome
    FROM public.complete_evolution_send(v_reject_attempt, 'rejected', NULL, 'provider body with secret') AS r;
  IF v_outcome <> 'rejected' OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_reject_attempt AND a.outcome = 'rejected' AND a.error_code = 'worker_error'
       AND a.external_message_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_reject_message AND m.status = 'failed' AND m.error_code IS NULL
       AND m.error_title IS NULL AND m.error_details IS NULL
  ) OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_main_metric THEN
    RAISE EXCEPTION 'rejection was not sanitized or advanced response metric';
  END IF;
  PERFORM r.attempt_id FROM public.complete_evolution_send(v_reject_attempt, 'rejected', NULL, 'provider body with secret') AS r;

  SELECT r.attempt_id, r.message_row_id INTO v_unknown_attempt, v_unknown_message
    FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-unknown-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one, 'agent', v_user_one,
      pg_catalog.jsonb_build_object(
        'content_type', 'text', 'content_text', NULL, 'ai_generated', true,
        'reply_to_message_id', v_legacy_message_id::text,
        'media_url', NULL, 'media_type', NULL, 'template_name', NULL,
        'interactive_reply_id', NULL, 'interactive_payload', NULL
      )
    ) AS r;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_unknown_message AND m.ai_generated
       AND m.content_text IS NULL AND m.reply_to_message_id = v_legacy_message_id
       AND m.status = 'sending'
  ) THEN
    RAISE EXCEPTION 'optional NULL fields, ai_generated or same-conversation reply-to were not preserved';
  END IF;
  UPDATE public.messages AS m SET created_at = pg_catalog.clock_timestamp() + interval '3 hours' WHERE m.id = v_unknown_message;
  SELECT r.outcome INTO v_outcome
    FROM public.complete_evolution_send(v_unknown_attempt, 'unknown', NULL, 'timeout response with secret') AS r;
  IF v_outcome <> 'unknown' OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_unknown_attempt AND a.outcome = 'unknown' AND a.error_code = 'worker_error'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m WHERE m.id = v_unknown_message AND m.status = 'sending' AND m.message_id IS NULL
  ) OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_main_metric THEN
    RAISE EXCEPTION 'unknown outcome changed the message or response metric';
  END IF;
  PERFORM r.attempt_id FROM public.complete_evolution_send(v_unknown_attempt, 'unknown', NULL, 'timeout response with secret') AS r;
  SELECT r.outcome INTO v_outcome
    FROM public.complete_evolution_send(v_unknown_attempt, 'rejected', NULL, 'retry_exhausted') AS r;
  IF v_outcome <> 'rejected' OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m WHERE m.id = v_unknown_message AND m.status = 'failed'
  ) OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_main_metric THEN
    RAISE EXCEPTION 'unknown to rejected reconciliation changed response metric';
  END IF;

  SELECT r.attempt_id, r.message_row_id INTO v_collision_attempt, v_collision_message
    FROM public.reserve_evolution_send(
      v_connection_one, 't06-c1-id-collision-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_one_two, 'agent', v_user_one,
      '{"content_type":"text","content_text":"remote ID collision fixture"}'::jsonb
    ) AS r;
  UPDATE public.messages AS m
     SET created_at = pg_catalog.clock_timestamp() + interval '2 hours', status = 'delivered'
   WHERE m.id = v_collision_message;
  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.complete_evolution_send(v_collision_attempt, 'accepted', v_main_external_id, NULL) AS r;
  EXCEPTION WHEN SQLSTATE '23505' THEN v_denied := true;
  END;
  IF NOT v_denied OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a WHERE a.id = v_collision_attempt AND a.outcome = 'pending'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m WHERE m.id = v_collision_message AND m.message_id IS NULL AND m.status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'external ID collision did not atomically roll back the attempt/message update';
  END IF;
  PERFORM r.attempt_id
    FROM public.complete_evolution_send(v_collision_attempt, 'accepted', 't06-c1-remote-' || pg_catalog.gen_random_uuid()::text, NULL) AS r;
  IF (SELECT m.status FROM public.messages AS m WHERE m.id = v_collision_message) <> 'delivered'
     OR (SELECT m.message_id FROM public.messages AS m WHERE m.id = v_collision_message) IS NULL THEN
    RAISE EXCEPTION 'accepted completion regressed a previously delivered message';
  END IF;

  SELECT r.attempt_id, r.message_row_id INTO v_cross_account_attempt, v_cross_account_message
    FROM public.reserve_evolution_send(
      v_connection_two, 't06-c1-other-connection-' || pg_catalog.gen_random_uuid()::text,
      v_hash, v_conversation_two, 'bot', v_user_two,
      '{"content_type":"text","content_text":"other connection namespace fixture"}'::jsonb
    ) AS r;
  PERFORM r.attempt_id
    FROM public.complete_evolution_send(v_cross_account_attempt, 'accepted', v_main_external_id, NULL) AS r;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_cross_account_message AND m.provider_connection_id = v_connection_two
       AND m.sender_type = 'bot' AND NOT m.ai_generated
       AND m.message_id = v_main_external_id AND m.status = 'sent'
  ) OR (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_two) IS NULL THEN
    RAISE EXCEPTION 'external ID was incorrectly treated as global across connections';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.complete_evolution_send(v_collision_attempt, 'accepted', 'pending', NULL) AS r;
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23505' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'terminal accepted attempt accepted a different external ID'; END IF;

  v_denied := false;
  BEGIN
    PERFORM r.attempt_id FROM public.complete_evolution_send(v_collision_attempt, 'pending', NULL, NULL) AS r;
  EXCEPTION WHEN SQLSTATE '22023' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'pending is not a valid completion outcome'; END IF;

  UPDATE public.messages AS m SET status = 'failed' WHERE m.id = v_message_id;
  IF (SELECT c.last_reply_at FROM public.conversations AS c WHERE c.id = v_conversation_one) IS DISTINCT FROM v_baseline_metric THEN
    RAISE EXCEPTION 'failing accepted Evolution response did not recompute to legacy non-failed response';
  END IF;
END;
$send_rpc_assertions$;
RESET ROLE;

ROLLBACK;

CREATE TEMP TABLE t06c1_snapshot_after (LIKE pg_temp.t06c1_snapshot_before INCLUDING ALL) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.t06c1_snapshot_after
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.provider || '|' || t.base_url || '|' || t.instance_name, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.evolution_send_attempts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_send_attempts AS t
UNION ALL
SELECT 'public.evolution_events', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.connection_id::text || '|' || t.event_key || '|' || t.normalized_event::text || '|' || t.created_at::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_events AS t;

DO $rollback_snapshot_assertion$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.t06c1_snapshot_before AS b
    FULL JOIN pg_temp.t06c1_snapshot_after AS a USING (table_name)
    WHERE b.row_count IS DISTINCT FROM a.row_count
       OR b.row_digest IS DISTINCT FROM a.row_digest
  ) THEN
    RAISE EXCEPTION 'T06.c1 rollback changed a protected data snapshot';
  END IF;
  RAISE NOTICE 'T06.c1 PASS: rollback preserved user/account/connection/conversation/message/attempt/event snapshots';
END;
$rollback_snapshot_assertion$;

DROP TABLE pg_temp.t06c1_snapshot_after;
DROP TABLE pg_temp.t06c1_snapshot_before;
