import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  rpc: vi.fn(),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    if (mocks.admin === 'throw-client') throw new Error('RAW_ADMIN_SECRET')
    return mocks.admin
  },
}))

import { EvolutionMessageWorkerError, runEvolutionMessageBatch } from './message-worker'

const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const leaseToken = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function claimedEvent(kind = 'message', overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    connection_id: connectionId,
    lease_token: leaseToken,
    normalized_event: { kind },
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
  mocks.admin = { rpc: mocks.rpc }
}

beforeEach(() => {
  mocks.admin = undefined
  mocks.rpc.mockReset()
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
})
