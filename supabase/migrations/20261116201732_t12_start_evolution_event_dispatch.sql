CREATE FUNCTION public.start_evolution_event_dispatch(
  p_dispatch_id uuid,
  p_lease_token uuid
) RETURNS TABLE(
  dispatch_id uuid,
  automation_log_id uuid,
  flow_run_id uuid,
  state text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_connection_account_id uuid;
  v_definition_account_id uuid;
  v_definition_user_id uuid;
  v_definition_active boolean;
  v_message_id uuid;
  v_message_conversation_id uuid;
  v_message_contact_id uuid;
  v_log_id uuid;
  v_flow_run_id uuid;
  v_flow_entry_node text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_dispatch_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid dispatch start' USING ERRCODE = '22023';
  END IF;

  SELECT d.*
    INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  SELECT e.*
    INTO v_event
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
    RAISE EXCEPTION 'Dispatch audit user/account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_dispatch.engine = 'automation' THEN
    SELECT a.account_id, a.user_id, a.is_active
      INTO v_definition_account_id, v_definition_user_id, v_definition_active
      FROM public.automations AS a
     WHERE a.id = v_dispatch.automation_id
     FOR SHARE;
  ELSIF v_dispatch.engine = 'flow' THEN
    SELECT f.account_id, f.user_id, f.status = 'active', f.entry_node_id
      INTO v_definition_account_id, v_definition_user_id,
           v_definition_active, v_flow_entry_node
      FROM public.flows AS f
     WHERE f.id = v_dispatch.flow_id
     FOR SHARE;
  ELSIF v_dispatch.engine = 'ai' THEN
    SELECT a.account_id, a.created_by,
           a.is_active AND a.auto_reply_enabled
      INTO v_definition_account_id, v_definition_user_id, v_definition_active
      FROM public.ai_configs AS a
     WHERE a.id = v_dispatch.ai_config_id
     FOR SHARE;
  ELSE
    RAISE EXCEPTION 'Dispatch engine is invalid' USING ERRCODE = '23514';
  END IF;

  IF v_definition_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_definition_user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Dispatch definition/account/user lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  -- A committed start followed by a worker crash is replayed from the
  -- already-linked execution row. It never creates a second log or run.
  IF v_dispatch.engine = 'automation' AND v_dispatch.automation_log_id IS NOT NULL THEN
    SELECT l.id INTO v_log_id
      FROM public.automation_logs AS l
     WHERE l.id = v_dispatch.automation_log_id
       AND l.evolution_dispatch_id = v_dispatch.id
       AND l.automation_id = v_dispatch.automation_id
       AND l.account_id = v_dispatch.account_id
       AND l.user_id = v_dispatch.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch automation log link is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, v_log_id, NULL::uuid, 'processing'::text;
    RETURN;
  ELSIF v_dispatch.engine = 'flow' AND v_dispatch.flow_run_id IS NOT NULL THEN
    SELECT r.id INTO v_flow_run_id
      FROM public.flow_runs AS r
     WHERE r.id = v_dispatch.flow_run_id
       AND r.flow_id = v_dispatch.flow_id
       AND r.account_id = v_dispatch.account_id
       AND r.user_id = v_dispatch.user_id
       AND r.contact_id = v_dispatch.contact_id
       AND r.conversation_id = v_dispatch.conversation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch flow run link is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, NULL::uuid, v_flow_run_id, 'processing'::text;
    RETURN;
  END IF;

  -- The worker/engine decides trigger-specific eligibility before calling
  -- start. This RPC only rechecks that the selected definition remains active.
  -- An inactive definition has no execution record or other side effect.
  IF v_definition_active IS DISTINCT FROM true
     OR v_dispatch.contact_id IS NULL
     OR v_dispatch.conversation_id IS NULL THEN
    UPDATE public.evolution_event_dispatches AS d
       SET state = 'skipped', lease_until = NULL, lease_token = NULL,
           last_error_code = NULL, updated_at = v_now
     WHERE d.id = v_dispatch.id
       AND d.state = 'processing'
       AND d.lease_token = p_lease_token
       AND d.lease_until > v_now;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, NULL::uuid, NULL::uuid, 'skipped'::text;
    RETURN;
  END IF;

  IF v_dispatch.engine = 'ai' THEN
    -- The root itself is the AI execution record; do not create a synthetic
    -- automation log or flow run.
    RETURN QUERY SELECT v_dispatch.id, NULL::uuid, NULL::uuid, 'processing'::text;
    RETURN;
  END IF;

  IF v_dispatch.engine = 'automation' THEN
    INSERT INTO public.automation_logs (
      automation_id, account_id, user_id, contact_id, trigger_event,
      steps_executed, status, evolution_dispatch_id
    )
    SELECT a.id, a.account_id, a.user_id, v_dispatch.contact_id,
           a.trigger_type, '[]'::jsonb, 'partial', v_dispatch.id
      FROM public.automations AS a
     WHERE a.id = v_dispatch.automation_id
    ON CONFLICT (evolution_dispatch_id) DO NOTHING
    RETURNING id INTO v_log_id;

    IF v_log_id IS NULL THEN
      SELECT l.id INTO v_log_id
        FROM public.automation_logs AS l
       WHERE l.evolution_dispatch_id = v_dispatch.id
         AND l.automation_id = v_dispatch.automation_id
         AND l.account_id = v_dispatch.account_id
         AND l.user_id = v_dispatch.user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch automation log could not be linked'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    UPDATE public.evolution_event_dispatches AS d
       SET automation_log_id = v_log_id, updated_at = v_now
     WHERE d.id = v_dispatch.id
       AND d.state = 'processing'
       AND d.lease_token = p_lease_token
       AND d.lease_until > v_now;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, v_log_id, NULL::uuid, 'processing'::text;
    RETURN;
  END IF;

  IF v_dispatch.engine = 'flow' THEN
    IF v_flow_entry_node IS NULL OR pg_catalog.btrim(v_flow_entry_node) = '' THEN
      UPDATE public.evolution_event_dispatches AS d
         SET state = 'skipped', lease_until = NULL, lease_token = NULL,
             last_error_code = NULL, updated_at = v_now
       WHERE d.id = v_dispatch.id
         AND d.state = 'processing'
         AND d.lease_token = p_lease_token
         AND d.lease_until > v_now;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT v_dispatch.id, NULL::uuid, NULL::uuid, 'skipped'::text;
      RETURN;
    END IF;

    SELECT r.id INTO v_flow_run_id
      FROM public.flow_runs AS r
     WHERE r.account_id = v_dispatch.account_id
       AND r.contact_id = v_dispatch.contact_id
       AND r.status = 'active'
     FOR UPDATE;

    IF FOUND AND EXISTS (
         SELECT 1 FROM public.flow_runs AS r
          WHERE r.id = v_flow_run_id AND r.flow_id <> v_dispatch.flow_id
       ) THEN
      UPDATE public.evolution_event_dispatches AS d
         SET state = 'skipped', lease_until = NULL, lease_token = NULL,
             last_error_code = NULL, updated_at = v_now
       WHERE d.id = v_dispatch.id
         AND d.state = 'processing'
         AND d.lease_token = p_lease_token
         AND d.lease_until > v_now;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT v_dispatch.id, NULL::uuid, NULL::uuid, 'skipped'::text;
      RETURN;
    END IF;

    IF v_flow_run_id IS NULL THEN
      INSERT INTO public.flow_runs (
        flow_id, account_id, user_id, contact_id, conversation_id,
        status, current_node_key
      ) VALUES (
        v_dispatch.flow_id, v_dispatch.account_id, v_dispatch.user_id,
        v_dispatch.contact_id, v_dispatch.conversation_id,
        'active', v_flow_entry_node
      )
      ON CONFLICT (account_id, contact_id) WHERE status = 'active' DO NOTHING
      RETURNING id INTO v_flow_run_id;

      IF v_flow_run_id IS NULL THEN
        SELECT r.id INTO v_flow_run_id
          FROM public.flow_runs AS r
         WHERE r.account_id = v_dispatch.account_id
           AND r.contact_id = v_dispatch.contact_id
           AND r.status = 'active'
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Concurrent flow run winner is unavailable'
            USING ERRCODE = '40001';
        END IF;
        IF NOT EXISTS (
             SELECT 1 FROM public.flow_runs AS r
              WHERE r.id = v_flow_run_id AND r.flow_id = v_dispatch.flow_id
           ) THEN
          UPDATE public.evolution_event_dispatches AS d
             SET state = 'skipped', lease_until = NULL, lease_token = NULL,
                 last_error_code = NULL, updated_at = v_now
           WHERE d.id = v_dispatch.id
             AND d.state = 'processing'
             AND d.lease_token = p_lease_token
             AND d.lease_until > v_now;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
          END IF;
          RETURN QUERY SELECT v_dispatch.id, NULL::uuid, NULL::uuid, 'skipped'::text;
          RETURN;
        END IF;
      END IF;
    END IF;

    UPDATE public.evolution_event_dispatches AS d
       SET flow_run_id = v_flow_run_id, updated_at = v_now
     WHERE d.id = v_dispatch.id
       AND d.state = 'processing'
       AND d.lease_token = p_lease_token
       AND d.lease_until > v_now;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, NULL::uuid, v_flow_run_id, 'processing'::text;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Dispatch engine could not be started' USING ERRCODE = '23514';
END;
$function$;

REVOKE ALL ON FUNCTION public.start_evolution_event_dispatch(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_evolution_event_dispatch(uuid, uuid)
  TO service_role;
