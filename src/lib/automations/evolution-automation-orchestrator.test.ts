import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  steps: [] as Record<string, unknown>[],
  queryError: null as { message: string } | null,
  completion: null as Record<string, unknown> | null,
  completedWaits: [] as Record<string, unknown>[],
  completedWaitLedger: null as Record<string, unknown> | null,
  prepare: vi.fn(),
  condition: vi.fn(),
  effect: vi.fn(),
  send: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        maybeSingle: async () => ({
          data: h.completedWaitLedger,
          error: h.queryError,
        }),
        order: () =>
          table === 'automation_steps'
            ? Promise.resolve({ data: h.steps, error: h.queryError })
            : query,
        limit: async () => ({ data: h.completedWaits, error: h.queryError }),
      };
      h.calls.push({ name: `from:${table}` });
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      return { data: h.completion ? [h.completion] : null, error: null };
    },
  }),
}));
vi.mock('@/lib/automations/evolution-dispatch-preparer', () => ({
  prepareEvolutionAutomationDispatch: h.prepare,
}));
vi.mock('@/lib/automations/evolution-condition-executor', () => ({
  executeEvolutionAutomationCondition: h.condition,
}));
vi.mock('@/lib/automations/evolution-step-executor', () => ({
  EvolutionAutomationStepError: class EvolutionAutomationStepError extends Error {
    constructor(readonly code: string) {
      super('step executor error');
    }
  },
  executeEvolutionAutomationStep: h.effect,
}));
vi.mock('@/lib/automations/evolution-send-message-executor', () => ({
  executeEvolutionAutomationSendMessage: h.send,
}));

import { executeEvolutionAutomationDispatch } from './evolution-automation-orchestrator';
import { EvolutionAutomationStepError } from '@/lib/automations/evolution-step-executor';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_TOKEN = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000004';
const USER_ID = '00000000-0000-4000-8000-000000000005';
const CONTACT_ID = '00000000-0000-4000-8000-000000000006';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000007';
const LOG_ID = '00000000-0000-4000-8000-000000000008';
const EVENT_ID = '00000000-0000-4000-8000-000000000009';
const ids = [
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000013',
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000015',
];

const input = {
  dispatch_id: ROOT_ID,
  lease_token: ROOT_TOKEN,
  account_id: ACCOUNT_ID,
  isFirstInbound: true,
};

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

function completed(state: string) {
  h.completion = { id: ROOT_ID, state };
}

