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
vi.mock('@/lib/flows/evolution-executor', () => ({
  processEvolutionFlowRoot: h.execute,
}));

import { runEvolutionFlowDispatchBatch } from './evolution-dispatch-worker';

const FLOW_ID = '00000000-0000-4000-8000-000000000002';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000001';
const AI_ID = '00000000-0000-4000-8000-000000000003';
const TOKEN = '00000000-0000-4000-8000-000000000004';

function root(id: string, engine = 'flow') {
  return {
    id,
    engine,
    state: 'processing',
    lease_token: TOKEN,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.claimError = null;
  h.claims = [];
  h.execute.mockResolvedValue({
    status: 'done',
    flowRunId: '00000000-0000-4000-8000-000000000005',
    transitions: 4,
  });
});

describe('runEvolutionFlowDispatchBatch', () => {
  it('claims only Flow roots with a one-root lease window and calls the existing executor', async () => {
    h.claims = [root(FLOW_ID)];

    const result = await runEvolutionFlowDispatchBatch();

    expect(h.calls).toEqual([
      {
        name: 'claim_evolution_flow_dispatches',
        args: { p_limit: 1, p_lease_seconds: 60 },
      },
    ]);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledWith({
      dispatchId: FLOW_ID,
      leaseToken: TOKEN,
    });
    expect(result).toEqual({
      claimed: 1,
      outcomes: [
        {
          status: 'done',
          flowRunId: '00000000-0000-4000-8000-000000000005',
          transitions: 4,
        },
      ],
    });
  });

  it('rejects a batch larger than one before claiming', async () => {
    await expect(runEvolutionFlowDispatchBatch({ limit: 2 })).rejects.toThrow(
      'limit must be 1'
    );
    expect(h.calls).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('fails closed when a claim returns an unexpected engine', async () => {
    h.claims = [root(AUTOMATION_ID, 'automation')];

    const result = await runEvolutionFlowDispatchBatch();

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      {
        status: 'error',
        dispatchId: AUTOMATION_ID,
        errorCode: 'unexpected_engine',
      },
    ]);
  });

  it.each([AUTOMATION_ID, AI_ID])(
    'never calls the executor for non-Flow engine %s',
    async (id) => {
      h.claims = [root(id, id === AI_ID ? 'ai' : 'automation')];

      const result = await runEvolutionFlowDispatchBatch();

      expect(result.outcomes[0]).toMatchObject({
        status: 'error',
        errorCode: 'unexpected_engine',
      });
      expect(h.execute).not.toHaveBeenCalled();
    }
  );

  it('does not execute any row if the claim RPC violates the requested limit', async () => {
    h.claims = [root(FLOW_ID), root(AUTOMATION_ID, 'automation')];

    const result = await runEvolutionFlowDispatchBatch();

    expect(h.execute).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      {
        status: 'error',
        dispatchId: FLOW_ID,
        errorCode: 'claim_limit_exceeded',
      },
      {
        status: 'error',
        dispatchId: AUTOMATION_ID,
        errorCode: 'claim_limit_exceeded',
      },
    ]);
  });

  it('returns a sanitized root error and keeps a waiting Flow nonterminal', async () => {
    h.claims = [root(FLOW_ID)];
    h.execute.mockRejectedValueOnce({
      code: 'stale_root_lease',
      message: 'private database details',
    });

    const failed = await runEvolutionFlowDispatchBatch();

    expect(failed.outcomes).toEqual([
      {
        status: 'error',
        dispatchId: FLOW_ID,
        errorCode: 'stale_root_lease',
      },
    ]);
    expect(JSON.stringify(failed)).not.toContain('private database details');

    h.execute.mockResolvedValueOnce({
      status: 'waiting',
      flowRunId: '00000000-0000-4000-8000-000000000005',
      nodeKey: 'unsupported',
    });
    const waiting = await runEvolutionFlowDispatchBatch();
    expect(waiting.outcomes[0]).toMatchObject({ status: 'waiting' });
  });

  it('rejects invalid lease duration before claiming', async () => {
    await expect(
      runEvolutionFlowDispatchBatch({ leaseSeconds: 61 })
    ).rejects.toThrow('leaseSeconds must be an integer from 1 through 60');
    expect(h.calls).toEqual([]);
  });
});
