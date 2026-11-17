import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  rpc: vi.fn(),
  from: vi.fn(),
}))

const mediaMocks = vi.hoisted(() => ({
  resolveMedia: vi.fn(),
  stage: vi.fn(),
  enabledMedia: [] as string[],
  decrypt: vi.fn(() => 'decrypted-synthetic-token'),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    if (mocks.admin === 'throw-client') throw new Error('RAW_ADMIN_SECRET')
    return mocks.admin
  },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mediaMocks.decrypt }))
vi.mock('./inbound-media-capability', () => ({
  enabledEvolutionInboundMedia: () => mediaMocks.enabledMedia,
}))
vi.mock('./media', () => {
  class MockEvolutionMediaError extends Error {
    constructor(readonly code: string, readonly httpStatus: number | null = null) {
      super('Synthetic Evolution media failure.')
      this.name = 'EvolutionMediaError'
    }
  }
  return {
    EvolutionMediaError: MockEvolutionMediaError,
    resolveMedia: mediaMocks.resolveMedia,
  }
})
vi.mock('./media-storage', () => {
  class MockEvolutionMediaStorageError extends Error {
    constructor(readonly code: string) {
      super('Synthetic Evolution media storage failure.')
      this.name = 'EvolutionMediaStorageError'
    }
  }
  return {
    EvolutionMediaStorageError: MockEvolutionMediaStorageError,
    stageEvolutionInboundMedia: mediaMocks.stage,
  }
})

import { EvolutionMessageWorkerError, runEvolutionMessageBatch } from './message-worker'
import { EvolutionMediaError } from './media'
import { EvolutionMediaStorageError } from './media-storage'
import type { ResolvedEvolutionMedia } from './media'

const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const mediaRef = {
  version: 1 as const,
  key: {
    remoteJid: '5511999999999@s.whatsapp.net',
    id: 'SYNTHETIC_MEDIA_ID',
    fromMe: false as const,
  },
}
const resolvedMedia: ResolvedEvolutionMedia = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: 'image/jpeg',
  filename: 'synthetic.jpg',
  contentType: 'image',
  sha256: 'a'.repeat(64),
}

function mediaEvent(mediaState: 'pending' | 'stored', overrides: Record<string, unknown> = {}) {
  return claimedEvent('message', {
    media_state: mediaState,
    normalized_event: {
      kind: 'message',
      eventKey: 'synthetic-event-key',
      externalMessageId: mediaRef.key.id,
      peer: mediaRef.key.remoteJid,
      occurredAt: '2026-11-16T17:00:00.000Z',
      fromMe: false,
      sentByApi: false,
      contentType: 'image',
      text: null,
      mediaRef,
    },
    ...overrides,
  })
}

function claimedEvent(kind = 'message', overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    connection_id: connectionId,
    lease_token: leaseToken,
    normalized_event: { kind, contentType: 'text' },
    ...overrides,
  }
}

function configureWorker(claims: unknown[] = [claimedEvent()]) {
  mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_evolution_message_events') return { data: claims, error: null }
    if (name === 'apply_evolution_event') return { data: [{ outcome: 'applied', message_row_id: 'message-row' }], error: null }
    if (name === 'fail_evolution_event') {
      return { data: [{ state: args?.p_retryable === true ? 'pending' : 'failed' }], error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: 'unknown rpc' } }
  })
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => table === 'whatsapp_connections'
        ? {
            data: {
              id: connectionId,
              provider: 'evolution',
              base_url: 'http://127.0.0.1:8080',
              instance_name: 'synthetic-instance',
              token_encrypted: 'encrypted-synthetic-token',
            },
            error: null,
          }
        : { data: null, error: null }),
    }
    return query
  })
  mocks.admin = { rpc: mocks.rpc, from: mocks.from }
}

beforeEach(() => {
  mocks.admin = undefined
  mocks.rpc.mockReset()
  mocks.from.mockReset()
  mediaMocks.resolveMedia.mockReset().mockResolvedValue(resolvedMedia)
  mediaMocks.stage.mockReset().mockResolvedValue('staged')
  mediaMocks.enabledMedia = []
  mediaMocks.decrypt.mockReset().mockReturnValue('decrypted-synthetic-token')
})

afterEach(() => vi.restoreAllMocks())

