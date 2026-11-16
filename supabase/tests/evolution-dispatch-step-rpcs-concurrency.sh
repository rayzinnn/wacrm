#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker --context colima-wacrm exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACCOUNT_ID=
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
EVENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
DISPATCH_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ROOT_TOKEN=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACTION_KEY="fixture:concurrent:$DISPATCH_ID"
TMP_DIR=$(mktemp -d)
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.evolution_event_dispatches WHERE id = '$DISPATCH_ID'::uuid;
DELETE FROM public.evolution_events WHERE id = '$EVENT_ID'::uuid;
DELETE FROM public.automations WHERE id = '$AUTOMATION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.accounts WHERE id = '$ACCOUNT_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE id='$ACCOUNT_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.automations WHERE id='$AUTOMATION_ID'::uuid) + (SELECT count(*) FROM public.evolution_events WHERE id='$EVENT_ID'::uuid) + (SELECT count(*) FROM public.evolution_event_dispatches WHERE id='$DISPATCH_ID'::uuid) + (SELECT count(*) FROM public.evolution_dispatch_steps WHERE dispatch_id='$DISPATCH_ID'::uuid);")
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
        '{"full_name":"T12 step RPC concurrency synthetic"}'::jsonb);
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
        't12-step-concurrency-$DISPATCH_ID', 'fixture-placeholder-not-a-secret',
        'fixture-placeholder-not-a-secret');
INSERT INTO public.automations (id, user_id, account_id, name, trigger_type, is_active)
VALUES ('$AUTOMATION_ID'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid,
        'T12 step RPC concurrency synthetic', 'inbound_message', true);
INSERT INTO public.evolution_events (id, connection_id, event_key, normalized_event, state, processed_at)
VALUES ('$EVENT_ID'::uuid, '$CONNECTION_ID'::uuid, 't12:step-rpc-concurrency:$DISPATCH_ID',
        '{"kind":"message"}'::jsonb, 'done', now());
INSERT INTO public.evolution_event_dispatches (id, event_id, account_id, engine, automation_id,
                                                user_id, state, attempts, lease_until, lease_token)
VALUES ('$DISPATCH_ID'::uuid, '$EVENT_ID'::uuid, '$ACCOUNT_ID'::uuid, 'automation',
        '$AUTOMATION_ID'::uuid, '$USER_ID'::uuid, 'processing', 1, now() + interval '2 minutes',
        '$ROOT_TOKEN'::uuid);
SQL

run_claim() {
  local delay=$1 output=$2
  "${PSQL[@]}" <<SQL >"$output"
BEGIN;
SET LOCAL ROLE service_role;
SELECT step_id::text || '|' || should_execute::text
  FROM public.claim_evolution_dispatch_step(
    '$DISPATCH_ID'::uuid, '$ROOT_TOKEN'::uuid, '$ACTION_KEY', 30
  );
SELECT pg_sleep($delay);
COMMIT;
SQL
}

run_claim 1 "$TMP_DIR/a.out" &
SESSION_A_PID=$!
sleep 0.15
run_claim 0 "$TMP_DIR/b.out" &
SESSION_B_PID=$!
wait "$SESSION_A_PID"
wait "$SESSION_B_PID"

grep -E '^[0-9a-f-]{36}\|(t|f|true|false)$' "$TMP_DIR/a.out" > "$TMP_DIR/a.claim" || {
  printf 'session A output:\n' >&2
  cat "$TMP_DIR/a.out" >&2
  exit 1
}
grep -E '^[0-9a-f-]{36}\|(t|f|true|false)$' "$TMP_DIR/b.out" > "$TMP_DIR/b.claim" || {
  printf 'session B output:\n' >&2
  cat "$TMP_DIR/b.out" >&2
  exit 1
}
if [[ $(wc -l < "$TMP_DIR/a.claim" | tr -d ' ') != 1 || $(wc -l < "$TMP_DIR/b.claim" | tr -d ' ') != 1 ]]; then
  printf 'two-session step claims did not each return one row\n' >&2
  exit 1
fi
STEP_A=$(cut -d '|' -f1 "$TMP_DIR/a.claim")
STEP_B=$(cut -d '|' -f1 "$TMP_DIR/b.claim")
EXECUTABLES=$(cat "$TMP_DIR/a.claim" "$TMP_DIR/b.claim" | awk -F'|' '$2 == "t" || $2 == "true" {n++} END {print n+0}')
if [[ "$STEP_A" != "$STEP_B" || "$EXECUTABLES" != 1 ]]; then
  printf 'racing claims did not share one step with exactly one executor\n' >&2
  exit 1
fi

STATE=$("${PSQL[@]}" -c "SELECT state || '|' || attempts || '|' || (lease_token IS NOT NULL) FROM public.evolution_dispatch_steps WHERE id='$STEP_A'::uuid;")
if [[ "$STATE" != 'processing|1|true' ]]; then
  printf 'concurrent step claim state unexpected: %s\n' "$STATE" >&2
  exit 1
fi
printf 'T12.dispatch-step-rpcs.concurrent PASS (two sessions, one executor; state: %s; cleanup verified)\n' "$STATE"
