-- These fixtures and both RPC outcomes exist only inside this transaction.
-- The final ROLLBACK leaves configured accounts and their data untouched.
BEGIN;

DO $fixtures_and_assertions$
DECLARE
  v_busy_user uuid := gen_random_uuid();
  v_empty_user uuid := gen_random_uuid();
  v_target_owner uuid := gen_random_uuid();
  v_busy_account uuid;
  v_empty_account uuid;
  v_target_account uuid;
  v_connection_id uuid;
  v_busy_token text := 't06-guard-busy-' || gen_random_uuid()::text;
  v_empty_token text := 't06-guard-empty-' || gen_random_uuid()::text;
  v_returned_account uuid;
  v_busy_blocked boolean := false;
  v_sqlstate text;
  v_message text;
  v_account_after uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (v_busy_user, 'authenticated', 'authenticated', v_busy_user::text || '@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.guard personal account with connection"}'::jsonb),
    (v_empty_user, 'authenticated', 'authenticated', v_empty_user::text || '@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.guard empty personal account"}'::jsonb),
    (v_target_owner, 'authenticated', 'authenticated', v_target_owner::text || '@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06.guard disposable destination"}'::jsonb);

  SELECT account_id INTO STRICT v_busy_account FROM public.profiles WHERE user_id = v_busy_user;
  SELECT account_id INTO STRICT v_empty_account FROM public.profiles WHERE user_id = v_empty_user;
  SELECT account_id INTO STRICT v_target_account FROM public.profiles WHERE user_id = v_target_owner;

  INSERT INTO public.account_invitations (account_id, token_hash, role, created_by_user_id, expires_at)
  VALUES
    (v_target_account, v_busy_token, 'viewer', v_target_owner, now() + interval '1 hour'),
    (v_target_account, v_empty_token, 'viewer', v_target_owner, now() + interval '1 hour');

  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    v_busy_account, v_busy_user, 'http://127.0.0.1:8080',
    't06-guard-' || gen_random_uuid()::text,
    'synthetic-token-ciphertext', 'synthetic-webhook-ciphertext'
  ) RETURNING id INTO v_connection_id;

  -- Prove the WhatsApp connection is the only domain data that could
  -- block either personal source account in redeem_invitation.
  IF EXISTS (
    SELECT 1 FROM public.contacts WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.conversations WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.broadcasts WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.automations WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.automation_logs WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.automation_pending_executions WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.flows WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.flow_runs WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.pipelines WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.deals WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.message_templates WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.tags WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.custom_fields WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.contact_notes WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.whatsapp_config WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.api_keys WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.webhook_endpoints WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.quick_replies WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.notifications WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.ai_configs WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.ai_knowledge_documents WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.ai_knowledge_chunks WHERE account_id IN (v_busy_account, v_empty_account)
    UNION ALL SELECT 1 FROM public.ai_usage_log WHERE account_id IN (v_busy_account, v_empty_account)
  ) THEN
    RAISE EXCEPTION 'Fixture contamination: another domain table contains source-account data';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE id = v_connection_id AND account_id = v_busy_account)
     OR EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE account_id = v_empty_account) THEN
    RAISE EXCEPTION 'Fixture contamination: the connection is not isolated to the busy personal account';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_busy_user::text, true);
  BEGIN
    PERFORM public.redeem_invitation(v_busy_token);
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    IF v_message NOT LIKE 'Your account already contains data%' THEN
      RAISE EXCEPTION 'Busy-account redemption failed for a different reason: % (%)', v_message, v_sqlstate;
    END IF;
    v_busy_blocked := true;
  END;

  IF NOT v_busy_blocked THEN
    RAISE EXCEPTION 'Personal account containing only whatsapp_connections was allowed to join';
  END IF;

  SELECT account_id INTO STRICT v_account_after FROM public.profiles WHERE user_id = v_busy_user;
  IF v_account_after <> v_busy_account
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_busy_account AND owner_user_id = v_busy_user)
     OR NOT EXISTS (SELECT 1 FROM public.whatsapp_connections WHERE id = v_connection_id AND account_id = v_busy_account)
     OR NOT EXISTS (
       SELECT 1 FROM public.account_invitations
       WHERE token_hash = v_busy_token AND accepted_at IS NULL AND accepted_by_user_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Blocked redemption changed the source account, profile, connection, or invitation';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_empty_user::text, true);
  v_returned_account := public.redeem_invitation(v_empty_token);

  SELECT account_id INTO STRICT v_account_after FROM public.profiles WHERE user_id = v_empty_user;
  IF v_returned_account <> v_target_account
     OR v_account_after <> v_target_account
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE user_id = v_empty_user AND account_id = v_target_account AND account_role = 'viewer'
     )
     OR EXISTS (SELECT 1 FROM public.accounts WHERE id = v_empty_account)
     OR NOT EXISTS (
       SELECT 1 FROM public.account_invitations
       WHERE token_hash = v_empty_token
         AND accepted_at IS NOT NULL
         AND accepted_by_user_id = v_empty_user
     ) THEN
    RAISE EXCEPTION 'Empty personal account could not join the invited account';
  END IF;
END;
$fixtures_and_assertions$;

ROLLBACK;
