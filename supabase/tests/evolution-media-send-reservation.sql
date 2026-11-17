-- Synthetic only. Run after the migration in a disposable local database.
BEGIN;

DO $test$
DECLARE
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  a_a uuid;
  a_b uuid;
  c_a uuid;
  c_b uuid;
  w_a uuid;
  w_b uuid;
  v_a uuid;
  v_b uuid;
  first_row record;
  replay_row record;
  other_tenant_row record;
  failed boolean := false;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data)
  VALUES
    (u_a, 'authenticated', 'authenticated', u_a::text || '@fixture.invalid', '', now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"T11 synthetic A"}'),
    (u_b, 'authenticated', 'authenticated', u_b::text || '@fixture.invalid', '', now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"T11 synthetic B"}');
  SELECT account_id INTO STRICT a_a FROM public.profiles WHERE user_id = u_a;
  SELECT account_id INTO STRICT a_b FROM public.profiles WHERE user_id = u_b;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (u_a, a_a, '+15550000111', 'T11 synthetic A'), (u_b, a_b, '+15550000112', 'T11 synthetic B');
  SELECT id INTO STRICT c_a FROM public.contacts WHERE account_id = a_a;
  SELECT id INTO STRICT c_b FROM public.contacts WHERE account_id = a_b;
  INSERT INTO public.whatsapp_connections (account_id, created_by, base_url, instance_name,
    token_encrypted, webhook_secret_encrypted)
  VALUES (a_a, u_a, 'http://127.0.0.1:8080', 't11-a-' || u_a, 'synthetic-a', 'synthetic-a'),
         (a_b, u_b, 'http://127.0.0.1:8080', 't11-b-' || u_b, 'synthetic-b', 'synthetic-b');
  SELECT id INTO STRICT w_a FROM public.whatsapp_connections WHERE account_id = a_a;
  SELECT id INTO STRICT w_b FROM public.whatsapp_connections WHERE account_id = a_b;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (u_a, a_a, c_a, 'open'), (u_b, a_b, c_b, 'open');
  SELECT id INTO STRICT v_a FROM public.conversations WHERE account_id = a_a;
  SELECT id INTO STRICT v_b FROM public.conversations WHERE account_id = a_b;

  SELECT * INTO STRICT first_row FROM public.reserve_evolution_media_send(
    w_a, 't11-synthetic-request', repeat('a', 64), v_a, u_a, 'image', 'image/png', 'Synthetic caption');
  IF NOT first_row.should_send OR first_row.outcome <> 'pending' THEN
    RAISE EXCEPTION 'first reservation did not authorize exactly one pending attempt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.id = first_row.message_row_id
      AND m.content_type = 'image' AND m.media_type = 'image/png'
      AND m.content_text = 'Synthetic caption' AND m.status = 'sending'
      AND m.provider_connection_id = w_a) THEN
    RAISE EXCEPTION 'reservation did not persist the expected synthetic message';
  END IF;

  SELECT * INTO STRICT replay_row FROM public.reserve_evolution_media_send(
    w_a, 't11-synthetic-request', repeat('a', 64), v_a, u_a, 'image', 'image/png', 'Synthetic caption');
  IF replay_row.should_send OR replay_row.attempt_id <> first_row.attempt_id
     OR replay_row.message_row_id <> first_row.message_row_id THEN
    RAISE EXCEPTION 'same-account replay did not return the original non-send reservation';
  END IF;

  PERFORM * FROM public.complete_evolution_send(first_row.attempt_id, 'unknown', NULL, 'timeout');
  SELECT * INTO STRICT replay_row FROM public.reserve_evolution_media_send(
    w_a, 't11-synthetic-request', repeat('a', 64), v_a, u_a, 'image', 'image/png', 'Synthetic caption');
  IF replay_row.should_send OR replay_row.outcome <> 'unknown' THEN
    RAISE EXCEPTION 'unknown replay authorized another send';
  END IF;

  SELECT * INTO STRICT other_tenant_row FROM public.reserve_evolution_media_send(
    w_b, 't11-synthetic-request', repeat('a', 64), v_b, u_b, 'document', 'application/pdf', NULL);
  IF NOT other_tenant_row.should_send OR other_tenant_row.attempt_id = first_row.attempt_id THEN
    RAISE EXCEPTION 'same request ID was not isolated by account';
  END IF;

  BEGIN
    PERFORM * FROM public.reserve_evolution_media_send(
      w_a, 't11-cross-tenant', repeat('b', 64), v_b, u_a, 'image', 'image/png', NULL);
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'cross-account conversation was accepted'; END IF;

  failed := false;
  BEGIN
    PERFORM * FROM public.reserve_evolution_media_send(
      w_a, 't11-bad-kind', repeat('c', 64), v_a, u_a, 'audio', 'audio/ogg', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'unsupported media kind was accepted'; END IF;

  failed := false;
  BEGIN
    PERFORM * FROM public.reserve_evolution_media_send(
      w_a, 't11-hash-conflict', repeat('d', 64), v_a, u_a, 'image', 'image/png', NULL);
    PERFORM * FROM public.reserve_evolution_media_send(
      w_a, 't11-hash-conflict', repeat('e', 64), v_a, u_a, 'image', 'image/png', NULL);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'request ID with changed payload hash was accepted'; END IF;
END;
$test$;

ROLLBACK;
