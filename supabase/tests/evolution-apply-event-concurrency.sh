#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
EVENT_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
EVENT_B=$(uuidgen | tr '[:upper:]' '[:lower:]')
TOKEN_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
TOKEN_B=$(uuidgen | tr '[:upper:]' '[:lower:]')
FIXTURE_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
PHONE=$(python3 -c 'import secrets; print("1555" + str(secrets.randbelow(10**10)).zfill(10))')
INSTANCE_NAME="t09-concurrency-${FIXTURE_KEY}"
TMP_DIR=$(mktemp -d)
ACCOUNT_ID=
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.evolution_events WHERE id IN ('$EVENT_A'::uuid, '$EVENT_B'::uuid) AND connection_id = '$CONNECTION_ID'::uuid;
DELETE FROM public.messages WHERE provider_connection_id = '$CONNECTION_ID'::uuid AND message_id = 't09-concurrency:$FIXTURE_KEY';
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.automations WHERE id = '$AUTOMATION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.contacts WHERE account_id = '$ACCOUNT_ID'::uuid AND phone_normalized = '$PHONE';
DELETE FROM public.accounts WHERE owner_user_id = '$USER_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE owner_user_id='$USER_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.evolution_events WHERE id IN ('$EVENT_A'::uuid,'$EVENT_B'::uuid)) + (SELECT count(*) FROM public.evolution_event_dispatches WHERE event_id IN ('$EVENT_A'::uuid,'$EVENT_B'::uuid)) + (SELECT count(*) FROM public.messages WHERE provider_connection_id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.automations WHERE id='$AUTOMATION_ID'::uuid) + (SELECT count(*) FROM public.contacts WHERE account_id='$ACCOUNT_ID'::uuid AND phone_normalized='$PHONE') + (SELECT count(*) FROM public.conversations AS c JOIN public.contacts AS t ON t.id=c.contact_id WHERE c.account_id='$ACCOUNT_ID'::uuid AND t.phone_normalized='$PHONE');")
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
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('$USER_ID'::uuid, 'authenticated', 'authenticated', '$USER_ID@fixture.invalid', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T09 concurrency synthetic"}'::jsonb);
SELECT account_id FROM public.profiles WHERE user_id = '$USER_ID'::uuid;
SQL
)
if [[ -z "$ACCOUNT_ID" ]]; then
  printf 'fixture account was not created\n' >&2
  exit 1
fi
CLEANUP_NEEDED=1
"${PSQL[@]}" <<SQL >/dev/null
INSERT INTO public.whatsapp_connections (id, account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted)
VALUES ('$CONNECTION_ID'::uuid, '$ACCOUNT_ID'::uuid, '$USER_ID'::uuid, 'http://127.0.0.1:8080', '$INSTANCE_NAME', 'synthetic', 'synthetic');
INSERT INTO public.automations (id, user_id, account_id, name, trigger_type, is_active)
VALUES ('$AUTOMATION_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid, 'T09 concurrency synthetic', 'inbound_message', true);
INSERT INTO public.evolution_events (id, connection_id, event_key, normalized_event, state, attempts, lease_until, lease_token)
VALUES
  ('$EVENT_A'::uuid, '$CONNECTION_ID'::uuid, 'message:concurrency-a:' || '$FIXTURE_KEY',
   jsonb_build_object('kind','message','eventKey','message:concurrency-a:' || '$FIXTURE_KEY',
     'externalMessageId','t09-concurrency:' || '$FIXTURE_KEY','peer','$PHONE@s.whatsapp.net',
     'occurredAt','2026-11-16T18:30:00.000Z','fromMe',false,'sentByApi',false,
     'contentType','text','text','concurrency inbound','mediaRef',NULL),
   'processing',1,clock_timestamp()+interval '60 seconds','$TOKEN_A'::uuid),
  ('$EVENT_B'::uuid, '$CONNECTION_ID'::uuid, 'message:concurrency-b:' || '$FIXTURE_KEY',
   jsonb_build_object('kind','message','eventKey','message:concurrency-b:' || '$FIXTURE_KEY',
     'externalMessageId','t09-concurrency:' || '$FIXTURE_KEY','peer','$PHONE@s.whatsapp.net',
     'occurredAt','2026-11-16T18:30:00.000Z','fromMe',false,'sentByApi',false,
     'contentType','text','text','concurrency inbound','mediaRef',NULL),
   'processing',1,clock_timestamp()+interval '60 seconds','$TOKEN_B'::uuid);
SQL

run_apply() {
  local event_id=$1 token=$2 delay=$3 output=$4
  "${PSQL[@]}" <<SQL >"$output"
BEGIN;
SET LOCAL ROLE service_role;
SELECT outcome || ':' || COALESCE(message_row_id::text, '')
  FROM public.apply_evolution_event('$event_id'::uuid, '$token'::uuid);
SELECT pg_sleep($delay);
COMMIT;
SQL
}

run_apply "$EVENT_A" "$TOKEN_A" 1 "$TMP_DIR/a.out" &
SESSION_A_PID=$!
sleep 0.2
run_apply "$EVENT_B" "$TOKEN_B" 0 "$TMP_DIR/b.out" &
SESSION_B_PID=$!
wait "$SESSION_A_PID"
wait "$SESSION_B_PID"

OUTCOME_A=$(head -n 1 "$TMP_DIR/a.out")
OUTCOME_B=$(head -n 1 "$TMP_DIR/b.out")
APPLIED_COUNT=$(printf '%s\n%s\n' "$OUTCOME_A" "$OUTCOME_B" | awk -F: '$1 == "applied" { count++ } END { print count+0 }')
DUPLICATE_COUNT=$(printf '%s\n%s\n' "$OUTCOME_A" "$OUTCOME_B" | awk -F: '$1 == "duplicate" { count++ } END { print count+0 }')
MESSAGE_ID_A=${OUTCOME_A#*:}
MESSAGE_ID_B=${OUTCOME_B#*:}
if [[ "$APPLIED_COUNT" != 1 || "$DUPLICATE_COUNT" != 1 || "$MESSAGE_ID_A" != "$MESSAGE_ID_B" ]]; then
  printf 'unexpected concurrent outcomes: A=%s B=%s\n' "$OUTCOME_A" "$OUTCOME_B" >&2
  exit 1
fi

COUNTS=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.messages AS m WHERE m.provider_connection_id = '$CONNECTION_ID'::uuid AND m.message_id = 't09-concurrency:$FIXTURE_KEY'),
  (SELECT count(*) FROM public.conversations AS c JOIN public.contacts AS t ON t.id = c.contact_id
    WHERE c.account_id = '$ACCOUNT_ID'::uuid AND t.phone_normalized = '$PHONE' AND c.unread_count = 1),
  (SELECT count(*) FROM public.evolution_event_dispatches AS d WHERE d.event_id IN ('$EVENT_A'::uuid,'$EVENT_B'::uuid) AND d.engine = 'automation' AND d.automation_id = '$AUTOMATION_ID'::uuid),
  (SELECT count(*) FROM public.evolution_events AS e WHERE e.id IN ('$EVENT_A'::uuid,'$EVENT_B'::uuid) AND e.state = 'done' AND e.lease_token IS NULL);
SQL
)
if [[ "$COUNTS" != $'1|1|1|2' ]]; then
  printf 'concurrent result counts unexpected: %s\n' "$COUNTS" >&2
  exit 1
fi
printf 'T09.apply.concurrent PASS (outcomes: %s, %s; counts: %s)\n' "$OUTCOME_A" "$OUTCOME_B" "$COUNTS"
