import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  claimRows: [] as Record<string, unknown>[],
  root: null as Record<string, unknown> | null,
  steps: [] as Record<string, unknown>[],
  pendingRow: null as Record<string, unknown> | null,
  waitDefinition: null as Record<string, unknown> | null,
  newWaitLedger: null as Record<string, unknown> | null,
  ackError: false,
  completionState: 'done' as string,
  appliedLocalSteps: new Set<string>(),
  effect: vi.fn(),
  condition: vi.fn(),
  send: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: h.steps, error: null }),
        maybeSingle: async () => {
          if (table === 'evolution_event_dispatches') {
            return { data: h.root, error: null };
          }
          if (table === 'automation_pending_executions') {
            return { data: h.pendingRow, error: null };
          }
          if (table === 'automation_steps') {
            return { data: h.waitDefinition, error: null };
          }
          if (table === 'evolution_dispatch_steps') {
            return { data: h.newWaitLedger, error: null };
          }
          return { data: null, error: null };
        },
      };
      h.calls.push({ name: `from:${table}` });
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      if (name === 'claim_evolution_automation_pending_executions') {
        return { data: h.claimRows, error: null };
      }
      if (name === 'start_evolution_event_dispatch') {
        return {
          data: [
            {
              dispatch_id: ROOT_ID,
              automation_log_id: LOG_ID,
              state: 'processing',
            },
          ],
          error: null,
        };
      }
      if (name === 'complete_evolution_automation_pending_execution') {
        return h.ackError
          ? { data: null, error: { code: '55000' } }
          : {
              data: [
                {
                  pending_execution_id: PENDING_ID,
                  status: 'done',
                  replayed: false,
                },
              ],
              error: null,
            };
      }
      if (name === 'complete_evolution_dispatch') {
        return {
          data: [{ id: ROOT_ID, state: args.p_state }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  }),
}));
vi.mock('@/lib/automations/evolution-step-executor', () => ({
  EvolutionAutomationStepError: class EvolutionAutomationStepError extends Error {
    constructor(readonly code: string) {
      super('step error');
    }
  },
  executeEvolutionAutomationStep: h.effect,
}));
vi.mock('@/lib/automations/evolution-condition-executor', () => ({
  executeEvolutionAutomationCondition: h.condition,
}));
vi.mock('@/lib/automations/evolution-send-message-executor', () => ({
  executeEvolutionAutomationSendMessage: h.send,
}));

import { consumeDueEvolutionAutomationWait } from './evolution-automation-pending-consumer';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_TOKEN = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000004';
const USER_ID = '00000000-0000-4000-8000-000000000005';
const CONTACT_ID = '00000000-0000-4000-8000-000000000006';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000007';
const LOG_ID = '00000000-0000-4000-8000-000000000008';
const WAIT_LEDGER_ID = '00000000-0000-4000-8000-000000000009';
const PENDING_ID = '00000000-0000-4000-8000-000000000010';
const PENDING_TOKEN = '00000000-0000-4000-8000-000000000011';
const ids = [
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000015',
  '00000000-0000-4000-8000-000000000016',
];

function step(
  id: string,
  step_type: string,
  position: number,
  parent_step_id: string | null = null,
  branch: 'yes' | 'no' | null = null
) {
  return {
    id,
    automation_id: AUTOMATION_ID,
    parent_step_id,
    branch,
    step_type,
    step_config: {},
    position,
    created_at: '2026-11-16T00:00:00.000Z',
  };
}

function makeClaim(
  parent_step_id: string | null,
  branch: 'yes' | 'no' | null,
  next_step_position: number,
  parked_step_id: string
) {
  return {
    pending_execution_id: PENDING_ID,
    dispatch_id: ROOT_ID,
    account_id: ACCOUNT_ID,
    user_id: USER_ID,
    automation_id: AUTOMATION_ID,
    log_id: LOG_ID,
    contact_id: CONTACT_ID,
    evolution_dispatch_step_id: WAIT_LEDGER_ID,
    parked_step_id,
    parent_step_id,
    branch,
    next_step_position,
    pending_lease_token: PENDING_TOKEN,
    dispatch_lease_token: ROOT_TOKEN,
  };
}

