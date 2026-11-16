CREATE FUNCTION public.claim_evolution_dispatch_send_step(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_action_key text,
  p_lease_seconds integer DEFAULT 60
) RETURNS TABLE(
  step_id uuid,
  state text,
  lease_token uuid,
  request_id text,
  send_attempt_id uuid,
  should_execute boolean,
  lease_acquired boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_connection_id uuid;
  v_connection_account_id uuid;
  v_definition_account_id uuid;
  v_attempt public.evolution_send_attempts%ROWTYPE;
  v_step_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_should_execute boolean := false;
  v_lease_acquired boolean := false;
  v_link_discovered_attempt boolean := false;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_action_key IS NULL OR pg_catalog.btrim(p_action_key) = ''
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'Invalid dispatch step claim' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  SELECT e.connection_id, c.account_id
    INTO v_connection_id, v_connection_account_id
    FROM public.evolution_events AS e
    JOIN public.whatsapp_connections AS c ON c.id = e.connection_id
   WHERE e.id = v_dispatch.event_id AND c.provider = 'evolution';
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_connection_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch event connection/account lineage is invalid' USING ERRCODE = '23514';
  END IF;

  IF v_dispatch.engine = 'automation' THEN
    SELECT a.account_id INTO v_definition_account_id
      FROM public.automations AS a WHERE a.id = v_dispatch.automation_id;
  ELSIF v_dispatch.engine = 'flow' THEN
    SELECT f.account_id INTO v_definition_account_id
      FROM public.flows AS f WHERE f.id = v_dispatch.flow_id;
  ELSE
    SELECT a.account_id INTO v_definition_account_id
      FROM public.ai_configs AS a WHERE a.id = v_dispatch.ai_config_id;
  END IF;
  IF v_definition_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch definition/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch audit user/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_dispatch.conversation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM public.conversations AS c
         JOIN public.contacts AS p ON p.id = c.contact_id
        WHERE c.id = v_dispatch.conversation_id
          AND c.account_id = v_dispatch.account_id
          AND p.account_id = v_dispatch.account_id
          AND (v_dispatch.contact_id IS NULL OR c.contact_id = v_dispatch.contact_id)
     ) THEN
    RAISE EXCEPTION 'Dispatch conversation/contact tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  v_step_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, request_id
  ) VALUES (
    v_step_id, p_dispatch_id, p_action_key, 'evolution-step:' || v_step_id::text
  ) ON CONFLICT (dispatch_id, action_key) DO NOTHING;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.dispatch_id = p_dispatch_id AND s.action_key = p_action_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch step could not be locked' USING ERRCODE = '40001';
  END IF;
  IF v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text THEN
    RAISE EXCEPTION 'Dispatch step request ID does not match its stable key' USING ERRCODE = '23514';
  END IF;

  -- A reservation committed before it was linked must suppress another POST.
  IF v_step.send_attempt_id IS NULL THEN
    SELECT a.* INTO v_attempt
      FROM public.evolution_send_attempts AS a
     WHERE a.account_id = v_dispatch.account_id AND a.request_id = v_step.request_id
     FOR UPDATE;
    IF FOUND THEN
      v_step.send_attempt_id := v_attempt.id;
      v_link_discovered_attempt := true;
    END IF;
  ELSE
    SELECT a.* INTO v_attempt
      FROM public.evolution_send_attempts AS a
     WHERE a.id = v_step.send_attempt_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked Evolution send attempt not found' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_step.send_attempt_id IS NOT NULL THEN
    IF v_attempt.account_id IS DISTINCT FROM v_dispatch.account_id
       OR v_attempt.connection_id IS DISTINCT FROM v_connection_id
       OR v_attempt.request_id IS DISTINCT FROM v_step.request_id
       OR v_dispatch.conversation_id IS NULL
       OR v_attempt.conversation_id IS DISTINCT FROM v_dispatch.conversation_id
       OR NOT EXISTS (
         SELECT 1 FROM public.conversations AS c
         JOIN public.contacts AS p ON p.id = c.contact_id
         WHERE c.id = v_attempt.conversation_id
           AND c.account_id = v_dispatch.account_id
           AND p.account_id = v_dispatch.account_id
       ) THEN
      RAISE EXCEPTION 'Evolution send attempt does not match dispatch tenant lineage' USING ERRCODE = '23514';
    END IF;
    IF v_link_discovered_attempt THEN
      UPDATE public.evolution_dispatch_steps AS s
         SET send_attempt_id = v_step.send_attempt_id,
             updated_at = v_now
       WHERE s.id = v_step.id AND s.send_attempt_id IS NULL;
    END IF;
  END IF;

  IF v_step.state IN ('done', 'skipped', 'failed', 'unknown') THEN
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.send_attempt_id, false, false;
    RETURN;
  END IF;
  IF v_step.state = 'pending' AND v_step.next_attempt_at > v_now THEN
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.send_attempt_id, false, false;
    RETURN;
  END IF;
  IF v_step.state = 'processing' AND v_step.lease_until > v_now THEN
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.send_attempt_id, false, false;
    RETURN;
  END IF;

  v_should_execute := v_step.send_attempt_id IS NULL;
  IF v_should_execute AND v_step.attempts >= 5 THEN
    UPDATE public.evolution_dispatch_steps AS s
       SET state = 'failed', lease_until = NULL, lease_token = NULL,
           last_error_code = COALESCE(s.last_error_code, 'attempts_exhausted'),
           updated_at = v_now
     WHERE s.id = v_step.id
    RETURNING s.* INTO v_step;
    RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                        v_step.request_id, v_step.send_attempt_id, false, false;
    RETURN;
  END IF;

  UPDATE public.evolution_dispatch_steps AS s
     SET state = 'processing',
         attempts = CASE WHEN v_should_execute THEN s.attempts + 1 ELSE s.attempts END,
         lease_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds::double precision),
         lease_token = pg_catalog.gen_random_uuid(),
         updated_at = v_now
   WHERE s.id = v_step.id
  RETURNING s.* INTO v_step;
  v_lease_acquired := true;

  RETURN QUERY SELECT v_step.id, v_step.state, v_step.lease_token,
                      v_step.request_id, v_step.send_attempt_id,
                      v_should_execute, v_lease_acquired;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_evolution_dispatch_send_step(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_dispatch_send_step(uuid, uuid, text, integer)
  TO service_role;
