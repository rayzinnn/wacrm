#!/usr/bin/env bash
set -euo pipefail

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

DB_CONTAINER=supabase_db_wacrm-local
PSQL=(docker --context colima-wacrm exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1)
USER_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACCOUNT_ID=
CONNECTION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
AUTOMATION_B=$(uuidgen | tr '[:upper:]' '[:lower:]')
EVENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
DISPATCH_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
DISPATCH_B=$(uuidgen | tr '[:upper:]' '[:lower:]')
TOKEN_A=$(uuidgen | tr '[:upper:]' '[:lower:]')
TOKEN_B=$(uuidgen | tr '[:upper:]' '[:lower:]')
ACTION_KEY="fixture:complete-race:$DISPATCH_A"
TMP_DIR=$(mktemp -d)
CLEANUP_NEEDED=0

cleanup() {
  local exit_status=$?
  if [[ "$CLEANUP_NEEDED" == 1 && -n "$ACCOUNT_ID" ]]; then
    "${PSQL[@]}" <<SQL >/dev/null
DELETE FROM public.evolution_event_dispatches WHERE id IN ('$DISPATCH_A'::uuid, '$DISPATCH_B'::uuid);
DELETE FROM public.evolution_events WHERE id = '$EVENT_ID'::uuid;
DELETE FROM public.automations WHERE id IN ('$AUTOMATION_A'::uuid, '$AUTOMATION_B'::uuid)
  AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.whatsapp_connections WHERE id = '$CONNECTION_ID'::uuid AND account_id = '$ACCOUNT_ID'::uuid;
DELETE FROM public.accounts WHERE id = '$ACCOUNT_ID'::uuid;
DELETE FROM auth.users WHERE id = '$USER_ID'::uuid;
SQL
    local remaining
    remaining=$("${PSQL[@]}" -c "SELECT (SELECT count(*) FROM auth.users WHERE id='$USER_ID'::uuid) + (SELECT count(*) FROM public.accounts WHERE id='$ACCOUNT_ID'::uuid) + (SELECT count(*) FROM public.whatsapp_connections WHERE id='$CONNECTION_ID'::uuid) + (SELECT count(*) FROM public.automations WHERE id IN ('$AUTOMATION_A'::uuid, '$AUTOMATION_B'::uuid)) + (SELECT count(*) FROM public.evolution_events WHERE id='$EVENT_ID'::uuid) + (SELECT count(*) FROM public.evolution_event_dispatches WHERE id IN ('$DISPATCH_A'::uuid, '$DISPATCH_B'::uuid)) + (SELECT count(*) FROM public.evolution_dispatch_steps WHERE dispatch_id IN ('$DISPATCH_A'::uuid, '$DISPATCH_B'::uuid));")
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
        '{"full_name":"T12 complete concurrency synthetic"}'::jsonb);
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
        't12-complete-race-$DISPATCH_A', 'fixture-placeholder-not-a-secret',
        'fixture-placeholder-not-a-secret');
INSERT INTO public.automations (id, user_id, account_id, name, trigger_type, is_active)
VALUES ('$AUTOMATION_A'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid,
        'T12 complete race A', 'inbound_message', true),
       ('$AUTOMATION_B'::uuid, '$USER_ID'::uuid, '$ACCOUNT_ID'::uuid,
        'T12 complete race B', 'inbound_message', true);
INSERT INTO public.evolution_events (id, connection_id, event_key, normalized_event, state, processed_at)
VALUES ('$EVENT_ID'::uuid, '$CONNECTION_ID'::uuid, 't12:complete-race:$DISPATCH_A',
        '{"kind":"message"}'::jsonb, 'done', now());
INSERT INTO public.evolution_event_dispatches (id, event_id, account_id, engine, automation_id,
                                                user_id, state, attempts, lease_until, lease_token)
