import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  from: vi.fn(),
  rpc: vi.fn(),
  decrypt: vi.fn(),
  assertAllowedOrigin: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    if (mocks.admin === 'throw-client') throw new Error('RAW_ADMIN_SECRET')
    return mocks.admin
  },
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return {
    ...actual,
    assertAllowedEvolutionOrigin: mocks.assertAllowedOrigin,
    getSession: mocks.getSession,
  }
})

import { EvolutionError } from './client'
import { EvolutionEventWorkerError, runEvolutionEventBatch } from './event-worker'

const checkedAt = '2026-11-16T05:00:00.000Z'
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const connection = {
  id: connectionId,
  provider: 'evolution',
  base_url: 'http://127.0.0.1:8080',
  instance_name: 'wacrm-local',
  token_encrypted: 'encrypted-provider-token',
}

function claimedEvent(kind = 'connection', overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    connection_id: connectionId,
    lease_token: leaseToken,
    normalized_event: { kind },
    ...overrides,
  }
}

function configureWorker(claims = [claimedEvent()]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: connection, error: null }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  mocks.from.mockReturnValue(query)
  mocks.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_evolution_events') return { data: claims, error: null }
    if (name === 'complete_evolution_connection_event') return { data: [{ outcome: 'applied' }], error: null }
    if (name === 'fail_evolution_event') {
      return { data: [{ state: args?.p_retryable === true ? 'pending' : 'failed' }], error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: 'unknown rpc' } }
  })
  mocks.admin = { from: mocks.from, rpc: mocks.rpc }
  mocks.decrypt.mockReturnValue('provider-token')
  mocks.assertAllowedOrigin.mockImplementation((origin: string) => origin)
  mocks.getSession.mockResolvedValue({ state: 'connected', checkedAt })
  return query
}

