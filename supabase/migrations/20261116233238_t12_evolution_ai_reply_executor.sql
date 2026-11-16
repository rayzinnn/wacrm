-- AI generation is a potentially billable side effect. Unlike ordinary
-- dispatch steps, an expired generation lease becomes terminal `unknown`;
-- the same persisted output is replayed only after the step reaches `done`.
CREATE FUNCTION public.claim_evolution_ai_reply_generation(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid
) RETURNS TABLE(
  step_id uuid,
  state text,
  lease_token uuid,
  request_id text,
  result jsonb,
  should_generate boolean,
  lease_acquired boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_ai_config public.ai_configs%ROWTYPE;
  v_connection_account_id uuid;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_conversation_id uuid;
  v_contact_id uuid;
  v_step_id uuid;
  v_now timestamptz;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid AI generation claim' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.engine <> 'ai' OR v_dispatch.ai_config_id IS NULL
     OR v_dispatch.contact_id IS NULL OR v_dispatch.conversation_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch root is not a complete AI message root' USING ERRCODE = '23514';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = v_dispatch.event_id
   FOR SHARE;
  IF NOT FOUND OR v_event.state <> 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'message'
     OR v_event.normalized_event ->> 'contentType' IS DISTINCT FROM 'text'
     OR v_event.normalized_event ->> 'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event ->> 'sentByApi' IS DISTINCT FROM 'false'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event -> 'externalMessageId') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(v_event.normalized_event ->> 'externalMessageId') = '' THEN
    RAISE EXCEPTION 'Dispatch event is not an applied inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch event/connection account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT a.* INTO v_ai_config
    FROM public.ai_configs AS a
   WHERE a.id = v_dispatch.ai_config_id
   FOR SHARE;
  IF NOT FOUND OR v_ai_config.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_ai_config.created_by IS NULL
     OR v_ai_config.created_by IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Dispatch AI config/account/author lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch author/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT c.id, c.contact_id
    INTO v_conversation_id, v_contact_id
    FROM public.conversations AS c
    JOIN public.contacts AS p ON p.id = c.contact_id
   WHERE c.id = v_dispatch.conversation_id
     AND c.account_id = v_dispatch.account_id
     AND c.contact_id = v_dispatch.contact_id
     AND p.account_id = v_dispatch.account_id
   FOR SHARE OF c, p;
  IF NOT FOUND OR v_conversation_id IS DISTINCT FROM v_dispatch.conversation_id
     OR v_contact_id IS DISTINCT FROM v_dispatch.contact_id THEN
    RAISE EXCEPTION 'Dispatch conversation/contact lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.messages AS m
        WHERE m.provider_connection_id = v_event.connection_id
          AND m.message_id = v_event.normalized_event ->> 'externalMessageId'
          AND m.conversation_id = v_dispatch.conversation_id
          AND m.sender_type = 'customer'
          AND m.content_type = 'text'
     ) THEN
    RAISE EXCEPTION 'Dispatch event/message lineage is invalid' USING ERRCODE = '23514';
  END IF;

  v_step_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, request_id)
  VALUES (v_step_id, v_dispatch.id, 'reply', 'evolution-step:' || v_step_id::text)
  ON CONFLICT (dispatch_id, action_key) DO NOTHING;
  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.dispatch_id = v_dispatch.id AND s.action_key = 'reply'
   FOR UPDATE;
  IF NOT FOUND OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'AI reply generation step lineage is invalid' USING ERRCODE = '23514';
  END IF;

  IF v_step.state IN ('done', 'skipped', 'failed', 'unknown') THEN
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.result, false, false;
    RETURN;
  END IF;
  IF v_step.state = 'processing' AND v_step.lease_until > v_now THEN
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.result, false, false;
    RETURN;
  END IF;
  IF v_step.state = 'processing' THEN
    UPDATE public.evolution_dispatch_steps AS s
       SET state = 'unknown', lease_until = NULL, lease_token = NULL,
           last_error_code = 'generation_interrupted', updated_at = v_now
     WHERE s.id = v_step.id
    RETURNING s.* INTO v_step;
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.result, false, false;
    RETURN;
  END IF;
  IF v_step.state <> 'pending' OR v_step.attempts <> 0
     OR v_step.next_attempt_at > v_now THEN
    RAISE EXCEPTION 'AI reply generation step is not claimable' USING ERRCODE = '55000';
  END IF;

  UPDATE public.evolution_dispatch_steps AS s
     SET state = 'processing', attempts = 1,
         lease_until = LEAST(
           v_dispatch.lease_until,
           v_now + interval '60 seconds'
         ),
         lease_token = pg_catalog.gen_random_uuid(),
         updated_at = v_now
   WHERE s.id = v_step.id
  RETURNING s.* INTO v_step;
  RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                      v_step.request_id, v_step.result, true, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_evolution_ai_reply_generation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_ai_reply_generation(uuid, uuid)
  TO service_role;

