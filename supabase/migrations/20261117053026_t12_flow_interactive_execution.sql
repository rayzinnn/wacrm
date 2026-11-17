CREATE OR REPLACE FUNCTION public.is_valid_evolution_flow_interactive_event(
  p_dispatch_id uuid,
  p_event_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.evolution_event_dispatches AS d
      JOIN public.evolution_events AS e ON e.id = p_event_id
      JOIN public.whatsapp_connections AS wc
        ON wc.id = e.connection_id AND wc.provider = 'evolution'
      JOIN public.messages AS m
        ON m.provider_connection_id = e.connection_id
       AND m.message_id = e.normalized_event->>'externalMessageId'
       AND m.content_type = 'interactive'
       AND m.sender_type = 'customer'
       AND m.interactive_reply_id = e.normalized_event->>'interactiveReplyId'
      JOIN public.conversations AS c ON c.id = m.conversation_id
      JOIN public.contacts AS ct ON ct.id = c.contact_id
     WHERE d.id = p_dispatch_id
       AND d.engine = 'flow'
       AND d.flow_run_id IS NOT NULL
       AND d.event_id = p_event_id
       AND e.state = 'done'
       AND pg_catalog.jsonb_typeof(e.normalized_event) = 'object'
       AND e.normalized_event->>'kind' = 'message'
       AND e.normalized_event->>'contentType' = 'interactive'
       AND e.normalized_event->>'fromMe' = 'false'
       AND e.normalized_event->>'sentByApi' = 'false'
       AND pg_catalog.jsonb_typeof(e.normalized_event->'interactiveReplyId') = 'string'
       AND pg_catalog.length(e.normalized_event->>'interactiveReplyId') BETWEEN 1 AND 200
       AND e.normalized_event->>'interactiveReplyKind' IN ('button', 'list')
       AND m.conversation_id = d.conversation_id
       AND c.account_id = d.account_id
       AND c.contact_id = d.contact_id
       AND ct.account_id = d.account_id
       AND wc.account_id = d.account_id
  );
$function$;

