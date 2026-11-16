CREATE FUNCTION public.claim_evolution_message_events(
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
     WHERE e.normalized_event ->> 'kind' = 'message'
       AND e.attempts >= 5
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
     WHERE e.normalized_event ->> 'kind' = 'message'
       AND e.attempts < 5
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

REVOKE ALL ON FUNCTION public.claim_evolution_message_events(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_message_events(integer, integer)
  TO service_role;
