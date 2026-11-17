BEGIN;

-- Synthetic Baileys replies only. No provider calls; every fixture rolls back.
DO $fixture$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_connection_a uuid;
  v_contact_button uuid;
  v_contact_list uuid;
  v_contact_unmatched uuid;
  v_contact_tenant uuid;
  v_contact_b uuid;
  v_conversation_button uuid;
  v_conversation_list uuid;
  v_conversation_unmatched uuid;
  v_conversation_tenant uuid;
  v_conversation_b uuid;
  v_run_button uuid;
  v_run_list uuid;
  v_run_unmatched uuid;
  v_run_b uuid;
  v_event_button uuid := pg_catalog.gen_random_uuid();
  v_event_list uuid := pg_catalog.gen_random_uuid();
  v_event_unmatched uuid := pg_catalog.gen_random_uuid();
  v_event_tenant uuid := pg_catalog.gen_random_uuid();
  v_event_echo uuid := pg_catalog.gen_random_uuid();
  v_event_group uuid := pg_catalog.gen_random_uuid();
  v_token_button uuid := pg_catalog.gen_random_uuid();
  v_token_list uuid := pg_catalog.gen_random_uuid();
  v_token_unmatched uuid := pg_catalog.gen_random_uuid();
  v_token_tenant uuid := pg_catalog.gen_random_uuid();
  v_token_echo uuid := pg_catalog.gen_random_uuid();
  v_token_group uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@interactive-a.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Synthetic Flow A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@interactive-b.invalid', '', pg_catalog.now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Synthetic Flow B"}'::jsonb);
  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;

  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id)
  VALUES (v_user_a, v_account_a, 'Synthetic interactive A', 'active', 'keyword', '{"keywords":["synthetic"]}', 'buttons')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id)
  VALUES (v_user_b, v_account_b, 'Synthetic interactive B', 'active', 'keyword', '{"keywords":["synthetic"]}', 'buttons')
  RETURNING id INTO v_flow_b;
  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config) VALUES
    (v_flow_a, 'buttons', 'send_buttons', '{"buttons":[{"reply_id":"BTN_OK","title":"Continue","next_node_key":"end"}]}'::jsonb),
    (v_flow_a, 'list', 'send_list', '{"sections":[{"rows":[{"reply_id":"ROW_INFO","title":"Details","next_node_key":"end"}]}]}'::jsonb),
    (v_flow_a, 'unmatched', 'send_buttons', '{"buttons":[{"reply_id":"BTN_OK","title":"Continue","next_node_key":"end"}]}'::jsonb),
    (v_flow_b, 'buttons', 'send_buttons', '{"buttons":[{"reply_id":"BTN_OK","title":"Continue","next_node_key":"end"}]}'::jsonb);

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (v_account_a, v_user_a, 'evolution', 'http://127.0.0.1:8080', 'synthetic-interactive', 'synthetic', 'synthetic')
  RETURNING id INTO v_connection_a;

  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+5521999991001', 'Synthetic button reply') RETURNING id INTO v_contact_button;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+5521999991002', 'Synthetic list reply') RETURNING id INTO v_contact_list;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+5521999991003', 'Synthetic unmatched reply') RETURNING id INTO v_contact_unmatched;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+5521999991004', 'Synthetic tenant probe A') RETURNING id INTO v_contact_tenant;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_b, v_account_b, '+5521999991004', 'Synthetic tenant probe B') RETURNING id INTO v_contact_b;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_button, 'open') RETURNING id INTO v_conversation_button;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_list, 'open') RETURNING id INTO v_conversation_list;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_unmatched, 'open') RETURNING id INTO v_conversation_unmatched;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_tenant, 'open') RETURNING id INTO v_conversation_tenant;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_b, v_account_b, v_contact_b, 'open') RETURNING id INTO v_conversation_b;

  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id, status, current_node_key
  ) VALUES
    (v_flow_a, v_account_a, v_user_a, v_contact_button, v_conversation_button, 'active', 'buttons') RETURNING id INTO v_run_button;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id, status, current_node_key
  ) VALUES
    (v_flow_a, v_account_a, v_user_a, v_contact_list, v_conversation_list, 'active', 'list') RETURNING id INTO v_run_list;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id, status, current_node_key
  ) VALUES
    (v_flow_a, v_account_a, v_user_a, v_contact_unmatched, v_conversation_unmatched, 'active', 'unmatched') RETURNING id INTO v_run_unmatched;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id, status, current_node_key
  ) VALUES
    (v_flow_b, v_account_b, v_user_b, v_contact_b, v_conversation_b, 'active', 'buttons') RETURNING id INTO v_run_b;

  INSERT INTO public.evolution_events (
    id, connection_id, event_key, normalized_event, state, attempts, lease_until, lease_token
  ) VALUES
    (v_event_button, v_connection_a, 'message:synthetic-button', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-button','externalMessageId','SYNTHETIC_BUTTON_MESSAGE',
      'peer','5521999991001@s.whatsapp.net','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','interactive','text','Continue','mediaRef',NULL,
      'interactiveReplyId','BTN_OK','interactiveReplyKind','button'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_button),
    (v_event_list, v_connection_a, 'message:synthetic-list', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-list','externalMessageId','SYNTHETIC_LIST_MESSAGE',
      'peer','5521999991002@s.whatsapp.net','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','interactive','text','Details','mediaRef',NULL,
      'interactiveReplyId','ROW_INFO','interactiveReplyKind','list'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_list),
    (v_event_unmatched, v_connection_a, 'message:synthetic-unmatched', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-unmatched','externalMessageId','SYNTHETIC_UNMATCHED_MESSAGE',
      'peer','5521999991003@s.whatsapp.net','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','interactive','text','Other','mediaRef',NULL,
      'interactiveReplyId','BTN_OTHER','interactiveReplyKind','button'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_unmatched),
    (v_event_tenant, v_connection_a, 'message:synthetic-tenant', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-tenant','externalMessageId','SYNTHETIC_TENANT_MESSAGE',
      'peer','5521999991004@s.whatsapp.net','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','interactive','text','Continue','mediaRef',NULL,
      'interactiveReplyId','BTN_OK','interactiveReplyKind','button'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_tenant),
    (v_event_echo, v_connection_a, 'message:synthetic-echo', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-echo','externalMessageId','SYNTHETIC_ECHO_MESSAGE',
      'peer','5521999991001@s.whatsapp.net','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',true,'sentByApi',false,'contentType','interactive','text','Continue','mediaRef',NULL,
      'interactiveReplyId','BTN_OK','interactiveReplyKind','button'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_echo),
    (v_event_group, v_connection_a, 'message:synthetic-group', pg_catalog.jsonb_build_object(
      'kind','message','eventKey','message:synthetic-group','externalMessageId','SYNTHETIC_GROUP_MESSAGE',
      'peer','123456789012345678@g.us','occurredAt','2026-11-17T12:00:00.000Z',
      'fromMe',false,'sentByApi',false,'contentType','interactive','text','Continue','mediaRef',NULL,
      'interactiveReplyId','BTN_OK','interactiveReplyKind','button'), 'processing', 1,
      pg_catalog.clock_timestamp() + interval '5 minutes', v_token_group);

  PERFORM pg_catalog.set_config('wacrm.interactive.flow_a', v_flow_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.flow_b', v_flow_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.run_button', v_run_button::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.run_list', v_run_list::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.run_unmatched', v_run_unmatched::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.run_b', v_run_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.conversation_button', v_conversation_button::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_button', v_event_button::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_button', v_token_button::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_list', v_event_list::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_list', v_token_list::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_unmatched', v_event_unmatched::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_unmatched', v_token_unmatched::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_tenant', v_event_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_tenant', v_token_tenant::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_echo', v_event_echo::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_echo', v_token_echo::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.event_group', v_event_group::text, true);
  PERFORM pg_catalog.set_config('wacrm.interactive.token_group', v_token_group::text, true);
END;
$fixture$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.apply_evolution_interactive_reply(uuid,uuid)'::regprocedure;
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_function
          AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
     ) OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Interactive reply RPC security/grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;
