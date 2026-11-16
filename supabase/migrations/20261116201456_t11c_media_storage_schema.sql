-- Private Evolution media storage. Keep this separate from the public
-- chat-media bucket, whose legacy policies and behavior are intentionally
-- untouched.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evolution-media',
  'evolution-media',
  false,
  16777216,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'application/msword', 'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr',
    'video/mp4', 'video/3gpp', 'video/3gp', 'video/quicktime'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.evolution_events
  ADD COLUMN media_sha256 text NULL,
  ADD COLUMN media_size_bytes bigint NULL,
  ADD COLUMN media_filename text NULL,
  ADD CONSTRAINT evolution_events_media_sha256_check
    CHECK (media_sha256 IS NULL OR media_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT evolution_events_media_size_check
    CHECK (media_size_bytes IS NULL OR media_size_bytes BETWEEN 1 AND 16777216),
  ADD CONSTRAINT evolution_events_media_filename_check
    CHECK (
      media_filename IS NULL OR (
        length(media_filename) BETWEEN 1 AND 80
        AND media_filename = btrim(media_filename)
        AND media_filename !~ '[[:cntrl:]]'
        AND pg_catalog.strpos(media_filename, '/') = 0
        AND pg_catalog.strpos(media_filename, pg_catalog.chr(92)) = 0
        AND media_filename !~ '[<>:"|?*]'
        AND pg_catalog.left(media_filename, 1) <> '.'
      )
    ),
  ADD CONSTRAINT evolution_events_media_metadata_bundle_check
    CHECK (
      (media_sha256 IS NULL AND media_size_bytes IS NULL AND media_filename IS NULL)
      OR
      (media_sha256 IS NOT NULL AND media_size_bytes IS NOT NULL AND media_filename IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION public.stage_evolution_media(
  p_event_id uuid,
  p_lease_token uuid,
  p_sha256 text,
  p_size_bytes bigint,
  p_media_type text,
  p_filename text
)
RETURNS TABLE (outcome text, media_storage_path text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_event public.evolution_events%ROWTYPE;
  v_account_id uuid;
  v_content_type text;
  v_expected_kind text;
  v_extension text;
  v_storage_path text;
  v_updated_rows integer;
BEGIN
  SELECT e.*
    INTO v_event
    FROM public.evolution_events AS e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF NOT FOUND
     OR p_lease_token IS NULL
     OR v_event.state <> 'processing'
     OR v_event.lease_token IS DISTINCT FROM p_lease_token
     OR v_event.lease_until IS NULL
     OR v_event.lease_until <= pg_catalog.clock_timestamp() THEN
    RETURN QUERY SELECT 'stale'::text, NULL::text;
    RETURN;
  END IF;

  IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
     OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 16777216
     OR p_filename IS NULL OR length(p_filename) NOT BETWEEN 1 AND 80
     OR p_filename <> btrim(p_filename)
     OR p_filename ~ '[[:cntrl:]]'
     OR pg_catalog.strpos(p_filename, '/') > 0
     OR pg_catalog.strpos(p_filename, pg_catalog.chr(92)) > 0
     OR p_filename ~ '[<>:"|?*]'
     OR pg_catalog.left(p_filename, 1) = '.' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_media_stage_metadata';
  END IF;

  v_expected_kind := CASE
    WHEN p_media_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif') THEN 'image'
    WHEN p_media_type IN (
      'application/pdf', 'application/msword', 'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain'
    ) THEN 'document'
    WHEN p_media_type IN ('audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr') THEN 'audio'
    WHEN p_media_type IN ('video/mp4', 'video/3gpp', 'video/3gp', 'video/quicktime') THEN 'video'
    ELSE NULL
  END;

  v_extension := CASE p_media_type
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'image/gif' THEN 'gif'
    WHEN 'application/pdf' THEN 'pdf'
    WHEN 'application/msword' THEN 'doc'
    WHEN 'application/vnd.ms-excel' THEN 'xls'
    WHEN 'application/vnd.ms-powerpoint' THEN 'ppt'
    WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx'
    WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN 'xlsx'
    WHEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation' THEN 'pptx'
    WHEN 'text/plain' THEN 'txt'
    WHEN 'audio/ogg' THEN 'ogg'
    WHEN 'audio/opus' THEN 'opus'
    WHEN 'audio/mpeg' THEN 'mp3'
    WHEN 'audio/aac' THEN 'aac'
    WHEN 'audio/mp4' THEN 'm4a'
    WHEN 'audio/amr' THEN 'amr'
    WHEN 'video/mp4' THEN 'mp4'
    WHEN 'video/3gpp' THEN '3gp'
    WHEN 'video/3gp' THEN '3gp'
    WHEN 'video/quicktime' THEN 'mov'
    ELSE NULL
  END;

  v_content_type := v_event.normalized_event ->> 'contentType';
  IF v_expected_kind IS NULL
     OR v_extension IS NULL
     OR v_event.normalized_event ->> 'kind' IS DISTINCT FROM 'message'
     OR v_content_type IS DISTINCT FROM v_expected_kind
     OR v_event.normalized_event -> 'mediaRef' ->> 'version' IS DISTINCT FROM '1'
     OR v_event.normalized_event -> 'mediaRef' -> 'key' ->> 'fromMe' IS DISTINCT FROM 'false'
     OR v_event.normalized_event -> 'mediaRef' -> 'key' ->> 'id'
        IS DISTINCT FROM v_event.normalized_event ->> 'externalMessageId'
     OR v_event.normalized_event -> 'mediaRef' -> 'key' ->> 'remoteJid'
        IS DISTINCT FROM v_event.normalized_event ->> 'peer' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_media_stage_event';
  END IF;

  SELECT c.account_id
    INTO v_account_id
    FROM public.whatsapp_connections AS c
   WHERE c.id = v_event.connection_id
     AND c.provider = 'evolution';

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_media_stage_connection';
  END IF;

  v_storage_path := 'account-' || v_account_id::text
    || '/evolution/' || v_event.id::text || '/payload.' || v_extension;

  IF v_event.media_state = 'stored' THEN
    IF v_event.media_storage_path IS NOT DISTINCT FROM v_storage_path
       AND v_event.media_sha256 IS NOT DISTINCT FROM p_sha256
       AND v_event.media_size_bytes IS NOT DISTINCT FROM p_size_bytes
       AND v_event.media_type IS NOT DISTINCT FROM p_media_type THEN
      RETURN QUERY SELECT 'duplicate'::text, v_storage_path;
    ELSE
      RETURN QUERY SELECT 'conflict'::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  IF v_event.media_state <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_media_stage_state';
  END IF;

  UPDATE public.evolution_events AS e
     SET media_state = 'stored',
         media_storage_path = v_storage_path,
         media_type = p_media_type,
         media_sha256 = p_sha256,
         media_size_bytes = p_size_bytes,
         media_filename = p_filename,
         updated_at = pg_catalog.clock_timestamp()
   WHERE e.id = p_event_id
     AND e.state = 'processing'
     AND e.lease_token = p_lease_token
     AND e.lease_until > pg_catalog.clock_timestamp()
     AND e.media_state = 'pending';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RETURN QUERY SELECT 'stale'::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'staged'::text, v_storage_path;
END;
$function$;

REVOKE ALL ON FUNCTION public.stage_evolution_media(uuid, uuid, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_evolution_media(uuid, uuid, text, bigint, text, text)
  TO service_role;
