-- Stable, idempotent candidate roots created transactionally from a new
-- inbound Evolution message. Per-action checkpoints are a later dispatch step.
CREATE TABLE public.evolution_event_dispatches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  account_id uuid NOT NULL,
  engine text NOT NULL,
  automation_id uuid NULL,
  flow_id uuid NULL,
  ai_config_id uuid NULL,
  user_id uuid NOT NULL,
  contact_id uuid NULL,
  conversation_id uuid NULL,
  automation_log_id uuid NULL,
  flow_run_id uuid NULL,
  ai_slot_claimed boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz NULL,
  lease_token uuid NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text NULL,
  result jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolution_event_dispatches_pkey PRIMARY KEY (id),
  CONSTRAINT evolution_event_dispatches_event_fkey
    FOREIGN KEY (event_id) REFERENCES public.evolution_events(id) ON DELETE CASCADE,
  CONSTRAINT evolution_event_dispatches_account_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE,
  CONSTRAINT evolution_event_dispatches_automation_fkey
    FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE,
  CONSTRAINT evolution_event_dispatches_flow_fkey
    FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE,
  CONSTRAINT evolution_event_dispatches_ai_config_fkey
    FOREIGN KEY (ai_config_id) REFERENCES public.ai_configs(id) ON DELETE CASCADE,
  CONSTRAINT evolution_event_dispatches_user_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT evolution_event_dispatches_contact_fkey
    FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT evolution_event_dispatches_conversation_fkey
    FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL,
  CONSTRAINT evolution_event_dispatches_automation_log_fkey
    FOREIGN KEY (automation_log_id) REFERENCES public.automation_logs(id) ON DELETE SET NULL,
  CONSTRAINT evolution_event_dispatches_flow_run_fkey
    FOREIGN KEY (flow_run_id) REFERENCES public.flow_runs(id) ON DELETE SET NULL,
  CONSTRAINT evolution_event_dispatches_engine_check
    CHECK (engine IN ('automation', 'flow', 'ai')),
  CONSTRAINT evolution_event_dispatches_definition_matches_engine
    CHECK (
      (engine = 'automation' AND automation_id IS NOT NULL AND flow_id IS NULL AND ai_config_id IS NULL)
      OR (engine = 'flow' AND automation_id IS NULL AND flow_id IS NOT NULL AND ai_config_id IS NULL)
      OR (engine = 'ai' AND automation_id IS NULL AND flow_id IS NULL AND ai_config_id IS NOT NULL)
    ),
  CONSTRAINT evolution_event_dispatches_state_check
    CHECK (state IN ('pending', 'processing', 'done', 'skipped', 'failed', 'unknown')),
  CONSTRAINT evolution_event_dispatches_attempts_check
    CHECK (attempts BETWEEN 0 AND 5)
);

CREATE UNIQUE INDEX evolution_dispatch_automation_event_key
  ON public.evolution_event_dispatches (event_id, automation_id)
  WHERE engine = 'automation';
CREATE UNIQUE INDEX evolution_dispatch_flow_event_key
  ON public.evolution_event_dispatches (event_id, flow_id)
  WHERE engine = 'flow';
CREATE UNIQUE INDEX evolution_dispatch_ai_event_key
  ON public.evolution_event_dispatches (event_id, ai_config_id)
  WHERE engine = 'ai';

ALTER TABLE public.evolution_event_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.evolution_event_dispatches FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evolution_event_dispatches TO service_role;