function setup(
  claim: Record<string, unknown>,
  steps: Record<string, unknown>[]
) {
  h.claimRows = [claim];
  h.root = {
    id: ROOT_ID,
    account_id: ACCOUNT_ID,
    engine: 'automation',
    automation_id: AUTOMATION_ID,
    user_id: USER_ID,
    contact_id: CONTACT_ID,
    conversation_id: CONVERSATION_ID,
    automation_log_id: LOG_ID,
    state: 'processing',
    lease_token: ROOT_TOKEN,
  };
  h.steps = steps;
  const parked = steps.find((item) => item.id === claim.parked_step_id)!;
  h.waitDefinition = {
    id: parked.id,
    parent_step_id: parked.parent_step_id,
    branch: parked.branch,
    position: parked.position,
    step_type: parked.step_type,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.claimRows = [];
  h.ackError = false;
  h.completionState = 'done';
  h.appliedLocalSteps = new Set();
  h.root = null;
  h.steps = [];
  h.pendingRow = {
    id: PENDING_ID,
    account_id: ACCOUNT_ID,
    automation_id: AUTOMATION_ID,
    log_id: LOG_ID,
    contact_id: CONTACT_ID,
    status: 'pending',
    evolution_dispatch_step_id: WAIT_LEDGER_ID,
    parked_step_id: ids[0],
    parent_step_id: null,
    branch: null,
    next_step_position: 2,
  };
  h.waitDefinition = null;
  h.newWaitLedger = null;
  h.effect.mockImplementation(
    async ({ step: current }: { step: { id: string } }) => {
      if (!h.appliedLocalSteps.has(current.id))
        h.appliedLocalSteps.add(current.id);
      return { executed: h.appliedLocalSteps.size === 1, state: 'done' };
    }
  );
  h.condition.mockResolvedValue({
    executed: false,
    state: 'done',
    branch: 'yes',
  });
  h.send.mockResolvedValue({ executed: false, state: 'done' });
});

