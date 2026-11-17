CREATE FUNCTION public.complete_evolution_flow_handoff(
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

  -- Match the Flow transition lock order: root, step, then run. The
  -- conversation update and nested transition share this transaction.
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
     OR v_event.normalized_event->>'contentType' IS DISTINCT FROM 'text'
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
