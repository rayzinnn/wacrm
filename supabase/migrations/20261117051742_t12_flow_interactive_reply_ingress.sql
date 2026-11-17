CREATE OR REPLACE FUNCTION public.apply_evolution_interactive_reply(
  p_event_id uuid,
  p_lease_token uuid
) RETURNS TABLE(outcome text, message_row_id uuid, retry_at timestamptz)
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
  v_reply_id text;
  v_reply_kind text;
  v_text text;
  v_occurred_at_text text;
  v_occurred_at timestamptz;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_row_id uuid;
  v_existing_conversation_id uuid;
  v_existing_content_type text;
  v_existing_text text;
  v_existing_reply_id text;
  v_key_count integer;
  v_inserted boolean := false;
BEGIN
  IF p_event_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid interactive Evolution event request' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution event not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_event.state = 'done' THEN
    SELECT m.id INTO v_message_row_id
      FROM public.messages AS m
     WHERE m.provider_connection_id = v_event.connection_id
       AND m.message_id = v_event.normalized_event->>'externalMessageId';
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

  SELECT c.account_id, c.created_by INTO v_account_id, v_actor_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id AND c.provider = 'evolution'
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
  PERFORM 1 FROM public.profiles AS p
   WHERE p.user_id = v_actor_id AND p.account_id = v_account_id
   FOR SHARE;
  IF NOT FOUND THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'connection_unavailable', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_message := v_event.normalized_event;
  IF pg_catalog.jsonb_typeof(v_message) IS DISTINCT FROM 'object' THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_interactive_reply', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_key_count
    FROM pg_catalog.jsonb_object_keys(v_message) AS k(key);
  IF v_key_count <> 12
     OR NOT (v_message ?& ARRAY[
       'kind', 'eventKey', 'externalMessageId', 'peer', 'occurredAt',
       'fromMe', 'sentByApi', 'contentType', 'text', 'mediaRef',
       'interactiveReplyId', 'interactiveReplyKind'
     ])
     OR v_message->>'kind' IS DISTINCT FROM 'message'
     OR v_message->>'eventKey' IS DISTINCT FROM v_event.event_key
     OR pg_catalog.jsonb_typeof(v_message->'externalMessageId') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(v_message->>'externalMessageId') = ''
     OR pg_catalog.length(v_message->>'externalMessageId') > 200
     OR (v_message->>'externalMessageId') !~ '^[A-Za-z0-9_.:-]+$'
     OR pg_catalog.jsonb_typeof(v_message->'peer') IS DISTINCT FROM 'string'
     OR (v_message->>'peer') !~ '^\d{8,15}@s\.whatsapp\.net$'
     OR pg_catalog.jsonb_typeof(v_message->'occurredAt') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(v_message->'fromMe') IS DISTINCT FROM 'boolean'
     OR v_message->>'fromMe' IS DISTINCT FROM 'false'
     OR pg_catalog.jsonb_typeof(v_message->'sentByApi') IS DISTINCT FROM 'boolean'
     OR v_message->>'sentByApi' IS DISTINCT FROM 'false'
     OR v_message->>'contentType' IS DISTINCT FROM 'interactive'
     OR pg_catalog.jsonb_typeof(v_message->'mediaRef') IS DISTINCT FROM 'null'
     OR (pg_catalog.jsonb_typeof(v_message->'text') NOT IN ('string', 'null'))
     OR (pg_catalog.jsonb_typeof(v_message->'text') = 'string'
         AND (pg_catalog.btrim(v_message->>'text') = ''
              OR v_message->>'text' <> pg_catalog.btrim(v_message->>'text')
              OR (v_message->>'text') ~ '[[:cntrl:]]'
              OR pg_catalog.length(v_message->>'text') > 1024))
     OR pg_catalog.jsonb_typeof(v_message->'interactiveReplyId') IS DISTINCT FROM 'string'
     OR pg_catalog.length(v_message->>'interactiveReplyId') NOT BETWEEN 1 AND 200
     OR v_message->>'interactiveReplyId' <> pg_catalog.btrim(v_message->>'interactiveReplyId')
     OR (v_message->>'interactiveReplyId') ~ '[[:cntrl:]]'
     OR pg_catalog.jsonb_typeof(v_message->'interactiveReplyKind') IS DISTINCT FROM 'string'
     OR v_message->>'interactiveReplyKind' NOT IN ('button', 'list') THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_interactive_reply', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_message_id := v_message->>'externalMessageId';
  v_peer := v_message->>'peer';
  v_phone_digits := pg_catalog.regexp_replace(v_peer, '@s\.whatsapp\.net$', '');
  v_reply_id := v_message->>'interactiveReplyId';
  v_reply_kind := v_message->>'interactiveReplyKind';
  v_text := COALESCE(
    v_message->>'text',
    CASE WHEN v_reply_kind = 'list' THEN '[List selection]' ELSE '[Button selection]' END
  );
  v_occurred_at_text := v_message->>'occurredAt';
  IF v_occurred_at_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_interactive_reply', updated_at = pg_catalog.clock_timestamp()
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
           last_error_code = 'invalid_interactive_reply', updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'failed'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END;
  IF NOT pg_catalog.isfinite(v_occurred_at) THEN
    UPDATE public.evolution_events AS e
       SET state = 'failed', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL,
           last_error_code = 'invalid_interactive_reply', updated_at = pg_catalog.clock_timestamp()
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
     WHERE c.account_id = v_account_id AND c.phone_normalized = v_phone_digits
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
    PERFORM 1 FROM public.conversations AS c WHERE c.id = v_conversation_id FOR UPDATE;
  END IF;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Evolution inbound conversation resolution failed' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text,
    interactive_reply_id, message_id, status, created_at, ai_generated, provider_connection_id
  ) VALUES (
    v_conversation_id, 'customer', v_actor_id, 'interactive', v_text,
    v_reply_id, v_message_id, 'sent', v_occurred_at, false, v_event.connection_id
  )
  ON CONFLICT (provider_connection_id, message_id)
    WHERE provider_connection_id IS NOT NULL AND message_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_message_row_id;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT m.id, m.conversation_id, m.content_type, m.content_text, m.interactive_reply_id
      INTO v_message_row_id, v_existing_conversation_id, v_existing_content_type,
           v_existing_text, v_existing_reply_id
      FROM public.messages AS m
     WHERE m.provider_connection_id = v_event.connection_id AND m.message_id = v_message_id
     FOR SHARE;
    IF NOT FOUND OR v_existing_conversation_id IS DISTINCT FROM v_conversation_id
       OR v_existing_content_type IS DISTINCT FROM 'interactive'
       OR v_existing_text IS DISTINCT FROM v_text
       OR v_existing_reply_id IS DISTINCT FROM v_reply_id THEN
      RAISE EXCEPTION 'Evolution interactive message conflicts with existing message' USING ERRCODE = '23505';
    END IF;
    UPDATE public.evolution_events AS e
       SET state = 'done', processed_at = pg_catalog.clock_timestamp(),
           lease_until = NULL, lease_token = NULL, last_error_code = NULL,
           updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id;
    RETURN QUERY SELECT 'duplicate'::text, v_message_row_id, NULL::timestamptz;
    RETURN;
  END IF;

  PERFORM public.bump_conversation_on_inbound(v_conversation_id, v_text);

  INSERT INTO public.evolution_event_dispatches (
    event_id, account_id, engine, flow_id, user_id, flow_run_id, contact_id, conversation_id
  )
  SELECT v_event.id, v_account_id, 'flow', f.id, f.user_id, r.id, v_contact_id, v_conversation_id
    FROM public.flow_runs AS r
    JOIN public.flows AS f
      ON f.id = r.flow_id AND f.account_id = r.account_id AND f.user_id = r.user_id
    JOIN public.flow_nodes AS n
      ON n.flow_id = r.flow_id AND n.node_key = r.current_node_key
   WHERE r.account_id = v_account_id
     AND r.contact_id = v_contact_id
     AND r.conversation_id = v_conversation_id
     AND r.status = 'active'
     AND f.status = 'active'
     AND ((v_reply_kind = 'button' AND n.node_type = 'send_buttons'
           AND pg_catalog.jsonb_typeof(n.config->'buttons') = 'array'
           AND EXISTS (
             SELECT 1 FROM pg_catalog.jsonb_array_elements(
               CASE WHEN pg_catalog.jsonb_typeof(n.config->'buttons') = 'array'
                    THEN n.config->'buttons' ELSE '[]'::jsonb END
             ) AS choice(value)
              WHERE choice.value->>'reply_id' = v_reply_id
           ))
       OR (v_reply_kind = 'list' AND n.node_type = 'send_list'
           AND pg_catalog.jsonb_typeof(n.config->'sections') = 'array'
           AND EXISTS (
             SELECT 1
               FROM pg_catalog.jsonb_array_elements(
                 CASE WHEN pg_catalog.jsonb_typeof(n.config->'sections') = 'array'
                      THEN n.config->'sections' ELSE '[]'::jsonb END
               ) AS section(value)
               CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
                 CASE WHEN pg_catalog.jsonb_typeof(section.value->'rows') = 'array'
                      THEN section.value->'rows' ELSE '[]'::jsonb END
               ) AS row_item(value)
              WHERE row_item.value->>'reply_id' = v_reply_id
           ))
     )
  ON CONFLICT (event_id, flow_id) WHERE engine = 'flow' DO NOTHING;

  UPDATE public.evolution_events AS e
     SET state = 'done', processed_at = pg_catalog.clock_timestamp(),
         lease_until = NULL, lease_token = NULL, last_error_code = NULL,
         updated_at = pg_catalog.clock_timestamp()
   WHERE e.id = p_event_id;

  RETURN QUERY SELECT 'applied'::text, v_message_row_id, NULL::timestamptz;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_evolution_interactive_reply(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evolution_interactive_reply(uuid, uuid)
  TO service_role;