beforeEach(() => {
  mocks.admin = undefined
  mocks.from.mockReset()
  mocks.rpc.mockReset()
  mocks.decrypt.mockReset()
  mocks.assertAllowedOrigin.mockReset()
  mocks.getSession.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('runEvolutionEventBatch', () => {
  it('claims a fixed batch and atomically completes a connection observation with the current lease token', async () => {
    const query = configureWorker()

    await expect(runEvolutionEventBatch()).resolves.toEqual({
      claimed: 1,
      done: 1,
      retry: 0,
      failed: 0,
      stale: 0,
    })

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'claim_evolution_events', {
      p_limit: 10,
      p_lease_seconds: 60,
    })
    expect(query.select).toHaveBeenCalledWith('id,provider,base_url,instance_name,token_encrypted')
    expect(query.eq).toHaveBeenCalledWith('id', connectionId)
    expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-provider-token')
    expect(mocks.getSession).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8080',
      instanceId: 'wacrm-local',
      token: 'provider-token',
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'complete_evolution_connection_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_state: 'connected',
      p_checked_at: checkedAt,
    })
    expect(JSON.stringify(query.select.mock.calls[0])).not.toContain('webhook_secret')
    expect(JSON.stringify(query.select.mock.calls[0])).not.toContain('created_by')
  })

  it('returns zero counts without looking up connections when the claim is empty', async () => {
    configureWorker([])

    await expect(runEvolutionEventBatch()).resolves.toEqual({
      claimed: 0,
      done: 0,
      retry: 0,
      failed: 0,
      stale: 0,
    })

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('fails unsupported event kinds permanently without loading a connection', async () => {
    configureWorker([claimedEvent('message')])

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ claimed: 1, failed: 1, retry: 0 })

    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'unsupported_event_kind',
      p_retryable: false,
    })
  })

  it.each([
    ['timeout', new EvolutionError('timeout', 'RAW_TIMEOUT_SECRET')],
    ['network error', new EvolutionError('network_error', 'RAW_NETWORK_SECRET')],
    ['HTTP 429', new EvolutionError('http_error', 'RAW_429_SECRET', { httpStatus: 429 })],
    ['HTTP 503', new EvolutionError('http_error', 'RAW_503_SECRET', { httpStatus: 503 })],
  ])('schedules %s as retryable without exposing provider details', async (_label, providerError) => {
    configureWorker()
    mocks.getSession.mockRejectedValue(providerError)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runEvolutionEventBatch()

    expect(result).toMatchObject({ retry: 1, done: 0, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'provider_unavailable',
      p_retryable: true,
    })
    expect(JSON.stringify(result)).not.toMatch(/RAW_(?:TIMEOUT|NETWORK|429|503)_SECRET/)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('fails provider authorization permanently', async () => {
    configureWorker()
    mocks.getSession.mockRejectedValue(new EvolutionError('unauthorized', 'RAW_AUTH_SECRET', { httpStatus: 401 }))

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })

    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', {
      p_event_id: eventId,
      p_lease_token: leaseToken,
      p_error_code: 'provider_unauthorized',
      p_retryable: false,
    })
  })

  it('fails invalid origins and decryption errors permanently', async () => {
    configureWorker()
    mocks.assertAllowedOrigin.mockImplementation(() => {
      throw new EvolutionError('origin_not_allowed', 'RAW_ORIGIN_SECRET')
    })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'origin_not_allowed',
      p_retryable: false,
    }))
    expect(mocks.getSession).not.toHaveBeenCalled()

    configureWorker()
    mocks.decrypt.mockImplementation(() => { throw new Error('RAW_CIPHERTEXT_SECRET') })
    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ failed: 1, retry: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'credentials_unavailable',
      p_retryable: false,
    }))
  })

  it('retries database lookup errors and throws', async () => {
    const query = configureWorker()
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'RAW_DB_SECRET' } })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ retry: 1, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'database_unavailable',
      p_retryable: true,
    }))

    configureWorker()
    mocks.from.mockImplementation(() => { throw new Error('RAW_DB_THROW_SECRET') })
    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ retry: 1, failed: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'database_unavailable',
      p_retryable: true,
    }))
  })

  it.each(['40001', 'P0002'])('counts stale completion lease %s without retrying state lookup', async (code) => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_events') return { data: [claimedEvent()], error: null }
      if (name === 'complete_evolution_connection_event') return { data: null, error: { code, message: 'RAW_STALE_SECRET' } }
      return { data: null, error: null }
    })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ stale: 1, retry: 0, done: 0 })
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'complete_evolution_connection_event')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'fail_evolution_event')).toBe(false)
  })

  it('leaves other completion persistence failures leased for recovery', async () => {
    configureWorker()
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_events') return { data: [claimedEvent()], error: null }
      if (name === 'complete_evolution_connection_event') return { data: null, error: { code: 'XX000', message: 'RAW_COMPLETE_SECRET' } }
      return { data: null, error: null }
    })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ retry: 1, done: 0 })
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'fail_evolution_event')).toBe(false)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it('counts stale fail RPC responses without attempting another operation', async () => {
    configureWorker()
    mocks.getSession.mockRejectedValue(new EvolutionError('unauthorized', 'RAW_AUTH_SECRET'))
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_events') return { data: [claimedEvent()], error: null }
      if (name === 'fail_evolution_event') return { data: null, error: { code: '40001', message: 'RAW_STALE_SECRET' } }
      return { data: null, error: null }
    })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ stale: 1, retry: 0, failed: 0 })
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'fail_evolution_event')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'complete_evolution_connection_event')).toBe(false)
  })

  it('counts an empty or malformed fail RPC response as retry until the lease can recover', async () => {
    configureWorker()
    mocks.getSession.mockRejectedValue(new EvolutionError('unauthorized', 'RAW_AUTH_SECRET'))
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_evolution_events') return { data: [claimedEvent()], error: null }
      if (name === 'fail_evolution_event') return { data: null, error: null }
      return { data: null, error: null }
    })

    await expect(runEvolutionEventBatch()).resolves.toMatchObject({ retry: 1, failed: 0, stale: 0 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'provider_unauthorized',
      p_retryable: false,
    }))
  })

  it('isolates per-event failures and continues the rest of the claimed batch', async () => {
    const secondEvent = claimedEvent('connection', {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      connection_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      lease_token: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    })
    const query = configureWorker([claimedEvent(), secondEvent])
    query.maybeSingle
      .mockRejectedValueOnce(new Error('RAW_DB_LOOKUP_SECRET'))
      .mockResolvedValueOnce({ data: { ...connection, id: secondEvent.connection_id }, error: null })
    mocks.getSession.mockResolvedValue({ state: 'connected', checkedAt })

    await expect(runEvolutionEventBatch()).resolves.toEqual({
      claimed: 2,
      done: 1,
      retry: 1,
      failed: 0,
      stale: 0,
    })
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('complete_evolution_connection_event', expect.objectContaining({
      p_event_id: secondEvent.id,
      p_lease_token: secondEvent.lease_token,
    }))
  })

  it('uses worker_error for unexpected failures and never logs or returns raw errors', async () => {
    configureWorker()
    mocks.getSession.mockRejectedValue(new Error('RAW_UNEXPECTED_SECRET'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await runEvolutionEventBatch()

    expect(result).toMatchObject({ retry: 1 })
    expect(mocks.rpc).toHaveBeenLastCalledWith('fail_evolution_event', expect.objectContaining({
      p_error_code: 'worker_error',
      p_retryable: true,
    }))
    expect(JSON.stringify(result)).not.toContain('RAW_UNEXPECTED_SECRET')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('sanitizes claim RPC errors into a typed 503 without a raw cause', async () => {
    configureWorker([])
    mocks.rpc.mockRejectedValue(new Error('RAW_CLAIM_SECRET'))

    const error = await runEvolutionEventBatch().catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionEventWorkerError)
    expect(error).toMatchObject({
      code: 'event_worker_unavailable',
      status: 503,
      message: 'Evolution event worker is unavailable.',
    })
    expect((error as Error).message).not.toContain('RAW_CLAIM_SECRET')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('sanitizes returned claim RPC errors into the same typed 503', async () => {
    configureWorker([])
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'RAW_CLAIM_SECRET' } })

    const error = await runEvolutionEventBatch().catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionEventWorkerError)
    expect(error).toMatchObject({ code: 'event_worker_unavailable', status: 503 })
    expect((error as Error).message).toBe('Evolution event worker is unavailable.')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })
})
