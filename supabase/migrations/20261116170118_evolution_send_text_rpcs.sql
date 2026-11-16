-- Keep the existing server-side trigger usable from its trigger context,
-- while removing direct EXECUTE from client roles and PUBLIC.
REVOKE ALL ON FUNCTION public.guard_message_provider_connection_namespace()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_message_provider_connection_namespace()
  TO service_role;

CREATE OR REPLACE FUNCTION public.track_conversation_message_times()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sender_type = 'customer' THEN
      UPDATE conversations
         SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, NEW.created_at), NEW.created_at)
       WHERE id = NEW.conversation_id;
    ELSIF (NEW.sender_type = 'agent' OR NEW.ai_generated)
      AND (
        (NEW.provider_connection_id IS NULL AND NEW.status IS DISTINCT FROM 'failed')
        OR (NEW.provider_connection_id IS NOT NULL AND NEW.status IN ('sent', 'delivered', 'read'))
      ) THEN
      UPDATE conversations
         SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
       WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.status = 'failed'
    AND OLD.status IS DISTINCT FROM 'failed'
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
       SET last_reply_at = (
         SELECT max(m.created_at)
           FROM messages AS m
          WHERE m.conversation_id = NEW.conversation_id
            AND (m.sender_type = 'agent' OR m.ai_generated)
            AND (
              (m.provider_connection_id IS NULL AND m.status <> 'failed')
              OR (m.provider_connection_id IS NOT NULL AND m.status IN ('sent', 'delivered', 'read'))
            )
       )
     WHERE id = NEW.conversation_id;
  ELSIF NEW.provider_connection_id IS NOT NULL
    AND OLD.provider_connection_id IS NOT NULL
    AND OLD.status = 'sending'
    AND NEW.status IN ('sent', 'delivered', 'read')
    AND (NEW.sender_type = 'agent' OR NEW.ai_generated) THEN
    UPDATE conversations
       SET last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
     WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.reserve_evolution_send(
  p_connection_id uuid,
  p_request_id text,
  p_request_hash text,
  p_conversation_id uuid,
  p_sender_type text,
  p_sender_id uuid,
  p_message jsonb
) RETURNS TABLE(
  attempt_id uuid,
  message_row_id uuid,
  outcome text,
  should_send boolean
)
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
  v_reply_to_message_id uuid;
  v_content_text text;
  v_ai_generated boolean := false;
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_inserted boolean := false;
  v_request_hash text;
  v_key text;
