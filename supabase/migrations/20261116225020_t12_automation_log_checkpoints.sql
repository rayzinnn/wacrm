-- Append an automation dispatch-step checkpoint before the step lease is
-- cleared, and finalize the automation log in the same transaction as its root.
CREATE SCHEMA IF NOT EXISTS wacrm_private;
REVOKE ALL ON SCHEMA wacrm_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA wacrm_private TO service_role;

ALTER FUNCTION public.complete_evolution_dispatch_step(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  SET SCHEMA wacrm_private;
ALTER FUNCTION wacrm_private.complete_evolution_dispatch_step(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  RENAME TO complete_evolution_dispatch_step_unlogged;
REVOKE ALL ON FUNCTION wacrm_private.complete_evolution_dispatch_step_unlogged(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wacrm_private.complete_evolution_dispatch_step_unlogged(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  TO service_role;

CREATE FUNCTION public.append_evolution_automation_step_log(
  p_account_id uuid,
  p_dispatch_id uuid,
  p_dispatch_lease_token uuid,
  p_log_id uuid,
  p_step_id uuid,
  p_step_lease_token uuid,
  p_state text,
  p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS TABLE(log_id uuid, appended boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_log public.automation_logs%ROWTYPE;
  v_definition public.automation_steps%ROWTYPE;
  v_entry jsonb;
  v_existing jsonb;
  v_safe_error_code text;
  v_log_status text;
  v_outcome_label text;
  v_action_id uuid;
BEGIN
  IF p_account_id IS NULL OR p_dispatch_id IS NULL
     OR p_dispatch_lease_token IS NULL OR p_log_id IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_state NOT IN ('done', 'skipped', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid Evolution automation log checkpoint' USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NULL THEN
    v_safe_error_code := NULL;
  ELSIF p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
    v_safe_error_code := p_error_code;
  ELSE
    v_safe_error_code := 'worker_error';
  END IF;
  IF p_state IN ('done', 'skipped') AND v_safe_error_code IS NOT NULL THEN
    RAISE EXCEPTION 'Successful automation step cannot carry an error code' USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND OR v_dispatch.account_id IS DISTINCT FROM p_account_id
     OR v_dispatch.engine IS DISTINCT FROM 'automation'
     OR v_dispatch.automation_id IS NULL
     OR v_dispatch.automation_log_id IS DISTINCT FROM p_log_id THEN
    RAISE EXCEPTION 'Automation log checkpoint tenant/root link is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM public.evolution_events AS e
         JOIN public.whatsapp_connections AS c ON c.id = e.connection_id
         JOIN public.automations AS a ON a.id = v_dispatch.automation_id
         JOIN public.profiles AS p
           ON p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
        WHERE e.id = v_dispatch.event_id
          AND e.state = 'done'
          AND c.provider = 'evolution'
          AND c.account_id = v_dispatch.account_id
          AND a.account_id = v_dispatch.account_id
          AND a.user_id = v_dispatch.user_id
     ) OR (v_dispatch.conversation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM public.conversations AS c
         JOIN public.contacts AS p ON p.id = c.contact_id
        WHERE c.id = v_dispatch.conversation_id
          AND c.account_id = v_dispatch.account_id
          AND p.account_id = v_dispatch.account_id
          AND (v_dispatch.contact_id IS NULL OR c.contact_id = v_dispatch.contact_id)
     )) THEN
    RAISE EXCEPTION 'Automation log checkpoint tenant lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT l.* INTO v_log
    FROM public.automation_logs AS l
   WHERE l.id = p_log_id
   FOR UPDATE;
  IF NOT FOUND OR v_log.evolution_dispatch_id IS DISTINCT FROM v_dispatch.id
     OR v_log.automation_id IS DISTINCT FROM v_dispatch.automation_id
     OR v_log.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_log.user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Automation log checkpoint log/root link is invalid' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_typeof(v_log.steps_executed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Automation log steps must be an array' USING ERRCODE = '23514';
  END IF;

  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id
     OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text THEN
    RAISE EXCEPTION 'Automation log checkpoint step/root link is invalid' USING ERRCODE = '23514';
  END IF;
  BEGIN
    v_action_id := v_step.action_key::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Automation log checkpoint action key is invalid' USING ERRCODE = '23514';
  END;
  SELECT a.* INTO v_definition
    FROM public.automation_steps AS a
   WHERE a.id = v_action_id
     AND a.automation_id = v_dispatch.automation_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation log checkpoint definition link is invalid' USING ERRCODE = '23514';
  END IF;

  v_log_status := CASE p_state
    WHEN 'done' THEN 'success'
    WHEN 'skipped' THEN 'skipped'
    ELSE 'failed'
  END;
  v_outcome_label := CASE p_state
    WHEN 'unknown' THEN 'outcome unknown'
    ELSE v_safe_error_code
  END;
  v_entry := pg_catalog.jsonb_build_object(
    'step_id', v_action_id,
    'evolution_dispatch_step_id', v_step.id,
    'step_type', v_definition.step_type,
    'status', v_log_status,
    'outcome_state', p_state,
    'result', p_result,
    'error_code', v_safe_error_code,
    'detail', v_outcome_label
  );

  SELECT item INTO v_existing
    FROM pg_catalog.jsonb_array_elements(v_log.steps_executed) AS items(item)
   WHERE item->>'evolution_dispatch_step_id' = v_step.id::text
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF v_existing IS DISTINCT FROM v_entry THEN
      RAISE EXCEPTION 'Automation log checkpoint replay payload differs' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_log.id, false;
    RETURN;
  END IF;

  IF v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Automation dispatch lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_step.state IS DISTINCT FROM 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL
     OR v_step.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Automation dispatch step lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  UPDATE public.automation_logs AS l
     SET steps_executed = l.steps_executed || pg_catalog.jsonb_build_array(v_entry)
   WHERE l.id = v_log.id
     AND l.evolution_dispatch_id = v_dispatch.id
     AND l.account_id = p_account_id;
  RETURN QUERY SELECT v_log.id, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.append_evolution_automation_step_log(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_evolution_automation_step_log(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, text)
  TO service_role;

CREATE FUNCTION public.complete_evolution_dispatch_step(
  p_step_id uuid,
  p_dispatch_lease_token uuid,
  p_lease_token uuid,
  p_state text,
  p_request_id text DEFAULT NULL,
  p_send_attempt_id uuid DEFAULT NULL,
  p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS public.evolution_dispatch_steps
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_existing public.evolution_dispatch_steps%ROWTYPE;
  v_log_state text := p_state;
  v_log_error_code text := p_error_code;
  v_dispatch_id uuid;
  v_attempts integer;
  v_appended boolean := false;
  v_logged boolean := false;
  v_expected_request_id text;
  v_expected_send_attempt_id uuid;
  v_safe_error_code text;
BEGIN
  SELECT s.dispatch_id INTO v_dispatch_id
    FROM public.evolution_dispatch_steps AS s WHERE s.id = p_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch step not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d WHERE d.id = v_dispatch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_dispatch.engine = 'automation' AND p_state IN ('done', 'skipped', 'failed', 'unknown') THEN
    SELECT a.appended INTO v_appended
      FROM public.append_evolution_automation_step_log(
        v_dispatch.account_id, v_dispatch.id, p_dispatch_lease_token,
        v_dispatch.automation_log_id, p_step_id, p_lease_token,
        p_state, p_result, p_error_code
      ) AS a;
    IF NOT v_appended THEN
      SELECT s.* INTO v_existing
        FROM public.evolution_dispatch_steps AS s
       WHERE s.id = p_step_id;
      v_expected_request_id := COALESCE(p_request_id, v_existing.request_id);
      v_expected_send_attempt_id := COALESCE(p_send_attempt_id, v_existing.send_attempt_id);
      v_safe_error_code := CASE
        WHEN p_error_code IS NULL THEN NULL
        WHEN p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN p_error_code
        ELSE 'worker_error'
      END;
      IF v_existing.state = p_state
         AND v_existing.request_id IS NOT DISTINCT FROM v_expected_request_id
         AND v_existing.send_attempt_id IS NOT DISTINCT FROM v_expected_send_attempt_id
         AND v_existing.result IS NOT DISTINCT FROM p_result
         AND v_existing.last_error_code IS NOT DISTINCT FROM v_safe_error_code THEN
        RETURN v_existing;
      END IF;
      IF v_existing.state = 'processing' THEN
        -- A previous append may have committed before the caller completed
        -- the checkpoint; allow the current live lease to finish it below.
        NULL;
      ELSE
        RAISE EXCEPTION 'Automation step completion replay differs' USING ERRCODE = '23514';
      END IF;
    END IF;
    v_logged := true;
  END IF;

  IF p_state = 'pending' THEN
    SELECT s.attempts INTO STRICT v_attempts
      FROM public.evolution_dispatch_steps AS s WHERE s.id = p_step_id;
    IF v_attempts >= 5 THEN
      v_log_state := 'failed';
      v_log_error_code := COALESCE(p_error_code, 'attempts_exhausted');
    END IF;
  END IF;
  IF v_dispatch.engine = 'automation'
     AND NOT v_logged
     AND v_log_state IN ('done', 'skipped', 'failed', 'unknown') THEN
    IF v_log_error_code IS NULL THEN
      v_safe_error_code := NULL;
    ELSIF v_log_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
      v_safe_error_code := v_log_error_code;
    ELSE
      v_safe_error_code := 'worker_error';
    END IF;
    PERFORM public.append_evolution_automation_step_log(
      v_dispatch.account_id, v_dispatch.id, p_dispatch_lease_token,
      v_dispatch.automation_log_id, p_step_id, p_lease_token,
      v_log_state, p_result, v_safe_error_code
    );
  END IF;

  RETURN wacrm_private.complete_evolution_dispatch_step_unlogged(
    p_step_id, p_dispatch_lease_token, p_lease_token, p_state,
    p_request_id, p_send_attempt_id, p_result, p_error_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_dispatch_step(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_dispatch_step(uuid, uuid, uuid, text, text, uuid, jsonb, text)
  TO service_role;

CREATE FUNCTION public.complete_evolution_automation_dispatch(
  p_account_id uuid,
  p_dispatch_id uuid,
  p_lease_token uuid,
  p_state text,
  p_error_code text DEFAULT NULL
) RETURNS TABLE(dispatch_id uuid, dispatch_state text, log_id uuid, log_status text, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_log public.automation_logs%ROWTYPE;
  v_completed public.evolution_event_dispatches%ROWTYPE;
  v_log_status text;
  v_safe_error_code text;
  v_error_message text;
BEGIN
  IF p_account_id IS NULL OR p_dispatch_id IS NULL OR p_lease_token IS NULL
     OR p_state NOT IN ('done', 'skipped', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid automation dispatch completion' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NULL THEN
    v_safe_error_code := NULL;
  ELSIF p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
    v_safe_error_code := p_error_code;
  ELSE
    v_safe_error_code := 'worker_error';
  END IF;
  IF p_state IN ('done', 'skipped') AND v_safe_error_code IS NOT NULL THEN
    RAISE EXCEPTION 'Successful automation dispatch cannot carry an error code' USING ERRCODE = '22023';
  END IF;

  v_log_status := CASE p_state
    WHEN 'done' THEN 'success'
    WHEN 'failed' THEN 'failed'
    ELSE 'partial'
  END;
  v_error_message := CASE p_state
    WHEN 'done' THEN NULL
    WHEN 'skipped' THEN v_safe_error_code
    WHEN 'failed' THEN COALESCE(v_safe_error_code, 'dispatch_failed')
    ELSE COALESCE(v_safe_error_code, 'outcome_unknown')
  END;

  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND OR v_dispatch.account_id IS DISTINCT FROM p_account_id
     OR v_dispatch.engine IS DISTINCT FROM 'automation'
     OR v_dispatch.automation_id IS NULL
     OR v_dispatch.automation_log_id IS NULL THEN
    RAISE EXCEPTION 'Automation dispatch tenant/root link is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT l.* INTO v_log
    FROM public.automation_logs AS l
   WHERE l.id = v_dispatch.automation_log_id
   FOR UPDATE;
  IF NOT FOUND OR v_log.evolution_dispatch_id IS DISTINCT FROM v_dispatch.id
     OR v_log.automation_id IS DISTINCT FROM v_dispatch.automation_id
     OR v_log.account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_log.user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Automation dispatch log/root link is invalid' USING ERRCODE = '23514';
  END IF;

  IF v_dispatch.state IS DISTINCT FROM 'processing' THEN
    IF v_dispatch.state IS DISTINCT FROM p_state
       OR v_dispatch.last_error_code IS DISTINCT FROM v_safe_error_code
       OR v_log.status IS DISTINCT FROM v_log_status
       OR v_log.error_message IS DISTINCT FROM v_error_message THEN
      RAISE EXCEPTION 'Automation dispatch completion replay differs' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_dispatch.id, v_dispatch.state, v_log.id, v_log.status, true;
    RETURN;
  END IF;
  IF v_dispatch.lease_token IS DISTINCT FROM p_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Automation dispatch lease is stale or expired' USING ERRCODE = '55000';
  END IF;

  v_completed := public.complete_evolution_dispatch(
    p_dispatch_id, p_lease_token, p_state, NULL, v_safe_error_code
  );
  UPDATE public.automation_logs AS l
     SET status = v_log_status,
         error_message = v_error_message
   WHERE l.id = v_log.id
     AND l.evolution_dispatch_id = p_dispatch_id
     AND l.account_id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation dispatch log could not be finalized' USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT v_completed.id, v_completed.state, v_log.id, v_log_status, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_automation_dispatch(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_automation_dispatch(uuid, uuid, uuid, text, text)
  TO service_role;
