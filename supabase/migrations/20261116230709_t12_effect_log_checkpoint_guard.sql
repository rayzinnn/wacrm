-- Keep the effect implementation intact and add its checkpoint in the same
-- database transaction. The ledger-step ID makes the write idempotent.
ALTER FUNCTION public.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  SET SCHEMA wacrm_private;
ALTER FUNCTION wacrm_private.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  RENAME TO apply_evolution_automation_effect_unlogged;
REVOKE ALL ON FUNCTION wacrm_private.apply_evolution_automation_effect_unlogged(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wacrm_private.apply_evolution_automation_effect_unlogged(uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;

CREATE FUNCTION public.apply_evolution_automation_effect(
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_operation text,
  p_payload jsonb
) RETURNS TABLE(step_id uuid, state text, result jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_effect record;
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_definition public.automation_steps%ROWTYPE;
  v_log public.automation_logs%ROWTYPE;
  v_action_id uuid;
  v_entry jsonb;
  v_existing jsonb;
BEGIN
  SELECT * INTO STRICT v_effect
    FROM wacrm_private.apply_evolution_automation_effect_unlogged(
      p_dispatch_id, p_dispatch_lease_token, p_step_id,
      p_step_lease_token, p_operation, p_payload
    );

  IF v_effect.state IS DISTINCT FROM 'done' OR v_effect.step_id IS DISTINCT FROM p_step_id THEN
    RAISE EXCEPTION 'Automation effect completion response is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND OR v_dispatch.engine IS DISTINCT FROM 'automation'
     OR v_dispatch.automation_log_id IS NULL
     OR v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Automation effect root fence or log link is invalid' USING ERRCODE = '55000';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id
     OR v_step.state IS DISTINCT FROM 'done'
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.result IS DISTINCT FROM v_effect.result THEN
    RAISE EXCEPTION 'Automation effect result does not match its ledger step' USING ERRCODE = '23514';
  END IF;

  BEGIN
    v_action_id := v_step.action_key::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Automation effect action key is invalid' USING ERRCODE = '23514';
  END;
  SELECT a.* INTO v_definition
    FROM public.automation_steps AS a
   WHERE a.id = v_action_id
     AND a.automation_id = v_dispatch.automation_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation effect definition link is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT l.* INTO v_log
    FROM public.automation_logs AS l
   WHERE l.id = v_dispatch.automation_log_id
     AND l.evolution_dispatch_id = v_dispatch.id
     AND l.automation_id = v_dispatch.automation_id
     AND l.account_id = v_dispatch.account_id
     AND l.user_id = v_dispatch.user_id
   FOR UPDATE;
  IF NOT FOUND OR pg_catalog.jsonb_typeof(v_log.steps_executed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Automation effect log/tenant link is invalid' USING ERRCODE = '23514';
  END IF;

  v_entry := pg_catalog.jsonb_build_object(
    'step_id', v_action_id,
    'evolution_dispatch_step_id', v_step.id,
    'step_type', v_definition.step_type,
    'status', 'success',
    'outcome_state', 'done',
    'result', v_effect.result,
    'error_code', NULL,
    'detail', NULL
  );
  SELECT item INTO v_existing
    FROM pg_catalog.jsonb_array_elements(v_log.steps_executed) AS items(item)
   WHERE item->>'evolution_dispatch_step_id' = v_step.id::text
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing IS DISTINCT FROM v_entry THEN
      RAISE EXCEPTION 'Automation effect checkpoint replay differs' USING ERRCODE = '23514';
    END IF;
  ELSE
    UPDATE public.automation_logs AS l
       SET steps_executed = l.steps_executed || pg_catalog.jsonb_build_array(v_entry)
     WHERE l.id = v_log.id
       AND l.evolution_dispatch_id = v_dispatch.id
       AND l.account_id = v_dispatch.account_id
       AND l.user_id = v_dispatch.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Automation effect checkpoint could not be appended' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN QUERY SELECT v_effect.step_id, v_effect.state, v_effect.result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;
