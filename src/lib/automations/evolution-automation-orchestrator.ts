import 'server-only';

import type { AutomationStep } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  EvolutionAutomationStepError,
  executeEvolutionAutomationStep,
} from '@/lib/automations/evolution-step-executor';
import { executeEvolutionAutomationCondition } from '@/lib/automations/evolution-condition-executor';
import {
  prepareEvolutionAutomationDispatch,
  type PreparedEvolutionAutomationContext,
  type ReservedEvolutionAutomationDispatch,
} from '@/lib/automations/evolution-dispatch-preparer';
import { executeEvolutionAutomationSendMessage } from '@/lib/automations/evolution-send-message-executor';

type Branch = 'yes' | 'no';
type TerminalRootState = 'done' | 'failed' | 'unknown';

export type EvolutionAutomationOrchestrationResult =
  | { state: 'skipped'; dispatch_id: string }
  | { state: 'done' | 'failed' | 'unknown'; dispatch_id: string }
  | {
      state: 'waiting' | 'processing';
      dispatch_id: string;
      step_id: string;
    };

interface PersistedAutomationStep {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  branch: Branch | null;
  step_type: AutomationStep['step_type'];
  step_config: AutomationStep['step_config'];
  position: number;
  created_at: string;
}

interface RootCompletion {
  id: string;
  state: string;
}

interface ScopeResult {
  state: 'completed' | 'waiting' | 'processing' | 'failed' | 'unknown';
  stepId?: string;
  errorCode?: string;
}

class InvalidAutomationDefinitionError extends Error {
  constructor(readonly code: string) {
    super('Persisted automation step order or graph is invalid');
    this.name = 'InvalidAutomationDefinitionError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function row<T>(data: unknown, label: string): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new Error(`${label} response is invalid`);
  }
  return rows[0] as T;
}

function parseSteps(
  data: unknown,
  automationId: string
): PersistedAutomationStep[] {
  if (!Array.isArray(data))
    throw new Error('automation_steps response is invalid');
  return data.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      !UUID_PATTERN.test(value.id) ||
      value.automation_id !== automationId ||
      (value.parent_step_id !== null &&
        (typeof value.parent_step_id !== 'string' ||
          !UUID_PATTERN.test(value.parent_step_id))) ||
      (value.branch !== null &&
        value.branch !== 'yes' &&
        value.branch !== 'no') ||
      typeof value.step_type !== 'string' ||
      typeof value.position !== 'number' ||
      !Number.isInteger(value.position) ||
      typeof value.created_at !== 'string'
    ) {
      throw new InvalidAutomationDefinitionError('automation_steps_invalid');
    }
    return value as unknown as PersistedAutomationStep;
  });
}

function orderedScope(
  steps: PersistedAutomationStep[],
  parentStepId: string | null,
  branch: Branch | null
): PersistedAutomationStep[] {
  const scope = steps
    .filter(
      (step) =>
        step.parent_step_id === parentStepId &&
        (parentStepId === null ? step.branch === null : step.branch === branch)
    )
    .sort((left, right) => left.position - right.position);
  for (let index = 1; index < scope.length; index += 1) {
    if (scope[index - 1]!.position === scope[index]!.position) {
      throw new InvalidAutomationDefinitionError('step_order_ambiguous');
    }
  }
  return scope;
}

async function completeRoot(
  context: PreparedEvolutionAutomationContext,
  state: TerminalRootState,
  errorCode: string | null
): Promise<EvolutionAutomationOrchestrationResult> {
  const { data, error } = await supabaseAdmin().rpc(
    'complete_evolution_dispatch',
    {
      p_dispatch_id: context.dispatch.id,
      p_lease_token: context.dispatch.lease_token,
      p_state: state,
      p_result: null,
      p_error_code: errorCode,
    }
  );
  if (error) throw new Error('Could not complete Evolution automation root');
  const completed = row<RootCompletion>(data, 'root completion');
  if (completed.id !== context.dispatch.id || completed.state !== state) {
    throw new Error('Evolution automation root completion did not match');
  }
  return { state, dispatch_id: context.dispatch.id };
}

function waiting(context: PreparedEvolutionAutomationContext, stepId: string) {
  return {
    state: 'waiting' as const,
    dispatch_id: context.dispatch.id,
    step_id: stepId,
  };
}

function processing(
  context: PreparedEvolutionAutomationContext,
  stepId: string
) {
  return {
    state: 'processing' as const,
    dispatch_id: context.dispatch.id,
    step_id: stepId,
  };
}

const PERMANENT_LOCAL_STEP_ERRORS = new Set([
  'invalid_input',
  'invalid_step_config',
  'interpolation_context_required',
  'unsupported_assignment_mode',
  'unsupported_step_type',
  'account_currency_invalid',
]);

