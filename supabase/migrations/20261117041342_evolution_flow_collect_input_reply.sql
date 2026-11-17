CREATE FUNCTION public.complete_evolution_flow_collect_input_reply(
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
  v_connection_account_id uuid;
  v_flow_account_id uuid;
  v_flow_user_id uuid;
  v_contact_account_id uuid;
  v_node public.flow_nodes%ROWTYPE;
  v_run public.flow_runs%ROWTYPE;
  v_existing public.flow_run_events%ROWTYPE;
  v_var_key text;
  v_next_node_key text;
  v_reply_raw text;
  v_reply text;
  v_now timestamptz;
  v_next_transition_seq integer;
  v_step_result jsonb;
  v_completed public.evolution_dispatch_steps%ROWTYPE;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL
     OR p_expected_transition_seq < 0 OR p_expected_transition_seq >= 2147483647
     OR p_node_key IS NULL OR pg_catalog.btrim(p_node_key) = '' THEN
    RAISE EXCEPTION 'Invalid Flow collect_input request' USING ERRCODE = '22023';
  END IF;

  -- Use the same root -> step -> event -> run lock order as Flow transitions.
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.engine IS DISTINCT FROM 'flow'
     OR v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch lease or Flow lineage is stale' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.flow_id IS NULL
     OR v_dispatch.flow_run_id IS DISTINCT FROM p_flow_run_id
     OR v_dispatch.event_id IS DISTINCT FROM p_event_id
     OR v_dispatch.contact_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch root does not match the Flow run or event'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id THEN
    RAISE EXCEPTION 'Dispatch step/root association is invalid' USING ERRCODE = '23514';
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
     OR v_event.normalized_event->>'sentByApi' IS DISTINCT FROM 'false'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event->'text') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Reply is not a completed inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;
  v_reply_raw := v_event.normalized_event->>'text';
  v_reply := pg_catalog.regexp_replace(
    v_reply_raw, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
  IF v_reply IS NULL OR v_reply = '' THEN
    RAISE EXCEPTION 'Reply text is empty after trimming' USING ERRCODE = '22023';
  END IF;

  SELECT c.account_id INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Reply event connection/account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT f.account_id, f.user_id INTO v_flow_account_id, v_flow_user_id
    FROM public.flows AS f
   WHERE f.id = v_dispatch.flow_id
   FOR SHARE;
  IF NOT FOUND OR v_flow_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_flow_user_id IS DISTINCT FROM v_dispatch.user_id
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id
          AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Flow definition/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT c.account_id INTO v_contact_account_id
    FROM public.contacts AS c
   WHERE c.id = v_dispatch.contact_id
   FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Flow contact/account lineage is invalid' USING ERRCODE = '23514';
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

  -- A completed call may be replayed while its root lease is still live.
  -- Return the current checkpoint only for the same durable step result.
  SELECT e.* INTO v_existing
    FROM public.flow_run_events AS e
   WHERE e.flow_run_id = v_run.id
     AND e.event_type = 'reply_received'
     AND e.evolution_event_id = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF v_existing.node_key IS DISTINCT FROM p_node_key
       OR v_existing.payload IS DISTINCT FROM '{}'::jsonb
       OR v_step.state IS DISTINCT FROM 'done'
       OR v_step.result->>'event_id' IS DISTINCT FROM p_event_id::text
       OR v_step.result->>'node_key' IS DISTINCT FROM p_node_key
       OR v_step.result->>'transition_seq' IS DISTINCT FROM v_existing.transition_seq::text THEN
      RAISE EXCEPTION 'Reply replay does not match its durable checkpoint'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT false, v_run.transition_seq, v_run.status;
    RETURN;
  END IF;

  IF v_run.status IS DISTINCT FROM 'active'
     OR v_run.current_node_key IS DISTINCT FROM p_node_key THEN
    RAISE EXCEPTION 'Flow run is not awaiting input at this node' USING ERRCODE = '55000';
  END IF;
  IF v_run.transition_seq IS DISTINCT FROM p_expected_transition_seq THEN
    RAISE EXCEPTION 'Flow transition sequence is stale or out of order'
      USING ERRCODE = '40001';
  END IF;
  v_next_transition_seq := p_expected_transition_seq + 1;

  SELECT n.* INTO v_node
    FROM public.flow_nodes AS n
   WHERE n.flow_id = v_dispatch.flow_id
     AND n.node_key = p_node_key
   FOR SHARE;
  IF NOT FOUND OR v_node.node_type IS DISTINCT FROM 'collect_input'
     OR pg_catalog.jsonb_typeof(v_node.config) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_node.config->'var_key') IS DISTINCT FROM 'string'
     OR pg_catalog.jsonb_typeof(v_node.config->'next_node_key') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Persisted Flow node is not a valid collect_input'
      USING ERRCODE = '23514';
  END IF;
  v_var_key := v_node.config->>'var_key';
  v_next_node_key := v_node.config->>'next_node_key';
  IF v_var_key IS NULL OR v_var_key !~ '^[A-Za-z_][A-Za-z0-9_]*$'
     OR v_next_node_key IS NULL OR pg_catalog.btrim(v_next_node_key) = ''
     OR NOT EXISTS (
       SELECT 1 FROM public.flow_nodes AS n
        WHERE n.flow_id = v_dispatch.flow_id
          AND n.node_key = v_next_node_key
     ) THEN
    RAISE EXCEPTION 'Persisted collect_input variable or target is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_typeof(v_run.vars) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Flow run variables are not an object' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.flow_run_events AS e
        WHERE e.flow_run_id = v_run.id
          AND e.event_type = 'message_sent'
          AND e.node_key = p_node_key
          AND e.transition_seq = v_run.transition_seq
     ) THEN
    RAISE EXCEPTION 'Collect_input prompt has no message_sent checkpoint'
      USING ERRCODE = '23514';
  END IF;

  IF v_step.state IS DISTINCT FROM 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL OR v_step.lease_until <= v_now
     OR v_step.action_key IS DISTINCT FROM p_expected_transition_seq::text || ':' || p_node_key
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Collect_input step lease or action key is stale'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.flow_run_events (
    flow_run_id, event_type, node_key, payload, evolution_event_id, transition_seq
  ) VALUES (
    v_run.id, 'reply_received', p_node_key, '{}'::jsonb, p_event_id,
    v_next_transition_seq
  );

  UPDATE public.flow_runs AS r
     SET vars = pg_catalog.jsonb_set(r.vars, ARRAY[v_var_key], pg_catalog.to_jsonb(v_reply), true),
         current_node_key = v_next_node_key,
         transition_seq = v_next_transition_seq,
         last_advanced_at = v_now
   WHERE r.id = v_run.id
     AND r.account_id = v_dispatch.account_id
     AND r.status = 'active'
     AND r.current_node_key = p_node_key
     AND r.transition_seq = p_expected_transition_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flow run changed during collect_input capture'
      USING ERRCODE = '40001';
  END IF;

  v_step_result := pg_catalog.jsonb_build_object(
    'applied', true,
    'event_id', p_event_id,
    'node_key', p_node_key,
    'transition_seq', v_next_transition_seq
  );
  v_completed := public.complete_evolution_dispatch_step(
    p_step_id, p_dispatch_lease_token, p_step_lease_token, 'done',
    v_step.request_id, NULL, v_step_result, NULL
  );

  RETURN QUERY SELECT true, v_next_transition_seq, 'active'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_collect_input_reply(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_collect_input_reply(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text
) TO service_role;
