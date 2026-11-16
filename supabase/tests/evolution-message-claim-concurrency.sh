#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
FIXTURE_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
TMP_DIR=$(mktemp -d)
ACCOUNT_ID=
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.accounts WHERE owner_user_id = '$USER_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE owner_user_id='$USER_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.evolution_events WHERE connection_id='$CONNECTION_ID'::uuid AND event_key LIKE 'message:claim-concurrency:$FIXTURE_KEY:%');")
    if [[ "$remaining" != 0 ]]; then
      printf 'cleanup verification failed: %s fixture rows remain\n' "$remaining" >&2
      exit_status=1
    fi
  fi
  rm -rf "$TMP_DIR"
  exit "$exit_status"
}
trap cleanup EXIT

PREEXISTING_DUE=$("${PSQL[@]}" -c "SELECT count(*) FROM public.evolution_events WHERE normalized_event ->> 'kind' = 'message' AND ((state = 'pending' AND next_attempt_at <= clock_timestamp()) OR (state = 'processing' AND lease_until <= clock_timestamp()));")
if [[ "$PREEXISTING_DUE" != 0 ]]; then
  printf 'concurrency fixture refused: %s preexisting due message events in local queue\n' "$PREEXISTING_DUE" >&2
  exit 1
fi

ACCOUNT_ID=$("${PSQL[@]}" <<SQL
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('$USER_ID'::uuid, 'authenticated', 'authenticated', '$USER_ID@fixture.invalid', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T09 message claim synthetic"}'::jsonb);
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
VALUES ('$CONNECTION_ID'::uuid, '$ACCOUNT_ID'::uuid, '$USER_ID'::uuid, 'http://127.0.0.1:8080', 't09-message-claim-$FIXTURE_KEY', 'synthetic', 'synthetic');
INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, attempts, next_attempt_at)
SELECT '$CONNECTION_ID'::uuid, 'message:claim-concurrency:$FIXTURE_KEY:' || series::text,
       jsonb_build_object('kind','message','eventKey','message:claim-concurrency:$FIXTURE_KEY:' || series::text),
       'pending', 0, '-infinity'::timestamptz
  FROM generate_series(1, 12) AS series;
INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, attempts, next_attempt_at)
VALUES ('$CONNECTION_ID'::uuid, 'connection:claim-concurrency:$FIXTURE_KEY',
        jsonb_build_object('kind','connection','eventKey','connection:claim-concurrency:$FIXTURE_KEY'),
        'pending', 0, '-infinity'::timestamptz);
SQL

run_claim() {
  local delay=$1 output=$2
  "${PSQL[@]}" <<SQL >"$output"
BEGIN;
SET LOCAL ROLE service_role;
SELECT id FROM public.claim_evolution_message_events(6, 30);
SELECT pg_sleep($delay);
COMMIT;
SQL
}

run_claim 1 "$TMP_DIR/a.out" &
SESSION_A_PID=$!
sleep 0.2
run_claim 0 "$TMP_DIR/b.out" &
SESSION_B_PID=$!
wait "$SESSION_A_PID"
wait "$SESSION_B_PID"

grep -E '^[0-9a-f-]{36}$' "$TMP_DIR/a.out" | sort > "$TMP_DIR/a.ids"
grep -E '^[0-9a-f-]{36}$' "$TMP_DIR/b.out" | sort > "$TMP_DIR/b.ids"
if [[ $(wc -l < "$TMP_DIR/a.ids" | tr -d ' ') != 6 || $(wc -l < "$TMP_DIR/b.ids" | tr -d ' ') != 6 ]]; then
  printf 'concurrent message claims did not each return six rows\n' >&2
  exit 1
fi
if comm -12 "$TMP_DIR/a.ids" "$TMP_DIR/b.ids" | grep -q .; then
  printf 'concurrent message claims returned overlapping event IDs\n' >&2
  exit 1
fi

COUNTS=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.evolution_events WHERE connection_id='$CONNECTION_ID'::uuid AND event_key LIKE 'message:claim-concurrency:$FIXTURE_KEY:%' AND state='processing' AND attempts=1 AND lease_token IS NOT NULL),
  (SELECT count(DISTINCT lease_token) FROM public.evolution_events WHERE connection_id='$CONNECTION_ID'::uuid AND event_key LIKE 'message:claim-concurrency:$FIXTURE_KEY:%'),
  (SELECT count(*) FROM public.evolution_events WHERE connection_id='$CONNECTION_ID'::uuid AND event_key='connection:claim-concurrency:$FIXTURE_KEY' AND state='pending' AND attempts=0 AND lease_token IS NULL);
SQL
)
if [[ "$COUNTS" != '12|12|1' ]]; then
  printf 'concurrent message claim state unexpected: %s\n' "$COUNTS" >&2
  exit 1
fi
printf 'T09.message-claim.concurrent PASS (6 + 6 disjoint claims; counts: %s)\n' "$COUNTS"