BEGIN
  IF p_connection_id IS NULL OR p_conversation_id IS NULL
     OR p_sender_id IS NULL OR p_sender_type IS NULL
     OR p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = ''
     OR pg_catalog.char_length(p_request_id) > 200
     OR p_request_hash IS NULL OR p_request_hash !~* '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid Evolution send reservation' USING ERRCODE = '22023';
  END IF;
  IF p_sender_type NOT IN ('agent', 'bot') THEN
    RAISE EXCEPTION 'Invalid Evolution message author type' USING ERRCODE = '22023';
  END IF;
  IF p_message IS NULL OR pg_catalog.jsonb_typeof(p_message) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Evolution text payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_message) AS k(key)
     WHERE k.key NOT IN (
       'content_type', 'content_text', 'media_url', 'media_type', 'template_name',
       'reply_to_message_id', 'interactive_reply_id', 'interactive_payload', 'ai_generated'
     )
  ) THEN
    RAISE EXCEPTION 'Evolution text payload contains an unsupported key' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_message ? 'content_type')
     OR pg_catalog.jsonb_typeof(p_message->'content_type') IS DISTINCT FROM 'string'
     OR p_message->>'content_type' IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Only text content is supported for Evolution send reservation' USING ERRCODE = '22023';
  END IF;
  IF p_message ? 'content_text'
     AND pg_catalog.jsonb_typeof(p_message->'content_text') NOT IN ('null', 'string') THEN
    RAISE EXCEPTION 'content_text must be a string or null' USING ERRCODE = '22023';
  END IF;
  IF p_message ? 'ai_generated'
     AND pg_catalog.jsonb_typeof(p_message->'ai_generated') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'ai_generated must be a non-null boolean' USING ERRCODE = '22023';
  END IF;
  IF p_message ? 'reply_to_message_id'
     AND pg_catalog.jsonb_typeof(p_message->'reply_to_message_id') NOT IN ('null', 'string') THEN
    RAISE EXCEPTION 'reply_to_message_id must be a UUID string or null' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['media_url', 'media_type', 'template_name', 'interactive_reply_id', 'interactive_payload'] LOOP
    IF p_message ? v_key
       AND pg_catalog.jsonb_typeof(p_message->v_key) IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'This Evolution message capability is not enabled' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_content_text := p_message->>'content_text';
  IF p_message ? 'ai_generated' THEN
    v_ai_generated := (p_message->>'ai_generated')::boolean;
  END IF;
  IF p_message ? 'reply_to_message_id'
     AND pg_catalog.jsonb_typeof(p_message->'reply_to_message_id') = 'string' THEN
    BEGIN
      v_reply_to_message_id := (p_message->>'reply_to_message_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'reply_to_message_id must be a UUID' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT c.account_id
    INTO v_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = p_connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution connection is not available to this reservation' USING ERRCODE = '42501';
  END IF;

  SELECT c.account_id, c.contact_id
    INTO v_conversation_account_id, v_contact_id
    FROM public.conversations AS c
   WHERE c.id = p_conversation_id
   FOR SHARE;
  IF NOT FOUND OR v_conversation_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Evolution connection and conversation must belong to one account' USING ERRCODE = '42501';
  END IF;

  SELECT c.account_id
    INTO v_contact_account_id
    FROM public.contacts AS c
   WHERE c.id = v_contact_id
   FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Conversation contact must belong to the connection account' USING ERRCODE = '42501';
  END IF;

  SELECT p.account_id
    INTO v_sender_account_id
    FROM public.profiles AS p
   WHERE p.user_id = p_sender_id
   FOR SHARE;
  IF NOT FOUND OR v_sender_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Message author must be a member of the connection account' USING ERRCODE = '42501';
  END IF;

  IF v_reply_to_message_id IS NOT NULL THEN
    PERFORM m.id
      FROM public.messages AS m
      JOIN public.conversations AS c ON c.id = m.conversation_id
     WHERE m.id = v_reply_to_message_id
       AND m.conversation_id = p_conversation_id
       AND c.account_id = v_account_id
     FOR KEY SHARE OF m, c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reply target must belong to the same conversation and account' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_request_hash := pg_catalog.lower(p_request_hash);
  SELECT a.*
    INTO v_attempt
    FROM public.evolution_send_attempts AS a
   WHERE a.account_id = v_account_id
     AND a.request_id = p_request_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_attempt.request_hash <> v_request_hash
       OR v_attempt.connection_id <> p_connection_id
       OR v_attempt.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Evolution request ID conflicts with its existing reservation' USING ERRCODE = '23505';
    END IF;
    IF v_attempt.outcome = 'pending'
       AND v_attempt.created_at < pg_catalog.clock_timestamp() - interval '120 seconds' THEN
      UPDATE public.evolution_send_attempts AS a
         SET outcome = 'unknown', error_code = 'pending_expired', updated_at = pg_catalog.clock_timestamp()
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
  )
  ON CONFLICT (account_id, request_id) DO NOTHING
  RETURNING a.* INTO v_attempt;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT a.*
      INTO STRICT v_attempt
      FROM public.evolution_send_attempts AS a
     WHERE a.account_id = v_account_id
       AND a.request_id = p_request_id
     FOR UPDATE;
    IF v_attempt.request_hash <> v_request_hash
       OR v_attempt.connection_id <> p_connection_id
       OR v_attempt.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'Evolution request ID conflicts with its existing reservation' USING ERRCODE = '23505';
    END IF;
    IF v_attempt.outcome = 'pending'
       AND v_attempt.created_at < pg_catalog.clock_timestamp() - interval '120 seconds' THEN
      UPDATE public.evolution_send_attempts AS a
         SET outcome = 'unknown', error_code = 'pending_expired', updated_at = pg_catalog.clock_timestamp()
       WHERE a.id = v_attempt.id
      RETURNING a.* INTO v_attempt;
    END IF;
    RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, false;
    RETURN;
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_type, sender_id, content_type, content_text,
    message_id, status, reply_to_message_id, ai_generated, provider_connection_id
  ) VALUES (
    p_conversation_id, p_sender_type, p_sender_id, 'text', v_content_text,
    NULL, 'sending', v_reply_to_message_id, v_ai_generated, p_connection_id
  ) RETURNING id INTO v_attempt.message_row_id;

  UPDATE public.evolution_send_attempts AS a
     SET message_row_id = v_attempt.message_row_id,
         updated_at = pg_catalog.clock_timestamp()
   WHERE a.id = v_attempt.id
  RETURNING a.* INTO v_attempt;

  RETURN QUERY SELECT v_attempt.id, v_attempt.message_row_id, v_attempt.outcome, true;
