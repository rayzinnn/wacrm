import 'server-only';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { EvolutionAutomationStepError } from '@/lib/automations/evolution-step-executor';
import {
  completeEvolutionAutomationRoot,
  InvalidAutomationDefinitionError,
  parsePersistedAutomationSteps,
  runEvolutionAutomationFromCursor,
  type EvolutionAutomationCursor,
  type EvolutionAutomationRunContext,
  type EvolutionAutomationScopeResult,
  type PersistedAutomationStep,
} from '@/lib/automations/evolution-automation-orchestrator';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ClaimedWait {
  pending_execution_id: string;
  dispatch_id: string;
  account_id: string;
  user_id: string;
  automation_id: string;
  log_id: string;
  contact_id: string;
  evolution_dispatch_step_id: string;
  parked_step_id: string;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  pending_lease_token: string;
  dispatch_lease_token: string;
}

interface RootRow {
  id: string;
  account_id: string;
  engine: string;
  automation_id: string | null;
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  automation_log_id: string | null;
  state: string;
  lease_token: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneRow<T>(data: unknown, label: string): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new Error(`${label} response is invalid`);
  }
  return rows[0] as T;
}

function parseClaim(value: unknown): ClaimedWait {
  if (
    !isRecord(value) ||
    ![
      'pending_execution_id',
      'dispatch_id',
      'account_id',
      'user_id',
      'automation_id',
      'log_id',
      'evolution_dispatch_step_id',
      'parked_step_id',
      'pending_lease_token',
      'dispatch_lease_token',
    ].every(
      (key) => typeof value[key] === 'string' && UUID_PATTERN.test(value[key])
    ) ||
    typeof value.contact_id !== 'string' ||
    !UUID_PATTERN.test(value.contact_id) ||
    (value.parent_step_id !== null &&
      (typeof value.parent_step_id !== 'string' ||
        !UUID_PATTERN.test(value.parent_step_id))) ||
    (value.branch !== null &&
      value.branch !== 'yes' &&
      value.branch !== 'no') ||
    typeof value.next_step_position !== 'number' ||
    !Number.isInteger(value.next_step_position)
  ) {
    throw new Error('Evolution pending claim response is invalid');
  }
  return value as unknown as ClaimedWait;
}

async function loadRootContext(
  claim: ClaimedWait
): Promise<EvolutionAutomationRunContext> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('evolution_event_dispatches')
    .select(
      'id,account_id,engine,automation_id,user_id,contact_id,conversation_id,automation_log_id,state,lease_token'
    )
    .eq('id', claim.dispatch_id)
    .maybeSingle();
  if (error || !data) throw new Error('Could not load claimed Evolution root');
  const root = data as RootRow;
  if (
    root.id !== claim.dispatch_id ||
    root.account_id !== claim.account_id ||
    root.engine !== 'automation' ||
    root.automation_id !== claim.automation_id ||
    root.user_id !== claim.user_id ||
    root.contact_id !== claim.contact_id ||
    root.automation_log_id !== claim.log_id ||
    root.state !== 'processing' ||
    root.lease_token !== claim.dispatch_lease_token ||
    typeof root.conversation_id !== 'string' ||
    !UUID_PATTERN.test(root.conversation_id)
  ) {
    throw new Error('Claimed Evolution root lineage is invalid');
  }

  const { data: startedData, error: startedError } = await db.rpc(
    'start_evolution_event_dispatch',
    {
      p_dispatch_id: claim.dispatch_id,
      p_lease_token: claim.dispatch_lease_token,
    }
  );
  if (startedError)
    throw new Error('Could not validate claimed Evolution root');
  const started = oneRow<{
    dispatch_id: string;
    automation_log_id: string | null;
    state: string;
  }>(startedData, 'root start');
  if (
    started.dispatch_id !== claim.dispatch_id ||
    started.state !== 'processing' ||
    started.automation_log_id !== claim.log_id
  ) {
    throw new Error('Claimed Evolution root start did not match');
  }

  return {
    dispatch: {
      id: root.id,
      lease_token: claim.dispatch_lease_token,
      account_id: root.account_id,
      automation_id: claim.automation_id,
      user_id: claim.user_id,
      contact_id: claim.contact_id,
      conversation_id: root.conversation_id,
      automation_log_id: claim.log_id,
    },
  };
}

