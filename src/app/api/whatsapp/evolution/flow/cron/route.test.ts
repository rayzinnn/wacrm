import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ batch: vi.fn() }));

vi.mock('@/lib/flows/evolution-dispatch-worker', () => ({
  runEvolutionFlowDispatchBatch: worker.batch,
}));

import { GET, maxDuration, runtime } from './route';

const SECRET = 'synthetic-flow-cron-secret';
const URL = 'http://localhost/api/whatsapp/evolution/flow/cron?secret=ignored';

function request(authorization?: string) {
  return new Request(URL, {
    method: 'GET',
    headers: authorization ? { authorization } : undefined,
  });
}

describe('GET /api/whatsapp/evolution/flow/cron', () => {
  beforeEach(() => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', SECRET);
    worker.batch.mockReset().mockResolvedValue({
      claimed: 1,
      outcomes: [
        { status: 'done', flowRunId: 'private-run-id', transitions: 3 },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses Node runtime and limits execution duration to 60 seconds', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });

  it.each([
    ['missing bearer', undefined],
    ['incorrect bearer', 'Bearer wrong'],
    ['wrong-length bearer', `Bearer ${'x'.repeat(SECRET.length + 1)}`],
  ])(
    'rejects %s before claiming a Flow root',
    async (_label, authorization) => {
      const response = await GET(request(authorization));

      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: 'Unauthorized.',
        code: 'unauthorized',
      });
      expect(worker.batch).not.toHaveBeenCalled();
    }
  );

  it('returns a configuration error and does not claim when the secret is absent', async () => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', '');

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'Evolution Flow cron is not configured.',
      code: 'flow_cron_not_configured',
    });
    expect(worker.batch).not.toHaveBeenCalled();
  });

  it('runs a one-root batch and returns counts without IDs or tokens', async () => {
    worker.batch.mockResolvedValueOnce({
      claimed: 1,
      outcomes: [
        {
          status: 'waiting',
          flowRunId: 'private-run-id',
          nodeKey: 'private-node-key',
          leaseToken: 'private-lease-token',
        },
      ],
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(worker.batch).toHaveBeenCalledTimes(1);
    expect(worker.batch).toHaveBeenCalledWith({ limit: 1 });
    expect(body).toBe(
      JSON.stringify({
        flow: {
          claimed: 1,
          done: 0,
          skipped: 0,
          waiting: 1,
          unsupported: 0,
          terminalNonSuccess: 0,
          transitionLimit: 0,
          errors: 0,
        },
      })
    );
    expect(body).not.toContain('private-run-id');
    expect(body).not.toContain('private-node-key');
    expect(body).not.toContain('private-lease-token');
  });

  it('maps an executor error to counts without exposing its details', async () => {
    worker.batch.mockResolvedValueOnce({
      claimed: 1,
      outcomes: [
        {
          status: 'error',
          dispatchId: 'private-dispatch-id',
          errorCode: 'private_database_message',
        },
      ],
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"errors":1');
    expect(body).not.toContain('private-dispatch-id');
    expect(body).not.toContain('private_database_message');
  });

  it.each([
    ['done', 'done'],
    ['unsupported_node', 'unsupported'],
    ['terminal_non_success', 'terminalNonSuccess'],
    ['transition_limit', 'transitionLimit'],
  ] as const)('counts a %s outcome as %s', async (status, counter) => {
    worker.batch.mockResolvedValueOnce({
      claimed: 1,
      outcomes: [{ status }],
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.flow[counter]).toBe(1);
  });

  it('returns a fixed service error when the batch fails', async () => {
    worker.batch.mockRejectedValueOnce(new Error('private database details'));

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toBe(
      JSON.stringify({
        error: 'Evolution Flow processing is unavailable.',
        code: 'flow_cron_unavailable',
      })
    );
    expect(body).not.toContain('private database details');
  });

  it('rejects a malformed multi-root result without exposing its IDs', async () => {
    worker.batch.mockResolvedValueOnce({
      claimed: 2,
      outcomes: [{ status: 'done', flowRunId: 'private-run-id' }],
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).not.toContain('private-run-id');
  });
});
