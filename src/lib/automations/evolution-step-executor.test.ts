import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationStep } from '@/types';

const h = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  claimData: undefined as unknown,
  claimError: null as { code?: string; message: string } | null,
  effectData: undefined as unknown,
  effectError: null as { code?: string; message: string } | null,
  currency: 'BRL' as string | null,
  currencyError: null as { message: string } | null,
  accountReads: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      if (name === 'claim_evolution_dispatch_step') {
        return { data: h.claimData, error: h.claimError };
      }
      return { data: h.effectData, error: h.effectError };
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          h.accountReads.push({ table, filters });
          return {
            data: h.currency === null ? null : { default_currency: h.currency },
            error: h.currencyError,
          };
        },
      };
      return query;
    },
  }),
}));

import { executeEvolutionAutomationStep } from './evolution-step-executor';

const ROOT = {
  id: '00000000-0000-4000-8000-000000000001',
  lease_token: '00000000-0000-4000-8000-000000000002',
  account_id: '00000000-0000-4000-8000-000000000003',
  contact_id: '00000000-0000-4000-8000-000000000004',
  conversation_id: '00000000-0000-4000-8000-000000000005',
};
const STEP_ID = '00000000-0000-4000-8000-000000000006';
const STEP_TOKEN = '00000000-0000-4000-8000-000000000007';
const STEP_UUID = '00000000-0000-4000-8000-000000000008';

