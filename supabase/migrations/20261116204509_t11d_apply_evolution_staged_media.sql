CREATE OR REPLACE FUNCTION public.apply_evolution_event(
  p_event_id uuid,
  p_lease_token uuid
) RETURNS TABLE(
  outcome text,
  message_row_id uuid,
  retry_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_event public.evolution_events%ROWTYPE;
  v_account_id uuid;
  v_actor_id uuid;
  v_message jsonb;
  v_message_id text;
  v_peer text;
  v_phone_digits text;
  v_text text;
  v_content_type text;
  v_media_type text;
  v_media_url text;
  v_media_extension text;
  v_is_media boolean := false;
  v_occurred_at_text text;
  v_occurred_at timestamptz;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_row_id uuid;
  v_existing_conversation_id uuid;
  v_existing_content_type text;
  v_existing_text text;
  v_existing_media_type text;
  v_existing_media_url text;
  v_inserted boolean := false;
  v_payload_key_count integer;
BEGIN
  IF p_event_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid Evolution event application request' USING ERRCODE = '22023';
  END IF;

  SELECT e.*
    INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.state = 'done' THEN
    IF v_event.normalized_event ->> 'kind' = 'message' THEN
      SELECT m.id INTO v_message_row_id
        FROM public.messages AS m
       WHERE m.provider_connection_id = v_event.connection_id
         AND m.message_id = v_event.normalized_event ->> 'externalMessageId';
    END IF;
    RETURN QUERY SELECT 'duplicate'::text, v_message_row_id, NULL::timestamptz;
    RETURN;
  ELSIF v_event.state = 'failed' THEN
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_event.state IS DISTINCT FROM 'processing'
     OR v_event.lease_token IS DISTINCT FROM p_lease_token
     OR v_event.lease_until IS NULL
     OR v_event.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Evolution event lease is stale or expired' USING ERRCODE = '40001';
  END IF;

  SELECT c.account_id, c.created_by
    INTO v_account_id, v_actor_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_actor_id IS NULL THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'connection_unavailable', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'message' THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'unsupported_event_kind', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_message := v_event.normalized_event;
  SELECT pg_catalog.count(*)::integer INTO v_payload_key_count
    FROM pg_catalog.jsonb_object_keys(v_message) AS k(key);
  IF v_payload_key_count <> 10
     OR NOT (v_message ?& ARRAY[
       'kind', 'eventKey', 'externalMessageId', 'peer', 'occurredAt',
       'fromMe', 'sentByApi', 'contentType', 'text', 'mediaRef'
     ])
     OR pg_catalog.jsonb_typeof(v_message->'eventKey') IS DISTINCT FROM 'string'
     OR v_message->>'eventKey' IS DISTINCT FROM v_event.event_key
     OR pg_catalog.jsonb_typeof(v_message->'externalMessageId') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(v_message->>'externalMessageId') = ''
     OR pg_catalog.jsonb_typeof(v_message->'peer') IS DISTINCT FROM 'string'
     OR (v_message->>'peer') !~ '^\d{8,15}@s\.whatsapp\.net$'
     OR pg_catalog.jsonb_typeof(v_message->'occurredAt') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(v_message->'fromMe') IS DISTINCT FROM 'boolean'
     OR v_message->>'fromMe' IS DISTINCT FROM 'false'
     OR pg_catalog.jsonb_typeof(v_message->'sentByApi') IS DISTINCT FROM 'boolean'
     OR v_message->>'sentByApi' IS DISTINCT FROM 'false'
     OR pg_catalog.jsonb_typeof(v_message->'text') NOT IN ('string', 'null') THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_message_event', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_content_type := v_message->>'contentType';
  v_is_media := v_content_type IN ('image', 'document', 'audio', 'video');
  IF NOT v_is_media THEN
    IF pg_catalog.jsonb_typeof(v_message->'mediaRef') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(v_message->'contentType') IS DISTINCT FROM 'string'
       OR v_content_type IS DISTINCT FROM 'text'
       OR pg_catalog.jsonb_typeof(v_message->'text') IS DISTINCT FROM 'string'
       OR pg_catalog.btrim(v_message->>'text') = '' THEN
      UPDATE public.evolution_events AS e
         SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
             lease_until = NULL, lease_token = NULL,
             last_error_code = 'unsupported_message_content', updated_at = pg_catalog.clock_timestamp()
       WHERE e.id = p_event_id;
      RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    v_text := v_message->>'text';
  ELSE
    IF pg_catalog.jsonb_typeof(v_message->'text') IS DISTINCT FROM 'null'
       OR pg_catalog.jsonb_typeof(v_message->'mediaRef') IS DISTINCT FROM 'object' THEN
      UPDATE public.evolution_events AS e
         SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
             lease_until = NULL, lease_token = NULL,
             last_error_code = 'invalid_media_event', updated_at = pg_catalog.clock_timestamp()
       WHERE e.id = p_event_id;
      RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_message->'mediaRef')) <> 2
       OR NOT (v_message->'mediaRef' ?& ARRAY['version', 'key'])
       OR pg_catalog.jsonb_typeof(v_message->'mediaRef'->'version') IS DISTINCT FROM 'number'
       OR v_message->'mediaRef'->>'version' IS DISTINCT FROM '1'
       OR pg_catalog.jsonb_typeof(v_message->'mediaRef'->'key') IS DISTINCT FROM 'object' THEN
      UPDATE public.evolution_events AS e
         SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
             lease_until = NULL, lease_token = NULL,
             last_error_code = 'invalid_media_event', updated_at = pg_catalog.clock_timestamp()
       WHERE e.id = p_event_id;
      RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_message->'mediaRef'->'key')) <> 3
       OR NOT (v_message->'mediaRef'->'key' ?& ARRAY['remoteJid', 'id', 'fromMe'])
       OR pg_catalog.jsonb_typeof(v_message->'mediaRef'->'key'->'fromMe') IS DISTINCT FROM 'boolean'
       OR v_message->'mediaRef'->'key'->>'remoteJid' IS DISTINCT FROM v_message->>'peer'
       OR v_message->'mediaRef'->'key'->>'id' IS DISTINCT FROM v_message->>'externalMessageId'
       OR v_message->'mediaRef'->'key'->>'fromMe' IS DISTINCT FROM 'false'
       OR v_event.media_state IS DISTINCT FROM 'stored'
       OR v_event.media_storage_path IS NULL
       OR v_event.media_type IS NULL
       OR v_event.media_sha256 IS NULL
       OR v_event.media_size_bytes IS NULL
       OR v_event.media_filename IS NULL THEN
      UPDATE public.evolution_events AS e
         SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
             lease_until = NULL, lease_token = NULL,
             last_error_code = 'media_not_staged', updated_at = pg_catalog.clock_timestamp()
       WHERE e.id = p_event_id;
      RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    v_media_extension := CASE v_event.media_type
      WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
      WHEN 'image/webp' THEN 'webp' WHEN 'image/gif' THEN 'gif'
      WHEN 'application/pdf' THEN 'pdf' WHEN 'application/msword' THEN 'doc'
      WHEN 'application/vnd.ms-excel' THEN 'xls' WHEN 'application/vnd.ms-powerpoint' THEN 'ppt'
      WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx'
      WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN 'xlsx'
      WHEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation' THEN 'pptx'
      WHEN 'text/plain' THEN 'txt' WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/opus' THEN 'opus'
      WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/aac' THEN 'aac' WHEN 'audio/mp4' THEN 'm4a'
      WHEN 'audio/amr' THEN 'amr' WHEN 'video/mp4' THEN 'mp4' WHEN 'video/3gpp' THEN '3gp'
      WHEN 'video/3gp' THEN '3gp' WHEN 'video/quicktime' THEN 'mov' ELSE NULL END;
    IF v_media_extension IS NULL
       OR (CASE WHEN v_event.media_type IN ('image/jpeg','image/png','image/webp','image/gif') THEN 'image'
                WHEN v_event.media_type IN ('application/pdf','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain') THEN 'document'
                WHEN v_event.media_type IN ('audio/ogg','audio/opus','audio/mpeg','audio/aac','audio/mp4','audio/amr') THEN 'audio'
                WHEN v_event.media_type IN ('video/mp4','video/3gpp','video/3gp','video/quicktime') THEN 'video' ELSE NULL END) IS DISTINCT FROM v_content_type
       OR v_event.media_storage_path IS DISTINCT FROM
          ('account-' || v_account_id::text || '/evolution/' || v_event.id::text || '/payload.' || v_media_extension)
       OR v_event.media_sha256 !~ '^[a-f0-9]{64}$'
       OR v_event.media_size_bytes NOT BETWEEN 1 AND 16777216 THEN
      UPDATE public.evolution_events AS e
         SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
             lease_until = NULL, lease_token = NULL,
             last_error_code = 'invalid_media_event', updated_at = pg_catalog.clock_timestamp()
       WHERE e.id = p_event_id;
      RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    v_text := NULL;
    v_media_type := v_event.media_type;
    v_media_url := '/api/whatsapp/media/' || v_event.id::text;
  END IF;

  v_message_id := v_message->>'externalMessageId';
  v_peer := v_message->>'peer';
  v_phone_digits := pg_catalog.regexp_replace(v_peer, '@s\.whatsapp\.net$', '');
  v_occurred_at_text := v_message->>'occurredAt';
  IF v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_message_event', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  BEGIN
    v_occurred_at := v_occurred_at_text::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_message_event', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END;
  IF NOT pg_catalog.isfinite(v_occurred_at) THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_message_event', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_actor_id, v_account_id, '+' || v_phone_digits, '+' || v_phone_digits)
  ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
  RETURNING id INTO v_contact_id;
  IF v_contact_id IS NULL THEN
    SELECT c.id INTO v_contact_id
      FROM public.contacts AS c
     WHERE c.account_id = v_account_id
       AND c.phone_normalized = v_phone_digits
     FOR UPDATE;
  END IF;
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'Evolution inbound contact resolution failed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_actor_id, v_account_id, v_contact_id, 'open')
  ON CONFLICT (account_id, contact_id) DO NOTHING
  RETURNING id INTO v_conversation_id;
  IF v_conversation_id IS NULL THEN
    SELECT c.id INTO v_conversation_id
      FROM public.conversations AS c
     WHERE c.account_id = v_account_id AND c.contact_id = v_contact_id
     FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.conversations AS c
     WHERE c.id = v_conversation_id
     FOR UPDATE;
  END IF;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Evolution inbound conversation resolution failed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text,
    message_id, status, created_at, ai_generated, provider_connection_id, media_url, media_type
  ) VALUES (
    v_conversation_id, 'customer', v_actor_id, v_content_type, v_text,
    v_message_id, 'sent', v_occurred_at, false, v_event.connection_id, v_media_url, v_media_type
  )
  ON CONFLICT (provider_connection_id, message_id)
    WHERE provider_connection_id IS NOT NULL AND message_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_message_row_id;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT m.id, m.conversation_id, m.content_type, m.content_text, m.media_type, m.media_url
      INTO v_message_row_id, v_existing_conversation_id, v_existing_content_type, v_existing_text, v_existing_media_type, v_existing_media_url
      FROM public.messages AS m
     WHERE m.provider_connection_id = v_event.connection_id
       AND m.message_id = v_message_id
     FOR SHARE;
    IF NOT FOUND
       OR v_existing_conversation_id IS DISTINCT FROM v_conversation_id
       OR v_existing_content_type IS DISTINCT FROM v_content_type
       OR v_existing_text IS DISTINCT FROM v_text
       OR v_existing_media_type IS DISTINCT FROM v_media_type
       OR v_existing_media_url IS DISTINCT FROM v_media_url THEN
      RAISE EXCEPTION 'Evolution message ID conflicts with existing content or conversation' USING ERRCODE = '23505';
    END IF;
    UPDATE public.evolution_events AS e
       SET state = 'done', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL, last_error_code = NULL,
           updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id AND e.state = 'processing' AND e.lease_token = p_lease_token
       AND e.lease_until > pg_catalog.clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION 'Evolution event lease is stale or expired' USING ERRCODE = '40001'; END IF;
    RETURN QUERY SELECT 'duplicate'::text, v_message_row_id, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM public.bump_conversation_on_inbound(v_conversation_id, CASE WHEN v_is_media THEN NULL ELSE v_text END);

  IF NOT v_is_media THEN
  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, automation_id, user_id, contact_id, conversation_id
  )
  SELECT v_event.id, v_account_id, 'automation', a.id, a.user_id, v_contact_id, v_conversation_id
    FROM public.automations AS a
   WHERE a.account_id = v_account_id AND a.is_active
  ON CONFLICT (event_id, automation_id) WHERE engine = 'automation' DO NOTHING;

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, flow_id, user_id, contact_id, conversation_id
  )
  SELECT v_event.id, v_account_id, 'flow', f.id, f.user_id, v_contact_id, v_conversation_id
    FROM public.flows AS f
   WHERE f.account_id = v_account_id AND f.status = 'active'
  ON CONFLICT (event_id, flow_id) WHERE engine = 'flow' DO NOTHING;

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, ai_config_id, user_id, contact_id, conversation_id
  )
  SELECT v_event.id, v_account_id, 'ai', a.id, a.created_by, v_contact_id, v_conversation_id
    FROM public.ai_configs AS a
   WHERE a.account_id = v_account_id
     AND a.is_active AND a.auto_reply_enabled
     AND a.created_by IS NOT NULL
  ON CONFLICT (event_id, ai_config_id) WHERE engine = 'ai' DO NOTHING;

  END IF;

  UPDATE public.evolution_events AS e
     SET state = 'done', processed_at = pg_catalog.clock_timestamp(),
         lease_until = NULL, lease_token = NULL, last_error_code = NULL,
         updated_at = pg_catalog.clock_timestamp()
   WHERE e.id = p_event_id AND e.state = 'processing' AND e.lease_token = p_lease_token
     AND e.lease_until > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Evolution event lease is stale or expired' USING ERRCODE = '40001'; END IF;

  RETURN QUERY SELECT 'applied'::text, v_message_row_id, NULL::timestamptz;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_evolution_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evolution_event(uuid, uuid)
  TO service_role;
