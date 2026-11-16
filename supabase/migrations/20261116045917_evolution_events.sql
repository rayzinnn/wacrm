CREATE TABLE public.evolution_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  normalized_event jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz NULL,
  lease_token uuid NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  media_state text NOT NULL DEFAULT 'not_required',
  media_storage_path text NULL,
  media_type text NULL,
  CONSTRAINT evolution_events_pkey PRIMARY KEY (id),
  CONSTRAINT evolution_events_connection_event_key UNIQUE (connection_id, event_key),
  CONSTRAINT evolution_events_state_check
    CHECK (state IN ('pending', 'processing', 'done', 'failed')),
  CONSTRAINT evolution_events_attempts_check CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT evolution_events_media_state_check
    CHECK (media_state IN ('not_required', 'pending', 'stored', 'failed')),
  CONSTRAINT evolution_events_media_path_check
    CHECK ((media_state = 'stored') = (media_storage_path IS NOT NULL))
);

CREATE INDEX evolution_events_claim_idx
  ON public.evolution_events (next_attempt_at, created_at, id)
  WHERE state IN ('pending', 'processing');

ALTER TABLE public.evolution_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.evolution_events FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evolution_events TO service_role;
