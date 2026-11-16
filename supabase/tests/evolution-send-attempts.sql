-- All fixture rows are synthetic and enclosed by BEGIN/ROLLBACK.
-- No evolution_events rows or real users/accounts/connections are mutated.

CREATE TEMP TABLE t06a3_snapshot_before (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_digest text NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.t06a3_snapshot_before
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.evolution_events', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_events AS t;

BEGIN;

-- RED before migration: this relation lookup must raise 42P01.
DO $target_relation_assertion$
BEGIN
  PERFORM e.id FROM public.evolution_send_attempts AS e LIMIT 1;
END;
$target_relation_assertion$;

DO $fixture_setup$
DECLARE
  v_user_one uuid := pg_catalog.gen_random_uuid();
  v_user_two uuid := pg_catalog.gen_random_uuid();
  v_account_one uuid;
  v_account_two uuid;
  v_contact_one uuid;
  v_contact_two uuid;
  v_connection_one uuid;
  v_connection_two uuid;
  v_conversation_one uuid;
  v_conversation_two uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_one, 'authenticated', 'authenticated', v_user_one::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.a3 synthetic account one"}'::jsonb),
    (v_user_two, 'authenticated', 'authenticated', v_user_two::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.a3 synthetic account two"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_one FROM public.profiles AS p WHERE p.user_id = v_user_one;
  SELECT p.account_id INTO STRICT v_account_two FROM public.profiles AS p WHERE p.user_id = v_user_two;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES
    (v_user_one, v_account_one, '+15550000001', 'T06.a3 synthetic one'),
    (v_user_two, v_account_two, '+15550000002', 'T06.a3 synthetic two');
  SELECT c.id INTO STRICT v_contact_one FROM public.contacts AS c WHERE c.account_id = v_account_one;
  SELECT c.id INTO STRICT v_contact_two FROM public.contacts AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_one, v_user_one, 'http://127.0.0.1:8080', 't06-a3-one-' || v_user_one::text,
     'synthetic-ciphertext-one', 'synthetic-webhook-one'),
    (v_account_two, v_user_two, 'http://127.0.0.1:8080', 't06-a3-two-' || v_user_two::text,
     'synthetic-ciphertext-two', 'synthetic-webhook-two');

  SELECT c.id INTO STRICT v_connection_one FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_one;
  SELECT c.id INTO STRICT v_connection_two FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES
    (v_user_one, v_account_one, v_contact_one, 'open'),
    (v_user_two, v_account_two, v_contact_two, 'open');
  SELECT c.id INTO STRICT v_conversation_one FROM public.conversations AS c WHERE c.account_id = v_account_one;
  SELECT c.id INTO STRICT v_conversation_two FROM public.conversations AS c WHERE c.account_id = v_account_two;

  PERFORM pg_catalog.set_config('wacrm.t06a3.user_one', v_user_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.user_two', v_user_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.account_one', v_account_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.account_two', v_account_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.connection_one', v_connection_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.connection_two', v_connection_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.conversation_one', v_conversation_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a3.conversation_two', v_conversation_two::text, true);
END;
$fixture_setup$;

DO $schema_security_assertions$
DECLARE
  v_columns name[];
  v_proc regprocedure := 'public.redeem_invitation(text)'::regprocedure;
BEGIN
  SELECT pg_catalog.array_agg(a.attname ORDER BY a.attnum)
    INTO v_columns
    FROM pg_catalog.pg_attribute AS a
   WHERE a.attrelid = 'public.evolution_send_attempts'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_columns IS DISTINCT FROM ARRAY[
    'id', 'account_id', 'connection_id', 'request_id', 'request_hash',
    'conversation_id', 'message_row_id', 'external_message_id', 'outcome',
    'error_code', 'created_at', 'updated_at'
  ]::name[] THEN
    RAISE EXCEPTION 'evolution_send_attempts does not have the exact 12-column contract';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.evolution_send_attempts'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p WHERE p.schemaname = 'public' AND p.tablename = 'evolution_send_attempts') THEN
    RAISE EXCEPTION 'evolution_send_attempts must have RLS enabled and zero policies';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c
       WHERE c.conrelid = 'public.evolution_send_attempts'::regclass AND c.contype = 'f') <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = 'public.evolution_send_attempts'::regclass AND c.conname = 'evolution_send_attempts_pkey' AND c.contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = 'public.evolution_send_attempts'::regclass AND c.conname = 'evolution_send_attempts_account_request_key' AND c.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS c WHERE c.conrelid = 'public.evolution_send_attempts'::regclass AND c.conname = 'evolution_send_attempts_outcome_check' AND c.contype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes AS i WHERE i.schemaname = 'public' AND i.indexname = 'evolution_send_attempts_connection_created_idx' AND i.indexdef ILIKE '%(connection_id, created_at DESC)%') THEN
    RAISE EXCEPTION 'evolution_send_attempts constraints or operational index do not match contract';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.evolution_send_attempts', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_send_attempts', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_send_attempts', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.evolution_send_attempts', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_send_attempts', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_send_attempts', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_send_attempts', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.evolution_send_attempts', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.evolution_send_attempts', 'DELETE') THEN
    RAISE EXCEPTION 'evolution_send_attempts grants do not restrict CRUD to service_role';
  END IF;
  IF pg_catalog.pg_get_userbyid((SELECT p.proowner FROM pg_catalog.pg_proc AS p WHERE p.oid = v_proc)) <> 'postgres'
     OR NOT pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_proc), 'evolution_send_attempts') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_proc), 'whatsapp_connections') = 0 THEN
    RAISE EXCEPTION 'redeem_invitation owner/grants/current data guards were not preserved';
  END IF;
