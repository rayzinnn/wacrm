import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workers = vi.hoisted(() => ({
  runEvolutionEventBatch: vi.fn(),
  runEvolutionMessageBatch: vi.fn(),
}))

vi.mock('@/lib/whatsapp/evolution/event-worker', () => ({
  runEvolutionEventBatch: workers.runEvolutionEventBatch,
}))
vi.mock('@/lib/whatsapp/evolution/message-worker', () => ({
  runEvolutionMessageBatch: workers.runEvolutionMessageBatch,
}))

import { GET, maxDuration, runtime } from './route'

const SECRET = 'synthetic-cron-secret-for-tests'
const URL = 'http://localhost/api/whatsapp/evolution/events/cron?secret=query-secret'

function request(authorization?: string) {
  return new Request(URL, {
    method: 'GET',
    headers: authorization ? { authorization } : undefined,
  })
}

describe('GET /api/whatsapp/evolution/events/cron', () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[]

  beforeEach(() => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', SECRET)
    workers.runEvolutionEventBatch.mockReset().mockResolvedValue({
      claimed: 3,
      done: 2,
      retry: 1,
      failed: 0,
      stale: 0,
    })
    workers.runEvolutionMessageBatch.mockReset().mockResolvedValue({
      claimed: 2,
      done: 1,
      retry: 0,
      failed: 1,
      stale: 0,
    })
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses Node.js and allows a 60-second route budget', () => {
    expect(runtime).toBe('nodejs')
    expect(maxDuration).toBe(60)
  })

  it.each([
    ['missing bearer', undefined],
    ['incorrect bearer', 'Bearer incorrect'],
    ['wrong length bearer', `Bearer ${'x'.repeat(SECRET.length + 1)}`],
  ])('rejects %s with no-store before claiming work', async (_label, authorization) => {
    const response = await GET(request(authorization))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Unauthorized.', code: 'unauthorized' })
    expect(workers.runEvolutionEventBatch).not.toHaveBeenCalled()
    expect(workers.runEvolutionMessageBatch).not.toHaveBeenCalled()
  })

  it('rejects requests when the server secret is not configured', async () => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', '')

    const response = await GET(request(`Bearer ${SECRET}`))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(workers.runEvolutionEventBatch).not.toHaveBeenCalled()
    expect(workers.runEvolutionMessageBatch).not.toHaveBeenCalled()
  })

  it('runs both batches for a valid bearer and returns only aggregated counts', async () => {
    workers.runEvolutionEventBatch.mockResolvedValueOnce({
      claimed: 3,
      done: 2,
      retry: 1,
      failed: 0,
      stale: 1,
    })
    workers.runEvolutionMessageBatch.mockResolvedValueOnce({
      claimed: 2,
      done: 1,
      retry: 1,
      failed: 1,
      stale: 0,
    })

    const response = await GET(request(`Bearer ${SECRET}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ claimed: 5, done: 3, retry: 2, failed: 1, stale: 1 })
    expect(workers.runEvolutionEventBatch).toHaveBeenCalledOnce()
    expect(workers.runEvolutionMessageBatch).toHaveBeenCalledOnce()
  })

  it('still runs the other batch and returns a constant sanitized 503 when one worker rejects', async () => {
    workers.runEvolutionEventBatch.mockRejectedValueOnce(new Error('private raw database error'))

    const response = await GET(request(`Bearer ${SECRET}`))
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(text).toBe(JSON.stringify({ error: 'Event processing is unavailable.', code: 'event_processing_unavailable' }))
    expect(text).not.toContain('private raw database error')
    expect(workers.runEvolutionEventBatch).toHaveBeenCalledOnce()
    expect(workers.runEvolutionMessageBatch).toHaveBeenCalledOnce()
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })
})