function step(
  step_type: AutomationStep['step_type'],
  step_config: Record<string, unknown>
): AutomationStep {
  return {
    id: STEP_ID,
    automation_id: '00000000-0000-4000-8000-000000000009',
    step_type,
    step_config,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function claimed(should_execute: boolean) {
  h.claimData = [
    {
      step_id: STEP_ID,
      state: should_execute ? 'processing' : 'done',
      lease_token: should_execute ? STEP_TOKEN : null,
      request_id: `evolution-step:${STEP_UUID}`,
      send_attempt_id: null,
      should_execute,
    },
  ];
}

beforeEach(() => {
  h.calls = [];
  h.claimData = undefined;
  h.claimError = null;
  h.effectData = [
    { step_id: STEP_ID, state: 'done', result: { applied: true } },
  ];
  h.effectError = null;
  h.currency = 'BRL';
  h.currencyError = null;
  h.accountReads = [];
});

describe('executeEvolutionAutomationStep', () => {
  it('does not apply an effect when the claim says not to execute', async () => {
    claimed(false);

    const result = await executeEvolutionAutomationStep({
      root: ROOT,
      step: step('add_tag', { tag_id: STEP_UUID }),
    });

    expect(result).toMatchObject({
      executed: false,
      state: 'done',
      step_id: STEP_ID,
    });
    expect(h.calls.map((call) => call.name)).toEqual([
      'claim_evolution_dispatch_step',
    ]);
  });

  it.each([
    [
      'add_tag',
      { tag_id: STEP_UUID },
      'add_tag',
      {
        contact_id: ROOT.contact_id,
        tag_id: STEP_UUID,
      },
    ],
    [
      'remove_tag',
      { tag_id: STEP_UUID },
      'remove_tag',
      {
        contact_id: ROOT.contact_id,
        tag_id: STEP_UUID,
      },
    ],
    [
      'update_contact_field',
      { field: 'name', value: 'Customer' },
      'update_contact_field',
      {
        contact_id: ROOT.contact_id,
        field: 'name',
        value: 'Customer',
      },
    ],
    [
      'assign_conversation',
      { mode: 'specific', agent_id: STEP_UUID },
      'assign_conversation',
      {
        conversation_id: ROOT.conversation_id,
        assigned_agent_id: STEP_UUID,
      },
    ],
    ['wait', { amount: 1, unit: 'hours' }, 'wait', {}],
  ] as const)(
    'builds the persisted %s effect payload with root lineage',
    async (type, config, operation, payload) => {
      claimed(true);

      const result = await executeEvolutionAutomationStep({
        root: ROOT,
        step: step(type, config as Record<string, unknown>),
      });

      expect(result).toMatchObject({
        executed: true,
        state: 'done',
        step_id: STEP_ID,
      });
      expect(h.calls).toEqual([
        {
          name: 'claim_evolution_dispatch_step',
          args: {
            p_dispatch_id: ROOT.id,
            p_dispatch_lease_token: ROOT.lease_token,
            p_action_key: STEP_ID,
          },
        },
        {
          name: 'apply_evolution_automation_effect',
          args: {
            p_dispatch_id: ROOT.id,
            p_dispatch_lease_token: ROOT.lease_token,
            p_step_id: STEP_ID,
            p_step_lease_token: STEP_TOKEN,
            p_operation: operation,
            p_payload: payload,
          },
        },
      ]);
    }
  );

  it('derives deal currency from the root account and defaults the legacy value', async () => {
    claimed(true);

    await executeEvolutionAutomationStep({
      root: ROOT,
      step: step('create_deal', {
        pipeline_id: STEP_UUID,
        stage_id: '00000000-0000-4000-8000-000000000010',
        title: 'Follow up',
      }),
    });

    expect(h.accountReads).toEqual([
      { table: 'accounts', filters: [['id', ROOT.account_id]] },
    ]);
    expect(h.calls[1]).toMatchObject({
      name: 'apply_evolution_automation_effect',
      args: {
        p_operation: 'create_deal',
        p_payload: {
          contact_id: ROOT.contact_id,
          pipeline_id: STEP_UUID,
          stage_id: '00000000-0000-4000-8000-000000000010',
          title: 'Follow up',
          value: 0,
          currency: 'BRL',
          status: 'open',
        },
      },
    });
  });

  it('stops on stale claim and effect errors', async () => {
    h.claimError = { code: '55000', message: 'stale root token' };
    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('wait', { amount: 1, unit: 'hours' }),
      })
    ).rejects.toMatchObject({ code: 'stale_lease' });
    expect(h.calls).toHaveLength(1);

    h.calls = [];
    h.claimError = null;
    claimed(true);
    h.effectError = { code: '55000', message: 'stale step token' };
    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('wait', { amount: 1, unit: 'hours' }),
      })
    ).rejects.toMatchObject({ code: 'stale_lease' });
    expect(h.calls.map((call) => call.name)).toEqual([
      'claim_evolution_dispatch_step',
      'apply_evolution_automation_effect',
    ]);
  });

  it('rejects an executable claim without a lease token', async () => {
    h.claimData = [
      {
        step_id: STEP_ID,
        state: 'processing',
        lease_token: null,
        request_id: null,
        send_attempt_id: null,
        should_execute: true,
      },
    ];

    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('wait', { amount: 1, unit: 'hours' }),
      })
    ).rejects.toMatchObject({ code: 'claim_response_invalid' });
    expect(h.calls.map((call) => call.name)).toEqual([
      'claim_evolution_dispatch_step',
    ]);
  });

  it('rejects unsupported and non-specific assignment steps before claiming', async () => {
    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('send_message', { text: 'hello' }),
      })
    ).rejects.toMatchObject({ code: 'unsupported_step_type' });
    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('assign_conversation', { mode: 'round_robin' }),
      })
    ).rejects.toMatchObject({ code: 'unsupported_assignment_mode' });
    expect(h.calls).toHaveLength(0);
  });

  it('fails closed on legacy interpolation without execution context', async () => {
    await expect(
      executeEvolutionAutomationStep({
        root: ROOT,
        step: step('update_contact_field', {
          field: 'name',
          value: '{{ message.text }}',
        }),
      })
    ).rejects.toMatchObject({ code: 'interpolation_context_required' });
    expect(h.calls).toHaveLength(0);
  });
});
