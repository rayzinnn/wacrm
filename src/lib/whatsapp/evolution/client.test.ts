import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EvolutionError, assertAllowedEvolutionOrigin, configureWebhook, connectSession, getSession } from './client'
import { getEvolutionCapabilities } from './capabilities'
import type { EvolutionCredentials } from './types'

const credentials: EvolutionCredentials = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'wacrm-local',
  token: 'restricted-test-token',
}

const stateFixture = JSON.parse(
  readFileSync(new URL('../../../../infra/evolution/fixtures/instance-state.observed.json', import.meta.url), 'utf8'),
)
const authFixture = JSON.parse(
  readFileSync(new URL('../../../../infra/evolution/fixtures/auth-failure.observed.json', import.meta.url), 'utf8'),
)
const qrPng = readFileSync(
  new URL('../../../../infra/evolution/fixtures/qr-synthetic-placeholder.png', import.meta.url),
)

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const statePayload = (state: unknown) => ({ instance: { instanceName: 'wacrm-local', state } })

beforeEach(() => {
  vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080')
  vi.stubEnv('EVOLUTION_WEBHOOK_BASE_URL', 'http://host.lima.internal:3000')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getSession', () => {
  it.each([
    ['close', 'disconnected'],
    ['connecting', 'connecting'],
    ['open', 'connected'],
    ['unexpected-provider-state', 'unknown'],
  ] as const)('maps provider state %s to %s', async (providerState, expectedState) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(statePayload(providerState)))

    const snapshot = await getSession(credentials)

    expect(snapshot.state).toBe(expectedState)
    expect(snapshot.qr).toBeNull()
    expect(snapshot.checkedAt).toEqual(expect.any(String))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'http://127.0.0.1:8080/instance/connectionState/wacrm-local',
    )
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({
      apikey: 'restricted-test-token',
      accept: 'application/json',
    })
  })

  it('uses the observed close response fixture', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(stateFixture.response))

    await expect(getSession(credentials)).resolves.toMatchObject({ state: 'disconnected', qr: null })
  })

  it('encodes the instance name as one URL path segment', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(statePayload('close')))

    await getSession({ ...credentials, instanceId: 'local/name' })

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'http://127.0.0.1:8080/instance/connectionState/local%2Fname',
    )
  })

  it('sets checkedAt at the start of the observation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T13:00:00.000Z'))
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { resolveResponse = resolve }))

    const pending = getSession(credentials)
    await vi.advanceTimersByTimeAsync(5_000)
    resolveResponse(jsonResponse(statePayload('open')))

    await expect(pending).resolves.toMatchObject({ checkedAt: '2026-11-16T13:00:00.000Z' })
  })
})

