-- All rows are synthetic and rollback-only. This test never writes
-- evolution_events or touches the configured WhatsApp connection.

CREATE TEMP TABLE t06a4_snapshot_before (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_digest text NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.t06a4_snapshot_before
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(t.id::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.owner_user_id::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.base_url || '|' || t.instance_name, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text || '|' || t.contact_id::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.conversation_id::text || '|' || COALESCE(t.message_id, '') || '|' || COALESCE(t.provider_connection_id::text, '') || '|' || t.status, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.pending_message_statuses', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.wamid || '|' || t.status || '|' || COALESCE(t.provider_connection_id::text, ''), E'\n' ORDER BY t.id), '')) FROM public.pending_message_statuses AS t;

BEGIN;

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
  v_conversation_two uuid;
  v_conversation_three uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_one, 'authenticated', 'authenticated', v_user_one::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.a4 synthetic account one"}'::jsonb),
    (v_user_two, 'authenticated', 'authenticated', v_user_two::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.a4 synthetic account two"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_one FROM public.profiles AS p WHERE p.user_id = v_user_one;
  SELECT p.account_id INTO STRICT v_account_two FROM public.profiles AS p WHERE p.user_id = v_user_two;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES
    (v_user_one, v_account_one, '+15550000001', 'T06.a4 synthetic one'),
    (v_user_one, v_account_one, '+15550000003', 'T06.a4 synthetic one two'),
    (v_user_two, v_account_two, '+15550000002', 'T06.a4 synthetic two');
  SELECT c.id INTO STRICT v_contact_one FROM public.contacts AS c WHERE c.account_id = v_account_one ORDER BY c.created_at, c.id LIMIT 1;
  SELECT c.id INTO STRICT v_contact_one_two FROM public.contacts AS c WHERE c.account_id = v_account_one AND c.id <> v_contact_one;
  SELECT c.id INTO STRICT v_contact_two FROM public.contacts AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_one, v_user_one, 'http://127.0.0.1:8080', 't06-a4-one-' || v_user_one::text,
     'synthetic-ciphertext-one', 'synthetic-webhook-one'),
    (v_account_two, v_user_two, 'http://127.0.0.1:8080', 't06-a4-two-' || v_user_two::text,
     'synthetic-ciphertext-two', 'synthetic-webhook-two');
  SELECT c.id INTO STRICT v_connection_one FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_one;
  SELECT c.id INTO STRICT v_connection_two FROM public.whatsapp_connections AS c WHERE c.account_id = v_account_two;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES
    (v_user_one, v_account_one, v_contact_one, 'open'),
    (v_user_one, v_account_one, v_contact_one_two, 'open'),
    (v_user_two, v_account_two, v_contact_two, 'open');
  SELECT c.id INTO STRICT v_conversation_one
    FROM public.conversations AS c WHERE c.account_id = v_account_one ORDER BY c.created_at, c.id LIMIT 1;
  SELECT c.id INTO STRICT v_conversation_two
    FROM public.conversations AS c WHERE c.account_id = v_account_one AND c.id <> v_conversation_one ORDER BY c.created_at, c.id LIMIT 1;
  SELECT c.id INTO STRICT v_conversation_three
    FROM public.conversations AS c WHERE c.account_id = v_account_two;

  PERFORM pg_catalog.set_config('wacrm.t06a4.user_one', v_user_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.user_two', v_user_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.account_one', v_account_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.account_two', v_account_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.connection_one', v_connection_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.connection_two', v_connection_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.conversation_one', v_conversation_one::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.conversation_two', v_conversation_two::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.conversation_three', v_conversation_three::text, true);
END;
$fixture_setup$;

DO $catalog_assertions$
DECLARE
  v_messages_connection_column boolean;
  v_statuses_connection_column boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = 'public.messages'::regclass
       AND a.attname = 'provider_connection_id'
       AND a.atttypid = 'uuid'::regtype
       AND NOT a.attnotnull
       AND NOT a.attisdropped
  ) INTO v_messages_connection_column;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
     WHERE a.attrelid = 'public.pending_message_statuses'::regclass
       AND a.attname = 'provider_connection_id'
       AND a.atttypid = 'uuid'::regtype
       AND NOT a.attnotnull
       AND NOT a.attisdropped
  ) INTO v_statuses_connection_column;

  IF NOT v_messages_connection_column OR NOT v_statuses_connection_column
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes AS i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'idx_messages_conversation_message_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes AS i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'idx_messages_legacy_conversation_message_id'
          AND i.indexdef ILIKE '%UNIQUE INDEX%'
          AND i.indexdef ILIKE '%(conversation_id, message_id)%'
          AND i.indexdef ILIKE '%provider_connection_id IS NULL%'
          AND i.indexdef ILIKE '%message_id IS NOT NULL%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes AS i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'idx_messages_provider_connection_message_id'
          AND i.indexdef ILIKE '%UNIQUE INDEX%'
          AND i.indexdef ILIKE '%(provider_connection_id, message_id)%'
          AND i.indexdef ILIKE '%provider_connection_id IS NOT NULL%'
          AND i.indexdef ILIKE '%message_id IS NOT NULL%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes AS i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'pending_message_statuses_legacy_key'
          AND i.indexdef ILIKE '%(account_id, wamid, status)%'
          AND i.indexdef ILIKE '%provider_connection_id IS NULL%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_indexes AS i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'pending_message_statuses_provider_key'
          AND i.indexdef ILIKE '%(account_id, provider_connection_id, wamid, status)%'
          AND i.indexdef ILIKE '%provider_connection_id IS NOT NULL%'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
        WHERE c.conrelid = 'public.pending_message_statuses'::regclass
          AND c.conname = 'pending_message_statuses_account_wamid_status_key'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
        WHERE c.conrelid = 'public.messages'::regclass
          AND c.conname = 'messages_provider_connection_id_fkey'
          AND c.contype = 'f'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS c
        WHERE c.conrelid = 'public.pending_message_statuses'::regclass
          AND c.conname = 'pending_message_statuses_provider_connection_id_fkey'
          AND c.contype = 'f'
     ) THEN
    RAISE EXCEPTION 'provider namespace columns, FKs, or partial unique indexes do not match contract';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.messages'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.pending_message_statuses'::regclass)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies AS p WHERE p.schemaname = 'public' AND p.tablename = 'messages') <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies AS p WHERE p.schemaname = 'public' AND p.tablename = 'pending_message_statuses')
     OR NOT pg_catalog.has_table_privilege('anon', 'public.messages', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.messages', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.pending_message_statuses', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.pending_message_statuses', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.messages', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.pending_message_statuses', 'INSERT') THEN
    RAISE EXCEPTION 'RLS, policies, or table grants changed unexpectedly';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS t
         JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.messages'::regclass
          AND t.tgname = 'messages_guard_provider_connection_namespace'
          AND NOT t.tgisinternal
          AND NOT p.prosecdef
          AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
     ) THEN
    RAISE EXCEPTION 'provider namespace guard trigger is missing or not SECURITY INVOKER with a fixed search_path';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM information_schema.triggers
       WHERE trigger_schema = 'public'
         AND event_object_table = 'messages'
         AND trigger_name = 'messages_track_conversation_times') <> 2
     OR EXISTS (
       SELECT 1 FROM information_schema.triggers
        WHERE trigger_schema = 'public'
          AND event_object_table = 'pending_message_statuses'
     ) THEN
    RAISE EXCEPTION 'existing messages/statuses triggers changed unexpectedly';
  END IF;
