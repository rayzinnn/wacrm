import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WEBHOOK_BODY_BYTES } from '@/lib/whatsapp/webhook-body'

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  normalizeWebhook: vi.fn(),
  enqueueEvents: vi.fn(),
}))

vi.mock('@/lib/whatsapp/evolution/webhook-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/webhook-auth')>()
  return { ...actual, authenticateWebhook: mocks.authenticateWebhook }
})

vi.mock('@/lib/whatsapp/evolution/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/events')>()
  return { ...actual, normalizeWebhook: mocks.normalizeWebhook }
})

vi.mock('@/lib/whatsapp/evolution/event-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/event-queue')>()
  return { ...actual, enqueueEvents: mocks.enqueueEvents }
})

const CONNECTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INSTANCE_ID = 'wacrm-local'
const PAYLOAD = {
  event: 'connection.update',
  instance: INSTANCE_ID,
  data: { instance: INSTANCE_ID, state: 'open' },
  date_time: '2026-11-16T00:00:00.000Z',
  apikey: 'synthetic-body-api-key',
}
const MESSAGE_PAYLOAD = {
  event: 'messages.upsert',
  instance: INSTANCE_ID,
  data: { key: { id: '[SYNTHETIC_MESSAGE_ID]' }, message: { conversation: '[SYNTHETIC_INBOUND_TEXT]' } },
  apikey: 'synthetic-body-api-key',
}
const CONTEXT = { connectionId: CONNECTION_ID, accountId: ACCOUNT_ID, instanceId: INSTANCE_ID }
const EVENTS = [{ kind: 'connection', eventKey: 'synthetic-event-key', occurredAt: '2026-11-16T00:00:00.000Z' }]
const MESSAGE_EVENTS = [{
  kind: 'message',
  eventKey: 'message:sha256:synthetic-message-key',
  externalMessageId: '[SYNTHETIC_MESSAGE_ID]',
  peer: '5521999990000@s.whatsapp.net',
  occurredAt: '2026-11-16T00:00:01.000Z',
  fromMe: false,
  sentByApi: false,
  contentType: 'text',
  text: 'synthetic inbound text',
  mediaRef: null,
}]
const URL = 'http://localhost/api/whatsapp/evolution/webhook'

