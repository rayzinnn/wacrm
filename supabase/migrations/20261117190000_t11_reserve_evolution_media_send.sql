CREATE FUNCTION public.reserve_evolution_media_send(
  p_connection_id uuid,
  p_request_id text,
  p_request_hash text,
  p_conversation_id uuid,
  p_sender_id uuid,
  p_content_type text,
  p_media_type text,
  p_content_text text DEFAULT NULL
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
  v_inserted boolean;
BEGIN
  IF p_connection_id IS NULL OR p_conversation_id IS NULL OR p_sender_id IS NULL
     OR p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = ''
     OR pg_catalog.char_length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~* '^[0-9a-f]{64}$'
     OR p_content_type IS NULL OR p_content_type NOT IN ('image', 'document')
     OR p_media_type IS NULL
     OR (p_content_type = 'image' AND p_media_type NOT IN ('image/jpeg', 'image/png'))
     OR (p_content_type = 'document' AND p_media_type IS DISTINCT FROM 'application/pdf')
     OR (p_content_text IS NOT NULL AND pg_catalog.char_length(p_content_text) > 4096) THEN
    RAISE EXCEPTION 'Invalid Evolution media reservation' USING ERRCODE = '22023';
  END IF;

  SELECT c.account_id INTO v_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = p_connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution connection is not available to this reservation' USING ERRCODE = '42501';
  END IF;

  -- Match the text reservation lock order: connection, conversation, attempt.
  SELECT c.account_id, c.contact_id INTO v_conversation_account_id, v_contact_id
    FROM public.conversations AS c WHERE c.id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_conversation_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Evolution connection and conversation must belong to one account' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_attempt FROM public.evolution_send_attempts AS a
   WHERE a.account_id = v_account_id AND a.request_id = p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> pg_catalog.lower(p_request_hash)
       OR v_attempt.connection_id <> p_connection_id
       OR v_attempt.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Evolution request ID conflicts with its existing reservation' USING ERRCODE = '23505';
    END IF;
    IF v_attempt.outcome = 'pending'
       AND v_attempt.created_at < pg_catalog.clock_timestamp() - interval '120 seconds' THEN
      UPDATE public.evolution_send_attempts AS a
         SET outcome = 'unknown', error_code = 'pending_expired', updated_at = pg_catalog.clock_timestamp()
       WHERE a.id = v_attempt.id RETURNING a.* INTO v_attempt;
    END IF;
    RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, false;
    RETURN;
  END IF;

  SELECT c.account_id INTO v_contact_account_id
    FROM public.contacts AS c WHERE c.id = v_contact_id FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Conversation contact must belong to the connection account' USING ERRCODE = '42501';
  END IF;
  SELECT p.account_id INTO v_sender_account_id
    FROM public.profiles AS p WHERE p.user_id = p_sender_id FOR SHARE;
  IF NOT FOUND OR v_sender_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Media sender and contact must belong to the connection account' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.evolution_send_attempts AS a (
    account_id, connection_id, request_id, request_hash, conversation_id
  ) VALUES (v_account_id, p_connection_id, p_request_id, pg_catalog.lower(p_request_hash), p_conversation_id)
  ON CONFLICT (account_id, request_id) DO NOTHING
  RETURNING a.* INTO v_attempt;
  v_inserted := FOUND;
  IF NOT v_inserted THEN
    RAISE EXCEPTION 'Concurrent Evolution media reservation must be retried' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text,
    media_type, message_id, status, provider_connection_id
  ) VALUES (
    p_conversation_id, 'agent', p_sender_id, p_content_type, p_content_text,
    p_media_type, NULL, 'sending', p_connection_id
  ) RETURNING id INTO v_attempt.message_row_id;

  UPDATE public.evolution_send_attempts AS a
     SET message_row_id = v_attempt.message_row_id, updated_at = pg_catalog.clock_timestamp()
   WHERE a.id = v_attempt.id RETURNING a.* INTO v_attempt;
  RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_evolution_media_send(uuid, text, text, uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_evolution_media_send(uuid, text, text, uuid, uuid, text, text, text)
  TO service_role;