async function runScope(
  context: PreparedEvolutionAutomationContext,
  steps: PersistedAutomationStep[],
  parentStepId: string | null,
  branch: Branch | null,
  visiting: Set<string>
): Promise<ScopeResult> {
  const scope = orderedScope(steps, parentStepId, branch);
  for (const persisted of scope) {
    const step = persisted as AutomationStep;
    let state: string;
    let selectedBranch: Branch | null = null;

    if (step.step_type === 'condition') {
      if (visiting.has(step.id)) {
        return {
          state: 'failed',
          stepId: step.id,
          errorCode: 'step_graph_invalid',
        };
      }
      const decision = await executeEvolutionAutomationCondition({
        root: {
          id: context.dispatch.id,
          lease_token: context.dispatch.lease_token,
          account_id: context.dispatch.account_id,
        },
        step: { id: step.id },
      });
      state = decision.state;
      selectedBranch = decision.branch ?? null;
      if (state === 'done' && selectedBranch === null) {
        return {
          state: 'failed',
          stepId: step.id,
          errorCode: 'condition_result_invalid',
        };
      }
      if (state === 'skipped') {
        return {
          state: 'failed',
          stepId: step.id,
          errorCode: 'condition_result_invalid',
        };
      }
    } else if (step.step_type === 'send_message') {
      const result = await executeEvolutionAutomationSendMessage({
        root: {
          id: context.dispatch.id,
          lease_token: context.dispatch.lease_token,
          account_id: context.dispatch.account_id,
        },
        step: { id: step.id },
      });
      state = result.state;
    } else {
      try {
        const result = await executeEvolutionAutomationStep({
          root: {
            id: context.dispatch.id,
            lease_token: context.dispatch.lease_token,
            account_id: context.dispatch.account_id,
            contact_id: context.dispatch.contact_id,
            conversation_id: context.dispatch.conversation_id,
          },
          step,
        });
        state = result.state;
      } catch (error) {
        if (
          error instanceof EvolutionAutomationStepError &&
          PERMANENT_LOCAL_STEP_ERRORS.has(error.code)
        ) {
          return { state: 'failed', stepId: step.id, errorCode: error.code };
        }
        throw error;
      }
    }

    if (state === 'pending' || state === 'processing') {
      return { state: 'processing', stepId: step.id };
    }
    if (state === 'unknown') {
      return { state: 'unknown', stepId: step.id };
    }
    if (state === 'failed') {
      return {
        state: 'failed',
        stepId: step.id,
        errorCode: 'automation_step_failed',
      };
    }
    if (state !== 'done' && state !== 'skipped') {
      return {
        state: 'failed',
        stepId: step.id,
        errorCode: 'automation_step_state_invalid',
      };
    }

    if (step.step_type === 'wait') {
      return { state: 'waiting', stepId: step.id };
    }

    if (step.step_type === 'condition') {
      const nested = await runScope(
        context,
        steps,
        step.id,
        selectedBranch,
        new Set(visiting).add(step.id)
      );
      if (nested.state !== 'completed') return nested;
    }
  }
  return { state: 'completed' };
}

/** Runs the reachable steps of one already-claimed Evolution automation root. */
export async function executeEvolutionAutomationDispatch(
  input: ReservedEvolutionAutomationDispatch
): Promise<EvolutionAutomationOrchestrationResult> {
  const prepared = await prepareEvolutionAutomationDispatch(input);
  if (prepared.state === 'skipped') {
    return { state: 'skipped', dispatch_id: prepared.dispatch_id };
  }
  const context = prepared.context;
  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select(
      'id,automation_id,parent_step_id,branch,step_type,step_config,position,created_at'
    )
    .eq('automation_id', context.dispatch.automation_id)
    .order('position', { ascending: true });
  if (error) throw new Error('Could not load persisted automation steps');

  let steps: PersistedAutomationStep[];
  try {
    steps = parseSteps(data, context.dispatch.automation_id);
  } catch {
    return completeRoot(context, 'failed', 'automation_steps_invalid');
  }

  let outcome: ScopeResult;
  try {
    outcome = await runScope(context, steps, null, null, new Set());
  } catch (error) {
    if (error instanceof InvalidAutomationDefinitionError) {
      return completeRoot(context, 'failed', error.code);
    }
    if (
      error instanceof EvolutionAutomationStepError &&
      PERMANENT_LOCAL_STEP_ERRORS.has(error.code)
    ) {
      return completeRoot(context, 'failed', error.code);
    }
    throw error;
  }

  switch (outcome.state) {
    case 'completed':
      return completeRoot(context, 'done', null);
    case 'failed':
      return completeRoot(
        context,
        'failed',
        outcome.errorCode ?? 'automation_step_failed'
      );
    case 'unknown':
      return completeRoot(context, 'unknown', 'outcome_unknown');
    case 'waiting':
      return waiting(context, outcome.stepId!);
    case 'processing':
      return processing(context, outcome.stepId!);
  }
}
