CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot_for_dispatch(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_max_replies integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_connection_account_id uuid;
  v_ai_config public.ai_configs%ROWTYPE;
  v_message_id uuid;
  v_message_conversation_id uuid;
  v_message_contact_id uuid;
  v_now timestamptz;
BEGIN
  IF p_dispatch_id IS NULL
     OR p_dispatch_lease_token IS NULL
     OR p_max_replies IS NULL
     OR p_max_replies NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Invalid AI reply slot claim' USING ERRCODE = '22023';
  END IF;

  SELECT d.*
    INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.engine <> 'ai'
     OR v_dispatch.ai_config_id IS NULL
     OR v_dispatch.contact_id IS NULL
     OR v_dispatch.conversation_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch root is not a complete AI message root'
      USING ERRCODE = '23514';
  END IF;

  SELECT e.*
    INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = v_dispatch.event_id
   FOR SHARE;
  IF NOT FOUND
     OR v_event.state <> 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'message'
     OR v_event.normalized_event ->> 'contentType' IS DISTINCT FROM 'text'
     OR v_event.normalized_event ->> 'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event ->> 'sentByApi' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Dispatch event is not an applied inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id
    INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch event/connection account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT m.id, c.id, p.id
    INTO v_message_id, v_message_conversation_id, v_message_contact_id
    FROM public.messages AS m
    JOIN public.conversations AS c ON c.id = m.conversation_id
    JOIN public.contacts AS p ON p.id = c.contact_id
   WHERE m.provider_connection_id = v_event.connection_id
     AND m.message_id = v_event.normalized_event ->> 'externalMessageId'
     AND m.sender_type = 'customer'
     AND m.content_type = 'text'
     AND c.account_id = v_dispatch.account_id
     AND p.account_id = v_dispatch.account_id
   FOR SHARE OF m, c, p;
  IF NOT FOUND
     OR v_dispatch.conversation_id IS DISTINCT FROM v_message_conversation_id
     OR v_dispatch.contact_id IS DISTINCT FROM v_message_contact_id THEN
    RAISE EXCEPTION 'Dispatch message/conversation/contact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id
          AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch author/account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT a.*
    INTO v_ai_config
    FROM public.ai_configs AS a
   WHERE a.id = v_dispatch.ai_config_id
   FOR SHARE;
  IF NOT FOUND
     OR v_ai_config.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_ai_config.created_by IS NULL
     OR v_ai_config.created_by IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Dispatch AI config/account/author lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  -- Once claimed, replay is successful even if current eligibility later
  -- changes. The root row lock makes this branch idempotent per AI root.
  IF v_dispatch.ai_slot_claimed THEN
    RETURN true;
  END IF;

  IF p_max_replies <> v_ai_config.auto_reply_max_per_conversation THEN
    RAISE EXCEPTION 'AI reply cap does not match the persisted configuration'
      USING ERRCODE = '22023';
  END IF;
  IF v_ai_config.is_active IS DISTINCT FROM true
     OR v_ai_config.auto_reply_enabled IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  -- Match the legacy eligibility and cap in one conditional UPDATE. Under
  -- concurrent roots for this conversation, PostgreSQL serializes this row
  -- update and rechecks ai_reply_count after acquiring the row lock.
  UPDATE public.conversations AS c
     SET ai_reply_count = c.ai_reply_count + 1
   WHERE c.id = v_dispatch.conversation_id
     AND c.account_id = v_dispatch.account_id
     AND c.contact_id = v_dispatch.contact_id
     AND c.ai_reply_count < p_max_replies
     AND NOT c.ai_autoreply_disabled
     AND c.assigned_agent_id IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.evolution_event_dispatches AS d
     SET ai_slot_claimed = true,
         updated_at = pg_catalog.clock_timestamp()
   WHERE d.id = v_dispatch.id
     AND d.engine = 'ai'
     AND d.state = 'processing'
     AND d.lease_token = p_dispatch_lease_token
     AND d.lease_until > pg_catalog.clock_timestamp()
     AND d.ai_slot_claimed = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot_for_dispatch(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot_for_dispatch(uuid, uuid, integer)
  TO service_role;
