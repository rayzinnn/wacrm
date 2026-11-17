BEGIN;

-- Synthetic roots only; the fixture and every claim mutation roll back.
DO $fixture_setup$
DECLARE
  v_user_id uuid := pg_catalog.gen_random_uuid();
  v_account_id uuid;
  v_connection_id uuid;
  v_automation_id uuid;
  v_flow_id uuid;
  v_ai_config_id uuid;
  v_event_id uuid;
  v_dispatch_id uuid;
  v_token uuid;
  v_ids jsonb := '{}'::jsonb;
  v_tokens jsonb := '{}'::jsonb;
  v_case record;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', v_user_id::text || '@fixture.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Synthetic Flow claim fixture"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account_id
    FROM public.profiles AS p WHERE p.user_id = v_user_id;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account_id, v_user_id, 'http://127.0.0.1:8080', 't12-flow-claim-' || v_user_id::text,
    'synthetic-token', 'synthetic-webhook-secret'
  ) RETURNING id INTO v_connection_id;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_id, v_account_id, 'Flow claim isolation fixture', 'inbound_message', true)
  RETURNING id INTO v_automation_id;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type)
  VALUES (v_user_id, v_account_id, 'Flow claim isolation fixture', 'active', 'first_inbound_message')
  RETURNING id INTO v_flow_id;
  INSERT INTO public.ai_configs (
    account_id, created_by, provider, model, api_key, is_active, auto_reply_enabled
  ) VALUES (v_account_id, v_user_id, 'openai', 'fixture-model', 'synthetic-placeholder', true, true)
  RETURNING id INTO v_ai_config_id;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('flow_pending', 'flow', 'pending', 0, 'due', NULL::text),
      ('flow_expired', 'flow', 'processing', 2, 'expired', NULL::text),
      ('flow_exhausted_pending', 'flow', 'pending', 5, 'due', 'keep_flow_pending'),
      ('flow_exhausted_processing', 'flow', 'processing', 5, 'expired', 'keep_flow_processing'),
      ('flow_future', 'flow', 'pending', 0, 'future', NULL::text),
      ('flow_live', 'flow', 'processing', 2, 'live', NULL::text),
      ('automation_due', 'automation', 'pending', 0, 'due', NULL::text),
      ('automation_exhausted', 'automation', 'pending', 5, 'due', 'keep_auto'),
      ('ai_due', 'ai', 'pending', 0, 'due', NULL::text),
      ('ai_exhausted', 'ai', 'processing', 5, 'expired', 'keep_ai')
    ) AS cases(label, engine, state, attempts, timing, error_code)
  LOOP
    INSERT INTO public.evolution_events (
      connection_id, event_key, normalized_event, state, processed_at, next_attempt_at
    ) VALUES (
      v_connection_id, 't12:flow-claim:' || v_case.label,
      pg_catalog.jsonb_build_object('kind', 'message', 'case', v_case.label),
      'done', pg_catalog.clock_timestamp(),
      CASE WHEN v_case.timing = 'future' THEN 'infinity'::timestamptz ELSE '-infinity'::timestamptz END
    ) RETURNING id INTO v_event_id;

    v_token := CASE WHEN v_case.state = 'processing' THEN pg_catalog.gen_random_uuid() ELSE NULL END;
    INSERT INTO public.evolution_event_dispatches (
      event_id, account_id, engine, automation_id, flow_id, ai_config_id, user_id,
      state, attempts, lease_until, lease_token, next_attempt_at, last_error_code
    ) VALUES (
      v_event_id, v_account_id, v_case.engine,
      CASE WHEN v_case.engine = 'automation' THEN v_automation_id END,
      CASE WHEN v_case.engine = 'flow' THEN v_flow_id END,
      CASE WHEN v_case.engine = 'ai' THEN v_ai_config_id END,
      v_user_id, v_case.state, v_case.attempts,
      CASE v_case.timing
        WHEN 'expired' THEN '-infinity'::timestamptz
        WHEN 'live' THEN 'infinity'::timestamptz
        ELSE NULL
      END,
      v_token,
      CASE WHEN v_case.timing = 'future' THEN 'infinity'::timestamptz ELSE '-infinity'::timestamptz END,
      v_case.error_code
    ) RETURNING id INTO v_dispatch_id;

    v_ids := pg_catalog.jsonb_set(v_ids, ARRAY[v_case.label], pg_catalog.to_jsonb(v_dispatch_id), true);
    IF v_token IS NOT NULL THEN
      v_tokens := pg_catalog.jsonb_set(v_tokens, ARRAY[v_case.label], pg_catalog.to_jsonb(v_token), true);
    END IF;
  END LOOP;

  PERFORM pg_catalog.set_config('wacrm.t12flowclaim.account_id', v_account_id::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12flowclaim.ids', v_ids::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12flowclaim.tokens', v_tokens::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_proc regprocedure := 'public.claim_evolution_flow_dispatches(integer,integer)'::regprocedure;
  v_root regtype := 'public.evolution_event_dispatches'::regtype;
BEGIN
  IF pg_catalog.pg_get_function_arguments(v_proc)
       <> 'p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_proc AND p.proretset AND p.prorettype = v_root
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_proc AND (
          p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
        )
     )
     OR pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Flow dispatch claim signature, security or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;

