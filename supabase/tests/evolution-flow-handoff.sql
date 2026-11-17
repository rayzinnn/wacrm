BEGIN;

-- Synthetic Flow handoffs only. The transaction is rolled back at the end.
DO $fixture_setup$
DECLARE
  v_user_a uuid := pg_catalog.gen_random_uuid();
  v_user_b uuid := pg_catalog.gen_random_uuid();
  v_user_agent uuid := pg_catalog.gen_random_uuid();
  v_account_a uuid;
  v_account_b uuid;
  v_flow_a uuid;
  v_flow_b uuid;
  v_connection_a uuid;
  v_connection_b uuid;
  v_contact_no uuid;
  v_contact_assign uuid;
  v_contact_bad uuid;
  v_contact_root uuid;
  v_contact_step uuid;
  v_contact_seq uuid;
  v_contact_b uuid;
  v_conversation_no uuid;
  v_conversation_assign uuid;
  v_conversation_bad uuid;
  v_conversation_root uuid;
  v_conversation_step uuid;
  v_conversation_seq uuid;
  v_conversation_b uuid;
  v_run_no uuid;
  v_run_assign uuid;
  v_run_bad uuid;
  v_run_root uuid;
  v_run_step uuid;
  v_run_seq uuid;
  v_run_b uuid;
  v_event_no uuid;
  v_event_assign uuid;
  v_event_bad uuid;
  v_event_root uuid;
  v_event_step uuid;
  v_event_seq uuid;
  v_event_b uuid;
  v_dispatch_no uuid := pg_catalog.gen_random_uuid();
  v_dispatch_assign uuid := pg_catalog.gen_random_uuid();
  v_dispatch_bad uuid := pg_catalog.gen_random_uuid();
  v_dispatch_root uuid := pg_catalog.gen_random_uuid();
  v_dispatch_step uuid := pg_catalog.gen_random_uuid();
  v_dispatch_seq uuid := pg_catalog.gen_random_uuid();
  v_dispatch_b uuid := pg_catalog.gen_random_uuid();
  v_step_no uuid := pg_catalog.gen_random_uuid();
  v_step_assign uuid := pg_catalog.gen_random_uuid();
  v_step_bad uuid := pg_catalog.gen_random_uuid();
  v_step_root uuid := pg_catalog.gen_random_uuid();
  v_step_stale uuid := pg_catalog.gen_random_uuid();
  v_step_seq uuid := pg_catalog.gen_random_uuid();
  v_step_b uuid := pg_catalog.gen_random_uuid();
  v_root_token_no uuid := pg_catalog.gen_random_uuid();
  v_root_token_assign uuid := pg_catalog.gen_random_uuid();
  v_root_token_bad uuid := pg_catalog.gen_random_uuid();
  v_root_token_root uuid := pg_catalog.gen_random_uuid();
  v_root_token_step uuid := pg_catalog.gen_random_uuid();
  v_root_token_seq uuid := pg_catalog.gen_random_uuid();
  v_root_token_b uuid := pg_catalog.gen_random_uuid();
  v_step_token_no uuid := pg_catalog.gen_random_uuid();
  v_step_token_assign uuid := pg_catalog.gen_random_uuid();
  v_step_token_bad uuid := pg_catalog.gen_random_uuid();
  v_step_token_root uuid := pg_catalog.gen_random_uuid();
  v_step_token_stale uuid := pg_catalog.gen_random_uuid();
  v_step_token_seq uuid := pg_catalog.gen_random_uuid();
  v_step_token_b uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', v_user_a::text || '@flow-handoff-a.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic handoff owner A"}'::jsonb),
    (v_user_b, 'authenticated', 'authenticated', v_user_b::text || '@flow-handoff-b.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic handoff owner B"}'::jsonb),
    (v_user_agent, 'authenticated', 'authenticated', v_user_agent::text || '@flow-handoff-agent.invalid', '',
     pg_catalog.now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Synthetic handoff agent"}'::jsonb);

  SELECT p.account_id INTO STRICT v_account_a FROM public.profiles AS p WHERE p.user_id = v_user_a;
  SELECT p.account_id INTO STRICT v_account_b FROM public.profiles AS p WHERE p.user_id = v_user_b;
  UPDATE public.profiles
     SET account_id = v_account_a, account_role = 'agent'
   WHERE user_id = v_user_agent;

  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id)
  VALUES (v_user_a, v_account_a, 'Synthetic handoff A', 'active', 'keyword', '{"keywords":["handoff"]}', 'no_assign')
  RETURNING id INTO v_flow_a;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id)
  VALUES (v_user_b, v_account_b, 'Synthetic handoff B', 'active', 'keyword', '{"keywords":["handoff"]}', 'tenant')
  RETURNING id INTO v_flow_b;

  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config) VALUES
    (v_flow_a, 'no_assign', 'handoff', '{"note":"synthetic note without assignment"}'::jsonb),
    (v_flow_a, 'assign', 'handoff', pg_catalog.jsonb_build_object(
      'note', 'synthetic assigned note', 'assign_to', v_user_agent::text
    )),
    (v_flow_a, 'bad_agent', 'handoff', pg_catalog.jsonb_build_object(
      'note', 'synthetic cross-tenant note', 'assign_to', v_user_b::text
    )),
    (v_flow_a, 'root_stale', 'handoff', '{}'::jsonb),
    (v_flow_a, 'step_stale', 'handoff', '{}'::jsonb),
    (v_flow_a, 'seq_stale', 'handoff', '{}'::jsonb),
    (v_flow_b, 'tenant', 'handoff', '{}'::jsonb);

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_a, v_user_a, 'evolution', 'http://127.0.0.1:8080', 'synthetic-handoff-a', 'synthetic', 'synthetic')
  RETURNING id INTO v_connection_a;
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES
    (v_account_b, v_user_b, 'evolution', 'http://127.0.0.1:8080', 'synthetic-handoff-b', 'synthetic', 'synthetic')
  RETURNING id INTO v_connection_b;

  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100001', 'Synthetic handoff no assignment') RETURNING id INTO v_contact_no;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100002', 'Synthetic handoff assignment') RETURNING id INTO v_contact_assign;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100003', 'Synthetic handoff bad agent') RETURNING id INTO v_contact_bad;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100004', 'Synthetic handoff stale root') RETURNING id INTO v_contact_root;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100005', 'Synthetic handoff stale step') RETURNING id INTO v_contact_step;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_a, v_account_a, '+15550100006', 'Synthetic handoff stale sequence') RETURNING id INTO v_contact_seq;
  INSERT INTO public.contacts (user_id, account_id, phone, name) VALUES
    (v_user_b, v_account_b, '+15550100007', 'Synthetic handoff tenant B') RETURNING id INTO v_contact_b;

  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_no, 'open') RETURNING id INTO v_conversation_no;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_assign, 'open') RETURNING id INTO v_conversation_assign;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_bad, 'open') RETURNING id INTO v_conversation_bad;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_root, 'open') RETURNING id INTO v_conversation_root;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_step, 'open') RETURNING id INTO v_conversation_step;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_a, v_account_a, v_contact_seq, 'open') RETURNING id INTO v_conversation_seq;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status) VALUES
    (v_user_b, v_account_b, v_contact_b, 'open') RETURNING id INTO v_conversation_b;

  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_no, v_conversation_no, 'active', 'no_assign', 0)
  RETURNING id INTO v_run_no;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_assign, v_conversation_assign, 'active', 'assign', 0)
  RETURNING id INTO v_run_assign;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_bad, v_conversation_bad, 'active', 'bad_agent', 0)
  RETURNING id INTO v_run_bad;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_root, v_conversation_root, 'active', 'root_stale', 0)
  RETURNING id INTO v_run_root;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_step, v_conversation_step, 'active', 'step_stale', 0)
  RETURNING id INTO v_run_step;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_a, v_account_a, v_user_a, v_contact_seq, v_conversation_seq, 'active', 'seq_stale', 0)
  RETURNING id INTO v_run_seq;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow_b, v_account_b, v_user_b, v_contact_b, v_conversation_b, 'active', 'tenant', 0)
  RETURNING id INTO v_run_b;

  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:no:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_no;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:assign:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_assign;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:bad:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_bad;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:root:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_root;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:step:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_step;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_a, 'flow-handoff:seq:' || v_user_a::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_seq;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at) VALUES
    (v_connection_b, 'flow-handoff:tenant:' || v_user_b::text,
     '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic inbound"}'::jsonb,
     'done', pg_catalog.clock_timestamp()) RETURNING id INTO v_event_b;

  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, flow_id, user_id, flow_run_id,
    contact_id, conversation_id, state, attempts, lease_until, lease_token
  ) VALUES
    (v_dispatch_no, v_event_no, v_account_a, 'flow', v_flow_a, v_user_a, v_run_no,
     v_contact_no, v_conversation_no, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_no),
    (v_dispatch_assign, v_event_assign, v_account_a, 'flow', v_flow_a, v_user_a, v_run_assign,
     v_contact_assign, v_conversation_assign, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_assign),
    (v_dispatch_bad, v_event_bad, v_account_a, 'flow', v_flow_a, v_user_a, v_run_bad,
     v_contact_bad, v_conversation_bad, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_bad),
    (v_dispatch_root, v_event_root, v_account_a, 'flow', v_flow_a, v_user_a, v_run_root,
     v_contact_root, v_conversation_root, 'processing', 1, pg_catalog.clock_timestamp() - interval '1 second', v_root_token_root),
    (v_dispatch_step, v_event_step, v_account_a, 'flow', v_flow_a, v_user_a, v_run_step,
     v_contact_step, v_conversation_step, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_step),
    (v_dispatch_seq, v_event_seq, v_account_a, 'flow', v_flow_a, v_user_a, v_run_seq,
     v_contact_seq, v_conversation_seq, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_seq),
    (v_dispatch_b, v_event_b, v_account_b, 'flow', v_flow_b, v_user_b, v_run_b,
     v_contact_b, v_conversation_b, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_root_token_b);

  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, lease_until, lease_token, request_id, send_attempt_id
  ) VALUES
    (v_step_no, v_dispatch_no, '0:no_assign', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_no,
     'evolution-step:' || v_step_no::text, NULL),
    (v_step_assign, v_dispatch_assign, '0:assign', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_assign,
     'evolution-step:' || v_step_assign::text, NULL),
    (v_step_bad, v_dispatch_bad, '0:bad_agent', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_bad,
     'evolution-step:' || v_step_bad::text, NULL),
    (v_step_root, v_dispatch_root, '0:root_stale', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', pg_catalog.gen_random_uuid(),
     'evolution-step:' || v_step_root::text, NULL),
    (v_step_stale, v_dispatch_step, '0:step_stale', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_stale,
     'evolution-step:' || v_step_stale::text, NULL),
    (v_step_seq, v_dispatch_seq, '8:seq_stale', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_seq,
     'evolution-step:' || v_step_seq::text, NULL),
    (v_step_b, v_dispatch_b, '0:tenant', 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token_b,
     'evolution-step:' || v_step_b::text, NULL);

  PERFORM pg_catalog.set_config('wacrm.flowhandoff.user_agent', v_user_agent::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.user_b', v_user_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.account_a', v_account_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.flow_a', v_flow_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.flow_b', v_flow_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.connection_a', v_connection_a::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.contact_no', v_contact_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_no', v_conversation_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_no', v_run_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_no', v_event_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_no', v_dispatch_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_no', v_root_token_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_no', v_step_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_no', v_step_token_no::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_assign', v_conversation_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_assign', v_run_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_assign', v_event_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_assign', v_dispatch_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_assign', v_root_token_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_assign', v_step_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_assign', v_step_token_assign::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_bad', v_conversation_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_bad', v_run_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_bad', v_event_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_bad', v_dispatch_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_bad', v_root_token_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_bad', v_step_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_bad', v_step_token_bad::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_root', v_conversation_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_root', v_run_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_root', v_event_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_root', v_dispatch_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_root', v_root_token_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_root', v_step_root::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_step', v_conversation_step::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_step', v_run_step::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_step', v_event_step::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_step', v_dispatch_step::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_step', v_root_token_step::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_stale', v_step_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_stale', v_step_token_stale::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.conversation_seq', v_conversation_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_seq', v_run_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_seq', v_event_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_seq', v_dispatch_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_seq', v_root_token_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_seq', v_step_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_seq', v_step_token_seq::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.run_b', v_run_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.event_b', v_event_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.dispatch_b', v_dispatch_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.root_token_b', v_root_token_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_b', v_step_b::text, true);
  PERFORM pg_catalog.set_config('wacrm.flowhandoff.step_token_b', v_step_token_b::text, true);