describe('connectSession', () => {
  it('returns a valid synthetic PNG data URL and local 20-second expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T13:00:00.000Z'))
    const syntheticDataUrl = 'data:image/png;base64,' + qrPng.toString('base64')
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      pairingCode: null,
      code: '[synthetic-only-placeholder]',
      base64: syntheticDataUrl,
      count: 1,
    }))

    const snapshot = await connectSession(credentials)

    expect(snapshot.state).toBe('connecting')
    expect(snapshot.qr).toEqual({
      dataUrl: syntheticDataUrl,
      expiresAt: '2026-11-16T13:00:20.000Z',
    })
    expect(snapshot.checkedAt).toBe('2026-11-16T13:00:00.000Z')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://127.0.0.1:8080/instance/connect/wacrm-local')
  })

  it('only reports connected when a no-QR response is followed by observed open state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ base64: null, count: 0 }))
      .mockResolvedValueOnce(jsonResponse(statePayload('open')))

    const snapshot = await connectSession(credentials)

    expect(snapshot.state).toBe('connected')
    expect(snapshot.qr).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not treat a no-QR response as connected when state is not open', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ count: 0 }))
      .mockResolvedValueOnce(jsonResponse(stateFixture.response))

    const snapshot = await connectSession(credentials)

    expect(snapshot.state).toBe('disconnected')
    expect(snapshot.qr).toBeNull()
  })

  it('marks a no-QR connection outcome ambiguous if state cannot be confirmed', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ base64: null, count: 0 }))
      .mockRejectedValueOnce(new Error('private network detail'))

    const error = await connectSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'network_error', httpStatus: null, retryable: false, ambiguous: true })
    expect(error.message).not.toContain('private network detail')
  })

  it('rejects invalid QR content without exposing it', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      base64: 'data:image/png;base64,INVALID_QR_SECRET_CONTENT',
      count: 1,
    }))

    const error = await connectSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'invalid_qr', httpStatus: 200, retryable: false, ambiguous: false })
    expect(error.message).not.toContain('INVALID_QR_SECRET_CONTENT')
  })

  it.each([
    ['data:image/svg+xml;base64,PHN2Zz4=', 'SVG'],
    ['data:text/html;base64,PGh0bWw+', 'HTML'],
    ['data:image/png;base64,iVBORw0KGgo=', 'truncated PNG'],
    ['data:image/png;base64,AAAA?', 'invalid base64'],
    ['data:image/png;base64,' + 'A'.repeat(7_000_001), 'oversized payload'],
  ])('rejects %s without including data in the error (%s)', async (dataUrl) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ base64: dataUrl, count: 1 }))

    const error = await connectSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error.code).toBe('invalid_qr')
    expect(error.message).not.toContain(dataUrl.slice(0, 80))
  })

  it('classifies abort during response JSON parsing as timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => Promise.resolve({
      type: 'default',
      status: 200,
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('private response', 'AbortError')))
      }),
    } as Response))

    const pending = connectSession(credentials).then(
      (value) => ({ value }),
      (cause) => ({ cause }),
    )
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    const error = 'cause' in result ? result.cause : null

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'timeout', httpStatus: null, retryable: false, ambiguous: true })
    expect(error.message).not.toContain('private response')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sanitizes the observed unauthorized response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(authFixture.response, 401))

    const error = await getSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'unauthorized', httpStatus: 401, retryable: false, ambiguous: false })
    expect(error.message).not.toContain('restricted-test-token')
    expect(error.message).not.toContain('Unauthorized')
  })

  it('does not mark an ambiguous connect server error retryable', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ private: 'response body' }, 503))

    const error = await connectSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'http_error', httpStatus: 503, retryable: false, ambiguous: true })
    expect(error.message).not.toContain('response body')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('times out with one ambiguous connect request and no retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('private body', 'AbortError')))
    }))

    const pending = connectSession(credentials).then(
      (value) => ({ value }),
      (cause) => ({ cause }),
    )
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending
    const error = 'cause' in result ? result.cause : null

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'timeout', httpStatus: null, retryable: false, ambiguous: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('blocks redirects and never reads or exposes their response body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('redirect secret body', {
      status: 302,
      headers: { location: 'https://elsewhere.invalid' },
    }))

    const error = await getSession(credentials).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'redirect_blocked', httpStatus: 302, retryable: false })
    expect(error.message).not.toContain('redirect secret body')
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('rejects a source outside the allowlist before fetch', async () => {
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080')

    const error = await getSession({ ...credentials, baseUrl: 'http://localhost:8080' }).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'origin_not_allowed', httpStatus: null, retryable: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['http://user:pass@127.0.0.1:8080', 'invalid_origin'],
    ['http://127.0.0.1:8080/path', 'invalid_origin'],
    ['http://127.0.0.1:8080?query=1', 'invalid_origin'],
    ['http://127.0.0.1:8080#fragment', 'invalid_origin'],
  ])('rejects non-origin URL %s before fetch', async (baseUrl, code) => {
    const error = await getSession({ ...credentials, baseUrl }).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error.code).toBe(code)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('canonicalizes the exact local HTTP origin with a trailing slash', () => {
    expect(assertAllowedEvolutionOrigin('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
  })

  it('canonicalizes HTTPS host case and a default port', () => {
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'https://example.com')

    expect(assertAllowedEvolutionOrigin('HTTPS://EXAMPLE.COM:443/')).toBe('https://example.com')
  })

  it('rejects external HTTP even when it appears in the allowlist', () => {
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://example.com')

    let error: unknown
    try {
      assertAllowedEvolutionOrigin('http://example.com')
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'origin_not_allowed', httpStatus: null, retryable: false })
  })

  it('rejects an empty instance identifier before fetch', async () => {
    const error = await getSession({ ...credentials, instanceId: '  ' }).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error.code).toBe('invalid_instance')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('configureWebhook', () => {
  const callbackUrl = 'http://host.lima.internal:3000/api/whatsapp/evolution/webhook'

  it('posts only the observed connection webhook configuration with authenticated headers', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await configureWebhook(credentials, callbackUrl, 'webhook-secret-123', 'connection-id-456')

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'http://127.0.0.1:8080/webhook/set/wacrm-local',
    )
    const init = vi.mocked(fetch).mock.calls[0][1]
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        apikey: 'restricted-test-token',
        accept: 'application/json',
        'content-type': 'application/json',
      },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      webhook: {
        enabled: true,
        url: callbackUrl,
        headers: {
          'x-wacrm-connection': 'connection-id-456',
          'x-wacrm-webhook-secret': 'webhook-secret-123',
        },
        byEvents: false,
        base64: false,
        events: ['CONNECTION_UPDATE'],
      },
    })
  })

  it('rejects callback URLs other than the configured operated origin before fetch', async () => {
    const error = await configureWebhook(
      credentials,
      'http://attacker.invalid/api/whatsapp/evolution/webhook',
      'webhook-secret-123',
      'connection-id-456',
    ).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'invalid_origin', httpStatus: null, retryable: false })
    expect(error.message).not.toContain('attacker.invalid')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports provider authentication failure without exposing credentials or body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('private auth response', { status: 401 }))

    const error = await configureWebhook(
      credentials,
      callbackUrl,
      'webhook-secret-123',
      'connection-id-456',
    ).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'unauthorized', httpStatus: 401, retryable: false, ambiguous: false })
    expect(error.message).not.toContain('private auth response')
    expect(error.message).not.toContain('restricted-test-token')
    expect(error.message).not.toContain('webhook-secret-123')
  })

  it('marks a timed out webhook update ambiguous and makes one request', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('private response', 'AbortError')))
    }))

    const pending = configureWebhook(
      credentials,
      callbackUrl,
      'webhook-secret-123',
      'connection-id-456',
    ).then(
      () => ({ ok: true as const }),
      (cause) => ({ error: cause as unknown }),
    )
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await pending

    expect('error' in result && result.error).toBeInstanceOf(EvolutionError)
    const error = 'error' in result ? result.error as EvolutionError : null
    expect(error).toMatchObject({ code: 'timeout', httpStatus: null, retryable: false, ambiguous: true })
    expect(error?.message).not.toContain('private response')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('blocks redirects without reading or exposing the response body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('private redirect response', {
      status: 302,
      headers: { location: 'https://elsewhere.invalid' },
    }))

    const error = await configureWebhook(
      credentials,
      callbackUrl,
      'webhook-secret-123',
      'connection-id-456',
    ).catch((cause) => cause)

    expect(error).toBeInstanceOf(EvolutionError)
    expect(error).toMatchObject({ code: 'redirect_blocked', httpStatus: 302, retryable: false, ambiguous: true })
    expect(error.message).not.toContain('private redirect response')
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('getEvolutionCapabilities', () => {
  it('keeps send and Meta-only capabilities disabled in this milestone', () => {
    expect(getEvolutionCapabilities()).toEqual({
      text: false,
      media: [],
      templates: false,
      broadcasts: false,
      reactions: false,
      interactive: false,
      typing: false,
    })
  })
})
