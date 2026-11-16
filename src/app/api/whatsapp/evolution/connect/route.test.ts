import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => {
  class MockEvolutionStoreError extends Error {
    constructor(readonly code: string, readonly status: number) {
      super('private store detail')
      this.name = 'EvolutionStoreError'
    }
  }

  return {
    role: 'admin' as 'owner' | 'admin' | 'agent' | 'viewer',
    accountId: 'account-A',
    sessionPresent: true,
    roleCalls: [] as string[],
    connections: {} as Record<string, unknown>,
    loadConnection: vi.fn(),
    saveSessionState: vi.fn(),
    connectSession: vi.fn(),
    getSession: vi.fn(),
    MockEvolutionStoreError,
  }
})

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: vi.fn(async (minimum: string) => {
      h.roleCalls.push(minimum)
      if (!h.sessionPresent) throw new actual.UnauthorizedError()
      if (h.role !== 'owner' && h.role !== 'admin') throw new actual.ForbiddenError()
      return {
        accountId: h.accountId,
        userId: 'user-' + h.accountId,
        role: h.role,
        account: { id: h.accountId, name: h.accountId },
        supabase: {} as never,
      }
    }),
  }
})

vi.mock('@/lib/whatsapp/evolution/store', () => ({
  EvolutionStoreError: h.MockEvolutionStoreError,
  loadConnection: h.loadConnection,
  saveSessionState: h.saveSessionState,
}))

vi.mock('@/lib/whatsapp/evolution/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/client')>()
  return {
    ...actual,
    connectSession: h.connectSession,
    getSession: h.getSession,
  }
})

import { POST } from './route'
import { EvolutionError } from '@/lib/whatsapp/evolution/client'

const pngDataUrl = 'data:image/png;base64,' + readFileSync(
  new URL('../../../../../../infra/evolution/fixtures/qr-synthetic-placeholder.png', import.meta.url),
).toString('base64')

function storedConnection(accountId: string) {
  return {
    id: 'connection-' + accountId,
    accountId,
    createdBy: 'owner-' + accountId,
    credentials: {
      baseUrl: 'http://127.0.0.1:8080',
      instanceId: 'instance-' + accountId,
      token: 'stored-provider-token-' + accountId,
    },
    webhookSecret: 'stored-webhook-secret-' + accountId,
    state: 'disconnected',
    checkedAt: null,
  }
}