END;
$schema_security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denials$
DECLARE
  v_statement text;
  v_denied boolean;
BEGIN
  FOREACH v_statement IN ARRAY ARRAY[
    'SELECT id FROM public.evolution_send_attempts LIMIT 1',
    'INSERT INTO public.evolution_send_attempts (account_id,connection_id,request_id,request_hash,conversation_id) VALUES (gen_random_uuid(),gen_random_uuid(),''anon'',''hash'',gen_random_uuid())',
    'UPDATE public.evolution_send_attempts SET outcome = ''accepted'' WHERE false',
    'DELETE FROM public.evolution_send_attempts WHERE false'
  ] LOOP
    v_denied := false;
    BEGIN
      EXECUTE v_statement;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'anon unexpectedly accessed evolution_send_attempts'; END IF;
  END LOOP;
END;
$anon_denials$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_denials$
DECLARE
  v_statement text;
  v_denied boolean;
BEGIN
  FOREACH v_statement IN ARRAY ARRAY[
    'SELECT id FROM public.evolution_send_attempts LIMIT 1',
    'INSERT INTO public.evolution_send_attempts (account_id,connection_id,request_id,request_hash,conversation_id) VALUES (gen_random_uuid(),gen_random_uuid(),''authenticated'',''hash'',gen_random_uuid())',
    'UPDATE public.evolution_send_attempts SET outcome = ''accepted'' WHERE false',
    'DELETE FROM public.evolution_send_attempts WHERE false'
  ] LOOP
    v_denied := false;
    BEGIN
      EXECUTE v_statement;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'authenticated unexpectedly accessed evolution_send_attempts'; END IF;
  END LOOP;
END;
$authenticated_denials$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $service_role_crud_and_constraints$
DECLARE
  v_account_one uuid := pg_catalog.current_setting('wacrm.t06a3.account_one')::uuid;
  v_account_two uuid := pg_catalog.current_setting('wacrm.t06a3.account_two')::uuid;
  v_connection_one uuid := pg_catalog.current_setting('wacrm.t06a3.connection_one')::uuid;
  v_connection_two uuid := pg_catalog.current_setting('wacrm.t06a3.connection_two')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06a3.conversation_one')::uuid;
  v_conversation_two uuid := pg_catalog.current_setting('wacrm.t06a3.conversation_two')::uuid;
  v_request_id text := 't06-a3-shared-' || pg_catalog.gen_random_uuid()::text;
  v_shared_one uuid;
  v_shared_two uuid;
  v_crud_id uuid;
  v_message_id uuid;
  v_missing uuid;
  v_constraint text;
