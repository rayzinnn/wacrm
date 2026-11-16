ALTER TABLE public.automation_pending_executions
  ADD COLUMN evolution_dispatch_step_id uuid NULL,
  ADD CONSTRAINT automation_pending_executions_evolution_dispatch_step_fkey
    FOREIGN KEY (evolution_dispatch_step_id)
    REFERENCES public.evolution_dispatch_steps(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT automation_pending_executions_evolution_dispatch_step_key
    UNIQUE (evolution_dispatch_step_id);