async function loadSteps(
  automationId: string
): Promise<PersistedAutomationStep[]> {
  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select(
      'id,automation_id,parent_step_id,branch,step_type,step_config,position,created_at'
    )
    .eq('automation_id', automationId)
    .order('position', { ascending: true });
  if (error)
    throw new Error('Could not load persisted Evolution automation steps');
  return parsePersistedAutomationSteps(data, automationId);
}

function cursorFromClaim(claim: ClaimedWait): EvolutionAutomationCursor {
  return {
    parent_step_id: claim.parent_step_id,
    branch: claim.branch,
    next_step_position: claim.next_step_position,
  };
}

async function confirmNewWait(
  context: EvolutionAutomationRunContext,
  outcome: EvolutionAutomationScopeResult
): Promise<void> {
  if (!outcome.pendingExecutionId || !outcome.ledgerStepId || !outcome.stepId) {
    throw new Error('New Evolution wait checkpoint is incomplete');
  }
  const { data, error } = await supabaseAdmin()
    .from('automation_pending_executions')
    .select(
      'id,account_id,automation_id,log_id,contact_id,status,evolution_dispatch_step_id,parked_step_id,parent_step_id,branch,next_step_position'
    )
    .eq('id', outcome.pendingExecutionId)
    .maybeSingle();
  if (error || !data)
    throw new Error('Could not verify newly parked Evolution wait');
  const pending = data as Record<string, unknown>;
  const step = await supabaseAdmin()
    .from('automation_steps')
    .select('id,parent_step_id,branch,position,step_type')
    .eq('id', outcome.stepId)
    .eq('automation_id', context.dispatch.automation_id)
    .maybeSingle();
  const ledger = await supabaseAdmin()
    .from('evolution_dispatch_steps')
    .select('id,dispatch_id,action_key,state,request_id,result')
    .eq('id', outcome.ledgerStepId)
    .maybeSingle();
  if (
    step.error ||
    !step.data ||
    ledger.error ||
    !ledger.data ||
    pending.id !== outcome.pendingExecutionId ||
    pending.account_id !== context.dispatch.account_id ||
    pending.automation_id !== context.dispatch.automation_id ||
    pending.log_id !== context.dispatch.automation_log_id ||
    pending.contact_id !== context.dispatch.contact_id ||
    pending.status !== 'pending' ||
    pending.evolution_dispatch_step_id !== outcome.ledgerStepId ||
    pending.parked_step_id !== outcome.stepId ||
    pending.parent_step_id !== step.data.parent_step_id ||
    pending.branch !== step.data.branch ||
    pending.next_step_position !== Number(step.data.position) + 1 ||
    step.data.step_type !== 'wait' ||
    ledger.data.dispatch_id !== context.dispatch.id ||
    ledger.data.action_key !== outcome.stepId ||
    ledger.data.state !== 'done' ||
    ledger.data.request_id !== `evolution-step:${ledger.data.id}` ||
    !isRecord(ledger.data.result) ||
    ledger.data.result.pending_execution_id !== outcome.pendingExecutionId
  ) {
    throw new Error(
      'New Evolution wait cursor does not match persisted lineage'
    );
  }
}

async function acknowledge(claim: ClaimedWait): Promise<void> {
  const { data, error } = await supabaseAdmin().rpc(
    'complete_evolution_automation_pending_execution',
    {
      p_pending_execution_id: claim.pending_execution_id,
      p_pending_lease_token: claim.pending_lease_token,
      p_dispatch_lease_token: claim.dispatch_lease_token,
    }
  );
  if (error)
    throw new Error('Could not acknowledge Evolution pending execution');
  const completed = oneRow<{
    pending_execution_id: string;
    status: string;
    replayed: boolean;
  }>(data, 'pending completion');
  if (
    completed.pending_execution_id !== claim.pending_execution_id ||
    completed.status !== 'done' ||
    typeof completed.replayed !== 'boolean'
  ) {
    throw new Error('Evolution pending acknowledgement did not match');
  }
}

