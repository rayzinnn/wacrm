import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const worker = vi.hoisted(() => ({ runEvolutionEventBatch: vi.fn() }))

vi.mock('@/lib/whatsapp/evolution/event-worker', () => ({
  runEvolutionEventBatch: worker.runEvolutionEventBatch,
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
    worker.runEvolutionEventBatch.mockReset().mockResolvedValue({
      claimed: 3,
      done: 2,
      retry: 1,
      failed: 0,
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
    expect(worker.runEvolutionEventBatch).not.toHaveBeenCalled()
  })

  it('rejects requests when the server secret is not configured', async () => {
    vi.stubEnv('EVOLUTION_EVENTS_CRON_SECRET', '')

    const response = await GET(request(`Bearer ${SECRET}`))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(worker.runEvolutionEventBatch).not.toHaveBeenCalled()
  })

  it('runs one batch for a valid bearer and returns only its counts', async () => {
    worker.runEvolutionEventBatch.mockResolvedValueOnce({
      claimed: 3,
      done: 2,
      retry: 1,
      failed: 0,
      stale: 0,
      secret: 'must-not-leak',
      eventIds: ['event-id-must-not-leak'],
    })

    const response = await GET(request(`Bearer ${SECRET}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ claimed: 3, done: 2, retry: 1, failed: 0, stale: 0 })
    expect(worker.runEvolutionEventBatch).toHaveBeenCalledOnce()
  })

  it('returns a constant sanitized 503 when the worker rejects without logging raw errors', async () => {
    worker.runEvolutionEventBatch.mockRejectedValueOnce(new Error('private raw database error'))

    const response = await GET(request(`Bearer ${SECRET}`))
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(text).toBe(JSON.stringify({ error: 'Event processing is unavailable.', code: 'event_processing_unavailable' }))
    expect(text).not.toContain('private raw database error')
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })
})