function request(body?: unknown) {
  return new Request('http://wacrm.test/api/whatsapp/evolution/connect?accountId=account-A&token=query-token', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  h.role = 'admin'
  h.accountId = 'account-A'
  h.sessionPresent = true
  h.roleCalls = []
  h.connections = {
    'account-A': storedConnection('account-A'),
    'account-B': storedConnection('account-B'),
  }
  h.loadConnection.mockReset().mockImplementation(async (accountId: string) => h.connections[accountId] ?? null)
  h.saveSessionState.mockReset().mockResolvedValue(undefined)
  h.connectSession.mockReset().mockResolvedValue({
    state: 'connecting',
    qr: { dataUrl: pngDataUrl, expiresAt: '2026-11-16T13:00:20.000Z' },
    checkedAt: '2026-11-16T13:00:00.000Z',
  })
  h.getSession.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('POST /api/whatsapp/evolution/connect', () => {
  it('requires admin before loading a connection or calling Evolution', async () => {
    for (const role of ['viewer', 'agent'] as const) {
      h.role = role
      const response = await POST(request())

      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(h.loadConnection).not.toHaveBeenCalled()
      expect(h.connectSession).not.toHaveBeenCalled()
    }
    expect(h.roleCalls).toEqual(['admin', 'admin'])
  })

  it('returns the auth convention 401 before any storage or provider call without a session', async () => {
    h.sessionPresent = false

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(h.loadConnection).not.toHaveBeenCalled()
    expect(h.connectSession).not.toHaveBeenCalled()
  })

  it('loads only the account from the authenticated context and ignores forged body/query values', async () => {
    h.accountId = 'account-B'
    const response = await POST(request({
      accountId: 'account-A',
      instanceId: 'forged-instance',
      token: 'forged-body-token',
      baseUrl: 'https://attacker.invalid',
    }))

    expect(response.status).toBe(200)
    expect(h.loadConnection).toHaveBeenCalledExactlyOnceWith('account-B')
    expect(h.connectSession).toHaveBeenCalledExactlyOnceWith(storedConnection('account-B').credentials)
    const body = await responseBody(response)
    expect(body).toMatchObject({ state: 'connecting', qr: { dataUrl: pngDataUrl } })
    const wire = JSON.stringify(body)
    expect(wire).not.toContain('stored-provider-token')
    expect(wire).not.toContain('stored-webhook-secret')
    expect(wire).not.toContain('forged-body-token')
  })

  it('returns connection_not_configured with no-store when storage has no connection', async () => {
    h.connections['account-A'] = null

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(response)).toMatchObject({ error: 'connection_not_configured' })
    expect(h.connectSession).not.toHaveBeenCalled()
    expect(h.saveSessionState).not.toHaveBeenCalled()
  })

  it('persists state and checkedAt only, while returning the QR snapshot without caching', async () => {
    const snapshot = {
      state: 'connecting',
      qr: { dataUrl: pngDataUrl, expiresAt: '2026-11-16T13:00:20.000Z' },
      checkedAt: '2026-11-16T13:00:00.000Z',
    }
    h.connectSession.mockResolvedValue(snapshot)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(response)).toEqual(snapshot)
    expect(h.saveSessionState).toHaveBeenCalledExactlyOnceWith('account-A', {
      state: 'connecting',
      checkedAt: snapshot.checkedAt,
    })
    expect(h.saveSessionState.mock.calls[0][1]).not.toHaveProperty('qr')
  })

  it('stores unknown at observation time and returns recoverable timeout instead of connected', async () => {
    h.connectSession.mockRejectedValue(new EvolutionError('timeout', 'secret-bearing provider text', { ambiguous: true }))

    const response = await POST(request())
    const body = await responseBody(response)

    expect(response.status).toBe(504)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({ error: 'Evolution request timed out.', code: 'evolution_timeout', ambiguous: true })
    expect(JSON.stringify(body)).not.toContain('secret-bearing')
    expect(h.saveSessionState).toHaveBeenCalledOnce()
    expect(h.saveSessionState.mock.calls[0][0]).toBe('account-A')
    expect(h.saveSessionState.mock.calls[0][1].state).toBe('unknown')
    expect(Date.parse(h.saveSessionState.mock.calls[0][1].checkedAt)).not.toBeNaN()
  })

  it('maps provider unauthorized without leaking the credential error', async () => {
    h.connectSession.mockRejectedValue(new EvolutionError('unauthorized', 'token value leaked here', { httpStatus: 401 }))

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(response)).toEqual({
      error: 'Evolution provider authentication failed.',
      code: 'evolution_unauthorized',
      ambiguous: false,
    })
    expect(h.saveSessionState).not.toHaveBeenCalled()
  })

  it('maps provider 429 to 429 and other provider HTTP errors to 502', async () => {
    h.connectSession.mockRejectedValueOnce(new EvolutionError('http_error', 'raw 429 response', { httpStatus: 429 }))
    const rateLimited = await POST(request())
    expect(rateLimited.status).toBe(429)
    expect(rateLimited.headers.get('Cache-Control')).toBe('no-store')

    h.connectSession.mockRejectedValueOnce(new EvolutionError('http_error', 'raw 500 response', { httpStatus: 500 }))
    const upstreamError = await POST(request())
    expect(upstreamError.status).toBe(502)
    expect(upstreamError.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([
    ['invalid_credentials', undefined, 400],
    ['invalid_instance', undefined, 400],
    ['invalid_origin', undefined, 400],
    ['origin_not_allowed', undefined, 400],
    ['invalid_qr', 200, 502],
    ['invalid_response', 200, 502],
    ['redirect_blocked', 302, 502],
    ['network_error', undefined, 502],
    ['timeout', undefined, 504],
    ['unauthorized', 401, 400],
  ] as const)('maps Evolution error %s to HTTP %s', async (code, httpStatus, expectedStatus) => {
    h.connectSession.mockRejectedValue(new EvolutionError(code, 'untrusted error detail', { httpStatus }))

    const response = await POST(request())
    const body = await responseBody(response)

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({ code: 'evolution_' + code })
    expect(JSON.stringify(body)).not.toContain('untrusted error detail')
  })

  it.each([
    ['actor_forbidden', 403],
    ['connection_conflict', 409],
    ['database_unavailable', 503],
    ['invalid_connection', 400],
    ['credentials_unavailable', 500],
  ] as const)('maps store error %s to HTTP %s', async (code, expectedStatus) => {
    h.loadConnection.mockRejectedValueOnce(new h.MockEvolutionStoreError(code, 418))

    const response = await POST(request())
    const body = await responseBody(response)

    expect(response.status).toBe(expectedStatus)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({ code })
    expect(JSON.stringify(body)).not.toContain('private store detail')
  })

  it('maps store errors and hides unexpected errors without logging', async () => {
    h.loadConnection.mockRejectedValueOnce(new h.MockEvolutionStoreError('database_unavailable', 503))
    const unavailable = await POST(request())
    expect(unavailable.status).toBe(503)
    expect(await responseBody(unavailable)).toMatchObject({ code: 'database_unavailable' })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.loadConnection.mockRejectedValueOnce(new Error('private database secret'))
    const unknown = await POST(request())
    expect(unknown.status).toBe(500)
    expect(unknown.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(unknown)).toEqual({ error: 'Internal server error.', code: 'internal_error' })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
