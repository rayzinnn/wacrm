BEGIN;

-- Rollback-only synthetic coverage for T11d. No Storage object or WhatsApp data.
DO $fixture$
DECLARE
  v_user uuid := pg_catalog.gen_random_uuid();
  v_account uuid;
  v_connection uuid;
  v_event_media uuid := pg_catalog.gen_random_uuid();
  v_event_malformed uuid := pg_catalog.gen_random_uuid();
  v_event_stale uuid := pg_catalog.gen_random_uuid();
  v_event_text uuid := pg_catalog.gen_random_uuid();
  v_event_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_media uuid := pg_catalog.gen_random_uuid();
  v_token_malformed uuid := pg_catalog.gen_random_uuid();
  v_token_stale uuid := pg_catalog.gen_random_uuid();
  v_token_text uuid := pg_catalog.gen_random_uuid();
  v_token_tenant uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user, 'authenticated', 'authenticated', v_user::text || '@t11d.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"T11d synthetic"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account FROM public.profiles AS p WHERE p.user_id = v_user;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account, v_user, 'http://127.0.0.1:8080', 't11d-' || v_user::text, 'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection;

  INSERT INTO public.evolution_events (
    id, connection_id, event_key, normalized_event, state, attempts,
    lease_until, lease_token, media_state
  ) VALUES
    (v_event_media, v_connection, 't11d:media', jsonb_build_object(
      'kind','message','eventKey','t11d:media','externalMessageId','t11d-image-001',
      'peer','15550000111@s.whatsapp.net','occurredAt','2026-11-16T18:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','image','text',NULL,
      'mediaRef',jsonb_build_object('version',1,'key',jsonb_build_object(
        'remoteJid','15550000111@s.whatsapp.net','id','t11d-image-001','fromMe',false))),
      'processing',1,pg_catalog.clock_timestamp()+interval '60 seconds',v_token_media,'pending'),
    (v_event_malformed, v_connection, 't11d:malformed', jsonb_build_object(
      'kind','message','eventKey','t11d:malformed','externalMessageId','t11d-image-002',
      'peer','15550000112@s.whatsapp.net','occurredAt','2026-11-16T18:01:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','image','text',NULL,
      'mediaRef',jsonb_build_object('version','1','key',jsonb_build_object(
        'remoteJid','15550000112@s.whatsapp.net','id','t11d-image-002','fromMe',false))),
      'processing',1,pg_catalog.clock_timestamp()+interval '60 seconds',v_token_malformed,'pending'),
    (v_event_stale, v_connection, 't11d:stale', jsonb_build_object(
      'kind','message','eventKey','t11d:stale','externalMessageId','t11d-image-003',
      'peer','15550000113@s.whatsapp.net','occurredAt','2026-11-16T18:02:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','image','text',NULL,
      'mediaRef',jsonb_build_object('version',1,'key',jsonb_build_object(
        'remoteJid','15550000113@s.whatsapp.net','id','t11d-image-003','fromMe',false))),
      'processing',1,pg_catalog.clock_timestamp()-interval '1 second',v_token_stale,'pending'),
    (v_event_text, v_connection, 't11d:text', jsonb_build_object(
      'kind','message','eventKey','t11d:text','externalMessageId','t11d-text-001',
      'peer','15550000114@s.whatsapp.net','occurredAt','2026-11-16T18:03:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','text','text','synthetic text','mediaRef',NULL),
      'processing',1,pg_catalog.clock_timestamp()+interval '60 seconds',v_token_text,'not_required'),
    (v_event_tenant, v_connection, 't11d:tenant-path', jsonb_build_object(
      'kind','message','eventKey','t11d:tenant-path','externalMessageId','t11d-image-tenant',
      'peer','15550000115@s.whatsapp.net','occurredAt','2026-11-16T18:04:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','image','text',NULL,
      'mediaRef',jsonb_build_object('version',1,'key',jsonb_build_object(
        'remoteJid','15550000115@s.whatsapp.net','id','t11d-image-tenant','fromMe',false))),
      'processing',1,pg_catalog.clock_timestamp()+interval '60 seconds',v_token_tenant,'pending');

  UPDATE public.evolution_events AS e
     SET media_state = 'stored',
         media_storage_path = 'account-' || v_account::text || '/evolution/' || e.id::text || '/payload.jpg',
         media_type = 'image/jpeg', media_sha256 = pg_catalog.repeat('a',64),
         media_size_bytes = 16, media_filename = 'fixture.jpg'
   WHERE e.id IN (v_event_media,v_event_malformed,v_event_stale,v_event_tenant);
  UPDATE public.evolution_events
     SET media_storage_path = 'account-' || pg_catalog.gen_random_uuid()::text || '/evolution/' || id::text || '/payload.jpg'
   WHERE id = v_event_tenant;

  PERFORM pg_catalog.set_config('wacrm.t11d.account',v_account::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.connection',v_connection::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.media',v_event_media::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.malformed',v_event_malformed::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.stale',v_event_stale::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.text',v_event_text::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.tenant',v_event_tenant::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.token_media',v_token_media::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.token_malformed',v_token_malformed::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.token_stale',v_token_stale::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.token_text',v_token_text::text,true);
  PERFORM pg_catalog.set_config('wacrm.t11d.token_tenant',v_token_tenant::text,true);