describe('runEvolutionMessageBatch', () => {
  it('claims only a fixed message batch and applies each event with its current lease token', async () => {
    configureWorker()

    await expect(runEvolutionMessageBatch()).resolves.toEqual({
      claimed: 1,
      done: 1,
      retry: 0,
      failed: 0,
      stale: 0,
    })

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'claim_evolution_message_events', {
      p_limit: 10,
      p_lease_seconds: 60,
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'apply_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
    })
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'claim_evolution_events')).toBe(false)
  })

  it.each(['applied', 'duplicate', 'ignored'])('counts terminal %s as done', async (outcome) => {
    configureWorker()
    mocks.rpc.mockResolvedValueOnce({ data: [claimedEvent()], error: null })
      .mockResolvedValueOnce({ data: [{ outcome }], error: null })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ done: 1, retry: 0, failed: 0 })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('counts SQL failed and retry outcomes without applying an event a second time', async () => {
    const second = claimedEvent('message', {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      lease_token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    })
    configureWorker([claimedEvent(), second])
    mocks.rpc.mockResolvedValueOnce({ data: [claimedEvent(), second], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'failed' }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'retry' }], error: null })

    await expect(runEvolutionMessageBatch()).resolves.toEqual({
      claimed: 2,
      done: 0,
      retry: 1,
      failed: 1,
      stale: 0,
    })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(2)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'fail_evolution_event')).toBe(false)
  })

  it.each(['40001', 'P0002'])('counts stale apply lease %s without failing or reapplying', async (code) => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_message_events') return { data: [claimedEvent()], error: null }
      if (name === 'apply_evolution_event') return { data: null, error: { code, message: 'RAW_STALE_SECRET' } }
      return { data: null, error: null }
    })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ stale: 1, retry: 0, done: 0 })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'fail_evolution_event')).toBe(false)
  })

  it('routes transient apply errors through retryable fail and counts pending for recovery', async () => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_message_events') return { data: [claimedEvent()], error: null }
      if (name === 'apply_evolution_event') return { data: null, error: { code: 'XX000', message: 'RAW_DB_SECRET' } }
      if (name === 'fail_evolution_event') return { data: [{ state: 'pending' }], error: null }
      return { data: null, error: null }
    })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ retry: 1, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'database_unavailable',
      p_retryable: true,
    })
  })

  it('routes permanent content conflicts through non-retryable fail', async () => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_message_events') return { data: [claimedEvent()], error: null }
      if (name === 'apply_evolution_event') return { data: null, error: { code: '23505', message: 'RAW_CONFLICT_SECRET' } }
      if (name === 'fail_evolution_event') return { data: [{ state: 'failed' }], error: null }
      return { data: null, error: null }
    })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'message_conflict',
      p_retryable: false,
    })
  })

  it('fails a claim of a non-message kind without calling apply', async () => {
    configureWorker([claimedEvent('connection')])

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, done: 0 })
    expect(mocks.rpc).not.toHaveBeenCalledWith('apply_evolution_event', expect.anything())
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'unsupported_event_kind',
      p_retryable: false,
    })
  })

  it('isolates event errors and continues the rest of the claimed batch', async () => {
    const second = claimedEvent('message', {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      lease_token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    })
    configureWorker([claimedEvent(), second])
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_evolution_message_events') return { data: [claimedEvent(), second], error: null }
      if (name === 'apply_evolution_event' && args?.p_event_id === eventId) {
        return { data: null, error: { code: 'XX000', message: 'RAW_FIRST_SECRET' } }
      }
      if (name === 'fail_evolution_event') return { data: [{ state: 'pending' }], error: null }
      if (name === 'apply_evolution_event') return { data: [{ outcome: 'applied' }], error: null }
      return { data: null, error: null }
    })

    await expect(runEvolutionMessageBatch()).resolves.toEqual({
      claimed: 2,
      done: 1,
      retry: 1,
      failed: 0,
      stale: 0,
    })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(2)
  })

  it('counts a stale failure lease without retrying the apply operation', async () => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_message_events') return { data: [claimedEvent()], error: null }
      if (name === 'apply_evolution_event') return { data: null, error: { code: 'XX000', message: 'RAW_DB_SECRET' } }
      if (name === 'fail_evolution_event') return { data: null, error: { code: '40001', message: 'RAW_STALE_SECRET' } }
      return { data: null, error: null }
    })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ stale: 1, retry: 0 })
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'fail_evolution_event')).toHaveLength(1)
  })

  it('sanitizes claim errors into a 503 without a raw cause', async () => {
    configureWorker([])
    mocks.rpc.mockRejectedValue(new Error('RAW_CLAIM_SECRET'))

    const error = await runEvolutionMessageBatch().catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionMessageWorkerError)
    expect(error).toMatchObject({ code: 'message_event_worker_unavailable', status: 503 })
    expect((error as Error).message).not.toContain('RAW_CLAIM_SECRET')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('rejects malformed or oversized claim batches before applying any event', async () => {
    configureWorker([claimedEvent('message', { lease_token: '' })])

    await expect(runEvolutionMessageBatch()).rejects.toBeInstanceOf(EvolutionMessageWorkerError)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'apply_evolution_event')).toBe(false)

    configureWorker(Array.from({ length: 11 }, (_, index) => claimedEvent('message', { id: `event-${index}` })))
    await expect(runEvolutionMessageBatch()).rejects.toBeInstanceOf(EvolutionMessageWorkerError)
  })

  it('keeps media dormant while capability is empty and fails without I/O', async () => {
    configureWorker([mediaEvent('pending')])

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, done: 0 })

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mediaMocks.resolveMedia).not.toHaveBeenCalled()
    expect(mediaMocks.stage).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'unsupported_media_kind',
      p_retryable: false,
    })
  })

  it('resolves, stages, then applies pending enabled media with server connection credentials', async () => {
    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    vi.stubGlobal('fetch', vi.fn())

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ done: 1, retry: 0 })

    expect(mocks.from).toHaveBeenCalledWith('whatsapp_connections')
    expect(mediaMocks.decrypt).toHaveBeenCalledWith('encrypted-synthetic-token')
    expect(mediaMocks.resolveMedia).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8080',
      instanceId: 'synthetic-instance',
      token: 'decrypted-synthetic-token',
    }, mediaRef)
    expect(mediaMocks.stage).toHaveBeenCalledWith({
      eventId,
      leaseToken,
      media: resolvedMedia,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('apply_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
    })
    expect(mediaMocks.resolveMedia.mock.invocationCallOrder[0]).toBeLessThan(mediaMocks.stage.mock.invocationCallOrder[0])
    expect(mediaMocks.stage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder.find((order, index) => mocks.rpc.mock.calls[index][0] === 'apply_evolution_event')!,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('applies already-stored media directly without looking up credentials or downloading again', async () => {
    configureWorker([mediaEvent('stored')])
    mediaMocks.enabledMedia = ['image']

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ done: 1, retry: 0 })

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mediaMocks.resolveMedia).not.toHaveBeenCalled()
    expect(mediaMocks.stage).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(1)
  })

  it('does not store a provider file whose kind differs from the claimed event', async () => {
    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.resolveMedia.mockResolvedValueOnce({ ...resolvedMedia, contentType: 'document' })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, done: 0 })

    expect(mediaMocks.stage).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'invalid_media_event',
      p_retryable: false,
    })
  })

  it('replays after a crash following stage by applying stored media without a second download', async () => {
    const pending = mediaEvent('pending')
    const stored = mediaEvent('stored')
    let applyAttempt = 0
    configureWorker([pending])
    mediaMocks.enabledMedia = ['image']
    mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_evolution_message_events') {
        return { data: [applyAttempt === 0 ? pending : stored], error: null }
      }
      if (name === 'apply_evolution_event') {
        applyAttempt += 1
        if (applyAttempt === 1) return { data: null, error: { code: 'XX000', message: 'RAW_APPLY_SECRET' } }
        return { data: [{ outcome: 'applied' }], error: null }
      }
      if (name === 'fail_evolution_event') {
        return { data: [{ state: args?.p_retryable ? 'pending' : 'failed' }], error: null }
      }
      return { data: null, error: { code: 'PGRST202', message: 'unknown rpc' } }
    })

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ retry: 1, done: 0 })
    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ done: 1, retry: 0 })

    expect(mediaMocks.resolveMedia).toHaveBeenCalledTimes(1)
    expect(mediaMocks.stage).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_evolution_event')).toHaveLength(2)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'fail_evolution_event')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.find(([name]) => name === 'fail_evolution_event')?.[1]).toEqual({
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'database_unavailable',
      p_retryable: true,
    })
  })

  it('does not fail or apply when media staging reports a stale lease', async () => {
    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.stage.mockResolvedValue('stale')

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ stale: 1, failed: 0 })

    expect(mediaMocks.resolveMedia).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'apply_evolution_event')).toBe(false)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'fail_evolution_event')).toBe(false)
  })

  it('routes stage storage errors to retryable or permanent failure without details', async () => {
    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.stage.mockRejectedValueOnce(new EvolutionMediaStorageError('storage_unavailable'))

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ retry: 1, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'media_storage_unavailable',
      p_retryable: true,
    })

    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.stage.mockResolvedValueOnce('conflict')

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'media_storage_conflict',
      p_retryable: false,
    })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('Synthetic Evolution media storage failure.')
  })

  it('records sanitized permanent and transient media failures through fail RPC', async () => {
    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.resolveMedia.mockRejectedValueOnce(new EvolutionMediaError('invalid_media_ref'))

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'invalid_media_event',
      p_retryable: false,
    })
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('payload')

    configureWorker([mediaEvent('pending')])
    mediaMocks.enabledMedia = ['image']
    mediaMocks.resolveMedia.mockRejectedValueOnce(new EvolutionMediaError('network_error'))

    await expect(runEvolutionMessageBatch()).resolves.toMatchObject({ retry: 1, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'media_provider_unavailable',
      p_retryable: true,
    })
  })
})