END;
$fixture_setup$;

DO $security_assertions$
DECLARE
  v_function regprocedure := 'public.complete_evolution_flow_handoff(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)'::regprocedure;
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
        WHERE p.oid = v_function
          AND (p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'])
     ) OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Flow handoff function security/grants mismatch';
  END IF;
END;
$security_assertions$;

SET LOCAL ROLE service_role;
DO $handoff_assertions$
DECLARE
  v_result record;
  v_run uuid := current_setting('wacrm.flowhandoff.run_no')::uuid;
  v_event uuid := current_setting('wacrm.flowhandoff.event_no')::uuid;
  v_dispatch uuid := current_setting('wacrm.flowhandoff.dispatch_no')::uuid;
  v_step uuid := current_setting('wacrm.flowhandoff.step_no')::uuid;
BEGIN
  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_handoff(
    v_dispatch, current_setting('wacrm.flowhandoff.root_token_no')::uuid,
    v_step, current_setting('wacrm.flowhandoff.step_token_no')::uuid,
    v_run, v_event, 0, 'no_assign'
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'handed_off'
     OR (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_no')::uuid) <> 'pending'
     OR (SELECT assigned_agent_id FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_no')::uuid) IS NOT NULL
     OR (SELECT status FROM public.flow_runs WHERE id = v_run) <> 'handed_off'
     OR (SELECT end_reason FROM public.flow_runs WHERE id = v_run) <> 'handoff_node'
     OR (SELECT transition_seq FROM public.flow_runs WHERE id = v_run) <> 1
     OR (SELECT current_node_key FROM public.flow_runs WHERE id = v_run) <> 'no_assign'
     OR (SELECT state FROM public.evolution_dispatch_steps WHERE id = v_step) <> 'done'
     OR (SELECT send_attempt_id FROM public.evolution_dispatch_steps WHERE id = v_step) IS NOT NULL
     OR (SELECT count(*) FROM public.flow_run_events WHERE flow_run_id = v_run AND evolution_event_id = v_event AND event_type = 'handoff') <> 1
     OR (SELECT payload FROM public.flow_run_events WHERE flow_run_id = v_run AND evolution_event_id = v_event AND event_type = 'handoff')
        <> '{"note":"synthetic note without assignment","assigned_to":null}'::jsonb
     OR (SELECT payload ? 'text' OR payload ? 'normalized_event' FROM public.flow_run_events
          WHERE flow_run_id = v_run AND evolution_event_id = v_event AND event_type = 'handoff') THEN
    RAISE EXCEPTION 'Unassigned Flow handoff effect/checkpoint mismatch';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_handoff(
    v_dispatch, current_setting('wacrm.flowhandoff.root_token_no')::uuid,
    v_step, current_setting('wacrm.flowhandoff.step_token_no')::uuid,
    v_run, v_event, 0, 'no_assign'
  );
  IF v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'handed_off'
     OR (SELECT count(*) FROM public.flow_run_events WHERE flow_run_id = v_run AND evolution_event_id = v_event AND event_type = 'handoff') <> 1 THEN
    RAISE EXCEPTION 'Flow handoff replay duplicated or advanced the transition';
  END IF;

  SELECT * INTO STRICT v_result FROM public.complete_evolution_flow_handoff(
    current_setting('wacrm.flowhandoff.dispatch_assign')::uuid,
    current_setting('wacrm.flowhandoff.root_token_assign')::uuid,
    current_setting('wacrm.flowhandoff.step_assign')::uuid,
    current_setting('wacrm.flowhandoff.step_token_assign')::uuid,
    current_setting('wacrm.flowhandoff.run_assign')::uuid,
    current_setting('wacrm.flowhandoff.event_assign')::uuid,
    0, 'assign'
  );
  IF NOT v_result.applied OR v_result.transition_seq <> 1 OR v_result.status <> 'handed_off'
     OR (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_assign')::uuid) <> 'pending'
     OR (SELECT assigned_agent_id FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_assign')::uuid)
        IS DISTINCT FROM current_setting('wacrm.flowhandoff.user_agent')::uuid
     OR (SELECT payload FROM public.flow_run_events
          WHERE flow_run_id = current_setting('wacrm.flowhandoff.run_assign')::uuid
            AND evolution_event_id = current_setting('wacrm.flowhandoff.event_assign')::uuid
            AND event_type = 'handoff')
        IS DISTINCT FROM pg_catalog.jsonb_build_object(
          'note', 'synthetic assigned note',
          'assigned_to', current_setting('wacrm.flowhandoff.user_agent')::uuid
        ) THEN
    RAISE EXCEPTION 'Assigned Flow handoff did not apply the configured same-account agent';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_handoff(
      current_setting('wacrm.flowhandoff.dispatch_bad')::uuid,
      current_setting('wacrm.flowhandoff.root_token_bad')::uuid,
      current_setting('wacrm.flowhandoff.step_bad')::uuid,
      current_setting('wacrm.flowhandoff.step_token_bad')::uuid,
      current_setting('wacrm.flowhandoff.run_bad')::uuid,
      current_setting('wacrm.flowhandoff.event_bad')::uuid,
      0, 'bad_agent'
    );
    RAISE EXCEPTION 'Cross-tenant handoff assignee was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_bad')::uuid) <> 'open'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_bad')::uuid) <> 'active'
     OR EXISTS (SELECT 1 FROM public.flow_run_events
                 WHERE flow_run_id = current_setting('wacrm.flowhandoff.run_bad')::uuid
                   AND evolution_event_id = current_setting('wacrm.flowhandoff.event_bad')::uuid) THEN
    RAISE EXCEPTION 'Rejected cross-tenant assignee mutated Flow state';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_handoff(
      current_setting('wacrm.flowhandoff.dispatch_root')::uuid,
      current_setting('wacrm.flowhandoff.root_token_root')::uuid,
      current_setting('wacrm.flowhandoff.step_root')::uuid,
      current_setting('wacrm.flowhandoff.step_token_no')::uuid,
      current_setting('wacrm.flowhandoff.run_root')::uuid,
      current_setting('wacrm.flowhandoff.event_root')::uuid,
      0, 'root_stale'
    );
    RAISE EXCEPTION 'Expired Flow root lease was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_root')::uuid) <> 'open'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_root')::uuid) <> 'active' THEN
    RAISE EXCEPTION 'Expired root lease mutated Flow state';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_handoff(
      current_setting('wacrm.flowhandoff.dispatch_step')::uuid,
      current_setting('wacrm.flowhandoff.root_token_step')::uuid,
      current_setting('wacrm.flowhandoff.step_stale')::uuid,
      pg_catalog.gen_random_uuid(),
      current_setting('wacrm.flowhandoff.run_step')::uuid,
      current_setting('wacrm.flowhandoff.event_step')::uuid,
      0, 'step_stale'
    );
    RAISE EXCEPTION 'Wrong Flow step lease token was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_step')::uuid) <> 'open'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_step')::uuid) <> 'active' THEN
    RAISE EXCEPTION 'Wrong step lease mutated Flow state';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_handoff(
      current_setting('wacrm.flowhandoff.dispatch_seq')::uuid,
      current_setting('wacrm.flowhandoff.root_token_seq')::uuid,
      current_setting('wacrm.flowhandoff.step_seq')::uuid,
      current_setting('wacrm.flowhandoff.step_token_seq')::uuid,
      current_setting('wacrm.flowhandoff.run_seq')::uuid,
      current_setting('wacrm.flowhandoff.event_seq')::uuid,
      8, 'seq_stale'
    );
    RAISE EXCEPTION 'Stale Flow transition sequence was accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  IF (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_seq')::uuid) <> 'open'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_seq')::uuid) <> 'active'
     OR (SELECT state FROM public.evolution_dispatch_steps WHERE id = current_setting('wacrm.flowhandoff.step_seq')::uuid) <> 'processing' THEN
    RAISE EXCEPTION 'Stale sequence mutated Flow state';
  END IF;

  BEGIN
    PERFORM * FROM public.complete_evolution_flow_handoff(
      current_setting('wacrm.flowhandoff.dispatch_b')::uuid,
      current_setting('wacrm.flowhandoff.root_token_b')::uuid,
      current_setting('wacrm.flowhandoff.step_b')::uuid,
      current_setting('wacrm.flowhandoff.step_token_b')::uuid,
      current_setting('wacrm.flowhandoff.run_no')::uuid,
      current_setting('wacrm.flowhandoff.event_b')::uuid,
      0, 'tenant'
    );
    RAISE EXCEPTION 'Cross-tenant Flow run was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF (SELECT status FROM public.conversations WHERE id = current_setting('wacrm.flowhandoff.conversation_no')::uuid) <> 'pending'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_no')::uuid) <> 'handed_off'
     OR (SELECT status FROM public.flow_runs WHERE id = current_setting('wacrm.flowhandoff.run_b')::uuid) <> 'active'
     OR EXISTS (SELECT 1 FROM public.flow_run_events
                 WHERE flow_run_id = current_setting('wacrm.flowhandoff.run_b')::uuid
                   AND evolution_event_id = current_setting('wacrm.flowhandoff.event_b')::uuid) THEN
    RAISE EXCEPTION 'Cross-tenant run check changed state';
  END IF;
END;
$handoff_assertions$;

ROLLBACK;