DO $claim_assertions$
DECLARE
  v_ids jsonb := current_setting('wacrm.t12flowclaim.ids')::jsonb;
  v_tokens jsonb := current_setting('wacrm.t12flowclaim.tokens')::jsonb;
  v_account_id uuid := current_setting('wacrm.t12flowclaim.account_id')::uuid;
  v_claimed uuid[];
  v_count integer;
  v_id uuid;
BEGIN
  BEGIN
    PERFORM 1 FROM public.claim_evolution_flow_dispatches(11, 1);
    RAISE EXCEPTION 'Flow claim limit above ten was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_flow_dispatches(0, 1);
    RAISE EXCEPTION 'zero Flow claim limit was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.claim_evolution_flow_dispatches(1, 61);
    RAISE EXCEPTION 'Flow lease above sixty seconds was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT pg_catalog.array_agg(c.id), pg_catalog.count(*)::integer
    INTO v_claimed, v_count
    FROM public.claim_evolution_flow_dispatches() AS c;
  IF v_count <> 2 OR EXISTS (
       SELECT 1 FROM public.evolution_event_dispatches AS d
        WHERE d.id = ANY(v_claimed)
          AND d.id NOT IN (
            (v_ids->>'flow_pending')::uuid,
            (v_ids->>'flow_expired')::uuid
          )
     ) THEN
    RAISE EXCEPTION 'Flow claim returned unexpected roots or count %', v_count;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.evolution_event_dispatches AS d
        WHERE d.id = ANY(v_claimed)
          AND (d.engine <> 'flow' OR d.account_id <> v_account_id
            OR d.state <> 'processing'
            OR d.attempts <> CASE
              WHEN d.id = (v_ids->>'flow_pending')::uuid THEN 1
              WHEN d.id = (v_ids->>'flow_expired')::uuid THEN 3
              ELSE -1 END
            OR d.lease_token IS NULL
            OR d.lease_token = (v_tokens->>'flow_expired')::uuid
            OR d.lease_until <= pg_catalog.clock_timestamp()
            OR d.lease_until > pg_catalog.clock_timestamp() + interval '61 seconds')
     ) THEN
    RAISE EXCEPTION 'Flow claim attempt/token/lease metadata is invalid';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.evolution_event_dispatches AS d
        WHERE d.id = (v_ids->>'flow_exhausted_pending')::uuid
          AND d.engine = 'flow' AND d.state = 'failed' AND d.attempts = 5
          AND d.lease_until IS NULL AND d.lease_token IS NULL
          AND d.last_error_code = 'keep_flow_pending'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.evolution_event_dispatches AS d
        WHERE d.id = (v_ids->>'flow_exhausted_processing')::uuid
          AND d.engine = 'flow' AND d.state = 'failed' AND d.attempts = 5
          AND d.lease_until IS NULL AND d.lease_token IS NULL
          AND d.last_error_code = 'keep_flow_processing'
     ) THEN
    RAISE EXCEPTION 'Exhausted Flow roots were not terminalized and fenced';
  END IF;

  FOREACH v_id IN ARRAY ARRAY[
    (v_ids->>'flow_future')::uuid,
    (v_ids->>'flow_live')::uuid,
    (v_ids->>'automation_due')::uuid,
    (v_ids->>'automation_exhausted')::uuid,
    (v_ids->>'ai_due')::uuid,
    (v_ids->>'ai_exhausted')::uuid
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.evolution_event_dispatches AS d
       WHERE d.id = v_id
         AND d.state = CASE
           WHEN d.id = (v_ids->>'flow_future')::uuid THEN 'pending'
           WHEN d.id = (v_ids->>'flow_live')::uuid THEN 'processing'
           WHEN d.id = (v_ids->>'automation_due')::uuid THEN 'pending'
           WHEN d.id = (v_ids->>'automation_exhausted')::uuid THEN 'pending'
           WHEN d.id = (v_ids->>'ai_due')::uuid THEN 'pending'
           ELSE 'processing' END
         AND d.attempts = CASE
           WHEN d.id = (v_ids->>'flow_live')::uuid THEN 2
           WHEN d.id IN ((v_ids->>'automation_exhausted')::uuid,
                         (v_ids->>'ai_exhausted')::uuid) THEN 5
           ELSE 0 END
         AND d.lease_token IS NOT DISTINCT FROM (v_tokens->>CASE
           WHEN d.id = (v_ids->>'flow_live')::uuid THEN 'flow_live'
           WHEN d.id = (v_ids->>'ai_exhausted')::uuid THEN 'ai_exhausted'
           ELSE '' END)::uuid
         AND d.last_error_code IS NOT DISTINCT FROM CASE
           WHEN d.id = (v_ids->>'automation_exhausted')::uuid THEN 'keep_auto'
           WHEN d.id = (v_ids->>'ai_exhausted')::uuid THEN 'keep_ai'
           ELSE NULL END
    ) THEN
      RAISE EXCEPTION 'Flow future/live or non-Flow root was changed: %', v_id;
    END IF;
  END LOOP;
END;
$claim_assertions$;

RESET ROLE;
ROLLBACK;
