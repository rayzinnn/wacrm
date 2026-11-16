import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ResolvedEvolutionMedia } from './media';

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mocks.admin,
}));

import {
  EvolutionMediaStorageError,
  stageEvolutionInboundMedia,
} from './media-storage';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherAccountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const connectionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const leaseToken = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const imageBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

const media: ResolvedEvolutionMedia = {
  bytes: imageBytes,
  mimeType: 'image/jpeg',
  filename: 'synthetic.jpg',
  contentType: 'image',
  sha256: createHash('sha256').update(imageBytes).digest('hex'),
};

function configureAdmin(
  options: {
    event?: Record<string, unknown> | null;
    connection?: Record<string, unknown> | null;
    stage?: unknown;
    upload?: (
      path: string,
      bytes: Uint8Array,
      options: Record<string, unknown>
    ) => Promise<unknown>;
    download?: (path: string) => Promise<unknown>;
  } = {}
) {
  const objectStore = new Map<string, Uint8Array>();
  const upload = vi.fn(
    async (
      path: string,
      bytes: Uint8Array,
      uploadOptions: Record<string, unknown>
    ) => {
      if (options.upload) return options.upload(path, bytes, uploadOptions);
      if (objectStore.has(path))
        return {
          data: null,
          error: { status: 409, code: 'ResourceAlreadyExists' },
        };
      objectStore.set(path, new Uint8Array(bytes));
      return { data: { path }, error: null };
    }
  );
  const download = vi.fn(async (path: string) => {
    if (options.download) return options.download(path);
    const bytes = objectStore.get(path);
    return bytes
      ? {
          data: new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer]),
          error: null,
        }
      : { data: null, error: { status: 404 } };
  });
  const bucket = { upload, download };
  const storageFrom = vi.fn(() => bucket);
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        if (table === 'evolution_events') {
          return {
            data:
              options.event === undefined
                ? {
                    id: eventId,
                    connection_id: connectionId,
                    state: 'processing',
                    lease_token: leaseToken,
                    lease_until: new Date(Date.now() + 30_000).toISOString(),
                    media_state: 'pending',
                  }
                : options.event,
            error: null,
          };
        }
        return {
          data:
            options.connection === undefined
              ? {
                  id: connectionId,
                  account_id: accountId,
                  provider: 'evolution',
                }
              : options.connection,
          error: null,
        };
      }),
    };
    return query;
  });
  mocks.rpc.mockImplementation(
    async () =>
      options.stage ?? {
        data: [
          {
            outcome: 'staged',
            media_storage_path: `account-${accountId}/evolution/${eventId}/payload.jpg`,
          },
        ],
        error: null,
      }
  );
  mocks.admin = {
    from: mocks.from,
    rpc: mocks.rpc,
    storage: { from: storageFrom },
  };
  return { upload, download, bucket, storageFrom };
}

beforeEach(() => {
  mocks.admin = undefined;
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('stageEvolutionInboundMedia', () => {
  it('derives the tenant path from the event connection and uploads without overwrite', async () => {
    const { upload, storageFrom } = configureAdmin();

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('staged');

    expect(upload).toHaveBeenCalledWith(
      `account-${accountId}/evolution/${eventId}/payload.jpg`,
      imageBytes,
      expect.objectContaining({
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '0',
      })
    );
    expect(mocks.rpc).toHaveBeenCalledWith('stage_evolution_media', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_sha256: media.sha256,
      p_size_bytes: imageBytes.byteLength,
      p_media_type: 'image/jpeg',
      p_filename: 'synthetic.jpg',
    });
    expect(storageFrom).toHaveBeenCalledWith('evolution-media');
  });

  it('rejects a caller-supplied tenant before any storage I/O', async () => {
    const { upload } = configureAdmin();
    const input = { eventId, leaseToken, media, accountId: otherAccountId };

    await expect(stageEvolutionInboundMedia(input)).rejects.toMatchObject({
      code: 'invalid_media',
    });

    expect(upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not upload or stage when the claim lease is stale', async () => {
    const { upload } = configureAdmin({
      event: {
        id: eventId,
        connection_id: connectionId,
        state: 'processing',
        lease_token: leaseToken,
        lease_until: new Date(Date.now() - 1_000).toISOString(),
        media_state: 'pending',
      },
    });

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('stale');

    expect(upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects non-Evolution or missing connection relations before storage I/O', async () => {
    const { upload } = configureAdmin({
      connection: {
        id: connectionId,
        account_id: otherAccountId,
        provider: 'meta',
      },
    });

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).rejects.toMatchObject({ code: 'stage_rejected' });

    expect(upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reuses a deterministic object on replay only when hash and size match', async () => {
    const { upload, download } = configureAdmin({
      stage: {
        data: [
          {
            outcome: 'duplicate',
            media_storage_path: `account-${accountId}/evolution/${eventId}/payload.jpg`,
          },
        ],
        error: null,
      },
    });
    await stageEvolutionInboundMedia({ eventId, leaseToken, media });

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('duplicate');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(
      `account-${accountId}/evolution/${eventId}/payload.jpg`
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'hash',
      new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x47,
      ]),
    ],
    ['size', imageBytes.subarray(0, imageBytes.length - 1)],
  ])(
    'rejects an existing deterministic object with a different %s',
    async (_label, existingBytes) => {
      const { upload } = configureAdmin({
        upload: async () => ({
          data: null,
          error: { status: 409, code: 'ResourceAlreadyExists' },
        }),
        download: async () => ({
          data: new Blob([existingBytes]),
          error: null,
        }),
      });

      await expect(
        stageEvolutionInboundMedia({ eventId, leaseToken, media })
      ).resolves.toBe('conflict');

      expect(upload).toHaveBeenCalledTimes(1);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it('recovers from a crash after upload by verifying the object before stage retry', async () => {
    const { upload, download } = configureAdmin();
    mocks.rpc
      .mockRejectedValueOnce(new Error('synthetic stage outage'))
      .mockResolvedValueOnce({
        data: [
          {
            outcome: 'staged',
            media_storage_path: `account-${accountId}/evolution/${eventId}/payload.jpg`,
          },
        ],
        error: null,
      });

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).rejects.toBeInstanceOf(EvolutionMediaStorageError);
    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('staged');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('returns stale from the fenced stage RPC without deleting the uploaded object', async () => {
    const { upload } = configureAdmin({
      stage: {
        data: [{ outcome: 'stale', media_storage_path: null }],
        error: null,
      },
    });

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('stale');

    expect(upload).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('treats a retry after stage commit as a duplicate without logging Storage details', async () => {
    const { upload, download } = configureAdmin({
      stage: undefined,
    });
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            outcome: 'staged',
            media_storage_path: `account-${accountId}/evolution/${eventId}/payload.jpg`,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: 'duplicate',
            media_storage_path: `account-${accountId}/evolution/${eventId}/payload.jpg`,
          },
        ],
        error: null,
      });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('staged');
    await expect(
      stageEvolutionInboundMedia({ eventId, leaseToken, media })
    ).resolves.toBe('duplicate');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});
