CREATE FUNCTION public.reserve_evolution_interactive_send(
  p_connection_id uuid,
  p_request_id text,
  p_request_hash text,
  p_conversation_id uuid,
  p_sender_id uuid,
  p_message jsonb
) RETURNS TABLE(attempt_id uuid, message_row_id uuid, outcome text, should_send boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_account_id uuid;
  v_conversation_account_id uuid;
  v_contact_id uuid;
  v_contact_account_id uuid;
  v_sender_account_id uuid;
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_inserted boolean := false;
  v_existing boolean := false;
  v_request_hash text;
  v_payload jsonb;
  v_content_text text;
BEGIN
  IF p_connection_id IS NULL OR p_conversation_id IS NULL OR p_sender_id IS NULL
     OR p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = ''
     OR pg_catalog.char_length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~* '^[0-9a-f]{64}$'
     OR p_message IS NULL OR pg_catalog.jsonb_typeof(p_message) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Evolution interactive reservation' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_object_keys(p_message) AS k(key)
     WHERE k.key NOT IN ('content_type', 'content_text', 'interactive_payload')
  ) OR p_message->>'content_type' IS DISTINCT FROM 'interactive'
     OR pg_catalog.jsonb_typeof(p_message->'content_text') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(p_message->>'content_text') = ''
     OR pg_catalog.jsonb_typeof(p_message->'interactive_payload') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid Evolution interactive message' USING ERRCODE = '22023';
  END IF;
  v_content_text := p_message->>'content_text';
  v_payload := p_message->'interactive_payload';
  IF COALESCE(v_payload->>'kind', '') NOT IN ('buttons', 'list')
     OR v_payload->>'requestId' IS DISTINCT FROM p_request_id
     OR COALESCE(v_payload->>'recipient', '') !~ '^[0-9]{8,15}@s\.whatsapp\.net$'
     OR pg_catalog.jsonb_typeof(v_payload->'title') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid Evolution interactive payload' USING ERRCODE = '22023';
  END IF;
  IF (v_payload->>'kind' = 'buttons' AND
      (pg_catalog.jsonb_typeof(v_payload->'buttons') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_payload->'buttons') NOT BETWEEN 1 AND 3))
     OR (v_payload->>'kind' = 'list' AND
      (pg_catalog.jsonb_typeof(v_payload->'sections') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_payload->'sections') < 1)) THEN
    RAISE EXCEPTION 'Invalid Evolution interactive options' USING ERRCODE = '22023';
  END IF;

  SELECT c.account_id INTO v_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = p_connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution connection is unavailable' USING ERRCODE = '42501';
  END IF;

  -- Match reserve_evolution_send and complete_evolution_send lock order.
  SELECT c.account_id, c.contact_id INTO v_conversation_account_id, v_contact_id
    FROM public.conversations AS c
   WHERE c.id = p_conversation_id
   FOR UPDATE;
  IF NOT FOUND OR v_conversation_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Evolution conversation/account mismatch' USING ERRCODE = '42501';
  END IF;
  v_request_hash := pg_catalog.lower(p_request_hash);
  SELECT a.* INTO v_attempt
    FROM public.evolution_send_attempts AS a
   WHERE a.account_id = v_account_id AND a.request_id = p_request_id
   FOR UPDATE;
  v_existing := FOUND;
  IF v_existing AND (
    v_attempt.request_hash <> v_request_hash OR
    v_attempt.connection_id <> p_connection_id OR
    v_attempt.conversation_id <> p_conversation_id
  ) THEN
    RAISE EXCEPTION 'Evolution request ID conflicts with its existing reservation' USING ERRCODE = '23505';
  END IF;

  SELECT c.account_id INTO v_contact_account_id
    FROM public.contacts AS c
   WHERE c.id = v_contact_id
   FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Conversation contact/account mismatch' USING ERRCODE = '42501';
  END IF;
  SELECT p.account_id INTO v_sender_account_id
    FROM public.profiles AS p
   WHERE p.user_id = p_sender_id
   FOR SHARE;
  IF NOT FOUND OR v_sender_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Message author/account mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_existing THEN
    IF v_attempt.outcome = 'pending'
       AND v_attempt.created_at < pg_catalog.clock_timestamp() - interval '120 seconds' THEN
      UPDATE public.evolution_send_attempts AS a
         SET outcome = 'unknown', error_code = 'pending_expired',
             updated_at = pg_catalog.clock_timestamp()
       WHERE a.id = v_attempt.id
      RETURNING a.* INTO v_attempt;
    END IF;
    RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, false;
    RETURN;
  END IF;

  INSERT INTO public.evolution_send_attempts AS a (
    account_id, connection_id, request_id, request_hash, conversation_id
  ) VALUES (
    v_account_id, p_connection_id, p_request_id, v_request_hash, p_conversation_id
  ) ON CONFLICT (account_id, request_id) DO NOTHING
  RETURNING a.* INTO v_attempt;
  v_inserted := FOUND;
  IF NOT v_inserted THEN
    SELECT a.* INTO STRICT v_attempt
      FROM public.evolution_send_attempts AS a
     WHERE a.account_id = v_account_id AND a.request_id = p_request_id;
    IF v_attempt.request_hash <> v_request_hash
       OR v_attempt.connection_id <> p_connection_id
       OR v_attempt.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Evolution request ID conflicts with its existing reservation' USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'Concurrent Evolution reservation must be retried' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text,
    interactive_payload, message_id, status, provider_connection_id
  ) VALUES (
    p_conversation_id, 'bot', p_sender_id, 'interactive', v_content_text,
    v_payload, NULL, 'sending', p_connection_id
  ) RETURNING id INTO v_attempt.message_row_id;

  UPDATE public.evolution_send_attempts AS a
     SET message_row_id = v_attempt.message_row_id,
         updated_at = pg_catalog.clock_timestamp()
   WHERE a.id = v_attempt.id
  RETURNING a.* INTO v_attempt;

  RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_evolution_interactive_send(uuid, text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_evolution_interactive_send(uuid, text, text, uuid, uuid, jsonb)
  TO service_role;