END;
$catalog_assertions$;

SET LOCAL ROLE service_role;
DO $namespace_assertions$
DECLARE
  v_account_one uuid := pg_catalog.current_setting('wacrm.t06a4.account_one')::uuid;
  v_account_two uuid := pg_catalog.current_setting('wacrm.t06a4.account_two')::uuid;
  v_connection_one uuid := pg_catalog.current_setting('wacrm.t06a4.connection_one')::uuid;
  v_connection_two uuid := pg_catalog.current_setting('wacrm.t06a4.connection_two')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_one')::uuid;
  v_conversation_two uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_two')::uuid;
  v_conversation_three uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_three')::uuid;
  v_missing_connection uuid := pg_catalog.gen_random_uuid();
  v_legacy_id text := 't06-a4-shared-' || pg_catalog.gen_random_uuid()::text;
  v_same_connection_id text := 't06-a4-one-connection-' || pg_catalog.gen_random_uuid()::text;
  v_cross_connection_id text := 't06-a4-cross-connection-' || pg_catalog.gen_random_uuid()::text;
  v_client_legacy_id text := 't06-a4-client-legacy-' || pg_catalog.gen_random_uuid()::text;
  v_client_provider_id text := 't06-a4-client-provider-' || pg_catalog.gen_random_uuid()::text;
  v_wamid text := 't06-a4-status-' || pg_catalog.gen_random_uuid()::text;
  v_message_id uuid;
  v_client_legacy_message_id uuid;
  v_client_provider_message_id uuid;
  v_constraint text;