function waitLedger(actionKey: string) {
  h.completedWaitLedger = {
    id: ids[4],
    dispatch_id: ROOT_ID,
    action_key: actionKey,
    state: 'done',
    request_id: `evolution-step:${ids[4]}`,
    result: { pending_execution_id: ids[5] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.queryError = null;
  h.completion = null;
  h.completedWaits = [];
  h.completedWaitLedger = null;
  h.steps = [];
  h.prepare.mockResolvedValue({
    state: 'ready',
    context: {
      dispatch: {
        id: ROOT_ID,
        lease_token: ROOT_TOKEN,
        account_id: ACCOUNT_ID,
        automation_id: AUTOMATION_ID,
        user_id: USER_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONVERSATION_ID,
        automation_log_id: LOG_ID,
      },
      event: {
        id: EVENT_ID,
        external_message_id: 'event-local',
        occurred_at: '2026-11-16T00:00:00.000Z',
        text: 'local fixture',
      },
      automation: {
        id: AUTOMATION_ID,
        account_id: ACCOUNT_ID,
        user_id: USER_ID,
        trigger_type: 'new_message_received',
        trigger_config: {},
      },
    },
  });
  h.condition.mockResolvedValue({
    executed: true,
    state: 'done',
    branch: 'yes',
  });
  h.effect.mockResolvedValue({ executed: true, state: 'done' });
  h.send.mockResolvedValue({ executed: true, state: 'done' });
});

describe('executeEvolutionAutomationDispatch', () => {
  it('walks each scope by position, traverses only the selected branch, then resumes its parent', async () => {
    const [conditionId, yesLaterId, yesFirstId, noId, sendId] = ids;
    h.steps = [
      step(conditionId!, 'condition', 1),
      step(yesLaterId!, 'add_tag', 8, conditionId!, 'yes'),
      step(yesFirstId!, 'remove_tag', 2, conditionId!, 'yes'),
      step(noId!, 'create_deal', 1, conditionId!, 'no'),
      step(sendId!, 'send_message', 5),
    ];
    h.condition.mockResolvedValue({
      executed: true,
      state: 'done',
      branch: 'yes',
    });
    completed('done');

    const result = await executeEvolutionAutomationDispatch(input);

    expect(result).toEqual({ state: 'done', dispatch_id: ROOT_ID });
    expect(h.condition).toHaveBeenCalledWith({
      root: { id: ROOT_ID, lease_token: ROOT_TOKEN, account_id: ACCOUNT_ID },
      step: { id: conditionId },
    });
    expect(h.effect.mock.calls.map(([args]) => args.step.id)).toEqual([
      yesFirstId,
      yesLaterId,
    ]);
    expect(h.send.mock.calls.map(([args]) => args.step.id)).toEqual([sendId]);
    expect(
      h.calls.find((call) => call.name === 'complete_evolution_dispatch')
    ).toMatchObject({ args: { p_state: 'done', p_result: null } });
  });

  it('uses a persisted condition branch on replay and does not rerun the other branch', async () => {
    const [conditionId, yesId, noId] = ids;
    h.steps = [
      step(conditionId!, 'condition', 1),
      step(yesId!, 'add_tag', 1, conditionId!, 'yes'),
      step(noId!, 'remove_tag', 1, conditionId!, 'no'),
    ];
    h.condition.mockResolvedValue({
      executed: false,
      state: 'done',
      branch: 'no',
    });
    completed('done');

    await executeEvolutionAutomationDispatch(input);

    expect(h.condition).toHaveBeenCalledOnce();
    expect(h.effect.mock.calls.map(([args]) => args.step.id)).toEqual([noId]);
  });

  it('recovers from a crash after wait ack using the latest validated persisted cursor', async () => {
    const [waitId, afterWaitId] = ids;
    h.steps = [step(waitId!, 'wait', 1), step(afterWaitId!, 'add_tag', 2)];
    h.completedWaits = [
      {
        id: ids[5],
        parked_step_id: waitId,
        parent_step_id: null,
        branch: null,
        next_step_position: 2,
        evolution_dispatch_step_id: ids[4],
      },
    ];
    h.completedWaitLedger = {
      id: ids[4],
      dispatch_id: ROOT_ID,
      action_key: waitId,
      state: 'done',
      request_id: `evolution-step:${ids[4]}`,
      result: { pending_execution_id: ids[5] },
    };
    completed('done');

    const result = await executeEvolutionAutomationDispatch(input);

    expect(result).toEqual({ state: 'done', dispatch_id: ROOT_ID });
    expect(h.effect.mock.calls.map(([args]) => args.step.id)).toEqual([
      afterWaitId,
    ]);
  });

  it.each([
    [
      'newly executed wait',
      {
        executed: true,
        state: 'done',
        result: {
          pending_execution_id: ids[5],
          step_id: ids[4],
        },
      },
    ],
    [
      'replayed wait',
      {
        executed: false,
        state: 'done',
        result: {
          pending_execution_id: ids[5],
          step_id: ids[4],
        },
      },
    ],
  ])(
    'suspends on a %s without advancing or completing the root',
    async (_label, waitResult) => {
      const [waitId, sendId] = ids;
      h.steps = [step(waitId!, 'wait', 1), step(sendId!, 'send_message', 2)];
      h.effect.mockResolvedValue(waitResult);
      waitLedger(waitId!);

      const result = await executeEvolutionAutomationDispatch(input);

      expect(result).toEqual({
        state: 'waiting',
        dispatch_id: ROOT_ID,
        step_id: waitId,
      });
      expect(h.send).not.toHaveBeenCalled();
      expect(
        h.calls.some((call) => call.name === 'complete_evolution_dispatch')
      ).toBe(false);
    }
  );

  it('suspends on a processing step and leaves later steps untouched', async () => {
    const [sendId, effectId] = ids;
    h.steps = [step(sendId!, 'send_message', 1), step(effectId!, 'add_tag', 2)];
    h.send.mockResolvedValue({ executed: false, state: 'processing' });

    const result = await executeEvolutionAutomationDispatch(input);

    expect(result).toEqual({
      state: 'processing',
      dispatch_id: ROOT_ID,
      step_id: sendId,
    });
    expect(h.effect).not.toHaveBeenCalled();
    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch')
    ).toBe(false);
  });

  it.each([
    ['failed', 'failed'],
    ['unknown', 'unknown'],
  ] as const)(
    'stops and finalizes a terminal %s step as root %s',
    async (stepState, rootState) => {
      const [failedStepId, laterId] = ids;
      h.steps = [
        step(failedStepId!, 'add_tag', 1),
        step(laterId!, 'send_message', 2),
      ];
      h.effect.mockResolvedValue({ executed: false, state: stepState });
      completed(rootState);

      const result = await executeEvolutionAutomationDispatch(input);

      expect(result).toEqual({ state: rootState, dispatch_id: ROOT_ID });
      expect(h.send).not.toHaveBeenCalled();
      expect(
        h.calls.find((call) => call.name === 'complete_evolution_dispatch')
      ).toMatchObject({ args: { p_state: rootState } });
    }
  );

  it('completes the root failed when a blocked step type is reached', async () => {
    const [blockedId, laterId] = ids;
    h.steps = [
      step(blockedId!, 'send_buttons', 1),
      step(laterId!, 'send_message', 2),
    ];
    h.effect.mockRejectedValue(
      new EvolutionAutomationStepError(
        'unsupported_step_type',
        'Unsupported in the test fixture'
      )
    );
    completed('failed');

    const result = await executeEvolutionAutomationDispatch(input);

    expect(result).toEqual({ state: 'failed', dispatch_id: ROOT_ID });
    expect(h.send).not.toHaveBeenCalled();
    expect(
      h.calls.find((call) => call.name === 'complete_evolution_dispatch')
    ).toMatchObject({
      args: { p_state: 'failed', p_error_code: 'unsupported_step_type' },
    });
  });
});
