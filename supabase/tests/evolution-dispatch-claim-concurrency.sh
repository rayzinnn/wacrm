#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACCOUNT_ID=
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
FIXTURE_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
TMP_DIR=$(mktemp -d)
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.evolution_event_dispatches WHERE account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.evolution_events WHERE connection_id = '$CONNECTION_ID'::uuid AND event_key LIKE 't12:concurrency:$FIXTURE_KEY:%';
DELETE FROM public.automations WHERE id = '$AUTOMATION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.accounts WHERE owner_user_id = '$USER_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE owner_user_id='$USER_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.automations WHERE id='$AUTOMATION_ID'::uuid) + (SELECT count(*) FROM public.evolution_events WHERE connection_id='$CONNECTION_ID'::uuid AND event_key LIKE 't12:concurrency:$FIXTURE_KEY:%') + (SELECT count(*) FROM public.evolution_event_dispatches WHERE account_id='$ACCOUNT_ID'::uuid);")
    if [[ "$remaining" != 0 ]]; then
      printf 'cleanup verification failed: %s fixture rows remain\n' "$remaining" >&2
      exit_status=1
    fi
  fi
  rm -rf "$TMP_DIR"
  exit "$exit_status"
}
trap cleanup EXIT

PREEXISTING_DUE=$("${PSQL[@]}" -c "SELECT count(*) FROM public.evolution_event_dispatches WHERE (state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp());")
if [[ "$PREEXISTING_DUE" != 0 ]]; then
  printf 'concurrency fixture refused: %s preexisting due dispatch roots in local queue\n' "$PREEXISTING_DUE" >&2
  exit 1
fi

ACCOUNT_ID=$("${PSQL[@]}" <<SQL
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('$USER_ID'::uuid, 'authenticated', 'authenticated', '$USER_ID@fixture.invalid', '', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"T12 dispatch concurrency synthetic"}'::jsonb);
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
VALUES ('$CONNECTION_ID'::uuid, '$ACCOUNT_ID'::uuid, '$USER_ID'::uuid, 'http://127.0.0.1:8080', 't12-dispatch-$FIXTURE_KEY', 'synthetic', 'synthetic');
INSERT INTO public.automations (id, user_id, account_id, name, trigger_type, is_active)
VALUES ('$AUTOMATION_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid, 'T12 dispatch concurrency synthetic', 'inbound_message', true);
INSERT INTO public.evolution_events (connection_id, event_key, normalized_event, state, processed_at, next_attempt_at)
SELECT '$CONNECTION_ID'::uuid, 't12:concurrency:$FIXTURE_KEY:' || series::text,
       jsonb_build_object('kind','message','eventKey','t12:concurrency:$FIXTURE_KEY:' || series::text),
       'done', now(), '-infinity'::timestamptz
  FROM generate_series(1, 12) AS series;
INSERT INTO public.evolution_event_dispatches (event_id, account_id, engine, automation_id, user_id, state, attempts, next_attempt_at)
SELECT e.id, '$ACCOUNT_ID'::uuid, 'automation', '$AUTOMATION_ID'::uuid,
       '$USER_ID'::uuid, 'pending', 0, '-infinity'::timestamptz
  FROM public.evolution_events AS e
 WHERE e.connection_id = '$CONNECTION_ID'::uuid
   AND e.event_key LIKE 't12:concurrency:$FIXTURE_KEY:%';
SQL

run_claim() {
  local delay=$1 output=$2
  "${PSQL[@]}" <<SQL >"$output"
BEGIN;
SET LOCAL ROLE service_role;
SELECT id FROM public.claim_evolution_dispatches(6, 30);
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
  printf 'concurrent dispatch claims did not each return six roots\n' >&2
  exit 1
fi
if comm -12 "$TMP_DIR/a.ids" "$TMP_DIR/b.ids" | grep -q .; then
  printf 'concurrent dispatch claims returned overlapping IDs\n' >&2
  exit 1
fi

COUNTS=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.evolution_event_dispatches WHERE account_id='$ACCOUNT_ID'::uuid AND state='processing' AND attempts=1 AND lease_token IS NOT NULL),
  (SELECT count(DISTINCT lease_token) FROM public.evolution_event_dispatches WHERE account_id='$ACCOUNT_ID'::uuid),
  (SELECT count(*) FROM public.evolution_event_dispatches WHERE account_id='$ACCOUNT_ID'::uuid AND state <> 'processing');
SQL
)
if [[ "$COUNTS" != '12|12|0' ]]; then
  printf 'concurrent dispatch claim state unexpected: %s\n' "$COUNTS" >&2
  exit 1
fi
printf 'T12.dispatch-claim.concurrent PASS (6 + 6 disjoint claims; counts: %s)\n' "$COUNTS"