CREATE FUNCTION public.complete_evolution_ai_handoff(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_summary text,
  p_handoff_agent_id uuid
) RETURNS TABLE(step_id uuid, state text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_ai_config public.ai_configs%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_connection_account_id uuid;
  v_conversation_account_id uuid;
  v_conversation_contact_id uuid;
  v_ai_disabled boolean;
  v_handoff_summary text;
  v_current_assignee uuid;
  v_result_assignee uuid;
  v_now timestamptz;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_summary IS NULL OR pg_catalog.btrim(p_summary) = ''
     OR pg_catalog.char_length(p_summary) > 500 THEN
    RAISE EXCEPTION 'Invalid AI handoff completion' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.engine <> 'ai' OR v_dispatch.ai_config_id IS NULL
     OR v_dispatch.contact_id IS NULL OR v_dispatch.conversation_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch root is not a complete AI message root' USING ERRCODE = '23514';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = v_dispatch.event_id
   FOR SHARE;
  IF NOT FOUND OR v_event.state <> 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'message'
     OR v_event.normalized_event ->> 'contentType' IS DISTINCT FROM 'text'
     OR v_event.normalized_event ->> 'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event ->> 'sentByApi' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Dispatch event is not an applied inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch event/connection account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT a.* INTO v_ai_config
    FROM public.ai_configs AS a
   WHERE a.id = v_dispatch.ai_config_id
   FOR SHARE;
  IF NOT FOUND OR v_ai_config.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_ai_config.created_by IS NULL
     OR v_ai_config.created_by IS DISTINCT FROM v_dispatch.user_id
     OR v_ai_config.handoff_agent_id IS DISTINCT FROM p_handoff_agent_id THEN
    RAISE EXCEPTION 'Dispatch AI config/account/author/handoff agent lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.messages AS m
        WHERE m.provider_connection_id = v_event.connection_id
          AND m.message_id = v_event.normalized_event ->> 'externalMessageId'
          AND m.conversation_id = v_dispatch.conversation_id
          AND m.sender_type = 'customer'
          AND m.content_type = 'text'
     ) THEN
    RAISE EXCEPTION 'Dispatch event/message lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch author/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_handoff_agent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = p_handoff_agent_id AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'AI handoff agent does not belong to dispatch account' USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id, c.contact_id, c.ai_autoreply_disabled,
         c.ai_handoff_summary, c.assigned_agent_id
    INTO v_conversation_account_id, v_conversation_contact_id,
         v_ai_disabled, v_handoff_summary, v_current_assignee
    FROM public.conversations AS c
   WHERE c.id = v_dispatch.conversation_id
   FOR UPDATE;
  IF NOT FOUND OR v_conversation_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_conversation_contact_id IS DISTINCT FROM v_dispatch.contact_id THEN
    RAISE EXCEPTION 'Dispatch conversation/contact lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id AND s.dispatch_id = v_dispatch.id
   FOR UPDATE;
  IF NOT FOUND OR v_step.action_key IS DISTINCT FROM 'reply:handoff'
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'AI handoff step lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_step.state = 'done' THEN
    IF v_ai_disabled IS DISTINCT FROM true
       OR v_handoff_summary IS DISTINCT FROM p_summary
       OR v_step.result IS DISTINCT FROM jsonb_build_object(
         'handoff', true,
         'summary', p_summary,
         'handoff_agent_id', p_handoff_agent_id,
         'assigned_agent_id', v_current_assignee
       ) THEN
      RAISE EXCEPTION 'AI handoff replay does not match the persisted effect'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_step.id, v_step.state;
    RETURN;
  END IF;
  IF v_step.state <> 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= v_now THEN
    RAISE EXCEPTION 'AI handoff step lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  UPDATE public.conversations AS c
     SET ai_autoreply_disabled = true,
         ai_handoff_summary = p_summary,
         assigned_agent_id = CASE
           WHEN c.assigned_agent_id IS NULL THEN p_handoff_agent_id
           ELSE c.assigned_agent_id
         END
   WHERE c.id = v_dispatch.conversation_id
     AND c.account_id = v_dispatch.account_id
     AND c.contact_id = v_dispatch.contact_id
  RETURNING c.assigned_agent_id INTO v_result_assignee;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch conversation changed during AI handoff' USING ERRCODE = '23514';
  END IF;

  UPDATE public.evolution_dispatch_steps AS s
     SET state = 'done', lease_until = NULL, lease_token = NULL,
         result = jsonb_build_object(
           'handoff', true,
           'summary', p_summary,
           'handoff_agent_id', p_handoff_agent_id,
           'assigned_agent_id', v_result_assignee
         ),
         last_error_code = NULL,
         updated_at = v_now
   WHERE s.id = v_step.id
     AND s.state = 'processing'
     AND s.lease_token = p_step_lease_token
     AND s.lease_until > pg_catalog.clock_timestamp()
  RETURNING s.* INTO v_step;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI handoff step lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  RETURN QUERY SELECT v_step.id, v_step.state;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_ai_handoff(uuid, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_ai_handoff(uuid, uuid, uuid, uuid, text, uuid)
  TO service_role;