BEGIN
  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, conversation_id, request_id, request_hash
  ) VALUES (
    v_account_one, v_connection_one, v_conversation_one, v_request_id, 'synthetic-hash-one'
  ) RETURNING id INTO v_shared_one;
  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_shared_one AND a.outcome = 'pending' AND a.message_row_id IS NULL
  ) THEN
    RAISE EXCEPTION 'service_role insert/select or pending/null defaults failed';
  END IF;

  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, request_id, request_hash
    ) VALUES (
      v_account_one, v_connection_one, v_conversation_one, v_request_id, 'different-hash'
    );
    RAISE EXCEPTION 'same-account reused request_id was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, conversation_id, request_id, request_hash
  ) VALUES (
    v_account_two, v_connection_two, v_conversation_two, v_request_id, 'synthetic-hash-two'
  ) RETURNING id INTO v_shared_two;
  IF v_shared_two = v_shared_one OR NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_shared_two AND a.account_id = v_account_two AND a.request_id = v_request_id
  ) THEN
    RAISE EXCEPTION 'same request_id was not independently reusable in another account';
  END IF;

  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, request_id, request_hash, outcome
    ) VALUES (
      v_account_one, v_connection_one, v_conversation_one,
      't06-a3-invalid-' || pg_catalog.gen_random_uuid()::text, 'synthetic-hash', 'queued'
    );
    RAISE EXCEPTION 'invalid outcome was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'evolution_send_attempts_outcome_check' THEN RAISE; END IF;
  END;

  v_missing := pg_catalog.gen_random_uuid();
  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, request_id, request_hash
    ) VALUES (
      v_missing, v_connection_one, v_conversation_one,
      't06-a3-fk-account-' || pg_catalog.gen_random_uuid()::text, 'synthetic-hash'
    );
    RAISE EXCEPTION 'missing account FK was accepted';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'evolution_send_attempts_account_fkey' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, request_id, request_hash
    ) VALUES (
      v_account_one, v_missing, v_conversation_one,
      't06-a3-fk-connection-' || pg_catalog.gen_random_uuid()::text, 'synthetic-hash'
    );
    RAISE EXCEPTION 'missing connection FK was accepted';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'evolution_send_attempts_connection_fkey' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, request_id, request_hash
    ) VALUES (
      v_account_one, v_connection_one, v_missing,
      't06-a3-fk-conversation-' || pg_catalog.gen_random_uuid()::text, 'synthetic-hash'
    );
    RAISE EXCEPTION 'missing conversation FK was accepted';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'evolution_send_attempts_conversation_fkey' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.evolution_send_attempts (
      account_id, connection_id, conversation_id, message_row_id, request_id, request_hash
    ) VALUES (
      v_account_one, v_connection_one, v_conversation_one, v_missing,
      't06-a3-fk-message-' || pg_catalog.gen_random_uuid()::text, 'synthetic-hash'
    );
    RAISE EXCEPTION 'missing message FK was accepted';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'evolution_send_attempts_message_row_fkey' THEN RAISE; END IF;
  END;

  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text)
  VALUES (v_conversation_one, 'agent', 'text', 'synthetic T06.a3 rollback fixture')
  RETURNING id INTO v_message_id;
  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, conversation_id, message_row_id, request_id, request_hash
  ) VALUES (
    v_account_one, v_connection_one, v_conversation_one, v_message_id,
    't06-a3-message-link-' || pg_catalog.gen_random_uuid()::text, 'synthetic-message-hash'
  ) RETURNING id INTO v_crud_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_crud_id AND a.message_row_id = v_message_id
  ) THEN
    RAISE EXCEPTION 'present message FK was not stored';
  END IF;
  DELETE FROM public.messages AS m WHERE m.id = v_message_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_crud_id AND a.message_row_id IS NULL
  ) THEN
    RAISE EXCEPTION 'message deletion did not set the optional FK to null';
  END IF;

  INSERT INTO public.evolution_send_attempts (
    account_id, connection_id, conversation_id, request_id, request_hash
  ) VALUES (
    v_account_two, v_connection_two, v_conversation_two,
    't06-a3-service-crud-' || pg_catalog.gen_random_uuid()::text, 'synthetic-crud-hash'
  ) RETURNING id INTO v_crud_id;
  UPDATE public.evolution_send_attempts AS a
     SET outcome = 'accepted', external_message_id = 'synthetic-external-id'
   WHERE a.id = v_crud_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_send_attempts AS a
     WHERE a.id = v_crud_id AND a.outcome = 'accepted' AND a.external_message_id = 'synthetic-external-id'
  ) THEN
    RAISE EXCEPTION 'service_role update/select failed';
  END IF;
  DELETE FROM public.evolution_send_attempts AS a WHERE a.id = v_crud_id;
  IF EXISTS (SELECT 1 FROM public.evolution_send_attempts AS a WHERE a.id = v_crud_id) THEN
    RAISE EXCEPTION 'service_role delete failed';
  END IF;
END;
$service_role_crud_and_constraints$;
RESET ROLE;

ROLLBACK;

CREATE TEMP TABLE t06a3_snapshot_after (LIKE pg_temp.t06a3_snapshot_before INCLUDING ALL) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.t06a3_snapshot_after
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.evolution_events', count(*), md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id), '')) FROM public.evolution_events AS t;

DO $rollback_snapshot_assertion$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.t06a3_snapshot_before AS b
    FULL JOIN pg_temp.t06a3_snapshot_after AS a USING (table_name)
    WHERE b.row_count IS DISTINCT FROM a.row_count
       OR b.row_digest IS DISTINCT FROM a.row_digest
  ) THEN
    RAISE EXCEPTION 'T06.a3 rollback changed a protected-table snapshot';
  END IF;
  RAISE NOTICE 'T06.a3 PASS: rollback preserved users/accounts/connections/conversations/messages/events snapshots';
END;
$rollback_snapshot_assertion$;

DROP TABLE pg_temp.t06a3_snapshot_after;
DROP TABLE pg_temp.t06a3_snapshot_before;
