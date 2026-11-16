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
  v_dispatch public.evolution_event_dispatches%ROWTYPE;
  v_event public.evolution_events%ROWTYPE;
  v_connection_account_id uuid;
  v_definition_account_id uuid;
  v_definition_user_id uuid;
  v_log public.automation_logs%ROWTYPE;
  v_step public.evolution_dispatch_steps%ROWTYPE;
  v_automation_step public.automation_steps%ROWTYPE;
  v_completed public.evolution_dispatch_steps%ROWTYPE;
  v_action_step_id uuid;
  v_contact_id uuid;
  v_tag_id uuid;
  v_field text;
  v_value text;
  v_custom_field_id uuid;
  v_now timestamptz;
BEGIN
  IF p_dispatch_id IS NULL OR p_dispatch_lease_token IS NULL
     OR p_step_id IS NULL OR p_step_lease_token IS NULL
     OR p_operation IS NULL OR p_payload IS NULL
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid automation effect request' USING ERRCODE = '22023';
  END IF;

  -- Only the first three local operations are enabled in this recut.
  -- Other contract operations stay fail-closed until their own tests land.
  IF p_operation NOT IN ('add_tag', 'remove_tag', 'update_contact_field') THEN
    RAISE EXCEPTION 'Automation effect operation is not enabled' USING ERRCODE = '22023';
  END IF;

  -- Shared lock order for T12 mutation RPCs: root first, then step.
  SELECT d.*
    INTO v_dispatch
    FROM public.evolution_event_dispatches AS d
   WHERE d.id = p_dispatch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch root not found' USING ERRCODE = 'P0002';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.state <> 'processing'
     OR v_dispatch.lease_token IS DISTINCT FROM p_dispatch_lease_token
     OR v_dispatch.lease_until IS NULL
     OR v_dispatch.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.engine <> 'automation' OR v_dispatch.automation_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch root is not an automation' USING ERRCODE = '23514';
  END IF;

  SELECT e.*
    INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = v_dispatch.event_id
   FOR SHARE;
  IF NOT FOUND OR v_event.state <> 'done'
     OR pg_catalog.jsonb_typeof(v_event.normalized_event) IS DISTINCT FROM 'object'
     OR v_event.normalized_event->>'kind' IS DISTINCT FROM 'message'
     OR v_event.normalized_event->>'contentType' IS DISTINCT FROM 'text'
     OR v_event.normalized_event->>'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event->>'sentByApi' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Dispatch event is not an applied inbound Evolution text event'
      USING ERRCODE = '23514';
  END IF;
  SELECT c.account_id
    INTO v_connection_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id
     AND c.provider = 'evolution'
   FOR SHARE;
  IF NOT FOUND OR v_connection_account_id IS DISTINCT FROM v_dispatch.account_id THEN
    RAISE EXCEPTION 'Dispatch event/connection account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT a.account_id, a.user_id
    INTO v_definition_account_id, v_definition_user_id
    FROM public.automations AS a
   WHERE a.id = v_dispatch.automation_id
   FOR SHARE;
  IF NOT FOUND
     OR v_definition_account_id IS DISTINCT FROM v_dispatch.account_id
     OR v_definition_user_id IS DISTINCT FROM v_dispatch.user_id THEN
    RAISE EXCEPTION 'Dispatch automation/account/user lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.profiles AS p
        WHERE p.user_id = v_dispatch.user_id
          AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch audit user/account lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF v_dispatch.contact_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.contacts AS c
        WHERE c.id = v_dispatch.contact_id
          AND c.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch contact/account lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_dispatch.conversation_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.conversations AS c
        WHERE c.id = v_dispatch.conversation_id
          AND c.account_id = v_dispatch.account_id
          AND c.contact_id = v_dispatch.contact_id
     ) THEN
    RAISE EXCEPTION 'Dispatch conversation/contact lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM public.messages AS m
         JOIN public.conversations AS c ON c.id = m.conversation_id
         JOIN public.contacts AS p ON p.id = c.contact_id
        WHERE m.provider_connection_id = v_event.connection_id
          AND m.message_id = v_event.normalized_event->>'externalMessageId'
          AND m.conversation_id = v_dispatch.conversation_id
          AND m.sender_type = 'customer'
          AND m.content_type = 'text'
          AND p.id = v_dispatch.contact_id
          AND c.account_id = v_dispatch.account_id
          AND p.account_id = v_dispatch.account_id
     ) THEN
    RAISE EXCEPTION 'Dispatch inbound message/conversation/contact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF v_dispatch.automation_log_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch automation log is not linked' USING ERRCODE = '23514';
  END IF;
  SELECT l.* INTO v_log
    FROM public.automation_logs AS l
   WHERE l.id = v_dispatch.automation_log_id
     AND l.evolution_dispatch_id = v_dispatch.id
     AND l.automation_id = v_dispatch.automation_id
     AND l.account_id = v_dispatch.account_id
     AND l.user_id = v_dispatch.user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch automation log lineage is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT s.*
    INTO v_step
    FROM public.evolution_dispatch_steps AS s
   WHERE s.id = p_step_id
   FOR UPDATE;
  IF NOT FOUND OR v_step.dispatch_id IS DISTINCT FROM v_dispatch.id THEN
    RAISE EXCEPTION 'Dispatch step/root association is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_step.state <> 'processing'
     OR v_step.lease_token IS DISTINCT FROM p_step_lease_token
     OR v_step.lease_until IS NULL
     OR v_step.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch step lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_dispatch.lease_until <= v_now OR v_step.lease_until <= v_now THEN
    RAISE EXCEPTION 'Dispatch root or step lease is stale or expired' USING ERRCODE = '55000';
  END IF;
  IF v_step.request_id IS DISTINCT FROM 'evolution-step:' || v_step.id::text
     OR v_step.send_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Local automation effect cannot replace or reuse a send attempt'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    v_action_step_id := v_step.action_key::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Automation action key is not a step UUID' USING ERRCODE = '23514';
  END;
  SELECT a.* INTO v_automation_step
    FROM public.automation_steps AS a
   WHERE a.id = v_action_step_id
     AND a.automation_id = v_dispatch.automation_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation action step/definition lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF p_operation IN ('add_tag', 'remove_tag') THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_payload)) <> 2
       OR NOT (p_payload ?& ARRAY['contact_id', 'tag_id'])
       OR pg_catalog.jsonb_typeof(p_payload->'contact_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_payload->'tag_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid tag effect payload' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_contact_id := (p_payload->>'contact_id')::uuid;
      v_tag_id := (p_payload->>'tag_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid tag effect identifiers' USING ERRCODE = '22023';
    END;
    IF v_contact_id IS DISTINCT FROM v_dispatch.contact_id
       OR v_automation_step.step_type IS DISTINCT FROM p_operation
       OR v_automation_step.step_config->>'tag_id' IS DISTINCT FROM v_tag_id::text THEN
      RAISE EXCEPTION 'Tag effect does not match the automation step or tenant'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM public.tags AS t
          WHERE t.id = v_tag_id AND t.account_id = v_dispatch.account_id
       ) THEN
      RAISE EXCEPTION 'Tag does not belong to the dispatch account' USING ERRCODE = '23514';
    END IF;

    IF p_operation = 'add_tag' THEN
      INSERT INTO public.contact_tags (contact_id, tag_id)
      VALUES (v_dispatch.contact_id, v_tag_id)
      ON CONFLICT (contact_id, tag_id) DO NOTHING;
    ELSE
      DELETE FROM public.contact_tags AS ct
       WHERE ct.contact_id = v_dispatch.contact_id
         AND ct.tag_id = v_tag_id;
    END IF;
  ELSE
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_payload)) <> 3
       OR NOT (p_payload ?& ARRAY['contact_id', 'field', 'value'])
       OR pg_catalog.jsonb_typeof(p_payload->'contact_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_payload->'field') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(p_payload->'value') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid contact field effect payload' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_contact_id := (p_payload->>'contact_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid contact field effect identifier' USING ERRCODE = '22023';
    END;
    v_field := p_payload->>'field';
    v_value := p_payload->>'value';
    IF v_contact_id IS DISTINCT FROM v_dispatch.contact_id
       OR v_automation_step.step_type IS DISTINCT FROM 'update_contact_field'
       OR v_automation_step.step_config->>'field' IS DISTINCT FROM v_field THEN
      RAISE EXCEPTION 'Contact field effect does not match the automation step or tenant'
        USING ERRCODE = '23514';
    END IF;

    IF v_field IN ('name', 'email', 'company') THEN
      IF v_field = 'name' THEN
        UPDATE public.contacts AS c SET name = v_value, updated_at = v_now
         WHERE c.id = v_dispatch.contact_id AND c.account_id = v_dispatch.account_id;
      ELSIF v_field = 'email' THEN
        UPDATE public.contacts AS c SET email = v_value, updated_at = v_now
         WHERE c.id = v_dispatch.contact_id AND c.account_id = v_dispatch.account_id;
      ELSE
        UPDATE public.contacts AS c SET company = v_value, updated_at = v_now
         WHERE c.id = v_dispatch.contact_id AND c.account_id = v_dispatch.account_id;
      END IF;
    ELSIF pg_catalog.left(v_field, 7) = 'custom:' THEN
      BEGIN
        v_custom_field_id := pg_catalog.substr(v_field, 8)::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid custom field identifier' USING ERRCODE = '22023';
      END;
      IF NOT EXISTS (
           SELECT 1 FROM public.custom_fields AS f
            WHERE f.id = v_custom_field_id
              AND f.account_id = v_dispatch.account_id
         ) THEN
        RAISE EXCEPTION 'Custom field does not belong to the dispatch account'
          USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.contact_custom_values (contact_id, custom_field_id, value)
      VALUES (v_dispatch.contact_id, v_custom_field_id, v_value)
      ON CONFLICT (contact_id, custom_field_id)
      DO UPDATE SET value = EXCLUDED.value;
    ELSE
      RAISE EXCEPTION 'Contact field is not writable by automation' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The effect and checkpoint share this transaction. Any failure in the
  -- fenced completion rolls back the preceding local mutation as well.
  v_completed := public.complete_evolution_dispatch_step(
    p_step_id, p_dispatch_lease_token, p_step_lease_token, 'done',
    v_step.request_id, NULL, NULL, NULL
  );
  RETURN QUERY SELECT v_completed.id, v_completed.state, v_completed.result;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evolution_automation_effect(uuid, uuid, uuid, uuid, text, jsonb)
  TO service_role;
