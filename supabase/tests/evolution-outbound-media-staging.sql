-- Synthetic rollback-only checks for the outbound private staging manifest.
-- Run after 20261117192326_t11_outbound_media_staging.sql in local Postgres.
BEGIN;

DO $security_assertions$
DECLARE
  v_table regclass := 'public.evolution_outbound_media_stages'::regclass;
  v_bucket record;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'evolution_outbound_media_stages')
     OR pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', v_table, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'DELETE') THEN
    RAISE EXCEPTION 'outbound staging manifest RLS/grants are unsafe';
  END IF;

  SELECT public, file_size_limit, allowed_mime_types INTO STRICT v_bucket
    FROM storage.buckets WHERE id = 'evolution-media';
  IF v_bucket.public OR v_bucket.file_size_limit <> 16777216
     OR NOT (v_bucket.allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]) THEN
    RAISE EXCEPTION 'the private Evolution bucket does not meet the staging limits';
  END IF;
END;
$security_assertions$;

DO $synthetic_isolation$
DECLARE
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  a_a uuid;
  a_b uuid;
  c_a uuid;
  c_b uuid;
  v_a uuid;
  v_b uuid;
  stage_id uuid := gen_random_uuid();
  foreign_stage_id uuid := gen_random_uuid();
  bad_stage_id uuid := gen_random_uuid();
  conflict boolean := false;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data)
  VALUES
    (u_a, 'authenticated', 'authenticated', u_a::text || '@fixture.invalid', '', now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"T11 outbound synthetic A"}'),
    (u_b, 'authenticated', 'authenticated', u_b::text || '@fixture.invalid', '', now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"T11 outbound synthetic B"}');
  SELECT account_id INTO STRICT a_a FROM public.profiles WHERE user_id = u_a;
  SELECT account_id INTO STRICT a_b FROM public.profiles WHERE user_id = u_b;

  INSERT INTO public.contacts (user_id, account_id, phone, name)
  VALUES (u_a, a_a, '+15550000221', 'T11 outbound synthetic A'),
         (u_b, a_b, '+15550000222', 'T11 outbound synthetic B');
  SELECT id INTO STRICT c_a FROM public.contacts WHERE account_id = a_a;
  SELECT id INTO STRICT c_b FROM public.contacts WHERE account_id = a_b;
  INSERT INTO public.conversations (user_id, account_id, contact_id, status)
  VALUES (u_a, a_a, c_a, 'open'), (u_b, a_b, c_b, 'open');
  SELECT id INTO STRICT v_a FROM public.conversations WHERE account_id = a_a;
  SELECT id INTO STRICT v_b FROM public.conversations WHERE account_id = a_b;

  INSERT INTO public.evolution_outbound_media_stages (
    id, account_id, conversation_id, uploaded_by, storage_path,
    content_type, media_type, filename, size_bytes, sha256, state
  ) VALUES (
    stage_id, a_a, v_a, u_a,
    'account-' || a_a::text || '/outbound/' || v_a::text || '/' || stage_id::text || '/payload.png',
    'image', 'image/png', 'synthetic.png', 9, repeat('a', 64), 'staged'
  );

  BEGIN
    INSERT INTO public.evolution_outbound_media_stages (
      id, account_id, conversation_id, uploaded_by, storage_path,
      content_type, media_type, filename, size_bytes, sha256
    ) VALUES (
      foreign_stage_id, a_b, v_a, u_b,
      'account-' || a_b::text || '/outbound/' || v_a::text || '/' || foreign_stage_id::text || '/payload.png',
      'image', 'image/png', 'foreign.png', 9, repeat('b', 64)
    );
  EXCEPTION WHEN foreign_key_violation THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'cross-account conversation binding was accepted'; END IF;

  conflict := false;
  BEGIN
    INSERT INTO public.evolution_outbound_media_stages (
      id, account_id, conversation_id, uploaded_by, storage_path,
      content_type, media_type, filename, size_bytes, sha256
    ) VALUES (
      bad_stage_id, a_a, v_a, u_a,
      'account-' || a_a::text || '/outbound/' || v_a::text || '/' || bad_stage_id::text || '/payload.pdf',
      'image', 'application/pdf', 'mismatch.pdf', 9, repeat('c', 64)
    );
  EXCEPTION WHEN check_violation THEN
    conflict := true;
  END;
  IF NOT conflict THEN RAISE EXCEPTION 'MIME/content type mismatch was accepted'; END IF;

  IF EXISTS (SELECT 1 FROM public.evolution_outbound_media_stages
      WHERE id IN (foreign_stage_id, bad_stage_id))
     OR NOT EXISTS (SELECT 1 FROM public.evolution_outbound_media_stages
       WHERE id = stage_id AND account_id = a_a AND conversation_id = v_a
         AND uploaded_by = u_a AND state = 'staged') THEN
    RAISE EXCEPTION 'synthetic staging manifest isolation assertion failed';
  END IF;
  IF v_b IS NULL THEN RAISE EXCEPTION 'synthetic second account was not created'; END IF;
END;
$synthetic_isolation$;

ROLLBACK;
