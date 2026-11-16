-- Legacy automation roots without a linked log retain their previous
-- completion behavior. A linked automation log still uses the fenced path.
CREATE OR REPLACE FUNCTION public.complete_evolution_dispatch_step(
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

  IF v_dispatch.engine = 'automation' AND v_dispatch.automation_log_id IS NOT NULL
     AND p_state IN ('done', 'skipped', 'failed', 'unknown') THEN
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
     AND v_dispatch.automation_log_id IS NOT NULL
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
  v_completed public.evolution_event_dispatches%ROWTYPE;
  v_log_status text;
  v_error_message text;
BEGIN
  v_completed := wacrm_private.complete_evolution_dispatch_unlogged(
    p_dispatch_id, p_lease_token, p_state, p_result, p_error_code
  );

  IF v_completed.engine = 'automation' AND v_completed.automation_log_id IS NOT NULL THEN
    v_log_status := CASE v_completed.state
      WHEN 'done' THEN 'success'
      WHEN 'failed' THEN 'failed'
      ELSE 'partial'
    END;
    v_error_message := CASE v_completed.state
      WHEN 'done' THEN NULL
      WHEN 'unknown' THEN COALESCE(v_completed.last_error_code, 'outcome_unknown')
      ELSE v_completed.last_error_code
    END;

    UPDATE public.automation_logs AS l
       SET status = v_log_status,
           error_message = v_error_message
     WHERE l.id = v_completed.automation_log_id
       AND l.evolution_dispatch_id = v_completed.id
       AND l.automation_id = v_completed.automation_id
       AND l.account_id = v_completed.account_id
       AND l.user_id = v_completed.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Automation dispatch log could not be finalized' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN v_completed;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  TO service_role;