BEGIN
  -- A legacy ID and the same Evolution ID can coexist in the same conversation.
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, status)
  VALUES (v_conversation_one, 'customer', 'text', v_legacy_id, 'sent')
  RETURNING id INTO v_message_id;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
  VALUES (v_conversation_one, 'customer', 'text', v_legacy_id, v_connection_one, 'sent');
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_message_id AND m.provider_connection_id IS NULL AND m.message_id = v_legacy_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.conversation_id = v_conversation_one
       AND m.provider_connection_id = v_connection_one
       AND m.message_id = v_legacy_id
  ) THEN
    RAISE EXCEPTION 'legacy and Evolution namespace rows did not coexist';
  END IF;

  -- The legacy key remains conversation-scoped and still rejects its duplicate.
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, status)
    VALUES (v_conversation_one, 'customer', 'text', v_legacy_id, 'sent');
    RAISE EXCEPTION 'duplicate legacy conversation/message ID was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, status)
  VALUES (v_conversation_two, 'customer', 'text', v_legacy_id, 'sent');

  -- One Evolution connection owns a message ID namespace across conversations.
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
  VALUES (v_conversation_one, 'customer', 'text', v_same_connection_id, v_connection_one, 'sent');
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
    VALUES (v_conversation_two, 'customer', 'text', v_same_connection_id, v_connection_one, 'sent');
    RAISE EXCEPTION 'same connection/message ID in another conversation was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;

  -- The same Evolution ID is valid in another connection.
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
  VALUES (v_conversation_one, 'customer', 'text', v_cross_connection_id, v_connection_one, 'sent');
  INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
  VALUES (v_conversation_three, 'customer', 'text', v_cross_connection_id, v_connection_two, 'sent');

  -- Server-owned writes also must not pair another account's connection and conversation.
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
    VALUES (v_conversation_one, 'customer', 'text', 't06-a4-cross-account-' || pg_catalog.gen_random_uuid()::text, v_connection_two, 'sent');
    RAISE EXCEPTION 'cross-account connection/conversation pair was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;

  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, message_id, status)
  VALUES (v_conversation_one, 'customer', 'text', 'client legacy fixture', v_client_legacy_id, 'sent')
  RETURNING id INTO v_client_legacy_message_id;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, message_id, provider_connection_id, status)
  VALUES (v_conversation_one, 'customer', 'text', 'client linked fixture', v_client_provider_id, v_connection_one, 'sent')
  RETURNING id INTO v_client_provider_message_id;
  PERFORM pg_catalog.set_config('wacrm.t06a4.client_legacy_message_id', v_client_legacy_message_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t06a4.client_provider_message_id', v_client_provider_message_id::text, true);

  BEGIN
    INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
    VALUES (v_conversation_one, 'customer', 'text', 't06-a4-invalid-fk-' || pg_catalog.gen_random_uuid()::text, v_missing_connection, 'sent');
    RAISE EXCEPTION 'messages.provider_connection_id accepted a missing connection';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'messages_provider_connection_id_fkey' THEN RAISE; END IF;
  END;

  -- Legacy status dedupe remains intact and independent from provider-scoped rows.
  INSERT INTO public.pending_message_statuses (account_id, wamid, status)
  VALUES (v_account_one, v_wamid, 'delivered');
  BEGIN
    INSERT INTO public.pending_message_statuses (account_id, wamid, status)
    VALUES (v_account_one, v_wamid, 'delivered');
    RAISE EXCEPTION 'duplicate legacy account/wamid/status was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  INSERT INTO public.pending_message_statuses (account_id, wamid, status)
  VALUES (v_account_one, v_wamid, 'read');

  INSERT INTO public.pending_message_statuses (account_id, provider_connection_id, wamid, status)
  VALUES (v_account_one, v_connection_one, v_wamid, 'delivered');
  BEGIN
    INSERT INTO public.pending_message_statuses (account_id, provider_connection_id, wamid, status)
    VALUES (v_account_one, v_connection_one, v_wamid, 'delivered');
    RAISE EXCEPTION 'duplicate provider account/connection/wamid/status was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  INSERT INTO public.pending_message_statuses (account_id, provider_connection_id, wamid, status)
  VALUES (v_account_two, v_connection_two, v_wamid, 'delivered');

  BEGIN
    INSERT INTO public.pending_message_statuses (account_id, provider_connection_id, wamid, status)
    VALUES (v_account_one, v_missing_connection, 't06-a4-invalid-status-fk-' || pg_catalog.gen_random_uuid()::text, 'delivered');
    RAISE EXCEPTION 'pending_message_statuses.provider_connection_id accepted a missing connection';
  EXCEPTION WHEN SQLSTATE '23503' THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint <> 'pending_message_statuses_provider_connection_id_fkey' THEN RAISE; END IF;
  END;
END;
$namespace_assertions$;
RESET ROLE;

-- A conversation agent retains legacy message editing, but cannot set or remove
-- the server-owned provider link. An unchanged Evolution link remains editable.
SET LOCAL ROLE authenticated;
DO $provider_link_client_guard$
DECLARE
  v_user_one uuid := pg_catalog.current_setting('wacrm.t06a4.user_one')::uuid;
  v_connection_one uuid := pg_catalog.current_setting('wacrm.t06a4.connection_one')::uuid;
  v_connection_two uuid := pg_catalog.current_setting('wacrm.t06a4.connection_two')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_one')::uuid;
  v_conversation_two uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_two')::uuid;
  v_legacy_message_id uuid := pg_catalog.current_setting('wacrm.t06a4.client_legacy_message_id')::uuid;
  v_provider_message_id uuid := pg_catalog.current_setting('wacrm.t06a4.client_provider_message_id')::uuid;
  v_legacy_inserted_id uuid;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_one::text, true);

  BEGIN
    INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, provider_connection_id, status)
    VALUES (v_conversation_one, 'customer', 'text', 't06-a4-client-insert-' || pg_catalog.gen_random_uuid()::text, v_connection_two, 'sent');
    RAISE EXCEPTION 'client inserted a message linked to another account connection';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.messages
       SET provider_connection_id = v_connection_two
     WHERE id = v_legacy_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'client could not see its own legacy fixture'; END IF;
    RAISE EXCEPTION 'client linked its own legacy message to another account connection';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.messages
       SET provider_connection_id = NULL
     WHERE id = v_provider_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'client could not see its own Evolution fixture'; END IF;
    RAISE EXCEPTION 'client removed an Evolution message link';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.messages
       SET conversation_id = v_conversation_two
     WHERE id = v_provider_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'client could not see its own Evolution fixture for conversation move'; END IF;
    RAISE EXCEPTION 'client changed the conversation of an Evolution message';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;

  UPDATE public.messages
     SET content_text = 'client edited unchanged provider link', status = 'delivered'
   WHERE id = v_provider_message_id
     AND provider_connection_id = v_connection_one;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_provider_message_id
       AND m.provider_connection_id = v_connection_one
       AND m.conversation_id = v_conversation_one
       AND m.content_text = 'client edited unchanged provider link'
       AND m.status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'client content/status update with unchanged provider link was blocked or changed the link';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, status)
  VALUES (v_conversation_one, 'customer', 'text', 'client legacy insert', 'sent')
  RETURNING id INTO v_legacy_inserted_id;
  UPDATE public.messages
     SET content_text = 'client legacy edit', status = 'delivered'
   WHERE id = v_legacy_inserted_id
     AND provider_connection_id IS NULL;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_legacy_inserted_id
       AND m.provider_connection_id IS NULL
       AND m.content_text = 'client legacy edit'
       AND m.status = 'delivered'
  ) THEN
    RAISE EXCEPTION 'legacy client insert/update behavior changed';
  END IF;
