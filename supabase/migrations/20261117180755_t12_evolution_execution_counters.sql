-- Keep the existing cached counters in sync with Evolution executions.
-- Legacy engines continue to call the established counter RPCs directly.

CREATE OR REPLACE FUNCTION public.count_evolution_automation_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.evolution_dispatch_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.automations AS a
     SET execution_count = a.execution_count + 1,
         last_executed_at = GREATEST(
           COALESCE(a.last_executed_at, '-infinity'::timestamptz),
           COALESCE(NEW.created_at, pg_catalog.clock_timestamp())
         )
   WHERE a.id = NEW.automation_id
     AND a.account_id = NEW.account_id
     AND EXISTS (
       SELECT 1
         FROM public.evolution_event_dispatches AS d
        WHERE d.id = NEW.evolution_dispatch_id
          AND d.engine = 'automation'
          AND d.automation_id = a.id
          AND d.account_id = a.account_id
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution automation execution counter lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.count_evolution_automation_execution()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_evolution_automation_execution()
  TO service_role;

DROP TRIGGER IF EXISTS count_evolution_automation_execution
  ON public.automation_logs;
CREATE TRIGGER count_evolution_automation_execution
  AFTER INSERT ON public.automation_logs
  FOR EACH ROW
  WHEN (NEW.evolution_dispatch_id IS NOT NULL)
  EXECUTE FUNCTION public.count_evolution_automation_execution();

CREATE OR REPLACE FUNCTION public.count_evolution_flow_run_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_started_at timestamptz;
BEGIN
  -- This trigger is deferred so the start RPC can link the newly inserted
  -- run to its dispatch in the same transaction before the trigger checks it.
  SELECT NEW.started_at
    INTO v_started_at
    FROM public.evolution_event_dispatches AS d
   WHERE d.engine = 'flow'
     AND d.flow_run_id = NEW.id
     AND d.flow_id = NEW.flow_id
     AND d.account_id = NEW.account_id
     AND d.user_id = NEW.user_id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.flows AS f
     SET execution_count = f.execution_count + 1,
         last_executed_at = GREATEST(
           COALESCE(f.last_executed_at, '-infinity'::timestamptz),
           v_started_at
         )
   WHERE f.id = NEW.flow_id
     AND f.account_id = NEW.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evolution flow execution counter lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.count_evolution_flow_run_execution()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_evolution_flow_run_execution()
  TO service_role;

DROP TRIGGER IF EXISTS count_evolution_flow_run_execution
  ON public.flow_runs;
CREATE CONSTRAINT TRIGGER count_evolution_flow_run_execution
  AFTER INSERT ON public.flow_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.count_evolution_flow_run_execution();

-- Repair cached totals for existing Evolution executions while preserving
-- any higher legacy counter values. The migration runs once; future records
-- are handled atomically by the scoped triggers above.
WITH evolution_counts AS (
  SELECT l.automation_id,
         l.account_id,
         pg_catalog.count(*)::integer AS run_count,
         pg_catalog.max(l.created_at) AS last_run_at
    FROM public.automation_logs AS l
    JOIN public.evolution_event_dispatches AS d
      ON d.id = l.evolution_dispatch_id
     AND d.engine = 'automation'
     AND d.automation_id = l.automation_id
     AND d.account_id = l.account_id
   GROUP BY l.automation_id, l.account_id
)
UPDATE public.automations AS a
   SET execution_count = a.execution_count + e.run_count,
       last_executed_at = GREATEST(
         COALESCE(a.last_executed_at, '-infinity'::timestamptz),
         e.last_run_at
       )
  FROM evolution_counts AS e
 WHERE a.id = e.automation_id
   AND a.account_id = e.account_id;

WITH evolution_counts AS (
  SELECT d.flow_id,
         d.account_id,
         pg_catalog.count(DISTINCT r.id)::integer AS run_count,
         pg_catalog.max(r.started_at) AS last_run_at
    FROM public.evolution_event_dispatches AS d
    JOIN public.flow_runs AS r
      ON r.id = d.flow_run_id
     AND r.flow_id = d.flow_id
     AND r.account_id = d.account_id
     AND r.user_id = d.user_id
   WHERE d.engine = 'flow'
   GROUP BY d.flow_id, d.account_id
)
UPDATE public.flows AS f
   SET execution_count = f.execution_count + e.run_count,
       last_executed_at = GREATEST(
         COALESCE(f.last_executed_at, '-infinity'::timestamptz),
         e.last_run_at
       )
  FROM evolution_counts AS e
 WHERE f.id = e.flow_id
   AND f.account_id = e.account_id;