describe('consumeDueEvolutionAutomationWait', () => {
  it('resumes a root cursor, acknowledges the wait, then completes the root', async () => {
    const [waitId, afterWaitId] = ids;
    setup(makeClaim(null, null, 2, waitId!), [
      step(waitId!, 'wait', 1),
      step(afterWaitId!, 'add_tag', 2),
    ]);

    const result = await consumeDueEvolutionAutomationWait();

    expect(result).toEqual({ state: 'done', dispatch_id: ROOT_ID });
    expect(h.effect).toHaveBeenCalledOnce();
    expect(h.effect.mock.calls[0]?.[0].step.id).toBe(afterWaitId);
    expect(h.calls.map((call) => call.name)).toEqual([
      'claim_evolution_automation_pending_executions',
      'from:evolution_event_dispatches',
      'start_evolution_event_dispatch',
      'from:automation_steps',
      'complete_evolution_automation_pending_execution',
      'complete_evolution_dispatch',
    ]);
  });

  it('ascends from a branch cursor after branch steps without replaying its condition', async () => {
    const [conditionId, waitId, branchStepId, rootNextId, noBranchId] = ids;
    setup(makeClaim(conditionId!, 'yes', 2, waitId!), [
      step(conditionId!, 'condition', 1),
      step(waitId!, 'wait', 1, conditionId!, 'yes'),
      step(branchStepId!, 'add_tag', 2, conditionId!, 'yes'),
      step(noBranchId!, 'remove_tag', 1, conditionId!, 'no'),
      step(rootNextId!, 'assign_conversation', 2),
    ]);

    const result = await consumeDueEvolutionAutomationWait();

    expect(result.state).toBe('done');
    expect(h.condition).not.toHaveBeenCalled();
    expect(h.effect.mock.calls.map(([args]) => args.step.id)).toEqual([
      branchStepId,
      rootNextId,
    ]);
    expect(
      h.effect.mock.calls.some(([args]) => args.step.id === noBranchId)
    ).toBe(false);
  });

  it('replays safely after a crash before ack using the persisted completed-step ledger', async () => {
    const [waitId, afterWaitId] = ids;
    setup(makeClaim(null, null, 2, waitId!), [
      step(waitId!, 'wait', 1),
      step(afterWaitId!, 'add_tag', 2),
    ]);
    h.ackError = true;
    await expect(consumeDueEvolutionAutomationWait()).rejects.toThrow(
      'Could not acknowledge'
    );
    expect(h.appliedLocalSteps.has(afterWaitId!)).toBe(true);
    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch')
    ).toBe(false);

    h.ackError = false;
    const result = await consumeDueEvolutionAutomationWait();

    expect(result.state).toBe('done');
    expect(h.effect).toHaveBeenCalledTimes(2);
    expect(h.appliedLocalSteps.size).toBe(1);
  });

  it('leaves the root open when the ack token is stale', async () => {
    const [waitId, afterWaitId] = ids;
    setup(makeClaim(null, null, 2, waitId!), [
      step(waitId!, 'wait', 1),
      step(afterWaitId!, 'add_tag', 2),
    ]);
    h.ackError = true;

    await expect(consumeDueEvolutionAutomationWait()).rejects.toThrow(
      'Could not acknowledge'
    );

    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch')
    ).toBe(false);
  });

  it('keeps the wait unacknowledged when the next step is still processing', async () => {
    const [waitId, stepId] = ids;
    setup(makeClaim(null, null, 2, waitId!), [
      step(waitId!, 'wait', 1),
      step(stepId!, 'add_tag', 2),
    ]);
    h.effect.mockResolvedValue({ executed: false, state: 'processing' });

    const result = await consumeDueEvolutionAutomationWait();

    expect(result).toEqual({
      state: 'processing',
      dispatch_id: ROOT_ID,
      step_id: stepId,
    });
    expect(
      h.calls.some(
        (call) =>
          call.name === 'complete_evolution_automation_pending_execution'
      )
    ).toBe(false);
    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch')
    ).toBe(false);
  });

  it('does not claim awaiting_reply waits', async () => {
    h.claimRows = [];

    const result = await consumeDueEvolutionAutomationWait();

    expect(result).toEqual({ state: 'idle' });
    expect(h.calls).toEqual([
      {
        name: 'claim_evolution_automation_pending_executions',
        args: { p_limit: 1, p_lease_seconds: 60 },
      },
    ]);
  });

  it('acks an old wait only after confirming a new temporal wait is parked', async () => {
    const [oldWaitId, nextWaitId] = ids;
    setup(makeClaim(null, null, 2, oldWaitId!), [
      step(oldWaitId!, 'wait', 1),
      step(nextWaitId!, 'wait', 2),
    ]);
    h.effect.mockImplementation(
      async ({ step: current }: { step: { id: string } }) =>
        current.id === nextWaitId
          ? {
              executed: true,
              state: 'done',
              result: {
                pending_execution_id: ids[3],
                step_id: ids[2],
              },
            }
          : { executed: false, state: 'done' }
    );
    h.pendingRow = {
      id: ids[3],
      account_id: ACCOUNT_ID,
      automation_id: AUTOMATION_ID,
      log_id: LOG_ID,
      contact_id: CONTACT_ID,
      status: 'pending',
      evolution_dispatch_step_id: ids[2],
      parked_step_id: nextWaitId,
      parent_step_id: null,
      branch: null,
      next_step_position: 3,
    };
    h.waitDefinition = {
      id: nextWaitId,
      parent_step_id: null,
      branch: null,
      position: 2,
      step_type: 'wait',
    };
    h.newWaitLedger = {
      id: ids[2],
      dispatch_id: ROOT_ID,
      action_key: nextWaitId,
      state: 'done',
      request_id: `evolution-step:${ids[2]}`,
      result: { pending_execution_id: ids[3] },
    };

    const result = await consumeDueEvolutionAutomationWait();

    expect(result).toEqual({
      state: 'waiting',
      dispatch_id: ROOT_ID,
      step_id: nextWaitId,
    });
    expect(
      h.calls.findIndex(
        (call) => call.name === 'from:automation_pending_executions'
      )
    ).toBeLessThan(
      h.calls.findIndex(
        (call) =>
          call.name === 'complete_evolution_automation_pending_execution'
      )
    );
    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch')
    ).toBe(false);
  });
});
