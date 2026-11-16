CREATE FUNCTION public.claim_evolution_events(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'Invalid event claim limit' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'Invalid event lease duration' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    SELECT e.id
      FROM public.evolution_events AS e
     WHERE e.attempts >= 5
       AND (
         (e.state = 'pending' AND e.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (e.state = 'processing' AND e.lease_until <= pg_catalog.clock_timestamp())
       )
     ORDER BY e.next_attempt_at, e.created_at, e.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.evolution_events AS e
     SET state = 'failed',
         lease_until = NULL,
         lease_token = NULL,
         last_error_code = COALESCE(e.last_error_code, 'attempts_exhausted'),
         updated_at = pg_catalog.clock_timestamp()
    FROM exhausted
   WHERE e.id = exhausted.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
      FROM public.evolution_events AS e
     WHERE e.attempts < 5
       AND (
         (e.state = 'pending' AND e.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (e.state = 'processing' AND e.lease_until <= pg_catalog.clock_timestamp())
       )
     ORDER BY e.next_attempt_at, e.created_at, e.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.evolution_events AS e
     SET state = 'processing',
         attempts = e.attempts + 1,
         lease_until = pg_catalog.clock_timestamp()
           + pg_catalog.make_interval(secs => p_lease_seconds::double precision),
         lease_token = pg_catalog.gen_random_uuid(),
         updated_at = pg_catalog.clock_timestamp()
    FROM candidates
   WHERE e.id = candidates.id
  RETURNING e.*;
END;
$function$;

CREATE FUNCTION public.fail_evolution_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean
) RETURNS public.evolution_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_event public.evolution_events%ROWTYPE;
  v_safe_error_code text;
  v_delay_seconds integer;
BEGIN
  IF p_event_id IS NULL OR p_lease_token IS NULL OR p_retryable IS NULL THEN
    RAISE EXCEPTION 'Invalid event failure request' USING ERRCODE = '22023';
  END IF;

  IF p_error_code ~ '^[a-z0-9][a-z0-9_]{0,47}$' THEN
    v_safe_error_code := p_error_code;
  ELSE
    v_safe_error_code := 'worker_error';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution event not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.state <> 'processing'
     OR v_event.lease_token IS DISTINCT FROM p_lease_token
     OR v_event.lease_until IS NULL
     OR v_event.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Evolution event lease is stale or expired' USING ERRCODE = '40001';
  END IF;

  IF p_retryable AND v_event.attempts < 5 THEN
    v_delay_seconds := CASE v_event.attempts
      WHEN 1 THEN 5
      WHEN 2 THEN 15
      WHEN 3 THEN 60
      ELSE 300
    END;

    UPDATE public.evolution_events AS e
       SET state = 'pending',
           next_attempt_at = pg_catalog.clock_timestamp()
             + pg_catalog.make_interval(secs => v_delay_seconds::double precision),
           lease_until = NULL,
           lease_token = NULL,
           last_error_code = v_safe_error_code,
           updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id
    RETURNING e.* INTO v_event;
  ELSE
    UPDATE public.evolution_events AS e
       SET state = 'failed',
           lease_until = NULL,
           lease_token = NULL,
           last_error_code = v_safe_error_code,
           updated_at = pg_catalog.clock_timestamp()
     WHERE e.id = p_event_id
    RETURNING e.* INTO v_event;
  END IF;

  RETURN v_event;
END;
$function$;

CREATE FUNCTION public.complete_evolution_connection_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_state text,
  p_checked_at timestamptz
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_event public.evolution_events%ROWTYPE;
BEGIN
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'Invalid event completion request' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution event not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'connection' THEN
    RAISE EXCEPTION 'Event is not a connection update' USING ERRCODE = '22023';
  END IF;
  IF v_event.state = 'done' THEN
    outcome := 'duplicate';
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('disconnected', 'connecting', 'connected', 'unknown')
     OR p_checked_at IS NULL OR NOT pg_catalog.isfinite(p_checked_at) THEN
    RAISE EXCEPTION 'Invalid connection observation' USING ERRCODE = '22023';
  END IF;
  IF p_lease_token IS NULL
     OR v_event.state <> 'processing'
     OR v_event.lease_token IS DISTINCT FROM p_lease_token
     OR v_event.lease_until IS NULL
     OR v_event.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Evolution event lease is stale or expired' USING ERRCODE = '40001';
  END IF;

  UPDATE public.whatsapp_connections AS c
     SET state = p_state,
         state_checked_at = p_checked_at,
         updated_at = pg_catalog.clock_timestamp()
   WHERE c.id = v_event.connection_id
     AND (c.state_checked_at IS NULL OR c.state_checked_at <= p_checked_at);

  UPDATE public.evolution_events AS e
     SET state = 'done',
         processed_at = pg_catalog.clock_timestamp(),
         lease_until = NULL,
         lease_token = NULL,
         updated_at = pg_catalog.clock_timestamp()
   WHERE e.id = p_event_id;

  outcome := 'applied';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_evolution_events(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_events(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.fail_evolution_event(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_evolution_event(uuid, uuid, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.complete_evolution_connection_event(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_connection_event(uuid, uuid, text, timestamptz) TO service_role;