/** Consumes at most one due temporal wait. This is intentionally not wired to cron. */
export async function consumeDueEvolutionAutomationWait(): Promise<
  | { state: 'idle' }
  | { state: 'waiting' | 'processing'; dispatch_id: string; step_id: string }
  | { state: 'done' | 'failed' | 'unknown'; dispatch_id: string }
> {
  const { data, error } = await supabaseAdmin().rpc(
    'claim_evolution_automation_pending_executions',
    { p_limit: 1, p_lease_seconds: 60 }
  );
  if (error) throw new Error('Could not claim a due Evolution automation wait');
  if (!Array.isArray(data))
    throw new Error('Evolution pending claim response is invalid');
  if (data.length === 0) return { state: 'idle' };
  if (data.length !== 1)
    throw new Error('Evolution pending claim exceeded its limit');

  const claim = parseClaim(data[0]);
  const context = await loadRootContext(claim);
  let outcome: EvolutionAutomationScopeResult;
  try {
    const steps = await loadSteps(claim.automation_id);
    const parked = steps.find((step) => step.id === claim.parked_step_id);
    if (
      !parked ||
      parked.step_type !== 'wait' ||
      parked.parent_step_id !== claim.parent_step_id ||
      parked.branch !== claim.branch ||
      parked.position + 1 !== claim.next_step_position
    ) {
      throw new InvalidAutomationDefinitionError('wait_cursor_invalid');
    }
    outcome = await runEvolutionAutomationFromCursor(
      context,
      steps,
      cursorFromClaim(claim)
    );
  } catch (error) {
    if (error instanceof InvalidAutomationDefinitionError) {
      outcome = { state: 'failed', errorCode: error.code };
    } else if (
      error instanceof EvolutionAutomationStepError &&
      [
        'invalid_input',
        'invalid_step_config',
        'interpolation_context_required',
        'unsupported_assignment_mode',
        'unsupported_step_type',
        'account_currency_invalid',
      ].includes(error.code)
    ) {
      outcome = { state: 'failed', errorCode: error.code };
    } else {
      // Transient DB/RPC errors leave the wait unacknowledged for lease recovery.
      throw error;
    }
  }

  if (outcome.state === 'processing') {
    return {
      state: 'processing',
      dispatch_id: claim.dispatch_id,
      step_id: outcome.stepId ?? claim.parked_step_id,
    };
  }
  if (outcome.state === 'waiting') {
    await confirmNewWait(context, outcome);
    await acknowledge(claim);
    return {
      state: 'waiting',
      dispatch_id: claim.dispatch_id,
      step_id: outcome.stepId!,
    };
  }

  // Ack first; root completion is fenced separately. A crash here is recovered
  // by the regular root consumer from the completed wait's persisted cursor.
  await acknowledge(claim);
  if (outcome.state === 'completed') {
    const completed = await completeEvolutionAutomationRoot(
      context,
      'done',
      null
    );
    if (completed.state !== 'done')
      throw new Error('Evolution root did not finish done');
    return { state: 'done', dispatch_id: claim.dispatch_id };
  }
  if (outcome.state === 'failed') {
    const completed = await completeEvolutionAutomationRoot(
      context,
      'failed',
      outcome.errorCode ?? 'automation_step_failed'
    );
    if (completed.state !== 'failed') {
      throw new Error('Evolution root did not finish failed');
    }
    return { state: 'failed', dispatch_id: claim.dispatch_id };
  }
  if (outcome.state === 'unknown') {
    const completed = await completeEvolutionAutomationRoot(
      context,
      'unknown',
      'outcome_unknown'
    );
    if (completed.state !== 'unknown') {
      throw new Error('Evolution root did not finish unknown');
    }
    return { state: 'unknown', dispatch_id: claim.dispatch_id };
  }
  throw new Error('Evolution automation traversal returned an invalid state');
}
