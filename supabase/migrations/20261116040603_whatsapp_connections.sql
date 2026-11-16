CREATE TABLE public.whatsapp_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'evolution',
  base_url text NOT NULL,
  instance_name text NOT NULL,
  token_encrypted text NOT NULL,
  webhook_secret_encrypted text NOT NULL,
  state text NOT NULL DEFAULT 'disconnected',
  state_checked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_connections_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_connections_account_id_key UNIQUE (account_id),
  CONSTRAINT whatsapp_connections_provider_check CHECK (provider = 'evolution'),
  CONSTRAINT whatsapp_connections_state_check
    CHECK (state IN ('disconnected', 'connecting', 'connected', 'unknown')),
  CONSTRAINT whatsapp_connections_base_url_instance_name_key UNIQUE (base_url, instance_name)
);

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_connections FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.whatsapp_connections TO service_role;
