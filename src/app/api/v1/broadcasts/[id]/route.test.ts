import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  from: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));

import { GET } from './route';
import { ApiError } from '@/lib/api/v1/respond';

const expectedError = {
  error: {
    code: 'unsupported_capability',
    message: 'Broadcasts are not supported by this provider.',
  },
};

function request() {
  return new Request('https://x.test/api/v1/broadcasts/not-a-uuid');
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue({
    supabase: { from: mocks.from },
    accountId: 'account-1',
  });
  mocks.from.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/v1/broadcasts/{id}', () => {
  it('authenticates the send scope, then returns the same no-store 422 for valid or malformed ids without reading params', async () => {
    const contexts = [context('f52c2b39-9690-4c48-a64e-e818bc48a91c'), context('not-a-uuid')];
    const responses = await Promise.all(
      contexts.map((item) => GET(request(), item))
    );

    for (let index = 0; index < responses.length; index += 1) {
      expect(responses[index].status).toBe(422);
      expect(responses[index].headers.get('cache-control')).toBe('no-store');
      expect(await responses[index].json()).toEqual(expectedError);
      expect(mocks.requireApiKey).toHaveBeenNthCalledWith(
        index + 1,
        expect.any(Request),
        'broadcasts:send'
      );
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves auth status 401/403/429 with no-store before inspecting params', async () => {
    for (const [status, code] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [429, 'rate_limited'],
    ] as const) {
      mocks.requireApiKey.mockRejectedValueOnce(
        new ApiError(code, `auth-${status}`, status)
      );
      const params = { then: vi.fn(() => { throw new Error('params read'); }) } as unknown as Promise<{ id: string }>;
      const item = request();

      const response = await GET(item, { params });

      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        error: { code, message: `auth-${status}` },
      });
      expect(params.then).not.toHaveBeenCalled();
      expect(mocks.requireApiKey).toHaveBeenLastCalledWith(item, 'broadcasts:send');
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not await caller params after successful authentication either', async () => {
    const params = { then: vi.fn(() => { throw new Error('params read'); }) } as unknown as Promise<{ id: string }>;

    const response = await GET(request(), { params });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(expectedError);
    expect(params.then).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
