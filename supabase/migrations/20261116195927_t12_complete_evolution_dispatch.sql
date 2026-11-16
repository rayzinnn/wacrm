CREATE OR REPLACE FUNCTION public.complete_evolution_dispatch(
  p_dispatch_id uuid,
  p_lease_token uuid,
  p_state text,
  p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS public.evolution_event_dispatches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_connection_id uuid;
  v_connection_account_id uuid;
  v_definition_account_id uuid;
  v_safe_error_code text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_dispatch_id IS NULL OR p_lease_token IS NULL OR p_state IS NULL
     OR p_state NOT IN ('done', 'skipped', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid dispatch completion' USING ERRCODE = '22023';
  END IF;
  -- The existing signature has no defined JSON result shape. This operation
  -- intentionally persists no result until that contract is specified.
  IF p_result IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch result payload is not supported' USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NULL THEN
    v_safe_error_code := NULL;
  ELSIF p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
    v_safe_error_code := p_error_code;
  ELSE
    v_safe_error_code := 'worker_error';
  END IF;
  IF p_state IN ('done', 'skipped') AND v_safe_error_code IS NOT NULL THEN
    RAISE EXCEPTION 'Successful dispatch state cannot carry an error code' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_lease_token
     OR v_dispatch.lease_until IS NULL OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  SELECT e.connection_id, c.account_id
    INTO v_connection_id, v_connection_account_id
    FROM public.evolution_events AS e
    JOIN public.whatsapp_connections AS c ON c.id = e.connection_id
   WHERE e.id = v_dispatch.event_id AND c.provider = 'evolution';
  IF NOT FOUND OR v_connection_id IS NULL
     OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch event/connection account lineage is invalid' USING ERRCODE = '23514';
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

  -- All supported step mutation RPCs lock the root first. Holding this root
  -- lock here makes the no-active-step check atomic against a concurrent claim.
  IF EXISTS (
       SELECT 1 FROM public.evolution_dispatch_steps AS s
        WHERE s.dispatch_id = v_dispatch.id AND s.state IN ('pending', 'processing')
     ) THEN
    RAISE EXCEPTION 'Dispatch has unfinished steps' USING ERRCODE = '55000';
  END IF;

  UPDATE public.evolution_event_dispatches AS d
     SET state = p_state,
         lease_until = NULL,
         lease_token = NULL,
         last_error_code = v_safe_error_code,
         result = NULL,
         updated_at = v_now
   WHERE d.id = v_dispatch.id
     AND d.state = 'processing'
     AND d.lease_token = p_lease_token
     AND d.lease_until > v_now
  RETURNING d.* INTO v_dispatch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  RETURN v_dispatch;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  TO service_role;