END;
$provider_link_client_guard$;
RESET ROLE;

-- RLS still scopes messages through conversations; the new nullable column
-- alone grants neither anonymous nor cross-account visibility.
SET LOCAL ROLE anon;
DO $anonymous_visibility$
DECLARE
  v_visible bigint;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  SELECT pg_catalog.count(*) INTO v_visible
    FROM public.messages AS m
   WHERE m.provider_connection_id IS NOT NULL
     AND m.message_id LIKE 't06-a4-%';
  IF v_visible <> 0 THEN RAISE EXCEPTION 'anon saw provider-scoped fixture rows'; END IF;
END;
$anonymous_visibility$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $other_account_visibility$
DECLARE
  v_user_two uuid := pg_catalog.current_setting('wacrm.t06a4.user_two')::uuid;
  v_conversation_one uuid := pg_catalog.current_setting('wacrm.t06a4.conversation_one')::uuid;
  v_visible bigint;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_two::text, true);
  SELECT pg_catalog.count(*) INTO v_visible
    FROM public.messages AS m
   WHERE m.conversation_id = v_conversation_one
     AND m.provider_connection_id IS NOT NULL
     AND m.message_id LIKE 't06-a4-%';
  IF v_visible <> 0 THEN RAISE EXCEPTION 'a different account read provider-scoped messages'; END IF;

  BEGIN
    PERFORM s.id FROM public.pending_message_statuses AS s LIMIT 1;
    RAISE EXCEPTION 'authenticated unexpectedly read pending statuses';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$other_account_visibility$;
