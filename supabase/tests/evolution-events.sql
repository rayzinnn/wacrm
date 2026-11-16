\set ON_ERROR_STOP on

BEGIN;

-- Disposable auth users create legitimate accounts through the existing trigger.
DO $fixtures$
DECLARE
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  account_a uuid;
  account_b uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (user_a, 'authenticated', 'authenticated', 't06-a2-a@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06 A2 disposable A"}'::jsonb),
    (user_b, 'authenticated', 'authenticated', 't06-a2-b@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06 A2 disposable B"}'::jsonb);

  SELECT p.account_id INTO STRICT account_a FROM public.profiles AS p WHERE p.user_id = user_a;
  SELECT p.account_id INTO STRICT account_b FROM public.profiles AS p WHERE p.user_id = user_b;
  PERFORM set_config('wacrm.t06a2.user_a', user_a::text, true);
  PERFORM set_config('wacrm.t06a2.user_b', user_b::text, true);
  PERFORM set_config('wacrm.t06a2.account_a', account_a::text, true);
  PERFORM set_config('wacrm.t06a2.account_b', account_b::text, true);
END;
$fixtures$;

SET LOCAL ROLE service_role;

DO $service_role_checks$
DECLARE
  account_a uuid := current_setting('wacrm.t06a2.account_a')::uuid;
  account_b uuid := current_setting('wacrm.t06a2.account_b')::uuid;
  user_a uuid := current_setting('wacrm.t06a2.user_a')::uuid;
  user_b uuid := current_setting('wacrm.t06a2.user_b')::uuid;
  connection_a uuid;
  connection_b uuid;
  event_id uuid;
BEGIN
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (account_a, user_a, 'http://127.0.0.1:8080', 't06-a2-fixture-a',
     'synthetic-token-ciphertext', 'synthetic-webhook-ciphertext'),
    (account_b, user_b, 'http://127.0.0.1:8080', 't06-a2-fixture-b',
     'synthetic-token-ciphertext', 'synthetic-webhook-ciphertext');

  -- Resolve both fixtures using their unique synthetic instance names.
  SELECT id INTO STRICT connection_a FROM public.whatsapp_connections
   WHERE instance_name = 't06-a2-fixture-a';
  SELECT id INTO STRICT connection_b FROM public.whatsapp_connections
   WHERE instance_name = 't06-a2-fixture-b';
  PERFORM set_config('wacrm.t06a2.connection_a', connection_a::text, true);
  PERFORM set_config('wacrm.t06a2.connection_b', connection_b::text, true);

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (connection_a, 'same-event-key', '{"type":"connection"}'::jsonb)
  RETURNING id INTO event_id;

  BEGIN
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
    VALUES (connection_a, 'same-event-key', '{"type":"connection"}'::jsonb);
    RAISE EXCEPTION 'duplicate event key for one connection was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
  VALUES (connection_b, 'same-event-key', '{"type":"connection"}'::jsonb);

  BEGIN
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state)
    VALUES (connection_a, 'invalid-state', '{"type":"connection"}'::jsonb, 'queued');
    RAISE EXCEPTION 'invalid event state was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, attempts)
    VALUES (connection_a, 'invalid-attempts', '{"type":"connection"}'::jsonb, 6);
    RAISE EXCEPTION 'attempts above five were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, media_state)
    VALUES (connection_a, 'invalid-media-state', '{"type":"connection"}'::jsonb, 'uploaded');
    RAISE EXCEPTION 'invalid media state was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.evolution_events (
      connection_id, event_key, normalized_event, media_state, media_storage_path
    ) VALUES (
      connection_a, 'invalid-media-path', '{"type":"connection"}'::jsonb,
      'stored', NULL
    );
    RAISE EXCEPTION 'stored media without a path was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.evolution_events (connection_id, event_key, normalized_event)
    VALUES ('00000000-0000-0000-0000-000000000001', 'invalid-fk', '{"type":"connection"}'::jsonb);
    RAISE EXCEPTION 'unknown connection foreign key was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE public.evolution_events SET state = 'processing', attempts = 1,
      lease_until = now() + interval '1 minute', lease_token = gen_random_uuid()
   WHERE id = event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_role could not update its event'; END IF;
END;
$service_role_checks$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('wacrm.t06a2.user_a'), true);
DO $authenticated_a_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.evolution_events LIMIT 0';
    RAISE EXCEPTION 'authenticated A could read evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.evolution_events (connection_id, event_key, normalized_event) VALUES (current_setting(''wacrm.t06a2.connection_a'')::uuid, ''client-write-a'', ''{"type":"connection"}'')';
    RAISE EXCEPTION 'authenticated A could insert evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.evolution_events SET state = ''done''';
    RAISE EXCEPTION 'authenticated A could update evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.evolution_events';
    RAISE EXCEPTION 'authenticated A could delete evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_a_denied$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('wacrm.t06a2.user_b'), true);
DO $authenticated_b_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.evolution_events LIMIT 0';
    RAISE EXCEPTION 'authenticated B could read evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.evolution_events (connection_id, event_key, normalized_event) VALUES (current_setting(''wacrm.t06a2.connection_b'')::uuid, ''client-write-b'', ''{"type":"connection"}'')';
    RAISE EXCEPTION 'authenticated B could insert evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.evolution_events SET state = ''done''';
    RAISE EXCEPTION 'authenticated B could update evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.evolution_events';
    RAISE EXCEPTION 'authenticated B could delete evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_b_denied$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.evolution_events LIMIT 0';
    RAISE EXCEPTION 'anon could read evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.evolution_events (connection_id, event_key, normalized_event) VALUES (current_setting(''wacrm.t06a2.connection_a'')::uuid, ''anon-write'', ''{"type":"connection"}'')';
    RAISE EXCEPTION 'anon could insert evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.evolution_events SET state = ''done''';
    RAISE EXCEPTION 'anon could update evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.evolution_events';
    RAISE EXCEPTION 'anon could delete evolution_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denied$;

RESET ROLE;
DO $catalog_checks$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.evolution_events'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'evolution_events') THEN
    RAISE EXCEPTION 'unexpected RLS policy exists';
  END IF;
  IF has_table_privilege('anon', 'public.evolution_events', 'SELECT')
     OR has_table_privilege('anon', 'public.evolution_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.evolution_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.evolution_events', 'INSERT')
     OR has_table_privilege('service_role', 'public.evolution_events', 'SELECT') = false
     OR has_table_privilege('service_role', 'public.evolution_events', 'INSERT') = false
     OR has_table_privilege('service_role', 'public.evolution_events', 'UPDATE') = false
     OR has_table_privilege('service_role', 'public.evolution_events', 'DELETE') = false THEN
    RAISE EXCEPTION 'table grants do not match service-only access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class AS c,
      LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE c.oid = 'public.evolution_events'::regclass
      AND acl.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
                            (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'PUBLIC, anon, or authenticated has table grants';
  END IF;
END;
$catalog_checks$;

ROLLBACK;