DO $assertions$
DECLARE
  v_result record;
  v_event uuid := current_setting('wacrm.interactive.event_button')::uuid;
  v_token uuid := current_setting('wacrm.interactive.token_button')::uuid;
  v_run uuid := current_setting('wacrm.interactive.run_button')::uuid;
  v_flow_a uuid := current_setting('wacrm.interactive.flow_a')::uuid;
  v_event_id uuid;
  v_token_id uuid;
BEGIN
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event, v_token);
  IF v_result.outcome <> 'applied'
     OR (SELECT count(*) FROM public.messages WHERE provider_connection_id = (SELECT connection_id FROM public.evolution_events WHERE id = v_event) AND message_id = 'SYNTHETIC_BUTTON_MESSAGE' AND content_type = 'interactive' AND interactive_reply_id = 'BTN_OK' AND content_text = 'Continue') <> 1
     OR (SELECT count(*) FROM public.evolution_event_dispatches WHERE event_id = v_event AND engine = 'flow' AND flow_id = v_flow_a AND flow_run_id = v_run) <> 1
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches WHERE event_id = v_event AND engine IN ('automation', 'ai')) THEN
    RAISE EXCEPTION 'Button reply persistence or Flow-only dispatch mismatch';
  END IF;

  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event, v_token);
  IF v_result.outcome <> 'duplicate'
     OR (SELECT count(*) FROM public.messages WHERE message_id = 'SYNTHETIC_BUTTON_MESSAGE') <> 1
     OR (SELECT count(*) FROM public.evolution_event_dispatches WHERE event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'Button reply replay duplicated message or Flow dispatch';
  END IF;

  v_event_id := current_setting('wacrm.interactive.event_list')::uuid;
  v_token_id := current_setting('wacrm.interactive.token_list')::uuid;
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event_id, v_token_id);
  IF v_result.outcome <> 'applied'
     OR (SELECT count(*) FROM public.evolution_event_dispatches WHERE event_id = v_event_id AND engine = 'flow' AND flow_run_id = current_setting('wacrm.interactive.run_list')::uuid) <> 1 THEN
    RAISE EXCEPTION 'List reply did not prepare its matching Flow dispatch';
  END IF;

  v_event_id := current_setting('wacrm.interactive.event_unmatched')::uuid;
  v_token_id := current_setting('wacrm.interactive.token_unmatched')::uuid;
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event_id, v_token_id);
  IF v_result.outcome <> 'applied'
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches WHERE event_id = v_event_id) THEN
    RAISE EXCEPTION 'Unconfigured reply ID created a Flow dispatch';
  END IF;

  v_event_id := current_setting('wacrm.interactive.event_tenant')::uuid;
  v_token_id := current_setting('wacrm.interactive.token_tenant')::uuid;
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event_id, v_token_id);
  IF v_result.outcome <> 'applied'
     OR EXISTS (SELECT 1 FROM public.evolution_event_dispatches WHERE event_id = v_event_id AND flow_run_id = current_setting('wacrm.interactive.run_b')::uuid) THEN
    RAISE EXCEPTION 'Cross-account Flow run received an interactive dispatch';
  END IF;

  v_event_id := current_setting('wacrm.interactive.event_echo')::uuid;
  v_token_id := current_setting('wacrm.interactive.token_echo')::uuid;
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event_id, v_token_id);
  IF v_result.outcome <> 'failed'
     OR EXISTS (SELECT 1 FROM public.messages WHERE message_id = 'SYNTHETIC_ECHO_MESSAGE') THEN
    RAISE EXCEPTION 'Interactive echo was persisted';
  END IF;

  v_event_id := current_setting('wacrm.interactive.event_group')::uuid;
  v_token_id := current_setting('wacrm.interactive.token_group')::uuid;
  SELECT * INTO STRICT v_result FROM public.apply_evolution_interactive_reply(v_event_id, v_token_id);
  IF v_result.outcome <> 'failed'
     OR EXISTS (SELECT 1 FROM public.messages WHERE message_id = 'SYNTHETIC_GROUP_MESSAGE') THEN
    RAISE EXCEPTION 'Group reply was persisted';
  END IF;
END;
$assertions$;

ROLLBACK;