VALUES ('$DISPATCH_A'::uuid, '$EVENT_ID'::uuid, '$ACCOUNT_ID'::uuid, 'automation',
        '$AUTOMATION_A'::uuid, '$USER_ID'::uuid, 'processing', 1, now() + interval '2 minutes', '$TOKEN_A'::uuid),
       ('$DISPATCH_B'::uuid, '$EVENT_ID'::uuid, '$ACCOUNT_ID'::uuid, 'automation',
        '$AUTOMATION_B'::uuid, '$USER_ID'::uuid, 'processing', 1, now() + interval '2 minutes', '$TOKEN_B'::uuid);
SQL

# A step claim wins the root lock; completion waits, sees the processing step,
# and must leave the root processing.
claim_step_first() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/claim.out"
BEGIN;
SET LOCAL ROLE service_role;
SELECT step_id::text || '|' || should_execute::text
  FROM public.claim_evolution_dispatch_step('$DISPATCH_A'::uuid, '$TOKEN_A'::uuid, '$ACTION_KEY', 30);
SELECT pg_sleep(1);
COMMIT;
SQL
}
complete_waiting_for_step() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/complete-wait.out"
BEGIN;
SET LOCAL ROLE service_role;
DO \$block\$
BEGIN
  PERFORM public.complete_evolution_dispatch('$DISPATCH_A'::uuid, '$TOKEN_A'::uuid, 'done');
  RAISE EXCEPTION 'unexpected root completion' USING ERRCODE = 'P0001';
EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
END;
\$block\$;
COMMIT;
SQL
}

claim_step_first &
SESSION_A_PID=$!
sleep 0.15
complete_waiting_for_step &
SESSION_B_PID=$!
wait "$SESSION_A_PID"
wait "$SESSION_B_PID"
if ! grep -Eq '^[0-9a-f-]{36}\|(t|true)$' "$TMP_DIR/claim.out"; then
  printf 'step-first session did not acquire one executable step\n' >&2
  cat "$TMP_DIR/claim.out" >&2
  exit 1
fi
ROOT_A_STATE=$("${PSQL[@]}" -c "SELECT state || '|' || (SELECT count(*) FROM public.evolution_dispatch_steps WHERE dispatch_id='$DISPATCH_A'::uuid AND state='processing') FROM public.evolution_event_dispatches WHERE id='$DISPATCH_A'::uuid;")
if [[ "$ROOT_A_STATE" != 'processing|1' ]]; then
  printf 'step-first race state unexpected: %s\n' "$ROOT_A_STATE" >&2
  exit 1
fi

# Root completion wins the lock; a waiting step claim must see a terminal root.
complete_root_first() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/root-first.out"
BEGIN;
SET LOCAL ROLE service_role;
SELECT (public.complete_evolution_dispatch('$DISPATCH_B'::uuid, '$TOKEN_B'::uuid, 'done')).state;
SELECT pg_sleep(1);
COMMIT;
SQL
}
claim_after_root_complete() {
  "${PSQL[@]}" <<SQL >"$TMP_DIR/claim-after.out"
BEGIN;
SET LOCAL ROLE service_role;
DO \$block\$
BEGIN
  PERFORM * FROM public.claim_evolution_dispatch_step('$DISPATCH_B'::uuid, '$TOKEN_B'::uuid, 'fixture:after-complete', 30);
  RAISE EXCEPTION 'unexpected step claim' USING ERRCODE = 'P0001';
EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
END;
\$block\$;
COMMIT;
SQL
}

complete_root_first &
SESSION_C_PID=$!
sleep 0.15
claim_after_root_complete &
SESSION_D_PID=$!
wait "$SESSION_C_PID"
wait "$SESSION_D_PID"
ROOT_B_STATE=$("${PSQL[@]}" -c "SELECT state || '|' || (SELECT count(*) FROM public.evolution_dispatch_steps WHERE dispatch_id='$DISPATCH_B'::uuid) FROM public.evolution_event_dispatches WHERE id='$DISPATCH_B'::uuid;")
if [[ "$ROOT_B_STATE" != 'done|0' ]]; then
  printf 'root-first race state unexpected: %s\n' "$ROOT_B_STATE" >&2
  exit 1
fi

printf 'T12.dispatch-complete.concurrent PASS (step-first blocks completion; root-first blocks claim; cleanup verified)\n'
