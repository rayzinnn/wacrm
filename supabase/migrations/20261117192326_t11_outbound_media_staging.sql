-- Server-only manifest for temporary outbound media in the private
-- evolution-media bucket. The object path is never returned to clients.

CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_account_id_key
  ON public.conversations (id, account_id);

CREATE TABLE public.evolution_outbound_media_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image', 'document')),
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  filename text NOT NULL CHECK (
    length(filename) BETWEEN 1 AND 80
    AND filename = btrim(filename)
    AND filename !~ '[[:cntrl:]]'
    AND strpos(filename, '/') = 0
    AND strpos(filename, chr(92)) = 0
    AND filename !~ '[<>:"|?*]'
    AND left(filename, 1) <> '.'
  ),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 16777216),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'staged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT evolution_outbound_media_stages_conversation_account_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES public.conversations (id, account_id) ON DELETE CASCADE,
  CONSTRAINT evolution_outbound_media_stages_media_type_matches_kind_check
    CHECK (
      (content_type = 'image' AND media_type IN ('image/jpeg', 'image/png'))
      OR (content_type = 'document' AND media_type = 'application/pdf')
    ),
  CONSTRAINT evolution_outbound_media_stages_storage_path_check
    CHECK (
      storage_path = 'account-' || account_id::text || '/outbound/'
        || conversation_id::text || '/' || id::text || '/payload.'
        || CASE media_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'pdf' END
    ),
  CONSTRAINT evolution_outbound_media_stages_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX evolution_outbound_media_stages_expiry_idx
  ON public.evolution_outbound_media_stages (expires_at);

ALTER TABLE public.evolution_outbound_media_stages ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.evolution_outbound_media_stages FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evolution_outbound_media_stages TO service_role;