RESET ROLE;

ROLLBACK;

CREATE TEMP TABLE t06a4_snapshot_after (LIKE pg_temp.t06a4_snapshot_before INCLUDING ALL) ON COMMIT PRESERVE ROWS;
INSERT INTO pg_temp.t06a4_snapshot_after
SELECT 'auth.users', count(*), md5(COALESCE(string_agg(t.id::text, E'\n' ORDER BY t.id), '')) FROM auth.users AS t
UNION ALL
SELECT 'public.profiles', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text, E'\n' ORDER BY t.id), '')) FROM public.profiles AS t
UNION ALL
SELECT 'public.accounts', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.owner_user_id::text, E'\n' ORDER BY t.id), '')) FROM public.accounts AS t
UNION ALL
SELECT 'public.contacts', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text, E'\n' ORDER BY t.id), '')) FROM public.contacts AS t
UNION ALL
SELECT 'public.whatsapp_connections', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.base_url || '|' || t.instance_name, E'\n' ORDER BY t.id), '')) FROM public.whatsapp_connections AS t
UNION ALL
SELECT 'public.conversations', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.user_id::text || '|' || t.account_id::text || '|' || t.contact_id::text, E'\n' ORDER BY t.id), '')) FROM public.conversations AS t
UNION ALL
SELECT 'public.messages', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.conversation_id::text || '|' || COALESCE(t.message_id, '') || '|' || COALESCE(t.provider_connection_id::text, '') || '|' || t.status, E'\n' ORDER BY t.id), '')) FROM public.messages AS t
UNION ALL
SELECT 'public.pending_message_statuses', count(*), md5(COALESCE(string_agg(t.id::text || '|' || t.account_id::text || '|' || t.wamid || '|' || t.status || '|' || COALESCE(t.provider_connection_id::text, ''), E'\n' ORDER BY t.id), '')) FROM public.pending_message_statuses AS t;

DO $rollback_snapshot_assertion$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.t06a4_snapshot_before AS b
    FULL JOIN pg_temp.t06a4_snapshot_after AS a USING (table_name)
    WHERE b.row_count IS DISTINCT FROM a.row_count
       OR b.row_digest IS DISTINCT FROM a.row_digest
  ) THEN
    RAISE EXCEPTION 'T06.a4 rollback changed a protected data snapshot';
  END IF;
  RAISE NOTICE 'T06.a4 PASS: rollback preserved user/account/connection/conversation/message/status snapshots';
END;
$rollback_snapshot_assertion$;

DROP TABLE pg_temp.t06a4_snapshot_after;
DROP TABLE pg_temp.t06a4_snapshot_before;
