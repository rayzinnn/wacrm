import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  accountId: 'account-1' as string | null,
  clientError: null as string | null,
  rateLimitOk: true,
  authCalls: 0,
  rateLimitCalls: 0,
  tables: [] as string[],
  filters: [] as Array<[string, string, string]>,
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init: ResponseInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(body), { ...init, headers });
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (h.clientError) throw new Error(h.clientError);
    return {
      auth: {
        getUser: async () => {
          h.authCalls += 1;
          return { data: { user: h.user }, error: null };
        },
      },
      from(table: string) {
        h.tables.push(table);
        const chain = {
          select: () => chain,
          eq: (column: string, value: string) => {
            h.filters.push([table, column, value]);
            return chain;
          },
          maybeSingle: async () => ({
            data:
              table === 'profiles' && h.accountId
                ? { account_id: h.accountId }
                : null,
            error: null,
          }),
        };
        return chain;
      },
    };
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { whatsappMedia: { limit: 240, windowMs: 60_000 } },
  checkRateLimit: () => {
    h.rateLimitCalls += 1;
    return { success: h.rateLimitOk };
  },
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.getMediaUrl,
  downloadMedia: h.downloadMedia,
}));

import { GET } from './route';

const fetchMock = vi.fn();

function call(mediaId = 'media-1') {
  return GET(new Request(`http://localhost/api/whatsapp/media/${mediaId}`), {
    params: Promise.resolve({ mediaId }),
  });
}

function expectNoTransport() {
  expect(h.getMediaUrl).not.toHaveBeenCalled();
  expect(h.downloadMedia).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: 'user-1' };
  h.accountId = 'account-1';
  h.rateLimitOk = true;
  h.authCalls = 0;
  h.rateLimitCalls = 0;
  h.tables = [];
  h.filters = [];
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/whatsapp/media/[mediaId] temporary Evolution gate', () => {
  it('keeps the media id validation', async () => {
    const res = await call('');

    expect(res.status).toBe(400);
    expect(h.authCalls).toBe(0);
    expect(h.rateLimitCalls).toBe(0);
    expect(h.tables).toEqual([]);
    expectNoTransport();
  });

  it('rejects unauthenticated callers before rate limit, account lookup, or transport', async () => {
    h.user = null;

    const res = await call();

    expect(res.status).toBe(401);
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(0);
    expect(h.tables).toEqual([]);
    expectNoTransport();
  });

  it('enforces rate limit before account lookup or transport', async () => {
    h.rateLimitOk = false;

    const res = await call();

    expect(res.status).toBe(429);
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual([]);
    expectNoTransport();
  });

  it('requires an account link before returning the temporary unavailable response', async () => {
    h.accountId = null;

    const res = await call();

    expect(res.status).toBe(403);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual(['profiles']);
    expect(h.filters).toContainEqual(['profiles', 'user_id', 'user-1']);
    expectNoTransport();
  });

  it('returns unavailable without cache after auth, rate limit, and account scope, without reading media config or calling Meta', async () => {
    const res = await call();

    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual(['profiles']);
    expect(h.filters).toContainEqual(['profiles', 'user_id', 'user-1']);
    expect(h.filters).not.toContainEqual([
      'whatsapp_config',
      'account_id',
      'account-1',
    ]);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expectNoTransport();
  });

  it('sanitizes unexpected failures and marks the 500 response no-store', async () => {
    const privateDetails = 'synthetic-private-error-marker';
    h.clientError = privateDetails;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await call();
    const responseBody = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(responseBody).not.toContain(privateDetails);
    expect(errorSpy).toHaveBeenCalledWith('WhatsApp media GET failed');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(privateDetails);
    expectNoTransport();
  });
});
