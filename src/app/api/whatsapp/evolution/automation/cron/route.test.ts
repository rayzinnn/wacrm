import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({
  calls: [] as string[],
  batch: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('@/lib/automations/evolution-automation-dispatch-worker', () => ({
  runEvolutionAutomationDispatchBatch: workers.batch,
}));
vi.mock('@/lib/automations/evolution-automation-pending-consumer', () => ({
  consumeDueEvolutionAutomationWait: workers.wait,
}));

import { GET, maxDuration, runtime } from './route';

const SECRET = 'synthetic-cron-secret-for-tests';
const URL =
  'http://localhost/api/whatsapp/evolution/automation/cron?secret=ignored';

function request(authorization?: string) {
  return new Request(URL, {
    method: 'GET',
    headers: authorization ? { authorization } : undefined,
  });
}

describe('GET /api/whatsapp/evolution/automation/cron', () => {
  beforeEach(() => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', SECRET);
    workers.calls = [];
    workers.batch.mockReset().mockImplementation(async (options) => {
      workers.calls.push('batch');
      expect(options).toEqual({ limit: 1 });
      return {
        claimed: 2,
        outcomes: [
          { state: 'done', dispatch_id: 'internal-id' },
          {
            state: 'error',
            dispatch_id: 'internal-id',
            error_code: 'secret-db-error',
          },
        ],
      };
    });
    workers.wait.mockReset().mockImplementation(async () => {
      workers.calls.push('wait');
      return { state: 'idle' };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the Node runtime and caps the route duration at 60 seconds', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });

  it.each([
    ['missing bearer', undefined],
    ['incorrect bearer', 'Bearer wrong'],
    ['wrong length bearer', `Bearer ${'x'.repeat(SECRET.length + 1)}`],
  ])(
    'rejects %s before invoking either worker',
    async (_label, authorization) => {
      const response = await GET(request(authorization));

      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: 'Unauthorized.',
        code: 'unauthorized',
      });
      expect(workers.calls).toEqual([]);
      expect(workers.batch).not.toHaveBeenCalled();
      expect(workers.wait).not.toHaveBeenCalled();
    }
  );

  it('does not invoke workers when the server secret is absent', async () => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', '');

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'Evolution automation cron is not configured.',
      code: 'automation_cron_not_configured',
    });
    expect(workers.calls).toEqual([]);
    expect(workers.batch).not.toHaveBeenCalled();
    expect(workers.wait).not.toHaveBeenCalled();
  });

  it('runs the root batch before temporal waits and returns sanitized counts', async () => {
    workers.wait.mockImplementationOnce(async () => {
      workers.calls.push('wait');
      return { state: 'done', dispatch_id: 'private-dispatch-id' };
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(workers.calls).toEqual(['batch', 'wait']);
    expect(body).toBe(
      JSON.stringify({
        automation: {
          claimed: 2,
          done: 1,
          skipped: 0,
          failed: 0,
          unknown: 0,
          waiting: 0,
          processing: 0,
          errors: 1,
        },
        temporal_wait: 'done',
      })
    );
    expect(body).not.toContain('internal-id');
    expect(body).not.toContain('secret-db-error');
    expect(body).not.toContain('private-dispatch-id');
  });

  it('does not run the wait consumer if the root batch fails and sanitizes the error', async () => {
    workers.batch.mockImplementationOnce(async () => {
      workers.calls.push('batch');
      throw new Error('private database details');
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(workers.calls).toEqual(['batch']);
    expect(workers.wait).not.toHaveBeenCalled();
    expect(body).toBe(
      JSON.stringify({
        error: 'Evolution automation processing is unavailable.',
        code: 'automation_cron_unavailable',
      })
    );
    expect(body).not.toContain('private database details');
  });

  it('returns the same sanitized service error if wait consumption fails', async () => {
    workers.wait.mockImplementationOnce(async () => {
      workers.calls.push('wait');
      throw new Error('private wait lease details');
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(workers.calls).toEqual(['batch', 'wait']);
    expect(body).not.toContain('private wait lease details');
  });

  it('awaits completion of the root batch before starting temporal wait consumption', async () => {
    let releaseBatch: (() => void) | undefined;
    workers.batch.mockImplementationOnce(() => {
      workers.calls.push('batch');
      return new Promise((resolve) => {
        releaseBatch = () => resolve({ claimed: 0, outcomes: [] });
      });
    });

    const responsePromise = GET(request(`Bearer ${SECRET}`));
    await Promise.resolve();
    expect(workers.calls).toEqual(['batch']);
    expect(workers.wait).not.toHaveBeenCalled();

    releaseBatch?.();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(workers.calls).toEqual(['batch', 'wait']);
  });
});