END;
$fixture$;

SET LOCAL ROLE service_role;

DO $assertions$
DECLARE
  v_account uuid := current_setting('wacrm.t11d.account')::uuid;
  v_connection uuid := current_setting('wacrm.t11d.connection')::uuid;
  v_media uuid := current_setting('wacrm.t11d.media')::uuid;
  v_malformed uuid := current_setting('wacrm.t11d.malformed')::uuid;
  v_stale uuid := current_setting('wacrm.t11d.stale')::uuid;
  v_text uuid := current_setting('wacrm.t11d.text')::uuid;
  v_tenant uuid := current_setting('wacrm.t11d.tenant')::uuid;
  v_outcome text;
  v_message uuid;
  v_conversation uuid;
  v_preview text;
  v_unread integer;
BEGIN
  SELECT r.outcome,r.message_row_id INTO v_outcome,v_message
    FROM public.apply_evolution_event(v_media,current_setting('wacrm.t11d.token_media')::uuid) r;
  IF v_outcome <> 'applied' OR NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id=v_message AND m.provider_connection_id=v_connection
      AND m.message_id='t11d-image-001' AND m.content_type='image' AND m.content_text IS NULL
      AND m.media_type='image/jpeg' AND m.media_url=('/api/whatsapp/media/' || v_media::text)
  ) OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches d WHERE d.event_id=v_media) THEN
    RAISE EXCEPTION 'staged media did not create one internal-URL message without dispatch roots';
  END IF;
  SELECT c.id,c.last_message_text,c.unread_count INTO STRICT v_conversation,v_preview,v_unread
    FROM public.conversations c JOIN public.contacts p ON p.id=c.contact_id
   WHERE c.account_id=v_account AND p.phone_normalized='15550000111';
  IF v_preview IS NOT NULL OR v_unread <> 1 THEN
    RAISE EXCEPTION 'media preview/unread contract differs';
  END IF;

  SELECT r.outcome,r.message_row_id INTO v_outcome,v_message
    FROM public.apply_evolution_event(v_media,pg_catalog.gen_random_uuid()) r;
  IF v_outcome <> 'duplicate' OR v_message IS NULL
     OR (SELECT c.unread_count FROM public.conversations c WHERE c.id=v_conversation) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.messages m WHERE m.provider_connection_id=v_connection AND m.message_id='t11d-image-001') <> 1 THEN
    RAISE EXCEPTION 'media replay was not idempotent';
  END IF;

  SELECT r.outcome INTO v_outcome
    FROM public.apply_evolution_event(v_malformed,current_setting('wacrm.t11d.token_malformed')::uuid) r;
  IF v_outcome <> 'failed'
     OR (SELECT e.last_error_code FROM public.evolution_events e WHERE e.id=v_malformed) <> 'invalid_media_event'
     OR EXISTS (SELECT 1 FROM public.messages m WHERE m.provider_connection_id=v_connection AND m.message_id='t11d-image-002') THEN
    RAISE EXCEPTION 'string mediaRef.version was not permanently rejected';
  END IF;

  BEGIN
    PERFORM 1 FROM public.apply_evolution_event(v_stale,current_setting('wacrm.t11d.token_stale')::uuid);
    RAISE EXCEPTION 'expired media lease unexpectedly applied';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF (SELECT e.state FROM public.evolution_events e WHERE e.id=v_stale) <> 'processing'
     OR EXISTS (SELECT 1 FROM public.messages m WHERE m.provider_connection_id=v_connection AND m.message_id='t11d-image-003') THEN
    RAISE EXCEPTION 'stale media lease changed event or message state';
  END IF;

  SELECT r.outcome INTO v_outcome
    FROM public.apply_evolution_event(v_tenant,current_setting('wacrm.t11d.token_tenant')::uuid) r;
  IF v_outcome <> 'failed'
     OR (SELECT e.last_error_code FROM public.evolution_events e WHERE e.id=v_tenant) <> 'invalid_media_event'
     OR EXISTS (SELECT 1 FROM public.messages m WHERE m.provider_connection_id=v_connection AND m.message_id='t11d-image-tenant') THEN
    RAISE EXCEPTION 'foreign account path was not permanently rejected';
  END IF;

  SELECT r.outcome,r.message_row_id INTO v_outcome,v_message
    FROM public.apply_evolution_event(v_text,current_setting('wacrm.t11d.token_text')::uuid) r;
  IF v_outcome <> 'applied' OR NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id=v_message AND m.content_type='text'
      AND m.content_text='synthetic text' AND m.media_url IS NULL AND m.media_type IS NULL
  ) THEN
    RAISE EXCEPTION 'existing text inbound path regressed';
  END IF;
END;
$assertions$;

ROLLBACK;
