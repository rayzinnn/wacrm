CREATE FUNCTION public.complete_evolution_flow_set_tag(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_flow_run_id uuid,
  p_event_id uuid,
  p_expected_transition_seq integer,
  p_node_key text,
  p_mode text,
  p_tag_id uuid,
  p_next_node_key text
) RETURNS TABLE(applied boolean, transition_seq integer, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_node public.flow_nodes%ROWTYPE;
  v_contact_account_id uuid;
  v_tag_account_id uuid;
  v_transition record;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_flow_run_id IS NULL OR p_event_id IS NULL
     OR p_expected_transition_seq IS NULL OR p_expected_transition_seq < 0
     OR p_node_key IS NULL OR p_mode IS NULL OR p_mode NOT IN ('add', 'remove')
     OR p_tag_id IS NULL OR p_next_node_key IS NULL THEN
    RAISE EXCEPTION 'Invalid Flow set_tag transition request' USING ERRCODE = '22023';
  END IF;

  -- Match the Flow transition lock order and keep the root fence through the
  -- nested transition and tag mutation.
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.engine IS DISTINCT FROM 'flow'
     OR v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= pg_catalog.clock_timestamp()
     OR v_dispatch.flow_run_id IS DISTINCT FROM p_flow_run_id
     OR v_dispatch.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Dispatch root lease or Flow lineage is stale' USING ERRCODE = '55000';
  END IF;

  SELECT n.* INTO v_node
    FROM public.flow_nodes AS n
   WHERE n.flow_id = v_dispatch.flow_id
     AND n.node_key = p_node_key
   FOR SHARE;
  IF NOT FOUND OR v_node.node_type IS DISTINCT FROM 'set_tag'
     OR v_node.config->>'mode' IS DISTINCT FROM p_mode
     OR v_node.config->>'tag_id' IS DISTINCT FROM p_tag_id::text
     OR v_node.config->>'next_node_key' IS DISTINCT FROM p_next_node_key THEN
    RAISE EXCEPTION 'Persisted Flow set_tag configuration does not match request'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.flow_nodes AS n
        WHERE n.flow_id = v_dispatch.flow_id
          AND n.node_key = p_next_node_key
     ) THEN
    RAISE EXCEPTION 'Flow set_tag target node does not exist' USING ERRCODE = '23514';
  END IF;
  IF v_dispatch.contact_id IS NULL THEN
    RAISE EXCEPTION 'Flow set_tag requires a root contact' USING ERRCODE = '23514';
  END IF;
  SELECT c.account_id INTO v_contact_account_id
    FROM public.contacts AS c
   WHERE c.id = v_dispatch.contact_id
   FOR SHARE;
  IF NOT FOUND OR v_contact_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Flow set_tag contact/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT t.account_id INTO v_tag_account_id
    FROM public.tags AS t
   WHERE t.id = p_tag_id
   FOR SHARE;
  IF NOT FOUND OR v_tag_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Flow set_tag tag/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  -- The existing transition RPC validates event/run/step lineage, both
  -- leases, and the expected cursor. Tag mutation below shares its transaction.
  SELECT * INTO STRICT v_transition
    FROM public.complete_evolution_flow_transition(
      p_dispatch_id, p_dispatch_lease_token, p_step_id, p_step_lease_token,
      p_flow_run_id, p_event_id, p_expected_transition_seq,
      'node_entered', p_node_key, '{}'::jsonb,
      p_next_node_key, 'active', NULL
    );

  IF v_transition.applied THEN
    IF p_mode = 'add' THEN
      INSERT INTO public.contact_tags (contact_id, tag_id)
      VALUES (v_dispatch.contact_id, p_tag_id)
      ON CONFLICT (contact_id, tag_id) DO NOTHING;
    ELSE
      DELETE FROM public.contact_tags AS ct
       WHERE ct.contact_id = v_dispatch.contact_id
         AND ct.tag_id = p_tag_id;
    END IF;
  END IF;

  RETURN QUERY SELECT v_transition.applied, v_transition.transition_seq, v_transition.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_flow_set_tag(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_flow_set_tag(
  uuid, uuid, uuid, uuid, uuid, uuid, integer, text, text, uuid, text
) TO service_role;