REVOKE ALL ON FUNCTION public.is_valid_evolution_flow_interactive_event(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_evolution_flow_interactive_event(uuid, uuid)
  TO service_role;


CREATE OR REPLACE FUNCTION public.start_evolution_event_dispatch(
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
     OR (v_event.normalized_event ->> 'contentType' IS DISTINCT FROM 'text' AND NOT public.is_valid_evolution_flow_interactive_start(v_dispatch.id, v_event.id))
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
     AND m.content_type = v_event.normalized_event ->> 'contentType'
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


CREATE OR REPLACE FUNCTION public.complete_evolution_flow_transition(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_flow_run_id uuid,
  p_event_id uuid,
  p_expected_transition_seq integer,
  p_event_type text,
  p_node_key text,
  p_payload jsonb,
  p_next_node_key text,
  p_next_status text,
  p_end_reason text
) RETURNS TABLE(applied boolean, transition_seq integer, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_existing public.flow_run_events%ROWTYPE;
  v_send_attempt public.evolution_send_attempts%ROWTYPE;
  v_completed public.evolution_dispatch_steps%ROWTYPE;
  v_connection_id uuid;
  v_connection_account_id uuid;
  v_flow_account_id uuid;
  v_flow_user_id uuid;
  v_now timestamptz;
  v_next_transition_seq integer;
  v_applied boolean := false;
  v_step_result jsonb;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL
     OR p_expected_transition_seq < 0 OR p_expected_transition_seq >= 2147483647
     OR p_event_type IS NULL OR p_next_status IS NULL
     OR p_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid flow transition request' USING ERRCODE = '22023';
  END IF;
  IF p_event_type NOT IN (
       'started', 'node_entered', 'message_sent', 'reply_received',
       'fallback_fired', 'handoff', 'timeout', 'error', 'completed'
     ) THEN
    RAISE EXCEPTION 'Unsupported flow transition event type' USING ERRCODE = '22023';
  END IF;
  IF p_next_status NOT IN (
       'active', 'completed', 'handed_off', 'timed_out',
       'paused_by_agent', 'cancelled', 'failed'
     ) THEN
    RAISE EXCEPTION 'Unsupported flow run status' USING ERRCODE = '22023';
  END IF;

  -- Consistent T12 lock order: root first, then its step, then the run.
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.engine IS DISTINCT FROM 'flow'
     OR v_dispatch.flow_id IS NULL
     OR v_dispatch.flow_run_id IS DISTINCT FROM p_flow_run_id
     OR v_dispatch.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Dispatch root does not match the flow run or event' USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id THEN
    RAISE EXCEPTION 'Dispatch step/root association is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_step.state IS DISTINCT FROM 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch step lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text THEN
    RAISE EXCEPTION 'Dispatch step request ID does not match its stable key'
      USING ERRCODE = '23514';
  END IF;
  IF v_step.send_attempt_id IS NOT NULL AND p_event_type IS DISTINCT FROM 'message_sent' THEN
    RAISE EXCEPTION 'A send-attempt step can only complete as message_sent'
      USING ERRCODE = '23514';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR SHARE;
  IF NOT FOUND OR v_event.id IS DISTINCT FROM v_dispatch.event_id
     OR v_event.state IS DISTINCT FROM 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event->>'kind' IS DISTINCT FROM 'message'
     OR (v_event.normalized_event->>'contentType' IS DISTINCT FROM 'text' AND NOT public.is_valid_evolution_flow_interactive_event(v_dispatch.id, v_event.id))
     OR v_event.normalized_event->>'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event->>'sentByApi' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Flow transition event is not an applied inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;
  SELECT c.id, c.account_id INTO v_connection_id, v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Flow event/connection account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_event_type = 'message_sent' THEN
    IF v_step.send_attempt_id IS NULL THEN
      RAISE EXCEPTION 'Flow message_sent transition requires a linked send attempt'
        USING ERRCODE = '23514';
    END IF;
    SELECT a.* INTO v_send_attempt
      FROM public.evolution_send_attempts AS a
     WHERE a.id = v_step.send_attempt_id
     FOR SHARE;
    IF NOT FOUND
       OR v_send_attempt.account_id IS DISTINCT FROM v_dispatch.account_id
       OR v_send_attempt.connection_id IS DISTINCT FROM v_connection_id
       OR v_dispatch.conversation_id IS NULL
       OR v_send_attempt.conversation_id IS DISTINCT FROM v_dispatch.conversation_id
       OR v_send_attempt.request_id IS DISTINCT FROM v_step.request_id THEN
      RAISE EXCEPTION 'Flow send attempt does not match root, connection, conversation, or request'
        USING ERRCODE = '23514';
    END IF;
    IF v_send_attempt.outcome IS DISTINCT FROM 'accepted' THEN
      RAISE EXCEPTION 'Flow send attempt is not known accepted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT f.account_id, f.user_id INTO v_flow_account_id, v_flow_user_id
    FROM public.flows AS f
   WHERE f.id = v_dispatch.flow_id
   FOR SHARE;
  IF NOT FOUND OR v_flow_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_flow_user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Flow definition/account/user lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id
          AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Flow audit user/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT r.* INTO v_run
    FROM public.flow_runs AS r
   WHERE r.id = p_flow_run_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_run.id IS DISTINCT FROM v_dispatch.flow_run_id
     OR v_run.flow_id IS DISTINCT FROM v_dispatch.flow_id
     OR v_run.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_run.user_id IS DISTINCT FROM v_dispatch.user_id
     OR v_run.contact_id IS DISTINCT FROM v_dispatch.contact_id
     OR v_run.conversation_id IS DISTINCT FROM v_dispatch.conversation_id THEN
    RAISE EXCEPTION 'Flow run/root tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  v_next_transition_seq := p_expected_transition_seq + 1;

  -- An already-recorded reply is an idempotent no-op, even if the run has
  -- since moved on. Other transition replays match their exact sequence key.
  IF p_event_type = 'reply_received' THEN
    SELECT e.* INTO v_existing
      FROM public.flow_run_events AS e
     WHERE e.flow_run_id = v_run.id
       AND e.event_type = 'reply_received'
       AND e.evolution_event_id = p_event_id
     FOR SHARE;
  ELSE
    SELECT e.* INTO v_existing
      FROM public.flow_run_events AS e
     WHERE e.flow_run_id = v_run.id
       AND e.evolution_event_id = p_event_id
       AND e.event_type = p_event_type
       AND e.transition_seq = v_next_transition_seq
     FOR SHARE;
  END IF;

  IF FOUND THEN
    IF p_event_type = 'reply_received' THEN
      -- A reply may have been replayed after later transitions. Return the
      -- current checkpoint without acknowledging a new, incompatible step.
      IF v_existing.transition_seq IS DISTINCT FROM v_next_transition_seq
         OR v_existing.node_key IS DISTINCT FROM p_node_key
         OR v_existing.payload IS DISTINCT FROM p_payload
         OR v_run.transition_seq IS DISTINCT FROM v_existing.transition_seq
         OR v_run.current_node_key IS DISTINCT FROM p_next_node_key
         OR v_run.status IS DISTINCT FROM p_next_status
         OR v_run.end_reason IS DISTINCT FROM p_end_reason THEN
        RETURN QUERY SELECT false, v_run.transition_seq, v_run.status;
        RETURN;
      END IF;
    ELSIF v_existing.transition_seq IS DISTINCT FROM v_next_transition_seq
       OR v_existing.node_key IS DISTINCT FROM p_node_key
       OR v_existing.payload IS DISTINCT FROM p_payload
       OR v_run.transition_seq IS DISTINCT FROM v_existing.transition_seq
       OR v_run.current_node_key IS DISTINCT FROM p_next_node_key
       OR v_run.status IS DISTINCT FROM p_next_status
       OR v_run.end_reason IS DISTINCT FROM p_end_reason THEN
      RAISE EXCEPTION 'Flow transition replay key has different event data'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF v_run.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Flow run is not active' USING ERRCODE = '55000';
    END IF;
    IF v_run.transition_seq IS DISTINCT FROM p_expected_transition_seq THEN
      RAISE EXCEPTION 'Flow transition sequence is stale or out of order'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.flow_run_events (
      flow_run_id, event_type, node_key, payload, evolution_event_id, transition_seq
    ) VALUES (
      v_run.id, p_event_type, p_node_key, p_payload, p_event_id, v_next_transition_seq
    );

    UPDATE public.flow_runs AS r
       SET current_node_key = p_next_node_key,
           status = p_next_status,
           transition_seq = v_next_transition_seq,
           last_advanced_at = v_now,
           ended_at = CASE WHEN p_next_status = 'active' THEN NULL ELSE v_now END,
           end_reason = p_end_reason
     WHERE r.id = v_run.id
       AND r.account_id = v_dispatch.account_id
       AND r.status = 'active'
       AND r.transition_seq = p_expected_transition_seq;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flow run changed during transition' USING ERRCODE = '40001';
    END IF;
    v_applied := true;
  END IF;

  v_step_result := pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'flow_run_id', v_run.id,
    'event_id', p_event_id,
    'transition_seq', CASE WHEN v_applied THEN v_next_transition_seq ELSE v_run.transition_seq END,
    'status', CASE WHEN v_applied THEN p_next_status ELSE v_run.status END
  );
  v_completed := public.complete_evolution_dispatch_step(
    p_step_id, p_dispatch_lease_token, p_step_lease_token, 'done',
    v_step.request_id, v_step.send_attempt_id, v_step_result, NULL
  );

  IF v_applied THEN
    RETURN QUERY SELECT true, v_next_transition_seq, p_next_status;
  ELSE
    RETURN QUERY SELECT false, v_run.transition_seq, v_run.status;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_transition(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_transition(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, jsonb, text, text, text
) TO service_role;


CREATE OR REPLACE FUNCTION public.complete_evolution_flow_handoff(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_flow_run_id uuid,
  p_event_id uuid,
  p_expected_transition_seq integer,
  p_node_key text
) RETURNS TABLE(applied boolean, transition_seq integer, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_flow public.flows%ROWTYPE;
  v_node public.flow_nodes%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_conversation public.conversations%ROWTYPE;
  v_connection_id uuid;
  v_connection_account_id uuid;
  v_valid_agent_id uuid;
  v_assigned_agent_id uuid;
  v_note text;
  v_event_payload jsonb;
  v_step_result jsonb;
  v_existing public.flow_run_events%ROWTYPE;
  v_transition record;
  v_now timestamptz;
  v_expected_next_seq integer;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL
     OR p_expected_transition_seq < 0 OR p_expected_transition_seq >= 2147483647
     OR p_node_key IS NULL OR pg_catalog.btrim(p_node_key) = '' THEN
    RAISE EXCEPTION 'Invalid Flow handoff request' USING ERRCODE = '22023';
  END IF;

  -- The conversation update and nested transition share this transaction.
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.engine IS DISTINCT FROM 'flow'
     OR v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now
     OR v_dispatch.flow_id IS NULL
     OR v_dispatch.flow_run_id IS DISTINCT FROM p_flow_run_id
     OR v_dispatch.event_id IS DISTINCT FROM p_event_id
     OR v_dispatch.contact_id IS NULL OR v_dispatch.conversation_id IS NULL THEN
    RAISE EXCEPTION 'Flow dispatch root lease or lineage is stale' USING ERRCODE = '55000';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id THEN
    RAISE EXCEPTION 'Flow handoff step/root association is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_step.action_key IS DISTINCT FROM (p_expected_transition_seq::text || ':' || p_node_key)
     OR v_step.request_id IS DISTINCT FROM ('evolution-step:' || v_step.id::text)
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Flow handoff step does not match the persisted action' USING ERRCODE = '23514';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR SHARE;
  IF NOT FOUND OR v_event.state IS DISTINCT FROM 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event->>'kind' IS DISTINCT FROM 'message'
     OR (v_event.normalized_event->>'contentType' IS DISTINCT FROM 'text' AND NOT public.is_valid_evolution_flow_interactive_event(v_dispatch.id, v_event.id))
     OR v_event.normalized_event->>'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event->>'sentByApi' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Flow handoff requires an applied inbound text event' USING ERRCODE = '23514';
  END IF;
  SELECT c.id, c.account_id INTO v_connection_id, v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Flow handoff event/connection tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT f.* INTO v_flow
    FROM public.flows AS f
   WHERE f.id = v_dispatch.flow_id
   FOR SHARE;
  IF NOT FOUND OR v_flow.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_flow.user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Flow handoff definition/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.profiles AS p
   WHERE p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow handoff audit user/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT n.* INTO v_node
    FROM public.flow_nodes AS n
   WHERE n.flow_id = v_dispatch.flow_id AND n.node_key = p_node_key
   FOR SHARE;
  IF NOT FOUND OR v_node.node_type IS DISTINCT FROM 'handoff'
     OR pg_catalog.jsonb_typeof(v_node.config) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Persisted Flow node is not a handoff node' USING ERRCODE = '23514';
  END IF;
  IF v_node.config ? 'note'
     AND pg_catalog.jsonb_typeof(v_node.config->'note') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'Persisted Flow handoff note is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_node.config ? 'assign_to'
     AND pg_catalog.jsonb_typeof(v_node.config->'assign_to') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'Persisted Flow handoff assignee is invalid' USING ERRCODE = '22023';
  END IF;
  v_note := v_node.config->>'note';
  IF NULLIF(v_node.config->>'assign_to', '') IS NOT NULL THEN
    BEGIN
      v_assigned_agent_id := (v_node.config->>'assign_to')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Persisted Flow handoff assignee is invalid' USING ERRCODE = '22023';
    END;
    PERFORM 1 FROM public.profiles AS p
     WHERE p.user_id = v_assigned_agent_id
       AND p.account_id = v_dispatch.account_id
       AND p.account_role IN ('owner', 'admin', 'agent')
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flow handoff assignee is not an agent in this account' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_event_payload := pg_catalog.jsonb_build_object(
    'note', v_note,
    'assigned_to', v_assigned_agent_id
  );

  -- Match start_evolution_event_dispatch lock order: conversation before run.
  -- Both functions already hold their own dispatch root; locking the shared
  -- conversation first prevents a run/conversation lock cycle.
  SELECT c.* INTO v_conversation
    FROM public.conversations AS c
    JOIN public.contacts AS ct ON ct.id = c.contact_id
   WHERE c.id = v_dispatch.conversation_id
     AND c.account_id = v_dispatch.account_id
     AND c.contact_id = v_dispatch.contact_id
     AND ct.account_id = v_dispatch.account_id
   FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow handoff conversation/contact tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT r.* INTO v_run
    FROM public.flow_runs AS r
   WHERE r.id = p_flow_run_id
   FOR UPDATE;
  IF NOT FOUND OR v_run.id IS DISTINCT FROM v_dispatch.flow_run_id
     OR v_run.flow_id IS DISTINCT FROM v_dispatch.flow_id
     OR v_run.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_run.user_id IS DISTINCT FROM v_dispatch.user_id
     OR v_run.contact_id IS DISTINCT FROM v_dispatch.contact_id
     OR v_run.conversation_id IS DISTINCT FROM v_dispatch.conversation_id THEN
    RAISE EXCEPTION 'Flow handoff run/root tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  v_expected_next_seq := p_expected_transition_seq + 1;
  IF v_step.state = 'done' THEN
    -- A durable same-step replay is a no-op. Validate the exact effect
    -- checkpoint and final rows; a changed config cannot be masked as replay.
    SELECT e.* INTO v_existing
      FROM public.flow_run_events AS e
     WHERE e.flow_run_id = v_run.id
       AND e.evolution_event_id = p_event_id
       AND e.event_type = 'handoff'
       AND e.transition_seq = v_expected_next_seq
     FOR SHARE;
    v_step_result := pg_catalog.jsonb_build_object(
      'applied', true,
      'flow_run_id', v_run.id,
      'event_id', p_event_id,
      'transition_seq', v_expected_next_seq,
      'status', 'handed_off',
      'note', v_note,
      'assigned_to', v_assigned_agent_id
    );
    IF NOT FOUND
       OR v_existing.node_key IS DISTINCT FROM p_node_key
       OR v_existing.payload IS DISTINCT FROM v_event_payload
       OR v_run.status IS DISTINCT FROM 'handed_off'
       OR v_run.current_node_key IS DISTINCT FROM p_node_key
       OR v_run.transition_seq IS DISTINCT FROM v_expected_next_seq
       OR v_run.end_reason IS DISTINCT FROM 'handoff_node'
       OR v_conversation.status IS DISTINCT FROM 'pending'
       OR (v_assigned_agent_id IS NOT NULL
           AND v_conversation.assigned_agent_id IS DISTINCT FROM v_assigned_agent_id)
       OR v_step.result IS DISTINCT FROM v_step_result THEN
      RAISE EXCEPTION 'Flow handoff replay does not match the persisted effect' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT false, v_run.transition_seq, v_run.status;
    RETURN;
  END IF;

  IF v_step.state IS DISTINCT FROM 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= v_now THEN
    RAISE EXCEPTION 'Flow handoff step lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_run.status IS DISTINCT FROM 'active'
     OR v_run.current_node_key IS DISTINCT FROM p_node_key
     OR v_run.transition_seq IS DISTINCT FROM p_expected_transition_seq THEN
    RAISE EXCEPTION 'Flow handoff run node or sequence is stale' USING ERRCODE = '40001';
  END IF;

  UPDATE public.conversations AS c
     SET status = 'pending',
         assigned_agent_id = COALESCE(v_assigned_agent_id, c.assigned_agent_id),
         updated_at = v_now
   WHERE c.id = v_dispatch.conversation_id
     AND c.account_id = v_dispatch.account_id
     AND c.contact_id = v_dispatch.contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow handoff conversation changed during transition' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO STRICT v_transition
    FROM public.complete_evolution_flow_transition(
      p_dispatch_id, p_dispatch_lease_token, p_step_id, p_step_lease_token,
      p_flow_run_id, p_event_id, p_expected_transition_seq,
      'handoff', p_node_key, v_event_payload,
      p_node_key, 'handed_off', 'handoff_node'
    );
  IF NOT v_transition.applied THEN
    RAISE EXCEPTION 'Flow handoff transition was not newly applied' USING ERRCODE = '40001';
  END IF;
  v_step_result := pg_catalog.jsonb_build_object(
    'applied', v_transition.applied,
    'flow_run_id', p_flow_run_id,
    'event_id', p_event_id,
    'transition_seq', v_transition.transition_seq,
    'status', v_transition.status,
    'note', v_note,
    'assigned_to', v_assigned_agent_id
  );
  UPDATE public.evolution_dispatch_steps AS s
     SET result = v_step_result,
         updated_at = pg_catalog.clock_timestamp()
   WHERE s.id = p_step_id AND s.dispatch_id = p_dispatch_id AND s.state = 'done';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow handoff step did not complete atomically' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_transition.applied, v_transition.transition_seq, v_transition.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_handoff(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_handoff(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.is_valid_evolution_flow_interactive_start(
  p_dispatch_id uuid,
  p_event_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.evolution_event_dispatches AS d
      JOIN public.flows AS f ON f.id = d.flow_id AND f.status = 'active'
      JOIN public.flow_runs AS r ON r.id = d.flow_run_id
      JOIN public.flow_nodes AS n
        ON n.flow_id = d.flow_id AND n.node_key = r.current_node_key
      JOIN public.evolution_events AS e ON e.id = p_event_id
     WHERE d.id = p_dispatch_id
       AND d.engine = 'flow'
       AND d.flow_run_id = r.id
       AND r.flow_id = d.flow_id
       AND r.account_id = d.account_id
       AND r.user_id = d.user_id
       AND r.contact_id = d.contact_id
       AND r.conversation_id = d.conversation_id
       AND r.status = 'active'
       AND ((e.normalized_event->>'interactiveReplyKind' = 'button'
             AND n.node_type = 'send_buttons'
             AND pg_catalog.jsonb_typeof(n.config->'buttons') = 'array'
             AND (SELECT pg_catalog.count(*) = 1
                    FROM pg_catalog.jsonb_array_elements(n.config->'buttons') AS option(value)
                   WHERE option.value->>'reply_id' = e.normalized_event->>'interactiveReplyId'
                     AND pg_catalog.jsonb_typeof(option.value->'next_node_key') = 'string'
                     AND EXISTS (SELECT 1 FROM public.flow_nodes AS target
                                  WHERE target.flow_id = d.flow_id
                                    AND target.node_key = option.value->>'next_node_key')))
         OR (e.normalized_event->>'interactiveReplyKind' = 'list'
             AND n.node_type = 'send_list'
             AND pg_catalog.jsonb_typeof(n.config->'sections') = 'array'
             AND (SELECT pg_catalog.count(*) = 1
                    FROM pg_catalog.jsonb_array_elements(n.config->'sections') AS section(value)
                    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
                      CASE WHEN pg_catalog.jsonb_typeof(section.value->'rows') = 'array'
                           THEN section.value->'rows' ELSE '[]'::jsonb END
                    ) AS option(value)
                   WHERE option.value->>'reply_id' = e.normalized_event->>'interactiveReplyId'
                     AND pg_catalog.jsonb_typeof(option.value->'next_node_key') = 'string'
                     AND EXISTS (SELECT 1 FROM public.flow_nodes AS target
                                  WHERE target.flow_id = d.flow_id
                                    AND target.node_key = option.value->>'next_node_key'))))
  ) AND public.is_valid_evolution_flow_interactive_event(p_dispatch_id, p_event_id);
$function$;

REVOKE ALL ON FUNCTION public.is_valid_evolution_flow_interactive_start(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_evolution_flow_interactive_start(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_evolution_flow_interactive_prompt(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_flow_run_id uuid,
  p_event_id uuid,
  p_expected_transition_seq integer,
  p_node_key text
) RETURNS TABLE(applied boolean, transition_seq integer, status text, prompt_message_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_node public.flow_nodes%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_connection_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_next_seq integer;
  v_existing public.flow_run_events%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL OR p_step_id IS NULL
     OR p_step_lease_token IS NULL OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL OR p_expected_transition_seq < 0
     OR p_expected_transition_seq >= 2147483647 OR p_node_key IS NULL THEN
    RAISE EXCEPTION 'Invalid Flow interactive prompt request' USING ERRCODE = '22023';
  END IF;
  SELECT d.* INTO v_dispatch FROM public.evolution_event_dispatches d
   WHERE d.id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND OR v_dispatch.engine <> 'flow' OR v_dispatch.flow_run_id <> p_flow_run_id
     OR v_dispatch.event_id <> p_event_id OR v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Flow interactive root lease or lineage is stale' USING ERRCODE = '55000';
  END IF;
  SELECT s.* INTO v_step FROM public.evolution_dispatch_steps s
   WHERE s.id = p_step_id AND s.dispatch_id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND OR v_step.action_key IS DISTINCT FROM p_expected_transition_seq::text || ':' || p_node_key
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Flow interactive prompt step is not linked to its stable send attempt' USING ERRCODE = '23514';
  END IF;
  SELECT e.connection_id INTO v_connection_id FROM public.evolution_events e
   WHERE e.id = p_event_id AND e.state = 'done'
     AND e.normalized_event->>'kind' = 'message'
     AND e.normalized_event->>'fromMe' = 'false'
     AND e.normalized_event->>'sentByApi' = 'false'
     AND e.normalized_event->>'contentType' IN ('text', 'interactive')
   FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.whatsapp_connections c
                                WHERE c.id = v_connection_id AND c.provider = 'evolution'
                                  AND c.account_id = v_dispatch.account_id) THEN
    RAISE EXCEPTION 'Flow interactive prompt root event is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT a.* INTO v_attempt FROM public.evolution_send_attempts a
   WHERE a.id = v_step.send_attempt_id FOR SHARE;
  IF NOT FOUND OR v_attempt.outcome <> 'accepted'
     OR v_attempt.account_id <> v_dispatch.account_id
     OR v_attempt.connection_id <> v_connection_id
     OR v_attempt.conversation_id <> v_dispatch.conversation_id
     OR v_attempt.request_id <> v_step.request_id
     OR v_attempt.message_row_id IS NULL THEN
    RAISE EXCEPTION 'Interactive prompt send is not known accepted for this Flow' USING ERRCODE = '55000';
  END IF;
  SELECT m.* INTO v_message FROM public.messages m
   WHERE m.id = v_attempt.message_row_id FOR UPDATE;
  IF NOT FOUND OR v_message.conversation_id <> v_dispatch.conversation_id
     OR v_message.provider_connection_id <> v_connection_id
     OR v_message.content_type <> 'interactive'
     OR v_message.status <> 'sent'
     OR v_message.sender_id IS NULL
     OR v_attempt.external_message_id IS NULL THEN
    RAISE EXCEPTION 'Accepted prompt message link is inconsistent' USING ERRCODE = '23514';
  END IF;
  SELECT n.* INTO v_node FROM public.flow_nodes n
   WHERE n.flow_id = v_dispatch.flow_id AND n.node_key = p_node_key FOR SHARE;
  IF NOT FOUND OR v_message.interactive_payload->>'kind' IS DISTINCT FROM
       (CASE WHEN v_node.node_type = 'send_buttons' THEN 'buttons'
             WHEN v_node.node_type = 'send_list' THEN 'list' ELSE NULL END)
     OR v_node.node_type NOT IN ('send_buttons', 'send_list')
     OR v_message.interactive_payload->>'requestId' IS DISTINCT FROM v_step.request_id THEN
    RAISE EXCEPTION 'Accepted prompt does not match the persisted interactive Flow node' USING ERRCODE = '23514';
  END IF;
  IF v_node.node_type = 'send_buttons' AND (
       pg_catalog.jsonb_typeof(v_node.config->'buttons') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_typeof(v_message.interactive_payload->'buttons') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_node.config->'buttons') <> pg_catalog.jsonb_array_length(v_message.interactive_payload->'buttons')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(v_node.config->'buttons') AS option(value)
          WHERE pg_catalog.jsonb_typeof(option.value->'reply_id') IS DISTINCT FROM 'string'
             OR NOT EXISTS (
               SELECT 1 FROM pg_catalog.jsonb_array_elements(v_message.interactive_payload->'buttons') AS sent(value)
                WHERE sent.value->>'id' = option.value->>'reply_id'
             )
       )
     ) THEN
    RAISE EXCEPTION 'Accepted button prompt options differ from persisted Flow config' USING ERRCODE = '23514';
  END IF;
  IF v_node.node_type = 'send_list' AND (
       pg_catalog.jsonb_typeof(v_node.config->'sections') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_typeof(v_message.interactive_payload->'sections') IS DISTINCT FROM 'array'
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_array_elements(v_node.config->'sections') AS section(value)
         CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
           CASE WHEN pg_catalog.jsonb_typeof(section.value->'rows') = 'array'
                THEN section.value->'rows' ELSE '[]'::jsonb END
         ) AS option(value)
          WHERE pg_catalog.jsonb_typeof(option.value->'reply_id') IS DISTINCT FROM 'string'
             OR NOT EXISTS (
               SELECT 1
                 FROM pg_catalog.jsonb_array_elements(v_message.interactive_payload->'sections') AS sent_section(value)
                 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
                   CASE WHEN pg_catalog.jsonb_typeof(sent_section.value->'rows') = 'array'
                        THEN sent_section.value->'rows' ELSE '[]'::jsonb END
                 ) AS sent(value)
                WHERE sent.value->>'id' = option.value->>'reply_id'
             )
       )
     ) THEN
    RAISE EXCEPTION 'Accepted list prompt options differ from persisted Flow config' USING ERRCODE = '23514';
  END IF;
  SELECT r.* INTO v_run FROM public.flow_runs r WHERE r.id = p_flow_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status <> 'active' OR v_run.current_node_key <> p_node_key
     OR v_run.account_id <> v_dispatch.account_id OR v_run.flow_id <> v_dispatch.flow_id
     OR v_run.user_id <> v_dispatch.user_id OR v_run.contact_id <> v_dispatch.contact_id
     OR v_run.conversation_id <> v_dispatch.conversation_id THEN
    RAISE EXCEPTION 'Interactive prompt Flow run is stale or cross-tenant' USING ERRCODE = '40001';
  END IF;
  IF v_step.state = 'done' THEN
    SELECT e.* INTO v_existing FROM public.flow_run_events e
     WHERE e.flow_run_id = v_run.id AND e.evolution_event_id = p_event_id
       AND e.event_type = 'message_sent' AND e.node_key = p_node_key FOR SHARE;
    IF NOT FOUND OR v_step.result->>'prompt_message_id' IS DISTINCT FROM v_message.id::text
       OR v_existing.payload <> jsonb_build_object('node_type', v_node.node_type)
       OR v_existing.transition_seq <> p_expected_transition_seq + 1
       OR v_run.transition_seq < v_existing.transition_seq THEN
      RAISE EXCEPTION 'Interactive prompt replay differs from durable checkpoint' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT false, v_run.transition_seq, v_run.status, v_message.id;
    RETURN;
  END IF;
  IF v_step.state <> 'processing' OR v_step.lease_token <> p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= v_now
     OR v_run.transition_seq <> p_expected_transition_seq THEN
    RAISE EXCEPTION 'Interactive prompt step lease or sequence is stale' USING ERRCODE = '40001';
  END IF;
  v_next_seq := p_expected_transition_seq + 1;
  INSERT INTO public.flow_run_events(flow_run_id,event_type,node_key,payload,evolution_event_id,transition_seq)
  VALUES (v_run.id,'message_sent',p_node_key,jsonb_build_object('node_type',v_node.node_type),p_event_id,v_next_seq);
  UPDATE public.flow_runs AS r SET last_prompt_message_id = v_message.id,
      transition_seq = v_next_seq, last_advanced_at = v_now
   WHERE r.id = v_run.id AND r.status = 'active'
     AND r.current_node_key = p_node_key AND r.transition_seq = p_expected_transition_seq;
  IF NOT FOUND THEN RAISE EXCEPTION 'Flow prompt checkpoint lost its cursor fence' USING ERRCODE = '40001'; END IF;
  v_result := jsonb_build_object('applied',true,'transition_seq',v_next_seq,'node_key',p_node_key,
                                'prompt_message_id',v_message.id);
  PERFORM public.complete_evolution_dispatch_step(
    p_step_id,p_dispatch_lease_token,p_step_lease_token,'done',v_step.request_id,
    v_step.send_attempt_id,v_result,NULL
  );
  RETURN QUERY SELECT true,v_next_seq,'active'::text,v_message.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_interactive_prompt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_interactive_prompt(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_evolution_flow_interactive_reply(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_flow_run_id uuid,
  p_event_id uuid,
  p_expected_transition_seq integer,
  p_node_key text
) RETURNS TABLE(applied boolean, transition_seq integer, status text, next_node_key text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_node public.flow_nodes%ROWTYPE;
  v_prompt public.messages%ROWTYPE;
  v_reply public.messages%ROWTYPE;
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_reply_kind text;
  v_reply_id text;
  v_next_node_key text;
  v_next_seq integer;
  v_existing public.flow_run_events%ROWTYPE;
  v_transition record;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL OR p_step_id IS NULL
     OR p_step_lease_token IS NULL OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL OR p_expected_transition_seq < 0
     OR p_expected_transition_seq >= 2147483647 OR p_node_key IS NULL THEN
    RAISE EXCEPTION 'Invalid Flow interactive reply request' USING ERRCODE = '22023';
  END IF;
  SELECT d.* INTO v_dispatch FROM public.evolution_event_dispatches d
   WHERE d.id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND OR v_dispatch.engine <> 'flow' OR v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token <> p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= pg_catalog.clock_timestamp()
     OR v_dispatch.flow_run_id <> p_flow_run_id OR v_dispatch.event_id <> p_event_id THEN
    RAISE EXCEPTION 'Flow interactive reply root lease or lineage is stale' USING ERRCODE = '55000';
  END IF;
  SELECT s.* INTO v_step FROM public.evolution_dispatch_steps s
   WHERE s.id = p_step_id AND s.dispatch_id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND OR v_step.action_key IS DISTINCT FROM p_expected_transition_seq::text || ':' || p_node_key
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Flow interactive reply step does not match action key' USING ERRCODE = '23514';
  END IF;
  SELECT e.* INTO v_event FROM public.evolution_events e
   WHERE e.id = p_event_id FOR SHARE;
  IF NOT FOUND OR v_event.state <> 'done' THEN
    RAISE EXCEPTION 'Flow interactive reply event is not applied' USING ERRCODE = '23514';
  END IF;
  v_reply_kind := v_event.normalized_event->>'interactiveReplyKind';
  v_reply_id := v_event.normalized_event->>'interactiveReplyId';
  IF NOT public.is_valid_evolution_flow_interactive_event(p_dispatch_id,p_event_id)
     OR v_reply_kind NOT IN ('button','list') THEN
    RAISE EXCEPTION 'Flow interactive reply event/message lineage is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT m.* INTO v_reply FROM public.messages m
   WHERE m.provider_connection_id = v_event.connection_id
     AND m.message_id = v_event.normalized_event->>'externalMessageId'
     AND m.sender_type = 'customer' AND m.content_type = 'interactive'
     AND m.interactive_reply_id = v_reply_id AND m.conversation_id = v_dispatch.conversation_id
   FOR SHARE;
  IF NOT FOUND OR v_reply.conversation_id <> v_dispatch.conversation_id
     OR v_event.connection_id IS DISTINCT FROM (
       SELECT c.id FROM public.whatsapp_connections c
        WHERE c.id = v_event.connection_id AND c.account_id = v_dispatch.account_id
          AND c.provider = 'evolution'
     ) THEN
    RAISE EXCEPTION 'Reply message does not belong to this Flow conversation' USING ERRCODE = '23514';
  END IF;
  SELECT r.* INTO v_run FROM public.flow_runs r WHERE r.id = p_flow_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.account_id <> v_dispatch.account_id OR v_run.flow_id <> v_dispatch.flow_id
     OR v_run.user_id <> v_dispatch.user_id OR v_run.contact_id <> v_dispatch.contact_id
     OR v_run.conversation_id <> v_dispatch.conversation_id THEN
    RAISE EXCEPTION 'Flow reply run is not active at the expected tenant/node/sequence' USING ERRCODE = '40001';
  END IF;
  SELECT n.* INTO v_node FROM public.flow_nodes n
   WHERE n.flow_id = v_dispatch.flow_id AND n.node_key = p_node_key FOR SHARE;
  IF NOT FOUND OR (v_reply_kind = 'button' AND v_node.node_type <> 'send_buttons')
     OR (v_reply_kind = 'list' AND v_node.node_type <> 'send_list') THEN
    RAISE EXCEPTION 'Reply kind does not match the active Flow prompt node' USING ERRCODE = '23514';
  END IF;
  IF v_run.last_prompt_message_id IS NULL THEN
    RAISE EXCEPTION 'Flow interactive reply has no accepted prompt checkpoint' USING ERRCODE = '23514';
  END IF;
  SELECT m.* INTO v_prompt FROM public.messages m
   WHERE m.id = v_run.last_prompt_message_id AND m.conversation_id = v_run.conversation_id
     AND m.content_type = 'interactive' AND m.status = 'sent'
   FOR SHARE;
  IF NOT FOUND OR v_reply.created_at <= v_prompt.created_at THEN
    RAISE EXCEPTION 'Flow reply is not later than the saved prompt' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.evolution_send_attempts a
        WHERE a.message_row_id = v_prompt.id AND a.account_id = v_dispatch.account_id
          AND a.connection_id = v_event.connection_id
          AND a.conversation_id = v_dispatch.conversation_id AND a.outcome = 'accepted'
          AND a.external_message_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Flow prompt has no accepted send attempt' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.flow_run_events fe
        WHERE fe.flow_run_id = v_run.id AND fe.event_type = 'message_sent'
          AND fe.node_key = p_node_key AND fe.transition_seq = p_expected_transition_seq
     ) THEN
    RAISE EXCEPTION 'Flow prompt checkpoint is missing' USING ERRCODE = '23514';
  END IF;
  IF v_reply_kind = 'button' THEN
    SELECT count(*), min(choice.value->>'next_node_key')
      INTO STRICT v_next_seq, v_next_node_key
      FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(v_node.config->'buttons') = 'array'
             THEN v_node.config->'buttons' ELSE '[]'::jsonb END
      ) AS choice(value)
     WHERE choice.value->>'reply_id' = v_reply_id;
  ELSE
    SELECT count(*), min(row_item.value->>'next_node_key')
      INTO STRICT v_next_seq, v_next_node_key
      FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(v_node.config->'sections') = 'array'
             THEN v_node.config->'sections' ELSE '[]'::jsonb END
      ) AS section(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(section.value->'rows') = 'array'
             THEN section.value->'rows' ELSE '[]'::jsonb END
      ) AS row_item(value)
     WHERE row_item.value->>'reply_id' = v_reply_id;
  END IF;
  IF v_next_seq <> 1 OR v_next_node_key IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.flow_nodes target
                     WHERE target.flow_id = v_dispatch.flow_id
                       AND target.node_key = v_next_node_key) THEN
    RAISE EXCEPTION 'Reply ID does not identify one persisted Flow option' USING ERRCODE = '23514';
  END IF;
  v_next_seq := p_expected_transition_seq + 1;
  IF v_step.state = 'done' THEN
    SELECT fe.* INTO v_existing FROM public.flow_run_events fe
     WHERE fe.flow_run_id = v_run.id AND fe.event_type = 'reply_received'
       AND fe.evolution_event_id = p_event_id FOR SHARE;
    IF NOT FOUND OR v_existing.node_key <> p_node_key OR v_existing.payload <> '{}'::jsonb
       OR v_existing.transition_seq <> v_next_seq
       OR v_step.result->>'next_node_key' IS DISTINCT FROM v_next_node_key
       OR v_step.result->>'transition_seq' IS DISTINCT FROM v_next_seq::text THEN
      RAISE EXCEPTION 'Flow interactive reply replay differs from its checkpoint' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT false,v_run.transition_seq,v_run.status,v_next_node_key;
    RETURN;
  END IF;
  IF v_run.status <> 'active' OR v_run.current_node_key <> p_node_key
     OR v_run.transition_seq <> p_expected_transition_seq THEN
    RAISE EXCEPTION 'Flow reply run is not at the expected active node/sequence' USING ERRCODE = '40001';
  END IF;
  IF v_step.state <> 'processing' OR v_step.lease_token <> p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Flow interactive reply step lease is stale' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO STRICT v_transition FROM public.complete_evolution_flow_transition(
    p_dispatch_id,p_dispatch_lease_token,p_step_id,p_step_lease_token,p_flow_run_id,
    p_event_id,p_expected_transition_seq,'reply_received',p_node_key,'{}'::jsonb,
    v_next_node_key,'active',NULL
  );
  IF v_transition.applied THEN
    UPDATE public.evolution_dispatch_steps AS s
       SET result = s.result || jsonb_build_object('next_node_key',v_next_node_key),
           updated_at = pg_catalog.clock_timestamp()
     WHERE s.id = p_step_id AND s.dispatch_id = p_dispatch_id AND s.state = 'done';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Flow interactive reply checkpoint did not complete atomically' USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN QUERY SELECT v_transition.applied,v_transition.transition_seq,v_transition.status,v_next_node_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_interactive_reply(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_interactive_reply(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)
  TO service_role;
