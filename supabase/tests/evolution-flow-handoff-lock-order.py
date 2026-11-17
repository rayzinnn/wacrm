"""Local two-session lock-order regression for Flow handoff vs dispatch start."""

from __future__ import annotations

import re
import subprocess
import time
import uuid


DB_CONTAINER = "supabase_db_wacrm-local"
DOCKER = ["docker", "--context", "colima-wacrm", "exec", "-i", DB_CONTAINER]
PSQL = ["psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]


def run_sql(sql: str) -> str:
    result = subprocess.run(DOCKER + PSQL, input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"local SQL command failed (exit {result.returncode})")
    return result.stdout + result.stderr


suffix = uuid.uuid4().hex
app_start = f"t12_handoff_start_{suffix}"
app_handoff = f"t12_handoff_effect_{suffix}"
fixture: dict[str, str] | None = None
start_session: subprocess.Popen[str] | None = None
handoff_session: subprocess.Popen[str] | None = None

setup_sql = """
DO $fixture$
DECLARE
  v_user uuid := pg_catalog.gen_random_uuid();
  v_account uuid;
  v_flow uuid;
  v_connection uuid;
  v_contact uuid;
  v_conversation uuid;
  v_run uuid;
  v_start_event uuid;
  v_handoff_event uuid;
  v_message_id text := 'synthetic-handoff-race-{suffix}';
  v_start_dispatch uuid := pg_catalog.gen_random_uuid();
  v_start_token uuid := pg_catalog.gen_random_uuid();
  v_handoff_dispatch uuid := pg_catalog.gen_random_uuid();
  v_handoff_token uuid := pg_catalog.gen_random_uuid();
  v_step uuid := pg_catalog.gen_random_uuid();
  v_step_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user, 'authenticated', 'authenticated',
    v_user::text || '@flow-handoff-race.invalid', '', pg_catalog.now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Synthetic handoff race"}'::jsonb
  );
  SELECT p.account_id INTO STRICT v_account FROM public.profiles AS p WHERE p.user_id = v_user;
  INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, trigger_config, entry_node_id)
  VALUES (v_user, v_account, 'Synthetic handoff race', 'active', 'keyword', '{"keywords":["race"]}', 'handoff')
  RETURNING id INTO v_flow;
  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config)
  VALUES (v_flow, 'handoff', 'handoff', '{"note":"synthetic race"}'::jsonb);
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, provider, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_account, v_user, 'evolution', 'http://127.0.0.1:8080',
    'synthetic-handoff-race-{suffix}', 'synthetic', 'synthetic'
  ) RETURNING id INTO v_connection;
  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (v_user, v_account, '+15550109999', 'Synthetic handoff race') RETURNING id INTO v_contact;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (v_user, v_account, v_contact, 'open') RETURNING id INTO v_conversation;
  INSERT INTO public.flow_runs (
    flow_id, account_id, user_id, contact_id, conversation_id,
    status, current_node_key, transition_seq
  ) VALUES (v_flow, v_account, v_user, v_contact, v_conversation, 'active', 'handoff', 0)
  RETURNING id INTO v_run;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (
    v_connection, 'synthetic-handoff-start-{suffix}',
    pg_catalog.jsonb_build_object(
      'kind', 'message', 'contentType', 'text', 'fromMe', false, 'sentByApi', false,
      'externalMessageId', v_message_id, 'text', 'synthetic'
    ), 'done', pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_start_event;
  INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at)
  VALUES (
    v_connection, 'synthetic-handoff-effect-{suffix}',
    '{"kind":"message","contentType":"text","fromMe":false,"sentByApi":false,"text":"synthetic"}'::jsonb,
    'done', pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_handoff_event;
  INSERT INTO public.messages (
    conversation_id, sender_type, content_type, content_text, message_id,
    status, provider_connection_id
  ) VALUES (v_conversation, 'customer', 'text', 'synthetic', v_message_id, 'read', v_connection);
  INSERT INTO public.evolution_event_dispatches (
    id, event_id, account_id, engine, flow_id, user_id, flow_run_id,
    contact_id, conversation_id, state, attempts, lease_until, lease_token
  ) VALUES
    (v_start_dispatch, v_start_event, v_account, 'flow', v_flow, v_user, NULL,
     v_contact, v_conversation, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_start_token),
    (v_handoff_dispatch, v_handoff_event, v_account, 'flow', v_flow, v_user, v_run,
     v_contact, v_conversation, 'processing', 1, pg_catalog.clock_timestamp() + interval '5 minutes', v_handoff_token);
  INSERT INTO public.evolution_dispatch_steps (
    id, dispatch_id, action_key, state, attempts, lease_until, lease_token, request_id
  ) VALUES (
    v_step, v_handoff_dispatch, '0:handoff', 'processing', 1,
    pg_catalog.clock_timestamp() + interval '5 minutes', v_step_token,
    'evolution-step:' || v_step::text
  );
  RAISE NOTICE 'FLOW_RACE_FIXTURE=%', pg_catalog.concat_ws('|',
    v_user, v_account, v_flow, v_connection, v_contact, v_conversation, v_run,
    v_start_event, v_handoff_event, v_message_id, v_start_dispatch, v_start_token,
    v_handoff_dispatch, v_handoff_token, v_step, v_step_token
  );
END;
$fixture$;
""".replace("{suffix}", suffix)


def cleanup(values: dict[str, str]) -> None:
    run_sql(f"""
    BEGIN;
    DELETE FROM public.evolution_event_dispatches WHERE id IN ('{values['start_dispatch']}', '{values['handoff_dispatch']}');
    DELETE FROM public.messages WHERE message_id = '{values['message_id']}';
    DELETE FROM public.evolution_events WHERE id IN ('{values['start_event']}', '{values['handoff_event']}');
    DELETE FROM public.flow_runs WHERE id = '{values['run']}';
    DELETE FROM public.conversations WHERE id = '{values['conversation']}';
    DELETE FROM public.contacts WHERE id = '{values['contact']}';
    DELETE FROM public.flow_nodes WHERE flow_id = '{values['flow']}';
    DELETE FROM public.flows WHERE id = '{values['flow']}';
    DELETE FROM public.whatsapp_connections WHERE id = '{values['connection']}';
    DELETE FROM public.accounts WHERE id = '{values['account']}';
    DELETE FROM auth.users WHERE id = '{values['user']}';
    COMMIT;
    """)
    residue = run_sql(f"""
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = '{values['user']}'
      UNION ALL SELECT 1 FROM public.accounts WHERE id = '{values['account']}'
      UNION ALL SELECT 1 FROM public.flows WHERE id = '{values['flow']}'
      UNION ALL SELECT 1 FROM public.whatsapp_connections WHERE id = '{values['connection']}'
      UNION ALL SELECT 1 FROM public.contacts WHERE id = '{values['contact']}'
      UNION ALL SELECT 1 FROM public.conversations WHERE id = '{values['conversation']}'
      UNION ALL SELECT 1 FROM public.flow_runs WHERE id = '{values['run']}'
      UNION ALL SELECT 1 FROM public.evolution_events WHERE id IN ('{values['start_event']}', '{values['handoff_event']}')
      UNION ALL SELECT 1 FROM public.evolution_event_dispatches WHERE id IN ('{values['start_dispatch']}', '{values['handoff_dispatch']}')
      UNION ALL SELECT 1 FROM public.evolution_dispatch_steps WHERE id = '{values['step']}'
      UNION ALL SELECT 1 FROM public.messages WHERE message_id = '{values['message_id']}'
    );
    """)
    if residue.strip().splitlines()[-1:] != ["t"]:
        raise RuntimeError("synthetic fixture cleanup left a residue")


try:
    setup_output = run_sql(setup_sql)
    match = re.search(r"FLOW_RACE_FIXTURE=([0-9a-f-]+\|[^\s]+)", setup_output)
    if not match:
        raise RuntimeError("synthetic fixture setup did not return its marker")
    names = (
        "user account flow connection contact conversation run start_event handoff_event "
        "message_id start_dispatch start_token handoff_dispatch handoff_token step step_token"
    ).split()
    fixture_values = match.group(1).split("|")
    if len(fixture_values) != len(names):
        raise RuntimeError("synthetic fixture marker has an unexpected shape")
    fixture = dict(zip(names, fixture_values))

    start_session = subprocess.Popen(
        DOCKER + PSQL,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert start_session.stdin is not None
    start_session.stdin.write(f"""
    SET application_name = '{app_start}';
    BEGIN;
    SET LOCAL ROLE service_role;
    SELECT true FROM public.conversations WHERE id = '{fixture['conversation']}' FOR SHARE;
    """)
    start_session.stdin.flush()

    handoff_sql = f"""
    SET application_name = '{app_handoff}';
    SET ROLE service_role;
    SELECT applied::text || '|' || transition_seq::text || '|' || status
      FROM public.complete_evolution_flow_handoff(
        '{fixture['handoff_dispatch']}', '{fixture['handoff_token']}',
        '{fixture['step']}', '{fixture['step_token']}', '{fixture['run']}',
        '{fixture['handoff_event']}', 0, 'handoff'
      );
    """
    handoff_session = subprocess.Popen(
        DOCKER + PSQL,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert handoff_session.stdin is not None
    handoff_session.stdin.write(handoff_sql)
    handoff_session.stdin.close()
    handoff_session.stdin = None

    waiting = False
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        result = run_sql(
            "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity "
            f"WHERE application_name = '{app_handoff}' AND wait_event_type = 'Lock');"
        )
        if result.strip().splitlines()[-1:] == ["t"]:
            waiting = True
            break
        if handoff_session.poll() is not None:
            break
        time.sleep(0.05)
    if not waiting:
        raise RuntimeError("handoff session did not block on the shared conversation")

    assert start_session.stdin is not None
    start_session.stdin.write(f"""
    SELECT state FROM public.start_evolution_event_dispatch(
      '{fixture['start_dispatch']}', '{fixture['start_token']}'
    );
    COMMIT;
    """)
    start_session.stdin.close()
    start_session.stdin = None

    start_output, _ = start_session.communicate(timeout=15)
    handoff_output, _ = handoff_session.communicate(timeout=15)
    if start_session.returncode or handoff_session.returncode:
        raise RuntimeError("one of the concurrent SQL sessions failed")
    if "processing" not in start_output or "true|1|handed_off" not in handoff_output:
        raise RuntimeError("the concurrent start/handoff result was unexpected")

    verification = run_sql(f"""
    SELECT (
      (SELECT status = 'handed_off' AND transition_seq = 1 FROM public.flow_runs WHERE id = '{fixture['run']}')
      AND (SELECT status = 'pending' FROM public.conversations WHERE id = '{fixture['conversation']}')
      AND (SELECT state = 'done' FROM public.evolution_dispatch_steps WHERE id = '{fixture['step']}')
      AND (SELECT flow_run_id = '{fixture['run']}' FROM public.evolution_event_dispatches WHERE id = '{fixture['start_dispatch']}')
      AND (SELECT count(*) = 1 FROM public.flow_run_events WHERE flow_run_id = '{fixture['run']}' AND evolution_event_id = '{fixture['handoff_event']}' AND event_type = 'handoff')
    );
    """)
    if verification.strip().splitlines()[-1:] != ["t"]:
        raise RuntimeError("concurrent SQL effects did not match the expected checkpoint")
finally:
    for session in (start_session, handoff_session):
        if session is not None and session.poll() is None:
            session.terminate()
            session.wait(timeout=5)
    if fixture is not None:
        cleanup(fixture)

print("PASS: concurrent start and handoff completed without deadlock; synthetic fixture removed")
