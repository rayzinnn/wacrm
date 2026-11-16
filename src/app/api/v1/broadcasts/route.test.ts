import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  from: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
  resolveAuditUserId: vi.fn(),
  createBroadcast: vi.fn(),
  deliverBroadcast: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (callback: () => unknown) => mocks.afterCallbacks.push(callback),
}));
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));
vi.mock('@/lib/api/v1/contacts', () => ({
  ContactError: class ContactError extends Error {},
  resolveAuditUserId: mocks.resolveAuditUserId,
}));
vi.mock('@/lib/whatsapp/broadcast-core', () => ({
  BroadcastError: class BroadcastError extends Error {},
  createBroadcast: mocks.createBroadcast,
  deliverBroadcast: mocks.deliverBroadcast,
}));

import { POST } from './route';
import { ApiError } from '@/lib/api/v1/respond';

const expectedError = {
  error: {
    code: 'unsupported_capability',
    message: 'Broadcasts are not supported by this provider.',
  },
};

function request(body: string) {
  return new Request('https://x.test/api/v1/broadcasts', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  mocks.requireApiKey.mockReset().mockResolvedValue({
    supabase: { from: mocks.from },
    accountId: 'account-1',
  });
  mocks.from.mockReset();
  mocks.afterCallbacks = [];
  mocks.resolveAuditUserId.mockReset();
  mocks.createBroadcast.mockReset();
  mocks.deliverBroadcast.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/v1/broadcasts', () => {
  it('authenticates the send scope, then returns the same no-store 422 without reading the body or launching work', async () => {
    const payloads = [
      JSON.stringify({
        name: 'July promo',
        template_name: 'promo_july',
        recipients: [{ to: '+14155550123', params: ['Jane'] }],
      }),
      '{malformed-json',
    ];
    const requests = payloads.map(request);
    const json = requests.map((item) => vi.spyOn(item, 'json'));

    const responses = await Promise.all(requests.map((item) => POST(item)));

    for (let index = 0; index < responses.length; index += 1) {
      expect(responses[index].status).toBe(422);
      expect(responses[index].headers.get('cache-control')).toBe('no-store');
      expect(await responses[index].json()).toEqual(expectedError);
      expect(json[index]).not.toHaveBeenCalled();
      expect(mocks.requireApiKey).toHaveBeenNthCalledWith(index + 1, itemAt(requests, index), 'broadcasts:send');
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.resolveAuditUserId).not.toHaveBeenCalled();
    expect(mocks.createBroadcast).not.toHaveBeenCalled();
    expect(mocks.deliverBroadcast).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
  ] as const)('preserves auth status %s with no-store and stops before body/business work', async (status, code) => {
    mocks.requireApiKey.mockRejectedValueOnce(
      new ApiError(code, `auth-${status}`, status)
    );
    const item = request('{malformed-json');
    const json = vi.spyOn(item, 'json');

    const response = await POST(item);

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code, message: `auth-${status}` },
    });
    expect(mocks.requireApiKey).toHaveBeenCalledWith(item, 'broadcasts:send');
    expect(json).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.resolveAuditUserId).not.toHaveBeenCalled();
    expect(mocks.createBroadcast).not.toHaveBeenCalled();
    expect(mocks.deliverBroadcast).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

function itemAt<T>(items: T[], index: number): T {
  return items[index];
}
