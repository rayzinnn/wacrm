import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claims: [] as unknown[] | null,
  claimError: null as { message: string } | null,
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  execute: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      return { data: h.claims, error: h.claimError };
    },
  }),
}));
vi.mock('@/lib/automations/evolution-automation-orchestrator', () => ({
  executeEvolutionAutomationDispatch: h.execute,
}));

import { runEvolutionAutomationDispatchBatch } from './evolution-automation-dispatch-worker';

const AUTOMATION_ID = '00000000-0000-4000-8000-000000000001';
const FLOW_ID = '00000000-0000-4000-8000-000000000002';
const AI_ID = '00000000-0000-4000-8000-000000000003';
const TOKEN = '00000000-0000-4000-8000-000000000004';
const ACCOUNT = '00000000-0000-4000-8000-000000000005';

function root(id: string, engine = 'automation') {
  return {
    id,
    engine,
    account_id: ACCOUNT,
    state: 'processing',
    lease_token: TOKEN,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.claimError = null;
  h.claims = [];
  h.execute.mockResolvedValue({ state: 'done', dispatch_id: AUTOMATION_ID });
});

describe('runEvolutionAutomationDispatchBatch', () => {
  it('claims automation roots only and defaults to a one-root lease window', async () => {
    h.claims = [root(AUTOMATION_ID)];

    const result = await runEvolutionAutomationDispatchBatch();

    expect(h.calls).toEqual([
      {
        name: 'claim_evolution_automation_dispatches',
        args: { p_limit: 1, p_lease_seconds: 60 },
      },
    ]);
    expect(h.execute).toHaveBeenCalledWith({
      dispatch_id: AUTOMATION_ID,
      lease_token: TOKEN,
      account_id: ACCOUNT,
    });
    expect(result).toEqual({
      claimed: 1,
      outcomes: [{ state: 'done', dispatch_id: AUTOMATION_ID }],
    });
  });

  it('rejects a multi-root batch before claiming without lease renewal support', async () => {
    await expect(
      runEvolutionAutomationDispatchBatch({ limit: 2 })
    ).rejects.toThrow('limit must be 1');

    expect(h.calls).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('fails closed if the claim RPC returns more roots than its requested limit', async () => {
    h.claims = [root(AUTOMATION_ID), root(FLOW_ID)];

    const result = await runEvolutionAutomationDispatchBatch();

    expect(h.execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      claimed: 2,
      outcomes: [
        {
          state: 'error',
          dispatch_id: AUTOMATION_ID,
          error_code: 'claim_limit_exceeded',
        },
        {
          state: 'error',
          dispatch_id: FLOW_ID,
          error_code: 'claim_limit_exceeded',
        },
      ],
    });
  });

  it.each([
    [FLOW_ID, 'flow'],
    [AI_ID, 'ai'],
  ])('does not process an unexpected %s root', async (id, engine) => {
    h.claims = [root(id, engine)];

    const result = await runEvolutionAutomationDispatchBatch();

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      { state: 'error', dispatch_id: id, error_code: 'unexpected_engine' },
    ]);
  });

  it('returns a sanitized error for a failed root', async () => {
    h.claims = [root(AUTOMATION_ID)];
    h.execute.mockRejectedValueOnce({
      code: 'stale_lease',
      message: 'sensitive detail is not returned',
    });

    const result = await runEvolutionAutomationDispatchBatch();

    expect(result.outcomes).toEqual([
      {
        state: 'error',
        dispatch_id: AUTOMATION_ID,
        error_code: 'stale_lease',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('sensitive detail');
  });

  it('returns a wait as suspended and performs no root completion itself', async () => {
    h.claims = [root(AUTOMATION_ID)];
    h.execute.mockResolvedValue({
      state: 'waiting',
      dispatch_id: AUTOMATION_ID,
      step_id: '00000000-0000-4000-8000-000000000006',
    });

    const result = await runEvolutionAutomationDispatchBatch();

    expect(result.outcomes[0]).toMatchObject({
      state: 'waiting',
      dispatch_id: AUTOMATION_ID,
    });
    expect(h.calls).toHaveLength(1);
  });
});
