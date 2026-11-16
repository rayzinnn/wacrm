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
     OR v_event.normalized_event->>'contentType' IS DISTINCT FROM 'text'
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
