-- Evolution wait claims use separate lease columns so legacy rows and cron
-- state remain untouched. The cursor is returned from the persisted wait row.
ALTER TABLE public.automation_pending_executions
  ADD COLUMN evolution_claim_token uuid NULL,
  ADD COLUMN evolution_claim_until timestamptz NULL,
  ADD COLUMN evolution_claim_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN evolution_completed_claim_token uuid NULL,
  ADD COLUMN evolution_completed_dispatch_token uuid NULL,
  ADD CONSTRAINT automation_pending_evolution_claim_lease_pair
    CHECK ((evolution_claim_token IS NULL) = (evolution_claim_until IS NULL)),
  ADD CONSTRAINT automation_pending_evolution_claim_attempts_check
    CHECK (evolution_claim_attempts >= 0);

CREATE INDEX automation_pending_evolution_due_idx
  ON public.automation_pending_executions (run_at, id)
  WHERE evolution_dispatch_step_id IS NOT NULL AND status = 'pending';

CREATE INDEX automation_pending_evolution_claim_expiry_idx
  ON public.automation_pending_executions (evolution_claim_until, run_at, id)
  WHERE evolution_dispatch_step_id IS NOT NULL AND status = 'pending';

CREATE FUNCTION public.claim_evolution_automation_pending_executions(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS TABLE(
  pending_execution_id uuid,
  dispatch_id uuid,
  account_id uuid,
  user_id uuid,
  automation_id uuid,
  log_id uuid,
  contact_id uuid,
  evolution_dispatch_step_id uuid,
  parked_step_id uuid,
  parent_step_id uuid,
  branch text,
  next_step_position integer,
  context jsonb,
  run_at timestamptz,
  pending_lease_token uuid,
  pending_lease_until timestamptz,
  dispatch_lease_token uuid,
  dispatch_lease_until timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_pending public.automation_pending_executions%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_definition public.automation_steps%ROWTYPE;
  v_log public.automation_logs%ROWTYPE;
  v_action_id uuid;
  v_now timestamptz;
  v_pending_token uuid;
  v_pending_until timestamptz;
  v_dispatch_token uuid;
  v_dispatch_until timestamptz;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'Invalid Evolution automation pending claim limits' USING ERRCODE = '22023';
  END IF;

  FOR v_pending IN
    SELECT p.*
      FROM public.automation_pending_executions AS p
     WHERE p.evolution_dispatch_step_id IS NOT NULL
       AND p.status = 'pending'
       AND p.run_at <= pg_catalog.clock_timestamp()
       AND (p.evolution_claim_until IS NULL
            OR p.evolution_claim_until <= pg_catalog.clock_timestamp())
     ORDER BY p.run_at, p.created_at, p.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  LOOP
    v_now := pg_catalog.clock_timestamp();

    -- Read the dispatch ID without locking the step; then take locks in the
    -- shared root-before-step order used by the T12 mutation RPCs.
    SELECT s.* INTO v_step
      FROM public.evolution_dispatch_steps AS s
     WHERE s.id = v_pending.evolution_dispatch_step_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT d.* INTO v_dispatch
      FROM public.evolution_event_dispatches AS d
     WHERE d.id = v_step.dispatch_id
     FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF v_dispatch.engine IS DISTINCT FROM 'automation'
       OR v_dispatch.automation_id IS NULL
       OR v_dispatch.state IS DISTINCT FROM 'processing' THEN
      CONTINUE;
    END IF;
    -- The pre-wait worker may still hold its root lease. Let it drain; the
    -- due row remains available and the ordinary root claims exclude it.
    IF v_dispatch.lease_until IS NOT NULL AND v_dispatch.lease_until > v_now THEN
      CONTINUE;
    END IF;

    SELECT s.* INTO v_step
      FROM public.evolution_dispatch_steps AS s
     WHERE s.id = v_pending.evolution_dispatch_step_id
     FOR UPDATE;
    IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id
       OR v_step.state IS DISTINCT FROM 'done'
       OR v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
       OR v_step.result->>'pending_execution_id' IS DISTINCT FROM v_pending.id::text THEN
      CONTINUE;
    END IF;
    BEGIN
      v_action_id := v_step.action_key::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      CONTINUE;
    END;

    SELECT a.* INTO v_definition
      FROM public.automation_steps AS a
     WHERE a.id = v_action_id
       AND a.automation_id = v_dispatch.automation_id
     FOR SHARE;
    IF NOT FOUND OR v_definition.step_type IS DISTINCT FROM 'wait'
       OR v_pending.parked_step_id IS DISTINCT FROM v_definition.id
       OR v_pending.parent_step_id IS DISTINCT FROM v_definition.parent_step_id
       OR v_pending.branch IS DISTINCT FROM v_definition.branch
       OR v_pending.next_step_position IS DISTINCT FROM v_definition.position + 1 THEN
      CONTINUE;
    END IF;

    SELECT l.* INTO v_log
      FROM public.automation_logs AS l
     WHERE l.id = v_dispatch.automation_log_id
       AND l.evolution_dispatch_id = v_dispatch.id
       AND l.automation_id = v_dispatch.automation_id
       AND l.account_id = v_dispatch.account_id
       AND l.user_id = v_dispatch.user_id
     FOR SHARE;
    IF NOT FOUND
       OR v_pending.log_id IS DISTINCT FROM v_log.id
       OR v_pending.account_id IS DISTINCT FROM v_dispatch.account_id
       OR v_pending.automation_id IS DISTINCT FROM v_dispatch.automation_id
       OR v_pending.user_id IS DISTINCT FROM v_dispatch.user_id
       OR v_pending.contact_id IS DISTINCT FROM v_dispatch.contact_id THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
         SELECT 1
           FROM public.evolution_events AS e
           JOIN public.whatsapp_connections AS c ON c.id = e.connection_id
           JOIN public.automations AS a ON a.id = v_dispatch.automation_id
           JOIN public.profiles AS p
             ON p.user_id = v_dispatch.user_id AND p.account_id = v_dispatch.account_id
           JOIN public.conversations AS cv
             ON cv.id = v_dispatch.conversation_id AND cv.account_id = v_dispatch.account_id
           JOIN public.contacts AS co
             ON co.id = cv.contact_id AND co.account_id = v_dispatch.account_id
          WHERE e.id = v_dispatch.event_id
            AND e.state = 'done'
            AND c.provider = 'evolution'
            AND c.account_id = v_dispatch.account_id
            AND a.account_id = v_dispatch.account_id
            AND a.user_id = v_dispatch.user_id
            AND v_dispatch.contact_id = co.id
       ) THEN
      CONTINUE;
    END IF;

    v_pending_token := pg_catalog.gen_random_uuid();
    v_pending_until := v_now + pg_catalog.make_interval(secs => p_lease_seconds::double precision);
    v_dispatch_token := pg_catalog.gen_random_uuid();
    v_dispatch_until := v_pending_until;

    UPDATE public.evolution_event_dispatches AS d
       SET lease_token = v_dispatch_token,
           lease_until = v_dispatch_until,
           updated_at = v_now
     WHERE d.id = v_dispatch.id
       AND d.state = 'processing'
       AND (d.lease_until IS NULL OR d.lease_until <= v_now)
    RETURNING d.* INTO v_dispatch;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.automation_pending_executions AS p
       SET evolution_claim_token = v_pending_token,
           evolution_claim_until = v_pending_until,
           evolution_claim_attempts = p.evolution_claim_attempts + 1
     WHERE p.id = v_pending.id
       AND p.evolution_dispatch_step_id = v_step.id
       AND p.status = 'pending'
       AND p.run_at <= v_now
       AND (p.evolution_claim_until IS NULL OR p.evolution_claim_until <= v_now)
    RETURNING p.* INTO v_pending;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evolution pending claim changed while locked' USING ERRCODE = '40001';
    END IF;

    RETURN QUERY SELECT
      v_pending.id, v_dispatch.id, v_dispatch.account_id, v_dispatch.user_id,
      v_dispatch.automation_id, v_dispatch.automation_log_id, v_dispatch.contact_id,
      v_step.id, v_pending.parked_step_id, v_pending.parent_step_id,
      v_pending.branch, v_pending.next_step_position, v_pending.context,
      v_pending.run_at, v_pending.evolution_claim_token, v_pending.evolution_claim_until,
      v_dispatch.lease_token, v_dispatch.lease_until;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_evolution_automation_pending_executions(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_automation_pending_executions(integer, integer)
  TO service_role;

CREATE FUNCTION public.complete_evolution_automation_pending_execution(
  p_pending_execution_id uuid,
  p_pending_lease_token uuid,
  p_dispatch_lease_token uuid
) RETURNS TABLE(pending_execution_id uuid, status text, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_pending public.automation_pending_executions%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_log public.automation_logs%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_pending_execution_id IS NULL OR p_pending_lease_token IS NULL
     OR p_dispatch_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid Evolution pending completion request' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_pending
    FROM public.automation_pending_executions AS p
   WHERE p.id = p_pending_execution_id
   FOR UPDATE;
  IF NOT FOUND OR v_pending.evolution_dispatch_step_id IS NULL THEN
    RAISE EXCEPTION 'Evolution pending execution not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT s.* INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = v_pending.evolution_dispatch_step_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution pending execution step not found' USING ERRCODE = '23514';
  END IF;
  SELECT d.* INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = v_step.dispatch_id
   FOR UPDATE;
  IF NOT FOUND OR v_dispatch.engine IS DISTINCT FROM 'automation'
     OR v_dispatch.automation_id IS NULL
     OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id
     OR v_step.state IS DISTINCT FROM 'done'
     OR v_step.result->>'pending_execution_id' IS DISTINCT FROM v_pending.id::text
     OR v_dispatch.account_id IS DISTINCT FROM v_pending.account_id
     OR v_dispatch.automation_id IS DISTINCT FROM v_pending.automation_id
     OR v_dispatch.user_id IS DISTINCT FROM v_pending.user_id
     OR v_dispatch.automation_log_id IS DISTINCT FROM v_pending.log_id THEN
    RAISE EXCEPTION 'Evolution pending/root tenant link is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT l.* INTO v_log
    FROM public.automation_logs AS l
   WHERE l.id = v_dispatch.automation_log_id
     AND l.evolution_dispatch_id = v_dispatch.id
     AND l.account_id = v_dispatch.account_id
     AND l.automation_id = v_dispatch.automation_id
     AND l.user_id = v_dispatch.user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution pending log/root link is invalid' USING ERRCODE = '23514';
  END IF;

  IF v_pending.status = 'done' THEN
    IF v_pending.evolution_completed_claim_token IS DISTINCT FROM p_pending_lease_token
       OR v_pending.evolution_completed_dispatch_token IS DISTINCT FROM p_dispatch_lease_token THEN
      RAISE EXCEPTION 'Evolution pending completion replay differs' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_pending.id, v_pending.status, true;
    RETURN;
  END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_pending.status IS DISTINCT FROM 'pending'
     OR v_pending.evolution_claim_token IS DISTINCT FROM p_pending_lease_token
     OR v_pending.evolution_claim_until IS NULL
     OR v_pending.evolution_claim_until <= v_now
     OR v_dispatch.state IS DISTINCT FROM 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Evolution pending or dispatch lease is stale' USING ERRCODE = '55000';
  END IF;

  UPDATE public.automation_pending_executions AS p
     SET status = 'done',
         evolution_claim_token = NULL,
         evolution_claim_until = NULL,
         evolution_completed_claim_token = p_pending_lease_token,
         evolution_completed_dispatch_token = p_dispatch_lease_token
   WHERE p.id = v_pending.id
     AND p.evolution_dispatch_step_id = v_step.id
     AND p.status = 'pending'
     AND p.evolution_claim_token = p_pending_lease_token
     AND p.evolution_claim_until > v_now;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution pending execution changed during completion' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_pending.id, 'done'::text, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_evolution_automation_pending_execution(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_evolution_automation_pending_execution(uuid, uuid, uuid)
  TO service_role;

-- Root claimers must leave an Evolution wait parked; this predicate only
-- considers rows carrying the Evolution ledger-step link. Legacy pending rows
-- (`evolution_dispatch_step_id IS NULL`) remain unchanged and claimable.
CREATE OR REPLACE FUNCTION public.claim_evolution_dispatches(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_event_dispatches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION 'Invalid dispatch claim limit' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'Invalid dispatch lease duration' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    SELECT d.id
      FROM public.evolution_event_dispatches AS d
     WHERE d.attempts >= 5
       AND (
         (d.state = 'pending' AND d.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (d.state = 'processing' AND d.lease_until <= pg_catalog.clock_timestamp())
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.automation_pending_executions AS p
         JOIN public.evolution_dispatch_steps AS s ON s.id = p.evolution_dispatch_step_id
          WHERE s.dispatch_id = d.id
            AND p.evolution_dispatch_step_id IS NOT NULL
            AND p.status IN ('pending', 'running', 'awaiting_reply')
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
     WHERE d.attempts < 5
       AND (
         (d.state = 'pending' AND d.next_attempt_at <= pg_catalog.clock_timestamp())
         OR (d.state = 'processing' AND d.lease_until <= pg_catalog.clock_timestamp())
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.automation_pending_executions AS p
         JOIN public.evolution_dispatch_steps AS s ON s.id = p.evolution_dispatch_step_id
          WHERE s.dispatch_id = d.id
            AND p.evolution_dispatch_step_id IS NOT NULL
            AND p.status IN ('pending', 'running', 'awaiting_reply')
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

REVOKE ALL ON FUNCTION public.claim_evolution_dispatches(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evolution_dispatches(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_evolution_automation_dispatches(
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
       AND NOT EXISTS (
         SELECT 1 FROM public.automation_pending_executions AS p
         JOIN public.evolution_dispatch_steps AS s ON s.id = p.evolution_dispatch_step_id
          WHERE s.dispatch_id = d.id
            AND p.evolution_dispatch_step_id IS NOT NULL
            AND p.status IN ('pending', 'running', 'awaiting_reply')
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
       AND NOT EXISTS (
         SELECT 1 FROM public.automation_pending_executions AS p
         JOIN public.evolution_dispatch_steps AS s ON s.id = p.evolution_dispatch_step_id
          WHERE s.dispatch_id = d.id
            AND p.evolution_dispatch_step_id IS NOT NULL
            AND p.status IN ('pending', 'running', 'awaiting_reply')
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