END;
$function$;

CREATE FUNCTION public.complete_evolution_send(
  p_attempt_id uuid,
  p_outcome text,
  p_external_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS TABLE(
  attempt_id uuid,
  outcome text,
  message_row_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_connection_account_id uuid;
  v_conversation_account_id uuid;
  v_contact_id uuid;
  v_contact_account_id uuid;
  v_message public.messages%ROWTYPE;
  v_sender_account_id uuid;
  v_safe_error_code text;
BEGIN
  IF p_attempt_id IS NULL OR p_outcome IS NULL
     OR p_outcome NOT IN ('accepted', 'rejected', 'unknown') THEN
    RAISE EXCEPTION 'Invalid Evolution send completion' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'accepted' THEN
    IF p_external_message_id IS NULL OR pg_catalog.btrim(p_external_message_id) = '' THEN
      RAISE EXCEPTION 'Accepted Evolution send requires an external message ID' USING ERRCODE = '22023';
    END IF;
    IF p_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'Accepted Evolution send cannot carry an error code' USING ERRCODE = '22023';
    END IF;
  ELSIF p_external_message_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only accepted Evolution sends may carry an external message ID' USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NULL THEN
    v_safe_error_code := NULL;
  ELSIF p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
    v_safe_error_code := p_error_code;
  ELSE
    v_safe_error_code := 'worker_error';
  END IF;

  SELECT a.*
    INTO v_attempt
    FROM public.evolution_send_attempts AS a
   WHERE a.id = p_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution send attempt not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.account_id
    INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_attempt.connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_attempt.account_id THEN
    RAISE EXCEPTION 'Evolution send attempt connection/account mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id, c.contact_id
    INTO v_conversation_account_id, v_contact_id
    FROM public.conversations AS c
   WHERE c.id = v_attempt.conversation_id
   FOR SHARE;
  IF NOT FOUND OR v_conversation_account_id IS DISTINCT FROM v_attempt.account_id THEN
    RAISE EXCEPTION 'Evolution send attempt conversation/account mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id
    INTO v_contact_account_id
    FROM public.contacts AS c
   WHERE c.id = v_contact_id
   FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_attempt.account_id THEN
    RAISE EXCEPTION 'Evolution send attempt contact/account mismatch' USING ERRCODE = '23514';
  END IF;

  IF v_attempt.message_row_id IS NULL THEN
    RAISE EXCEPTION 'Evolution send attempt has no linked message row' USING ERRCODE = '23514';
  END IF;
  SELECT m.*
    INTO v_message
    FROM public.messages AS m
   WHERE m.id = v_attempt.message_row_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_message.conversation_id IS DISTINCT FROM v_attempt.conversation_id
     OR v_message.provider_connection_id IS DISTINCT FROM v_attempt.connection_id
     OR v_message.sender_type NOT IN ('agent', 'bot')
     OR v_message.sender_id IS NULL THEN
    RAISE EXCEPTION 'Evolution send attempt message link is inconsistent' USING ERRCODE = '23514';
  END IF;
  SELECT p.account_id
    INTO v_sender_account_id
    FROM public.profiles AS p
   WHERE p.user_id = v_message.sender_id
   FOR SHARE;
  IF NOT FOUND OR v_sender_account_id IS DISTINCT FROM v_attempt.account_id THEN
    RAISE EXCEPTION 'Evolution send attempt author/account mismatch' USING ERRCODE = '23514';
  END IF;

  IF v_attempt.outcome IN ('accepted', 'rejected') THEN
    IF v_attempt.outcome = p_outcome
       AND v_attempt.external_message_id IS NOT DISTINCT FROM p_external_message_id
       AND v_attempt.error_code IS NOT DISTINCT FROM v_safe_error_code THEN
      RETURN QUERY SELECT v_attempt.id, v_attempt.outcome, v_attempt.message_row_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Terminal Evolution send outcome conflicts with the existing result' USING ERRCODE = '23505';
  ELSIF v_attempt.outcome = 'unknown' AND p_outcome = 'unknown' THEN
    IF v_attempt.external_message_id IS NULL
       AND v_safe_error_code IS NOT DISTINCT FROM v_attempt.error_code THEN
      RETURN QUERY SELECT v_attempt.id, v_attempt.outcome, v_attempt.message_row_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Unknown Evolution send result conflicts with the existing result' USING ERRCODE = '23505';
  ELSIF v_attempt.outcome NOT IN ('pending', 'unknown')
     OR (v_attempt.outcome = 'unknown' AND p_outcome NOT IN ('accepted', 'rejected')) THEN
    RAISE EXCEPTION 'Invalid Evolution send outcome transition' USING ERRCODE = '23514';
  END IF;

  IF p_outcome = 'accepted' THEN
    IF v_message.status = 'failed'
       OR (v_message.message_id IS NOT NULL AND v_message.message_id IS DISTINCT FROM p_external_message_id) THEN
      RAISE EXCEPTION 'Accepted Evolution send conflicts with the linked message state or ID' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.messages AS m
       WHERE m.provider_connection_id = v_attempt.connection_id
         AND m.message_id = p_external_message_id
         AND m.id <> v_message.id
    ) THEN
      RAISE EXCEPTION 'External message ID is already used in this connection namespace' USING ERRCODE = '23505';
    END IF;

    UPDATE public.evolution_send_attempts AS a
       SET outcome = 'accepted', external_message_id = p_external_message_id,
           error_code = NULL, updated_at = pg_catalog.clock_timestamp()
     WHERE a.id = v_attempt.id
    RETURNING a.* INTO v_attempt;
    UPDATE public.messages AS m
       SET message_id = p_external_message_id,
           status = CASE WHEN m.status = 'sending' THEN 'sent' ELSE m.status END
     WHERE m.id = v_message.id;
  ELSIF p_outcome = 'rejected' THEN
    IF v_message.status IN ('sent', 'delivered', 'read') THEN
      RAISE EXCEPTION 'Rejected Evolution send conflicts with an accepted message state' USING ERRCODE = '23505';
    END IF;
    UPDATE public.evolution_send_attempts AS a
       SET outcome = 'rejected', external_message_id = NULL,
           error_code = v_safe_error_code, updated_at = pg_catalog.clock_timestamp()
     WHERE a.id = v_attempt.id
    RETURNING a.* INTO v_attempt;
    UPDATE public.messages AS m
       SET status = CASE WHEN m.status = 'sending' THEN 'failed' ELSE m.status END
     WHERE m.id = v_message.id;
  ELSE
    UPDATE public.evolution_send_attempts AS a
       SET outcome = 'unknown', external_message_id = NULL,
           error_code = v_safe_error_code, updated_at = pg_catalog.clock_timestamp()
     WHERE a.id = v_attempt.id
    RETURNING a.* INTO v_attempt;
  END IF;

  RETURN QUERY SELECT v_attempt.id, v_attempt.outcome, v_attempt.message_row_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_evolution_send(uuid, text, text, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_evolution_send(uuid, text, text, uuid, text, uuid, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_evolution_send(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_send(uuid, text, text, text)
  TO service_role;
