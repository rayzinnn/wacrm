BEGIN;

-- Synthetic tenants, effects, and checkpoints; the test rolls everything back.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_connection_a uuid;
  v_contact_a uuid;
  v_conversation_a uuid;
  v_tag_add uuid;
  v_tag_remove uuid;
  v_tag_b uuid;
  v_automation_a uuid;
  v_custom_field_a uuid;
  v_event_a uuid;
  v_event_stale uuid;
  v_dispatch_a uuid;
  v_dispatch_stale uuid;
  v_log_a uuid;
  v_log_stale uuid;
  v_action_add uuid := pg_catalog.gen_random_uuid();
  v_action_remove uuid := pg_catalog.gen_random_uuid();
  v_action_update uuid := pg_catalog.gen_random_uuid();
  v_action_foreign_tag uuid := pg_catalog.gen_random_uuid();
  v_action_expired uuid := pg_catalog.gen_random_uuid();
  v_action_stale_root uuid := pg_catalog.gen_random_uuid();
  v_step_add uuid := pg_catalog.gen_random_uuid();
  v_step_remove uuid := pg_catalog.gen_random_uuid();
  v_step_update uuid := pg_catalog.gen_random_uuid();
  v_step_foreign_tag uuid := pg_catalog.gen_random_uuid();
  v_step_expired uuid := pg_catalog.gen_random_uuid();
  v_step_stale_root uuid := pg_catalog.gen_random_uuid();
  v_root_token uuid := pg_catalog.gen_random_uuid();
  v_stale_root_token uuid := pg_catalog.gen_random_uuid();
  v_token_add uuid := pg_catalog.gen_random_uuid();
  v_token_remove uuid := pg_catalog.gen_random_uuid();
  v_token_update uuid := pg_catalog.gen_random_uuid();
  v_token_foreign_tag uuid := pg_catalog.gen_random_uuid();
  v_token_expired uuid := pg_catalog.gen_random_uuid();
  v_token_stale_root uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 local effects A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@fixture.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 local effects B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
                                            token_encrypted, webhook_secret_encrypted)
  VALUES (v_account_a, v_user_a, 'http://127.0.0.1:8080', 't12-effects-' || v_user_a::text,
          'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user_a, v_account_a, '+15550000031', 'Before')
  RETURNING id INTO v_contact_a;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user_a, v_account_a, v_contact_a, 'open')
  RETURNING id INTO v_conversation_a;
  INSERT INTO public.tags (user_id, account_id, name)
  VALUES (v_user_a, v_account_a, 'T12 add tag') RETURNING id INTO v_tag_add;
  INSERT INTO public.tags (user_id, account_id, name)
  VALUES (v_user_a, v_account_a, 'T12 remove tag') RETURNING id INTO v_tag_remove;
  INSERT INTO public.tags (user_id, account_id, name)
  VALUES (v_user_b, v_account_b, 'T12 foreign tag B') RETURNING id INTO v_tag_b;
  INSERT INTO public.contact_tags (contact_id, tag_id)
  VALUES (v_contact_a, v_tag_remove);
  INSERT INTO public.custom_fields (user_id, account_id, field_name, field_type)
  VALUES (v_user_a, v_account_a, 'T12 local custom', 'text') RETURNING id INTO v_custom_field_a;
  INSERT INTO public.automations (user_id, account_id, name, trigger_type, is_active)
  VALUES (v_user_a, v_account_a, 'T12 local effects', 'new_message_received', true)
  RETURNING id INTO v_automation_a;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:effects:' || v_user_a::text,
          pg_catalog.jsonb_build_object(
            'kind','message','eventKey','t12:effects:' || v_user_a::text,
            'externalMessageId','fixture-effects-' || v_user_a::text,
            'peer','15550000031@s.whatsapp.net','occurredAt',pg_catalog.now()::text,
            'fromMe',false,'sentByApi',false,'contentType','text','text','fixture','mediaRef',NULL
          ), 'done', pg_catalog.now())
  RETURNING id INTO v_event_a;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (v_connection_a, 't12:effects-stale:' || v_user_a::text,
          pg_catalog.jsonb_build_object(
            'kind','message','eventKey','t12:effects-stale:' || v_user_a::text,
            'externalMessageId','fixture-effects-stale-' || v_user_a::text,
            'peer','15550000031@s.whatsapp.net','occurredAt',pg_catalog.now()::text,
            'fromMe',false,'sentByApi',false,'contentType','text','text','fixture','mediaRef',NULL
          ), 'done', pg_catalog.now())
  RETURNING id INTO v_event_stale;
  INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text,
                               message_id, provider_connection_id)
  VALUES
    (v_conversation_a, 'customer', 'text', 'fixture', 'fixture-effects-' || v_user_a::text, v_connection_a),
    (v_conversation_a, 'customer', 'text', 'fixture', 'fixture-effects-stale-' || v_user_a::text, v_connection_a);

  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_a, v_account_a, 'automation', v_automation_a, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token)
  RETURNING id INTO v_dispatch_a;
  INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id,
      user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
  VALUES (v_event_stale, v_account_a, 'automation', v_automation_a, v_user_a,
          v_contact_a, v_conversation_a, 'processing', 1,
          pg_catalog.clock_timestamp() - interval '1 second', v_stale_root_token)
  RETURNING id INTO v_dispatch_stale;

  INSERT INTO public.automation_logs (automation_id, account_id, user_id, contact_id,
      trigger_event, steps_executed, status, evolution_dispatch_id)
  VALUES (v_automation_a, v_account_a, v_user_a, v_contact_a,
          'new_message_received', '[]'::jsonb, 'partial', v_dispatch_a)
  RETURNING id INTO v_log_a;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log_a
   WHERE id = v_dispatch_a;
  INSERT INTO public.automation_logs (automation_id, account_id, user_id, contact_id,
      trigger_event, steps_executed, status, evolution_dispatch_id)
  VALUES (v_automation_a, v_account_a, v_user_a, v_contact_a,
          'new_message_received', '[]'::jsonb, 'partial', v_dispatch_stale)
  RETURNING id INTO v_log_stale;
  UPDATE public.evolution_event_dispatches SET automation_log_id = v_log_stale
   WHERE id = v_dispatch_stale;

  INSERT INTO public.automation_steps (id, automation_id, step_type, step_config, position)
  VALUES
    (v_action_add, v_automation_a, 'add_tag', pg_catalog.jsonb_build_object('tag_id', v_tag_add), 0),
    (v_action_remove, v_automation_a, 'remove_tag', pg_catalog.jsonb_build_object('tag_id', v_tag_remove), 1),
    (v_action_update, v_automation_a, 'update_contact_field', '{"field":"name","value":"interpolated"}'::jsonb, 2),
    (v_action_foreign_tag, v_automation_a, 'add_tag', pg_catalog.jsonb_build_object('tag_id', v_tag_b), 3),
    (v_action_expired, v_automation_a, 'add_tag', pg_catalog.jsonb_build_object('tag_id', v_tag_add), 4),
    (v_action_stale_root, v_automation_a, 'update_contact_field', '{"field":"name","value":"stale"}'::jsonb, 5);

  INSERT INTO public.evolution_dispatch_steps (id, dispatch_id, action_key, state, attempts,
      lease_until, lease_token, request_id)
  VALUES
    (v_step_add, v_dispatch_a, v_action_add::text, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_token_add, 'evolution-step:' || v_step_add::text),
    (v_step_remove, v_dispatch_a, v_action_remove::text, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_token_remove, 'evolution-step:' || v_step_remove::text),
    (v_step_update, v_dispatch_a, v_action_update::text, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_token_update, 'evolution-step:' || v_step_update::text),
    (v_step_foreign_tag, v_dispatch_a, v_action_foreign_tag::text, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_token_foreign_tag, 'evolution-step:' || v_step_foreign_tag::text),
    (v_step_expired, v_dispatch_a, v_action_expired::text, 'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_token_expired, 'evolution-step:' || v_step_expired::text),
    (v_step_stale_root, v_dispatch_stale, v_action_stale_root::text, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_token_stale_root, 'evolution-step:' || v_step_stale_root::text);

  PERFORM pg_catalog.set_config('wacrm.t12effect.user_a', v_user_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.dispatch', v_dispatch_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.dispatch_stale', v_dispatch_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.root_token', v_root_token::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_add', v_step_add::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_remove', v_step_remove::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_update', v_step_update::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_foreign_tag', v_step_foreign_tag::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_expired', v_step_expired::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.step_stale_root', v_step_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_add', v_token_add::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_remove', v_token_remove::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_update', v_token_update::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_foreign_tag', v_token_foreign_tag::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_expired', v_token_expired::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.token_stale_root', v_token_stale_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.action_add', v_action_add::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.tag_add', v_tag_add::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.tag_remove', v_tag_remove::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.tag_b', v_tag_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.t12effect.contact_a', v_contact_a::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.apply_evolution_automation_effect(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure;
BEGIN
  IF pg_catalog.pg_get_function_result(v_function) <>
       'TABLE(step_id uuid, state text, result jsonb)'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function
       AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']))
     OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'automation effect signature, security, or grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE anon;
DO $anon_denial$
BEGIN
  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      current_setting('wacrm.t12effect.dispatch')::uuid,
      current_setting('wacrm.t12effect.root_token')::uuid,
      current_setting('wacrm.t12effect.step_add')::uuid,
      current_setting('wacrm.t12effect.token_add')::uuid,
      'add_tag', '{}'::jsonb
    );
    RAISE EXCEPTION 'anon executed apply_evolution_automation_effect';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denial$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $effect_assertions$
DECLARE
  v_dispatch uuid := current_setting('wacrm.t12effect.dispatch')::uuid;
  v_root_token uuid := current_setting('wacrm.t12effect.root_token')::uuid;
  v_step uuid := current_setting('wacrm.t12effect.step_add')::uuid;
  v_token uuid := current_setting('wacrm.t12effect.token_add')::uuid;
  v_result record;
  v_claim record;
BEGIN
  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, pg_catalog.gen_random_uuid(), v_step, v_token,
      'add_tag', pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'tag_id', current_setting('wacrm.t12effect.tag_add')::uuid));
    RAISE EXCEPTION 'stale root token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, v_root_token, v_step, pg_catalog.gen_random_uuid(),
      'add_tag', pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'tag_id', current_setting('wacrm.t12effect.tag_add')::uuid));
    RAISE EXCEPTION 'stale step token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.contact_tags
      WHERE contact_id = current_setting('wacrm.t12effect.contact_a')::uuid
        AND tag_id = current_setting('wacrm.t12effect.tag_add')::uuid) THEN
    RAISE EXCEPTION 'stale calls changed the absent add_tag relation';
  END IF;

  SELECT * INTO STRICT v_result FROM public.apply_evolution_automation_effect(
    v_dispatch, v_root_token, v_step, v_token, 'add_tag',
    pg_catalog.jsonb_build_object(
      'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
      'tag_id', current_setting('wacrm.t12effect.tag_add')::uuid));
  IF v_result.state <> 'done' OR v_result.step_id IS DISTINCT FROM v_step THEN
    RAISE EXCEPTION 'add_tag did not complete its step';
  END IF;
  SELECT * INTO STRICT v_claim FROM public.claim_evolution_dispatch_step(
    v_dispatch, v_root_token, current_setting('wacrm.t12effect.action_add'), 30);
  IF v_claim.state <> 'done' OR v_claim.should_execute THEN
    RAISE EXCEPTION 'replay after completed add_tag authorized another effect';
  END IF;
  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, v_root_token, v_step, v_token, 'add_tag',
      pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'tag_id', current_setting('wacrm.t12effect.tag_add')::uuid));
    RAISE EXCEPTION 'completed add_tag step was applied twice';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.contact_tags
      WHERE contact_id = current_setting('wacrm.t12effect.contact_a')::uuid
        AND tag_id = current_setting('wacrm.t12effect.tag_add')::uuid) <> 1 THEN
    RAISE EXCEPTION 'add_tag replay duplicated the relation';
  END IF;

  SELECT * INTO STRICT v_result FROM public.apply_evolution_automation_effect(
    v_dispatch, v_root_token,
    current_setting('wacrm.t12effect.step_remove')::uuid,
    current_setting('wacrm.t12effect.token_remove')::uuid,
    'remove_tag', pg_catalog.jsonb_build_object(
      'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
      'tag_id', current_setting('wacrm.t12effect.tag_remove')::uuid));
  IF v_result.state <> 'done'
     OR EXISTS (SELECT 1 FROM public.contact_tags
       WHERE contact_id = current_setting('wacrm.t12effect.contact_a')::uuid
         AND tag_id = current_setting('wacrm.t12effect.tag_remove')::uuid) THEN
    RAISE EXCEPTION 'remove_tag did not remove the tenant relation';
  END IF;

  SELECT * INTO STRICT v_result FROM public.apply_evolution_automation_effect(
    v_dispatch, v_root_token,
    current_setting('wacrm.t12effect.step_update')::uuid,
    current_setting('wacrm.t12effect.token_update')::uuid,
    'update_contact_field', pg_catalog.jsonb_build_object(
      'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
      'field', 'name', 'value', 'After'));
  IF v_result.state <> 'done'
     OR (SELECT c.name FROM public.contacts AS c
          WHERE c.id = current_setting('wacrm.t12effect.contact_a')::uuid) <> 'After' THEN
    RAISE EXCEPTION 'update_contact_field did not apply';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, v_root_token,
      current_setting('wacrm.t12effect.step_foreign_tag')::uuid,
      current_setting('wacrm.t12effect.token_foreign_tag')::uuid,
      'add_tag', pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'tag_id', current_setting('wacrm.t12effect.tag_b')::uuid));
    RAISE EXCEPTION 'cross-tenant tag was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.contact_tags
      WHERE contact_id = current_setting('wacrm.t12effect.contact_a')::uuid
        AND tag_id = current_setting('wacrm.t12effect.tag_b')::uuid)
     OR (SELECT state FROM public.evolution_dispatch_steps
          WHERE id = current_setting('wacrm.t12effect.step_foreign_tag')::uuid) <> 'processing' THEN
    RAISE EXCEPTION 'cross-tenant rejection changed data or checkpoint';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      current_setting('wacrm.t12effect.dispatch_stale')::uuid,
      (SELECT d.lease_token FROM public.evolution_event_dispatches AS d
        WHERE d.id = current_setting('wacrm.t12effect.dispatch_stale')::uuid),
      current_setting('wacrm.t12effect.step_stale_root')::uuid,
      current_setting('wacrm.t12effect.token_stale_root')::uuid,
      'update_contact_field', pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'field', 'name', 'value', 'Must not persist'));
    RAISE EXCEPTION 'expired root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT c.name FROM public.contacts AS c
       WHERE c.id = current_setting('wacrm.t12effect.contact_a')::uuid) <> 'After'
     OR (SELECT s.state FROM public.evolution_dispatch_steps AS s
          WHERE s.id = current_setting('wacrm.t12effect.step_stale_root')::uuid) <> 'processing' THEN
    RAISE EXCEPTION 'expired root lease left a partial field write or checkpoint';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, v_root_token,
      current_setting('wacrm.t12effect.step_expired')::uuid,
      current_setting('wacrm.t12effect.token_expired')::uuid,
      'add_tag', pg_catalog.jsonb_build_object(
        'contact_id', current_setting('wacrm.t12effect.contact_a')::uuid,
        'tag_id', current_setting('wacrm.t12effect.tag_add')::uuid));
    RAISE EXCEPTION 'expired step lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM public.apply_evolution_automation_effect(
      v_dispatch, v_root_token,
      current_setting('wacrm.t12effect.step_foreign_tag')::uuid,
      current_setting('wacrm.t12effect.token_foreign_tag')::uuid,
      'send_webhook', '{}'::jsonb);
    RAISE EXCEPTION 'unsupported transport was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$effect_assertions$;
RESET ROLE;

ROLLBACK;
