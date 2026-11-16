CREATE TABLE public.evolution_dispatch_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL,
  action_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz NULL,
  lease_token uuid NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id text NULL,
  send_attempt_id uuid NULL,
  result jsonb NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolution_dispatch_steps_pkey PRIMARY KEY (id),
  CONSTRAINT evolution_dispatch_steps_dispatch_fkey
    FOREIGN KEY (dispatch_id) REFERENCES public.evolution_event_dispatches(id) ON DELETE CASCADE,
  CONSTRAINT evolution_dispatch_steps_send_attempt_fkey
    FOREIGN KEY (send_attempt_id) REFERENCES public.evolution_send_attempts(id) ON DELETE SET NULL,
  CONSTRAINT evolution_dispatch_steps_state_check
    CHECK (state IN ('pending', 'processing', 'done', 'skipped', 'failed', 'unknown')),
  CONSTRAINT evolution_dispatch_steps_attempts_check
    CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT evolution_dispatch_steps_dispatch_action_key
    UNIQUE (dispatch_id, action_key)
);

CREATE UNIQUE INDEX evolution_dispatch_steps_request_id_key
  ON public.evolution_dispatch_steps (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.evolution_dispatch_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.evolution_dispatch_steps FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evolution_dispatch_steps TO service_role;

ALTER TABLE public.automation_logs
  ADD COLUMN evolution_dispatch_id uuid NULL;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_evolution_dispatch_id_fkey
  FOREIGN KEY (evolution_dispatch_id)
  REFERENCES public.evolution_event_dispatches(id)
  ON DELETE SET NULL;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_evolution_dispatch_id_key
  UNIQUE (evolution_dispatch_id);
