-- Synthetic rollback-only test. No provider request is made.
BEGIN;

DO $fixture$
DECLARE
  v_user uuid := pg_catalog.gen_random_uuid();
  v_other uuid := pg_catalog.gen_random_uuid();
  v_account uuid;
  v_other_account uuid;
  v_contact uuid;
  v_other_contact uuid;
  v_connection uuid;
  v_other_connection uuid;
  v_conversation uuid;
  v_other_conversation uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user, 'authenticated', 'authenticated', v_user::text || '@interactive-fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    (v_other, 'authenticated', 'authenticated', v_other::text || '@interactive-fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);
  SELECT account_id INTO STRICT v_account FROM public.profiles WHERE user_id = v_user;
  SELECT account_id INTO STRICT v_other_account FROM public.profiles WHERE user_id = v_other;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user, v_account, '+15550000021', 'Synthetic interactive'),
         (v_other, v_other_account, '+15550000022', 'Synthetic other');
  SELECT id INTO STRICT v_contact FROM public.contacts WHERE account_id = v_account;
  SELECT id INTO STRICT v_other_contact FROM public.contacts WHERE account_id = v_other_account;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account, v_user, 'evolution', 'http://127.0.0.1:8080', 'interactive-fixture-1', 'synthetic', 'synthetic'),
    (v_other_account, v_other, 'evolution', 'http://127.0.0.1:8080', 'interactive-fixture-2', 'synthetic', 'synthetic');
  SELECT id INTO STRICT v_connection FROM public.whatsapp_connections WHERE account_id = v_account;
  SELECT id INTO STRICT v_other_connection FROM public.whatsapp_connections WHERE account_id = v_other_account;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user, v_account, v_contact, 'open'),
         (v_other, v_other_account, v_other_contact, 'open');
  SELECT id INTO STRICT v_conversation FROM public.conversations WHERE account_id = v_account;
  SELECT id INTO STRICT v_other_conversation FROM public.conversations WHERE account_id = v_other_account;
  PERFORM pg_catalog.set_config('wacrm.interactive.user', v_user::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.connection', v_connection::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.other_connection', v_other_connection::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.conversation', v_conversation::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.other_conversation', v_other_conversation::text, true);
END;
$fixture$;

DO $grant_check$
DECLARE
  v_fn regprocedure := 'public.reserve_evolution_interactive_send(uuid,text,text,uuid,uuid,jsonb)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR NOT (SELECT NOT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'Interactive reservation grants/security are invalid';
  END IF;
END;
$grant_check$;

SET LOCAL ROLE service_role;
DO $reserve_test$
DECLARE
  v_user uuid := pg_catalog.current_setting('wacrm.interactive.user')::uuid;
  v_connection uuid := pg_catalog.current_setting('wacrm.interactive.connection')::uuid;
  v_other_connection uuid := pg_catalog.current_setting('wacrm.interactive.other_connection')::uuid;
  v_conversation uuid := pg_catalog.current_setting('wacrm.interactive.conversation')::uuid;
  v_other_conversation uuid := pg_catalog.current_setting('wacrm.interactive.other_conversation')::uuid;
  v_message jsonb := '{"content_type":"interactive","content_text":"Choose","interactive_payload":{"kind":"buttons","recipient":"15550000021@s.whatsapp.net","requestId":"synthetic-step","title":"Choose","buttons":[{"id":"go","displayText":"Go"}]}}'::jsonb;
  v_first record;
  v_replay record;
  v_done record;
  v_denied boolean := false;
BEGIN
  SELECT * INTO STRICT v_first FROM public.reserve_evolution_interactive_send(
    v_connection, 'synthetic-step', pg_catalog.repeat('a', 64), v_conversation, v_user, v_message
  );
  IF NOT v_first.should_send OR v_first.outcome <> 'pending' THEN
    RAISE EXCEPTION 'Fresh interactive reservation was not sendable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.messages AS m
     WHERE m.id = v_first.message_row_id AND m.conversation_id = v_conversation
       AND m.sender_type = 'bot' AND m.content_type = 'interactive'
       AND m.interactive_payload = v_message->'interactive_payload'
       AND m.status = 'sending'
  ) THEN
    RAISE EXCEPTION 'Interactive message was not reserved with its payload';
  END IF;
  SELECT * INTO STRICT v_replay FROM public.reserve_evolution_interactive_send(
    v_connection, 'synthetic-step', pg_catalog.repeat('a', 64), v_conversation, v_user, v_message
  );
  IF v_replay.should_send OR v_replay.attempt_id <> v_first.attempt_id
     OR v_replay.message_row_id <> v_first.message_row_id THEN
    RAISE EXCEPTION 'Interactive replay authorized another send';
  END IF;
  BEGIN
    PERFORM 1 FROM public.reserve_evolution_interactive_send(
      v_connection, 'synthetic-step', pg_catalog.repeat('b', 64), v_conversation, v_user, v_message
    );
  EXCEPTION WHEN unique_violation THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Changed payload hash was accepted on replay'; END IF;

  v_denied := false;
  BEGIN
    PERFORM 1 FROM public.reserve_evolution_interactive_send(
      v_other_connection, 'cross-tenant', pg_catalog.repeat('c', 64), v_conversation, v_user,
      pg_catalog.jsonb_set(v_message, '{interactive_payload,requestId}', '"cross-tenant"'::jsonb)
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Cross-tenant connection was accepted'; END IF;

  v_denied := false;
  BEGIN
    PERFORM 1 FROM public.reserve_evolution_interactive_send(
      v_connection, 'other-conversation', pg_catalog.repeat('d', 64), v_other_conversation, v_user,
      pg_catalog.jsonb_set(v_message, '{interactive_payload,requestId}', '"other-conversation"'::jsonb)
    );
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Cross-tenant conversation was accepted'; END IF;

  SELECT * INTO STRICT v_done FROM public.complete_evolution_send(
    v_first.attempt_id, 'accepted', 'synthetic-provider-id', NULL
  );
  IF v_done.outcome <> 'accepted' OR NOT EXISTS (
    SELECT 1 FROM public.messages AS m WHERE m.id = v_first.message_row_id
      AND m.status = 'sent' AND m.message_id = 'synthetic-provider-id'
  ) THEN
    RAISE EXCEPTION 'Interactive send completion did not update its message';
  END IF;
  SELECT * INTO STRICT v_replay FROM public.reserve_evolution_interactive_send(
    v_connection, 'synthetic-step', pg_catalog.repeat('a', 64), v_conversation, v_user, v_message
  );
  IF v_replay.should_send OR v_replay.outcome <> 'accepted' THEN
    RAISE EXCEPTION 'Accepted interactive replay authorized another send';
  END IF;
END;
$reserve_test$;

ROLLBACK;
