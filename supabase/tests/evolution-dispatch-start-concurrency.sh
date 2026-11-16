#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker --context colima-wacrm exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACCOUNT_ID=
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CONTACT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CONVERSATION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
EVENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
DISPATCH_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ROOT_TOKEN=$(uuidgen | tr '[:upper:]' '[:lower:]')
TMP_DIR=$(mktemp -d)
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.automation_logs WHERE automation_id = '$AUTOMATION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.evolution_event_dispatches WHERE id = '$DISPATCH_ID'::uuid;
DELETE FROM public.evolution_events WHERE id = '$EVENT_ID'::uuid;
DELETE FROM public.automations WHERE id = '$AUTOMATION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.messages WHERE provider_connection_id = '$CONNECTION_ID'::uuid;
DELETE FROM public.conversations WHERE id = '$CONVERSATION_ID'::uuid;
DELETE FROM public.contacts WHERE id = '$CONTACT_ID'::uuid;
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.accounts WHERE id = '$ACCOUNT_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE id='$ACCOUNT_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.contacts WHERE id='$CONTACT_ID'::uuid) + (SELECT count(*) FROM public.conversations WHERE id='$CONVERSATION_ID'::uuid) + (SELECT count(*) FROM public.automations WHERE id='$AUTOMATION_ID'::uuid) + (SELECT count(*) FROM public.evolution_events WHERE id='$EVENT_ID'::uuid) + (SELECT count(*) FROM public.evolution_event_dispatches WHERE id='$DISPATCH_ID'::uuid) + (SELECT count(*) FROM public.automation_logs WHERE automation_id='$AUTOMATION_ID'::uuid AND account_id='$ACCOUNT_ID'::uuid);")
    if [[ "$remaining" != 0 ]]; then
      printf 'cleanup verification failed: %s fixture rows remain\n' "$remaining" >&2
      exit_status=1
    fi
  fi
  rm -rf "$TMP_DIR"
  exit "$exit_status"
}
trap cleanup EXIT

ACCOUNT_ID=$("${PSQL[@]}" <<SQL
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data)
VALUES ('$USER_ID'::uuid, 'authenticated', 'authenticated', '$USER_ID@fixture.invalid', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"T12 start concurrency synthetic"}'::jsonb);
SELECT account_id FROM public.profiles WHERE user_id = '$USER_ID'::uuid;
SQL
)
if [[ -z "$ACCOUNT_ID" ]]; then
  printf 'synthetic account was not created\n' >&2
  exit 1
fi
CLEANUP_NEEDED=1

"${PSQL[@]}" <<SQL >/dev/null
INSERT INTO public.whatsapp_connections (id, account_id, created_by, base_url, instance_name,
                                          token_encrypted, webhook_secret_encrypted)
VALUES ('$CONNECTION_ID'::uuid, '$ACCOUNT_ID'::uuid, '$USER_ID'::uuid, 'http://127.0.0.1:8080',
        't12-start-race-$DISPATCH_ID', 'fixture-placeholder-not-a-secret', 'fixture-placeholder-not-a-secret');
INSERT INTO public.contacts (id, user_id, account_id, phone, name)
VALUES ('$CONTACT_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid, '+15550000021', 'T12 start race');
INSERT INTO public.conversations (id, user_id, account_id, contact_id, status)
VALUES ('$CONVERSATION_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid, '$CONTACT_ID'::uuid, 'open');
INSERT INTO public.automations (id, user_id, account_id, name, trigger_type, is_active)
VALUES ('$AUTOMATION_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid,
        'T12 start race', 'new_message_received', true);
INSERT INTO public.evolution_events (id, connection_id, event_key, normalized_event, state, processed_at)
VALUES ('$EVENT_ID'::uuid, '$CONNECTION_ID'::uuid, 't12:start-race:$DISPATCH_ID',
        jsonb_build_object('kind','message','eventKey','t12:start-race:$DISPATCH_ID',
          'externalMessageId','fixture-message-$DISPATCH_ID','peer','15550000021@s.whatsapp.net',
          'occurredAt',now()::text,'fromMe',false,'sentByApi',false,'contentType','text',
          'text','synthetic message','mediaRef',null), 'done', now());
INSERT INTO public.messages (id, conversation_id, sender_type, content_type, content_text,
                             message_id, provider_connection_id)
VALUES (gen_random_uuid(), '$CONVERSATION_ID'::uuid, 'customer', 'text', 'synthetic message',
        'fixture-message-$DISPATCH_ID', '$CONNECTION_ID'::uuid);
INSERT INTO public.evolution_event_dispatches (id, event_id, account_id, engine, automation_id,
    user_id, contact_id, conversation_id, state, attempts, lease_until, lease_token)
VALUES ('$DISPATCH_ID'::uuid, '$EVENT_ID'::uuid, '$ACCOUNT_ID'::uuid, 'automation', '$AUTOMATION_ID'::uuid,
    '$USER_ID'::uuid, '$CONTACT_ID'::uuid, '$CONVERSATION_ID'::uuid,
    'processing', 1, now() + interval '2 minutes', '$ROOT_TOKEN'::uuid);
SQL

start_and_hold() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/session-a.out"
BEGIN;
SET LOCAL ROLE service_role;
SELECT dispatch_id::text || '|' || automation_log_id::text || '|' || state
  FROM public.start_evolution_event_dispatch('$DISPATCH_ID'::uuid, '$ROOT_TOKEN'::uuid);
SELECT pg_sleep(1);
COMMIT;
SQL
}
replay_waiting() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/session-b.out"
BEGIN;
SET LOCAL ROLE service_role;
SELECT dispatch_id::text || '|' || automation_log_id::text || '|' || state
  FROM public.start_evolution_event_dispatch('$DISPATCH_ID'::uuid, '$ROOT_TOKEN'::uuid);
COMMIT;
SQL
}

start_and_hold &
SESSION_A_PID=$!
sleep 0.15
replay_waiting &
SESSION_B_PID=$!
wait "$SESSION_A_PID"
wait "$SESSION_B_PID"

RESULT_A=$(rg '^[0-9a-f-]{36}\|[0-9a-f-]{36}\|processing$' "$TMP_DIR/session-a.out" | head -1)
RESULT_B=$(rg '^[0-9a-f-]{36}\|[0-9a-f-]{36}\|processing$' "$TMP_DIR/session-b.out" | head -1)
if [[ -z "$RESULT_A" || "$RESULT_A" != "$RESULT_B" ]]; then
  printf 'concurrent replay returned different start rows\nA: %s\nB: %s\n' "$RESULT_A" "$RESULT_B" >&2
  exit 1
fi

ROW_COUNTS=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM public.automation_logs WHERE evolution_dispatch_id='$DISPATCH_ID'::uuid) || '|' || (SELECT count(*) FROM public.evolution_event_dispatches WHERE id='$DISPATCH_ID'::uuid AND automation_log_id IS NOT NULL);")
if [[ "$ROW_COUNTS" != '1|1' ]]; then
  printf 'concurrent replay did not leave exactly one linked log: %s\n' "$ROW_COUNTS" >&2
  exit 1
fi
printf 'concurrent start replay passed; one linked automation log\n'
