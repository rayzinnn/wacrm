-- Keep the established root completion RPC contract while finalizing linked
-- automation logs in the same transaction. Existing workers keep their call.
ALTER FUNCTION public.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  SET SCHEMA wacrm_private;
ALTER FUNCTION wacrm_private.complete_evolution_dispatch(uuid, uuid, text, jsonb, text)
  RENAME TO complete_evolution_dispatch_unlogged;
REVOKE ALL ON FUNCTION wacrm_private.complete_evolution_dispatch_unlogged(uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wacrm_private.complete_evolution_dispatch_unlogged(uuid, uuid, text, jsonb, text)
  TO service_role;

CREATE FUNCTION public.complete_evolution_dispatch(
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

  IF v_completed.engine = 'automation' THEN
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
