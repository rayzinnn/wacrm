\set ON_ERROR_STOP on

BEGIN;

-- Fixtures are disposable and exist only inside this transaction.
DO $fixtures$
DECLARE
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  account_a uuid;
  account_b uuid;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES
    (user_a, 'authenticated', 'authenticated', 't06-a1-a@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06 A1 disposable A"}'::jsonb),
    (user_b, 'authenticated', 'authenticated', 't06-a1-b@fixture.invalid', '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"T06 A1 disposable B"}'::jsonb);

  SELECT p.account_id INTO STRICT account_a FROM public.profiles AS p WHERE p.user_id = user_a;
  SELECT p.account_id INTO STRICT account_b FROM public.profiles AS p WHERE p.user_id = user_b;

  PERFORM set_config('wacrm.t06a1.user_a', user_a::text, true);
  PERFORM set_config('wacrm.t06a1.user_b', user_b::text, true);
  PERFORM set_config('wacrm.t06a1.account_a', account_a::text, true);
  PERFORM set_config('wacrm.t06a1.account_b', account_b::text, true);
END;
$fixtures$;

SET LOCAL ROLE service_role;

DO $service_role_checks$
DECLARE
  account_a uuid := current_setting('wacrm.t06a1.account_a')::uuid;
  account_b uuid := current_setting('wacrm.t06a1.account_b')::uuid;
  user_a uuid := current_setting('wacrm.t06a1.user_a')::uuid;
  connection_a uuid;
  provider_value text;
  state_value text;
  checked_at timestamptz;
BEGIN
  INSERT INTO public.whatsapp_connections (
    account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted
  ) VALUES (
    account_a, user_a, 'http://127.0.0.1:8080', 't06-a1-fixture-instance',
    'synthetic-ciphertext-token', 'synthetic-ciphertext-webhook'
  ) RETURNING id INTO connection_a;

  PERFORM set_config('wacrm.t06a1.connection_a', connection_a::text, true);

  SELECT provider, state, state_checked_at
    INTO STRICT provider_value, state_value, checked_at
    FROM public.whatsapp_connections WHERE id = connection_a;
  IF provider_value <> 'evolution' OR state_value <> 'disconnected' OR checked_at IS NOT NULL THEN
    RAISE EXCEPTION 'connection defaults did not match the approved contract';
  END IF;

  UPDATE public.whatsapp_connections
     SET state = 'connected', state_checked_at = now()
   WHERE id = connection_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_role could not update its fixture connection';
  END IF;

  BEGIN
    INSERT INTO public.whatsapp_connections (
      account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
    ) VALUES (
      account_a, user_a, 'http://127.0.0.1:8080', 't06-a1-second-account-connection',
      'synthetic-ciphertext-token', 'synthetic-ciphertext-webhook'
    );
    RAISE EXCEPTION 'duplicate account connection was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_connections (
      account_id, created_by, base_url, instance_name, token_encrypted, webhook_secret_encrypted
    ) VALUES (
      account_b, current_setting('wacrm.t06a1.user_b')::uuid,
      'http://127.0.0.1:8080', 't06-a1-fixture-instance',
      'synthetic-ciphertext-token', 'synthetic-ciphertext-webhook'
    );
    RAISE EXCEPTION 'duplicate base_url/instance_name pair was accepted across accounts';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_connections (
      account_id, created_by, base_url, instance_name, provider,
      token_encrypted, webhook_secret_encrypted
    ) VALUES (
      account_b, current_setting('wacrm.t06a1.user_b')::uuid,
      'http://127.0.0.1:8080', 't06-a1-invalid-provider', 'meta',
      'synthetic-ciphertext-token', 'synthetic-ciphertext-webhook'
    );
    RAISE EXCEPTION 'invalid provider was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.whatsapp_connections (
      account_id, created_by, base_url, instance_name, state,
      token_encrypted, webhook_secret_encrypted
    ) VALUES (
      account_b, current_setting('wacrm.t06a1.user_b')::uuid,
      'http://127.0.0.1:8080', 't06-a1-invalid-state', 'open',
      'synthetic-ciphertext-token', 'synthetic-ciphertext-webhook'
    );
    RAISE EXCEPTION 'invalid state was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$service_role_checks$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('wacrm.t06a1.user_a'), true);
DO $authenticated_a_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.whatsapp_connections LIMIT 0';
    RAISE EXCEPTION 'authenticated A could read whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.whatsapp_connections DEFAULT VALUES';
    RAISE EXCEPTION 'authenticated A could insert into whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.whatsapp_connections SET state = ''disconnected''';
    RAISE EXCEPTION 'authenticated A could update whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.whatsapp_connections';
    RAISE EXCEPTION 'authenticated A could delete from whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_a_denied$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('wacrm.t06a1.user_b'), true);
DO $authenticated_b_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.whatsapp_connections LIMIT 0';
    RAISE EXCEPTION 'authenticated B could read whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.whatsapp_connections DEFAULT VALUES';
    RAISE EXCEPTION 'authenticated B could insert into whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'UPDATE public.whatsapp_connections SET state = ''disconnected''';
    RAISE EXCEPTION 'authenticated B could update whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM public.whatsapp_connections';
    RAISE EXCEPTION 'authenticated B could delete from whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_b_denied$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    EXECUTE 'SELECT 1 FROM public.whatsapp_connections LIMIT 0';
    RAISE EXCEPTION 'anon could read whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'INSERT INTO public.whatsapp_connections DEFAULT VALUES';
    RAISE EXCEPTION 'anon could insert into whatsapp_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_denied$;

RESET ROLE;

DO $catalog_checks$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.whatsapp_connections'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_connections'
  ) THEN
    RAISE EXCEPTION 'unexpected RLS policy exists';
  END IF;
  IF has_table_privilege('anon', 'public.whatsapp_connections', 'SELECT')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'INSERT')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'UPDATE')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'DELETE')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'REFERENCES')
     OR has_table_privilege('anon', 'public.whatsapp_connections', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'INSERT')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'DELETE')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.whatsapp_connections', 'TRIGGER') THEN
    RAISE EXCEPTION 'public, anon, or authenticated has table grants';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class AS c,
           LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
     WHERE c.oid = 'public.whatsapp_connections'::regclass
       AND acl.grantee IN (
         0,
         (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
         (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
       )
  ) THEN
    RAISE EXCEPTION 'PUBLIC, anon, or authenticated has table grants';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.whatsapp_connections', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_connections', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_connections', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_connections', 'DELETE') THEN
    RAISE EXCEPTION 'service_role is missing explicit table grants';
  END IF;
END;
$catalog_checks$;

ROLLBACK;
