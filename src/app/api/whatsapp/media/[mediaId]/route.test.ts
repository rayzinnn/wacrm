import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const eventId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const bytes = new TextEncoder().encode('synthetic image bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const storagePath = `account-${accountId}/evolution/${eventId}/payload.jpg`;

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  accountId: '33333333-3333-4333-8333-333333333333' as string | null,
  clientError: null as string | null,
  rateLimitOk: true,
  authCalls: 0,
  rateLimitCalls: 0,
  tables: [] as string[],
  filters: [] as Array<[string, string, string]>,
  adminTables: [] as string[],
  adminRows: {} as Record<string, Record<string, unknown> | null>,
  download: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      h.adminTables.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.adminRows[table] ?? null, error: null }),
      };
      return chain;
    },
    storage: { from: () => ({ download: h.download }) },
  }),
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

function call(mediaId = eventId, headers?: HeadersInit) {
  return GET(new Request(`http://localhost/api/whatsapp/media/${mediaId}`, { headers }), {
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
  h.accountId = accountId;
  h.rateLimitOk = true;
  h.authCalls = 0;
  h.rateLimitCalls = 0;
  h.tables = [];
  h.filters = [];
  h.adminTables = [];
  h.adminRows = {
    evolution_events: {
      id: eventId, connection_id: connectionId, state: 'done', media_state: 'stored',
      normalized_event: { kind: 'message', externalMessageId: 'remote-1', contentType: 'image' },
      media_storage_path: storagePath, media_type: 'image/jpeg', media_filename: 'photo.jpg',
      media_sha256: sha256, media_size_bytes: bytes.byteLength,
    },
    whatsapp_connections: { id: connectionId, account_id: accountId, provider: 'evolution' },
    messages: { conversation_id: conversationId, sender_type: 'customer', content_type: 'image', media_type: 'image/jpeg', media_url: `/api/whatsapp/media/${eventId}` },
    conversations: { id: conversationId, account_id: accountId },
  };
  h.download.mockResolvedValue({ data: { arrayBuffer: async () => bytes.buffer }, error: null });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/whatsapp/media/[mediaId] private Evolution media', () => {
  it('keeps the media id validation', async () => {
    const res = await call('');

    expect(res.status).toBe(400);
    expect(h.authCalls).toBe(0);
    expect(h.rateLimitCalls).toBe(0);
    expect(h.tables).toEqual([]);
    expect(h.adminTables).toEqual([]);
    expect(h.download).not.toHaveBeenCalled();
    expectNoTransport();
  });

  it('rejects unauthenticated callers before rate limit, account lookup, or transport', async () => {
    h.user = null;

    const res = await call();

    expect(res.status).toBe(401);
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(0);
    expect(h.tables).toEqual([]);
    expect(h.adminTables).toEqual([]);
    expect(h.download).not.toHaveBeenCalled();
    expectNoTransport();
  });

  it('enforces rate limit before account lookup or transport', async () => {
    h.rateLimitOk = false;

    const res = await call();

    expect(res.status).toBe(429);
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual([]);
    expect(h.adminTables).toEqual([]);
    expect(h.download).not.toHaveBeenCalled();
    expectNoTransport();
  });

  it('requires an account link before returning the temporary unavailable response', async () => {
    h.accountId = null;

    const res = await call();

    expect(res.status).toBe(403);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual(['profiles']);
    expect(h.filters).toContainEqual(['profiles', 'user_id', 'user-1']);
    expect(h.adminTables).toEqual([]);
    expect(h.download).not.toHaveBeenCalled();
    expectNoTransport();
  });

  it('returns verified private media after account, event, connection, message and conversation checks', async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''photo.jpg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(h.authCalls).toBe(1);
    expect(h.rateLimitCalls).toBe(1);
    expect(h.tables).toEqual(['profiles']);
    expect(h.filters).toContainEqual(['profiles', 'user_id', 'user-1']);
    expect(h.adminTables).toEqual(['evolution_events', 'whatsapp_connections', 'messages', 'conversations']);
    expect(h.download).toHaveBeenCalledWith(storagePath);
    expectNoTransport();
  });

  it('hides invalid ids, foreign connections and missing messages without downloading', async () => {
    expect((await call('invalid')).status).toBe(404);
    h.adminRows.whatsapp_connections = { id: connectionId, account_id: '55555555-5555-4555-8555-555555555555', provider: 'evolution' };
    expect((await call()).status).toBe(404);
    h.adminRows.whatsapp_connections = { id: connectionId, account_id: accountId, provider: 'evolution' };
    h.adminRows.conversations = { id: conversationId, account_id: '55555555-5555-4555-8555-555555555555' };
    expect((await call()).status).toBe(404);
    h.adminRows.conversations = { id: conversationId, account_id: accountId };
    h.adminRows.messages = null;
    expect((await call()).status).toBe(404);
    h.adminRows.messages = { conversation_id: conversationId, sender_type: 'customer', content_type: 'image', media_type: 'image/jpeg', media_url: `/api/whatsapp/media/${eventId}` };
    h.adminRows.evolution_events = { ...h.adminRows.evolution_events, media_storage_path: `account-${accountId}/evolution/${eventId}/wrong.jpg` };
    expect((await call()).status).toBe(404);
    expect(h.download).not.toHaveBeenCalled();
    expectNoTransport();
  });

  it('fails closed when downloaded bytes differ from the stored hash', async () => {
    h.download.mockResolvedValue({ data: { arrayBuffer: async () => new TextEncoder().encode('wrong').buffer }, error: null });
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expectNoTransport();
  });

  it('serves verified byte ranges for native audio and video players', async () => {
    const res = await call(eventId, { Range: 'bytes=2-5' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 2-5/${bytes.byteLength}`);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.slice(2, 6));
    const invalid = await call(eventId, { Range: 'bytes=999999-' });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.byteLength}`);
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
