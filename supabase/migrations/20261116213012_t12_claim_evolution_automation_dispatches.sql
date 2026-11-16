CREATE FUNCTION public.claim_evolution_automation_dispatches(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_event_dispatches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'Invalid automation dispatch claim limit' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'Invalid automation dispatch lease duration' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    SELECT d.id
      FROM public.evolution_event_dispatches AS d
     WHERE d.engine = 'automation'
       AND d.attempts >= 5
       AND (
         (d.state = 'pending' AND d.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (d.state = 'processing' AND d.lease_until <= pg_catalog.clock_timestamp())
       )
     ORDER BY d.next_attempt_at, d.created_at, d.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.evolution_event_dispatches AS d
     SET state = 'failed',
         lease_until = NULL,
         lease_token = NULL,
         last_error_code = COALESCE(d.last_error_code, 'attempts_exhausted'),
         updated_at = pg_catalog.clock_timestamp()
    FROM exhausted
   WHERE d.id = exhausted.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
      FROM public.evolution_event_dispatches AS d
     WHERE d.engine = 'automation'
       AND d.attempts < 5
       AND (
         (d.state = 'pending' AND d.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (d.state = 'processing' AND d.lease_until <= pg_catalog.clock_timestamp())
       )
     ORDER BY d.next_attempt_at, d.created_at, d.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.evolution_event_dispatches AS d
     SET state = 'processing',
         attempts = d.attempts + 1,
         lease_until = pg_catalog.clock_timestamp()
           + pg_catalog.make_interval(secs => p_lease_seconds::double precision),
         lease_token = pg_catalog.gen_random_uuid(),
         updated_at = pg_catalog.clock_timestamp()
    FROM candidates
   WHERE d.id = candidates.id
  RETURNING d.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_evolution_automation_dispatches(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_automation_dispatches(integer, integer)
  TO service_role;
