ALTER TABLE public.flow_run_events
  ADD COLUMN evolution_event_id uuid NULL
    REFERENCES public.evolution_events(id) ON DELETE SET NULL,
  ADD COLUMN transition_seq integer NULL;

CREATE UNIQUE INDEX flow_run_events_reply_event_key
  ON public.flow_run_events (flow_run_id, evolution_event_id)
  WHERE event_type = 'reply_received'
    AND evolution_event_id IS NOT NULL;

CREATE UNIQUE INDEX flow_run_events_evolution_transition_key
  ON public.flow_run_events (flow_run_id, evolution_event_id, event_type, transition_seq)
  WHERE evolution_event_id IS NOT NULL
    AND transition_seq IS NOT NULL;
