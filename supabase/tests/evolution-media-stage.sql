BEGIN;

-- Rollback-only SQL verification. Every user, account, connection, event,
-- and Storage object in this script is synthetic.
DO $setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_user_c uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_account_c uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_connection_c uuid;
  v_event_a uuid;
  v_event_b uuid;
  v_event_c uuid;
  v_token_a uuid := pg_catalog.gen_random_uuid();
  v_token_b uuid := pg_catalog.gen_random_uuid();
  v_token_c uuid := pg_catalog.gen_random_uuid();
  v_proc regprocedure;
  v_mime_types text[];
BEGIN
  SELECT b.allowed_mime_types
    INTO STRICT v_mime_types
    FROM storage.buckets AS b
   WHERE b.id = 'evolution-media'
     AND b.name = 'evolution-media'
     AND b.public = false
     AND b.file_size_limit = 16777216;

  IF v_mime_types IS DISTINCT FROM ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'application/msword', 'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr',
    'video/mp4', 'video/3gpp', 'video/3gp', 'video/quicktime'
  ]::text[] THEN
    RAISE EXCEPTION 'evolution-media bucket MIME policy differs from the T11 allowlist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets AS b
     WHERE b.id = 'chat-media' AND b.public = true
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies AS p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname = 'Members can read chat media'
  ) THEN
    RAISE EXCEPTION 'legacy chat-media visibility or read policy changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
     WHERE c.oid = 'storage.objects'::regclass AND c.relrowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies AS p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND (
         (p.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL')
           AND (p.qual IS NULL OR p.qual NOT ILIKE '%bucket_id%'))
         OR
         (p.cmd = 'INSERT'
           AND (p.with_check IS NULL OR p.with_check NOT ILIKE '%bucket_id%'))
         OR
         (p.cmd IN ('UPDATE', 'ALL')
           AND coalesce(p.with_check, p.qual, '') NOT ILIKE '%bucket_id%')
       )
  ) THEN
    RAISE EXCEPTION 'Storage RLS is off or an objects policy is not bucket-scoped';
  END IF;

  v_proc := 'public.stage_evolution_media(uuid,uuid,text,bigint,text,text)'::regprocedure;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_proc
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public'])
  ) OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'stage_evolution_media security attributes or grants do not match';
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T11c synthetic A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T11c synthetic B"}'::jsonb),
    (v_user_c, 'authenticated', 'authenticated', v_user_c::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T11c synthetic C"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;
  SELECT p.account_id INTO STRICT v_account_c FROM public.profiles AS p WHERE p.user_id = v_user_c;

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't11c-a-' || v_user_a::text, 'synthetic-a', 'synthetic-a')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_b, v_user_b, 'http://127.0.0.1:8080', 't11c-b-' || v_user_b::text, 'synthetic-b', 'synthetic-b')
  RETURNING id INTO v_connection_b;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_c, v_user_c, 'http://127.0.0.1:8080', 't11c-c-' || v_user_c::text, 'synthetic-c', 'synthetic-c')
  RETURNING id INTO v_connection_c;

  INSERT INTO public.evolution_events (
    connection_id, event_key, normalized_event, state, attempts, lease_until, lease_token, media_state
  ) VALUES
    (v_connection_a, 't11c:stage-a', jsonb_build_object(
      'kind', 'message', 'eventKey', 't11c:stage-a', 'externalMessageId', 'SYNTHETIC_MEDIA_ID_A',
      'peer', '15550000001@s.whatsapp.net', 'fromMe', false, 'contentType', 'image',
      'mediaRef', jsonb_build_object('version', 1, 'key', jsonb_build_object(
        'remoteJid', '15550000001@s.whatsapp.net', 'id', 'SYNTHETIC_MEDIA_ID_A', 'fromMe', false
      ))
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_a, 'pending'),
    (v_connection_b, 't11c:stage-b', jsonb_build_object(
      'kind', 'message', 'eventKey', 't11c:stage-b', 'externalMessageId', 'SYNTHETIC_MEDIA_ID_B',
      'peer', '15550000002@s.whatsapp.net', 'fromMe', false, 'contentType', 'image',
      'mediaRef', jsonb_build_object('version', 1, 'key', jsonb_build_object(
        'remoteJid', '15550000002@s.whatsapp.net', 'id', 'SYNTHETIC_MEDIA_ID_B', 'fromMe', false
      ))
    ), 'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_token_b, 'pending'),
    (v_connection_c, 't11c:stage-non-evolution', jsonb_build_object(
      'kind', 'message', 'eventKey', 't11c:stage-non-evolution', 'externalMessageId', 'SYNTHETIC_MEDIA_ID_C',
      'peer', '15550000003@s.whatsapp.net', 'fromMe', false, 'contentType', 'image',
      'mediaRef', jsonb_build_object('version', 1, 'key', jsonb_build_object(
        'remoteJid', '15550000003@s.whatsapp.net', 'id', 'SYNTHETIC_MEDIA_ID_C', 'fromMe', false
      ))
    ), 'processing', 1, pg_catalog.clock_timestamp() + interval '60 seconds', v_token_c, 'pending');

  SELECT e.id INTO STRICT v_event_a FROM public.evolution_events AS e
   WHERE e.connection_id = v_connection_a AND e.event_key = 't11c:stage-a';
  SELECT e.id INTO STRICT v_event_b FROM public.evolution_events AS e
   WHERE e.connection_id = v_connection_b AND e.event_key = 't11c:stage-b';
  SELECT e.id INTO STRICT v_event_c FROM public.evolution_events AS e
   WHERE e.connection_id = v_connection_c AND e.event_key = 't11c:stage-non-evolution';

  PERFORM pg_catalog.set_config('wacrm.t11c.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.account_b', v_account_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.event_a', v_event_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.token_a', v_token_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.event_b', v_event_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.token_b', v_token_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.event_c', v_event_c::text, true);
  PERFORM pg_catalog.set_config('wacrm.t11c.token_c', v_token_c::text, true);

  -- whatsapp_connections currently has a CHECK requiring provider='evolution'.
  -- Relax it only inside this transaction to exercise the RPC's defensive filter.
  ALTER TABLE public.whatsapp_connections DROP CONSTRAINT whatsapp_connections_provider_check;
  UPDATE public.whatsapp_connections SET provider = 'non-evolution' WHERE id = v_connection_c;
END;
$setup$;

SET LOCAL ROLE service_role;

DO $stage_assertions$
DECLARE
  v_result record;
  v_event_a uuid := pg_catalog.current_setting('wacrm.t11c.event_a')::uuid;
  v_event_b uuid := pg_catalog.current_setting('wacrm.t11c.event_b')::uuid;
  v_event_c uuid := pg_catalog.current_setting('wacrm.t11c.event_c')::uuid;
  v_token_a uuid := pg_catalog.current_setting('wacrm.t11c.token_a')::uuid;
  v_token_b uuid := pg_catalog.current_setting('wacrm.t11c.token_b')::uuid;
  v_token_c uuid := pg_catalog.current_setting('wacrm.t11c.token_c')::uuid;
  v_account_a uuid := pg_catalog.current_setting('wacrm.t11c.account_a')::uuid;
  v_account_b uuid := pg_catalog.current_setting('wacrm.t11c.account_b')::uuid;
  v_path_a text;
  v_path_b text;
  v_sha text := pg_catalog.repeat('a', 64);
BEGIN
  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_a, pg_catalog.gen_random_uuid(), v_sha, 1024, 'image/jpeg', 'synthetic.jpg');
  IF v_result.outcome <> 'stale' OR v_result.media_storage_path IS NOT NULL THEN
    RAISE EXCEPTION 'wrong lease token was not fenced';
  END IF;

  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_a, v_token_a, v_sha, 1024, 'image/jpeg', 'synthetic.jpg');
  v_path_a := v_result.media_storage_path;
  IF v_result.outcome <> 'staged'
     OR v_path_a <> 'account-' || v_account_a::text || '/evolution/' || v_event_a::text || '/payload.jpg' THEN
    RAISE EXCEPTION 'stage result is not deterministic and account-scoped';
  END IF;

  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_a, v_token_a, v_sha, 1024, 'image/jpeg', 'renamed-synthetic.jpg');
  IF v_result.outcome <> 'duplicate' OR v_result.media_storage_path <> v_path_a THEN
    RAISE EXCEPTION 'same-hash replay did not reuse the staged path';
  END IF;

  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_a, v_token_a, pg_catalog.repeat('b', 64), 1024, 'image/jpeg', 'synthetic.jpg');
  IF v_result.outcome <> 'conflict' OR v_result.media_storage_path IS NOT NULL THEN
    RAISE EXCEPTION 'same path with a different hash was not rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_event_a AND e.media_state = 'stored'
       AND e.media_storage_path = v_path_a AND e.media_sha256 = v_sha
       AND e.media_size_bytes = 1024 AND e.media_filename = 'synthetic.jpg'
  ) THEN
    RAISE EXCEPTION 'hash conflict or replay changed staged metadata';
  END IF;

  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_b, v_token_b, v_sha, 2048, 'image/jpeg', 'synthetic.jpg');
  IF v_result.outcome <> 'stale' OR v_result.media_storage_path IS NOT NULL THEN
    RAISE EXCEPTION 'expired lease was not fenced';
  END IF;

  UPDATE public.evolution_events
     SET lease_until = pg_catalog.clock_timestamp() + interval '60 seconds'
   WHERE id = v_event_b;
  SELECT * INTO STRICT v_result
    FROM public.stage_evolution_media(v_event_b, v_token_b, v_sha, 2048, 'image/jpeg', 'synthetic.jpg');
  v_path_b := v_result.media_storage_path;
  IF v_result.outcome <> 'staged'
     OR v_path_b <> 'account-' || v_account_b::text || '/evolution/' || v_event_b::text || '/payload.jpg'
     OR v_path_b = v_path_a THEN
    RAISE EXCEPTION 'second tenant path was not isolated';
  END IF;

  BEGIN
    PERFORM * FROM public.stage_evolution_media(v_event_b, v_token_b, v_sha, 1024, 'image/svg+xml', 'synthetic.svg');
    RAISE EXCEPTION 'active SVG content was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM * FROM public.stage_evolution_media(v_event_b, v_token_b, v_sha, 16777217, 'image/jpeg', 'synthetic.jpg');
    RAISE EXCEPTION 'oversized media metadata was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM * FROM public.stage_evolution_media(v_event_b, v_token_b, v_sha, 1024, 'image/jpeg', '../unsafe.jpg');
    RAISE EXCEPTION 'unsafe filename was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_event_c AND e.media_state <> 'pending'
  ) THEN
    RAISE EXCEPTION 'unexpected state on non-Evolution event fixture';
  END IF;

  BEGIN
    PERFORM * FROM public.stage_evolution_media(v_event_c, v_token_c, v_sha, 1024, 'image/jpeg', 'synthetic.jpg');
    RAISE EXCEPTION 'non-Evolution connection was allowed to stage media';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.evolution_events AS e
     WHERE e.id = v_event_c AND (e.media_state <> 'pending' OR e.media_storage_path IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'non-Evolution stage attempt changed event state';
  END IF;

END;
$stage_assertions$;

ROLLBACK;