describe('Evolution public webhook receiver', () => {
  let route: typeof import('./route')
  let AuthError: typeof import('@/lib/whatsapp/evolution/webhook-auth').WebhookAuthError
  let NormalizeError: typeof import('@/lib/whatsapp/evolution/events').NormalizationError
  let QueueError: typeof import('@/lib/whatsapp/evolution/event-queue').EventQueueError
  let consoleSpies: ReturnType<typeof vi.spyOn>[]

  beforeEach(async () => {
    vi.resetModules()
    mocks.authenticateWebhook.mockReset().mockResolvedValue(CONTEXT)
    mocks.normalizeWebhook.mockReset().mockReturnValue(EVENTS)
    mocks.enqueueEvents.mockReset().mockResolvedValue({ inserted: 1, duplicates: 0 })
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]
    route = await import('./route')
    ;({ WebhookAuthError: AuthError } = await import('@/lib/whatsapp/evolution/webhook-auth'))
    ;({ NormalizationError: NormalizeError } = await import('@/lib/whatsapp/evolution/events'))
    ;({ EventQueueError: QueueError } = await import('@/lib/whatsapp/evolution/event-queue'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function request(body: string, headers: HeadersInit = { 'content-type': 'application/json' }) {
    return new Request(URL, { method: 'POST', headers, body })
  }

  async function expectNoStore(response: Response) {
    expect(response.headers.get('cache-control')).toBe('no-store')
  }

  it('uses the Node.js runtime', () => {
    expect(route.runtime).toBe('nodejs')
  })

  it('returns 413 when actual body bytes exceed the cap', async () => {
    const response = await route.POST(request('x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1)))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Webhook payload is too large.', code: 'payload_too_large' })
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).not.toHaveBeenCalled()
  })

  it('counts streamed chunked bytes and rejects an oversized stream', async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024).fill(120)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1).fill(120))
        controller.close()
      },
    })
    const streamedRequest = new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)

    const response = await route.POST(streamedRequest)

    expect(response.status).toBe(413)
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).not.toHaveBeenCalled()
  })

  it('returns a generic 400 for a stream read failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('sensitive stream contents')
      },
    })
    const streamedRequest = new Request(URL, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    const response = await route.POST(streamedRequest)
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).toBe(JSON.stringify({ error: 'Could not read webhook body.', code: 'invalid_request_body' }))
    expect(text).not.toContain('sensitive stream contents')
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).not.toHaveBeenCalled()
  })

  it('returns a generic 400 for invalid JSON without authenticating', async () => {
    const response = await route.POST(request('{"token":"sensitive\n'))
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).toBe(JSON.stringify({ error: 'Invalid JSON body.', code: 'invalid_json' }))
    expect(text).not.toContain('sensitive')
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).not.toHaveBeenCalled()
  })

  it.each([
    ['webhook_unauthorized', 401],
    ['webhook_correlation_mismatch', 403],
    ['webhook_auth_unavailable', 503],
  ] as const)('returns the typed authentication error %s', async (code, status) => {
    mocks.authenticateWebhook.mockRejectedValueOnce(new AuthError(code))

    const response = await route.POST(request(JSON.stringify(PAYLOAD)))
    const body = await response.json()

    expect(response.status).toBe(status)
    expect(body.code).toBe(code)
    await expectNoStore(response)
    expect(mocks.normalizeWebhook).not.toHaveBeenCalled()
    expect(mocks.enqueueEvents).not.toHaveBeenCalled()
  })

  it('authenticates inbound message callbacks before normalization or enqueue', async () => {
    mocks.authenticateWebhook.mockRejectedValueOnce(new AuthError('webhook_unauthorized'))

    const response = await route.POST(request(JSON.stringify(MESSAGE_PAYLOAD)))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'webhook_unauthorized' })
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).toHaveBeenCalledOnce()
    expect(mocks.normalizeWebhook).not.toHaveBeenCalled()
    expect(mocks.enqueueEvents).not.toHaveBeenCalled()
  })

  it('returns 400 for an authenticated but malformed known event', async () => {
    mocks.normalizeWebhook.mockImplementationOnce(() => { throw new NormalizeError() })

    const response = await route.POST(request(JSON.stringify(PAYLOAD)))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid webhook event.', code: 'invalid_webhook_event' })
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).toHaveBeenCalledOnce()
    expect(mocks.enqueueEvents).not.toHaveBeenCalled()
  })

  it('acknowledges an authenticated unknown event as ignored without enqueueing', async () => {
    mocks.normalizeWebhook.mockReturnValueOnce([])

    const response = await route.POST(request(JSON.stringify({ ...PAYLOAD, event: 'messages.upsert' })))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 0, duplicates: 0, ignored: true })
    await expectNoStore(response)
    expect(mocks.authenticateWebhook).toHaveBeenCalledOnce()
    expect(mocks.enqueueEvents).not.toHaveBeenCalled()
  })

  it('enqueues normalized inbound text for durable persistence', async () => {
    mocks.normalizeWebhook.mockReturnValueOnce(MESSAGE_EVENTS as never)

    const response = await route.POST(request(JSON.stringify(MESSAGE_PAYLOAD)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 1, duplicates: 0, ignored: false })
    await expectNoStore(response)
    expect(mocks.enqueueEvents).toHaveBeenCalledOnce()
    expect(mocks.enqueueEvents).toHaveBeenCalledWith(CONTEXT.connectionId, MESSAGE_EVENTS)
  })

  it('enqueues each normalized event variant returned by the normalizer', async () => {
    mocks.normalizeWebhook.mockReturnValueOnce([...EVENTS, ...MESSAGE_EVENTS] as never)

    const response = await route.POST(request(JSON.stringify(PAYLOAD)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 1, duplicates: 0, ignored: false })
    expect(mocks.enqueueEvents).toHaveBeenCalledOnce()
    expect(mocks.enqueueEvents).toHaveBeenCalledWith(CONTEXT.connectionId, [...EVENTS, ...MESSAGE_EVENTS])
    await expectNoStore(response)
  })

  it('waits for durable persistence before acknowledging an inbound message', async () => {
    let markEnqueueStarted!: () => void
    const enqueueStarted = new Promise<void>((resolve) => { markEnqueueStarted = resolve })
    let resolveEnqueue!: (value: { inserted: number; duplicates: number }) => void
    mocks.normalizeWebhook.mockReturnValueOnce(MESSAGE_EVENTS as never)
    mocks.enqueueEvents.mockImplementationOnce(() => {
      markEnqueueStarted()
      return new Promise((resolve) => { resolveEnqueue = resolve })
    })

    let settled = false
    const responsePromise = route.POST(request(JSON.stringify(MESSAGE_PAYLOAD))).then((response) => {
      settled = true
      return response
    })
    await enqueueStarted
    await Promise.resolve()

    expect(settled).toBe(false)
    resolveEnqueue({ inserted: 1, duplicates: 0 })
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 1, duplicates: 0, ignored: false })
    await expectNoStore(response)
  })

  it('acknowledges an inbound replay as a duplicate after the queue confirms it', async () => {
    mocks.normalizeWebhook.mockReturnValueOnce(MESSAGE_EVENTS as never)
    mocks.enqueueEvents.mockResolvedValueOnce({ inserted: 0, duplicates: 1 })

    const response = await route.POST(request(JSON.stringify(MESSAGE_PAYLOAD)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 0, duplicates: 1, ignored: false })
    expect(mocks.enqueueEvents).toHaveBeenCalledWith(CONTEXT.connectionId, MESSAGE_EVENTS)
    await expectNoStore(response)
  })

  it('does not acknowledge an inbound message when durable enqueue fails', async () => {
    mocks.normalizeWebhook.mockReturnValueOnce(MESSAGE_EVENTS as never)
    mocks.enqueueEvents.mockRejectedValueOnce(new QueueError())

    const response = await route.POST(request(JSON.stringify(MESSAGE_PAYLOAD)))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Webhook processing is unavailable.', code: 'webhook_unavailable' })
    expect(mocks.enqueueEvents).toHaveBeenCalledWith(CONTEXT.connectionId, MESSAGE_EVENTS)
    await expectNoStore(response)
  })

  it('does not acknowledge a known event until durable enqueue resolves', async () => {
    let markEnqueueStarted!: () => void
    const enqueueStarted = new Promise<void>((resolve) => { markEnqueueStarted = resolve })
    let resolveEnqueue!: (value: { inserted: number; duplicates: number }) => void
    mocks.enqueueEvents.mockImplementationOnce(() => {
      markEnqueueStarted()
      return new Promise((resolve) => { resolveEnqueue = resolve })
    })

    let settled = false
    const responsePromise = route.POST(request(JSON.stringify(PAYLOAD))).then((response) => {
      settled = true
      return response
    })
    await enqueueStarted
    await Promise.resolve()

    expect(settled).toBe(false)
    resolveEnqueue({ inserted: 1, duplicates: 0 })
    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 1, duplicates: 0, ignored: false })
    await expectNoStore(response)
  })

  it('returns only replay counts after enqueue resolves', async () => {
    mocks.enqueueEvents.mockResolvedValueOnce({ inserted: 0, duplicates: 1 })

    const response = await route.POST(request(JSON.stringify(PAYLOAD)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ inserted: 0, duplicates: 1, ignored: false })
    await expectNoStore(response)
  })

  it('returns sanitized 503 for typed, unexpected, or unexpected authentication failures', async () => {
    const cases = [
      () => mocks.enqueueEvents.mockRejectedValueOnce(new QueueError()),
      () => mocks.enqueueEvents.mockRejectedValueOnce(new Error('sensitive queue response')),
      () => mocks.authenticateWebhook.mockRejectedValueOnce(new Error('sensitive auth response')),
    ]

    for (const configure of cases) {
      configure()
      const response = await route.POST(request(JSON.stringify(PAYLOAD)))
      const text = await response.text()

      expect(response.status).toBe(503)
      expect(text).toBe(JSON.stringify({ error: 'Webhook processing is unavailable.', code: 'webhook_unavailable' }))
      expect(text).not.toContain('sensitive')
      await expectNoStore(response)
    }
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })

  it('captures receivedAt at request entry and passes it to normalization', async () => {
    const start = new Date('2026-11-16T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(start)
    const responsePromise = route.POST(request(JSON.stringify(PAYLOAD)))
    vi.setSystemTime(new Date('2026-11-16T12:00:05.000Z'))

    const response = await responsePromise

    expect(response.status).toBe(200)
    expect(mocks.normalizeWebhook).toHaveBeenCalledWith(PAYLOAD, '2026-11-16T12:00:00.000Z')
  })
})
