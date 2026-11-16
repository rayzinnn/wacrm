import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { GET } from './route'
import { EvolutionError } from '@/lib/whatsapp/evolution/client'

function storedConnection(accountId: string) {
  return {
    id: 'connection-' + accountId,
    accountId,
    createdBy: 'owner-' + accountId,
    credentials: {
      baseUrl: 'https://evolution-' + accountId + '.example.test',
      instanceId: 'instance-' + accountId,
      token: 'stored-provider-token-' + accountId,
    },
    webhookSecret: 'stored-webhook-secret-' + accountId,
    state: 'disconnected',
    checkedAt: null,
  }
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
  h.getSession.mockReset().mockResolvedValue({
    state: 'connected',
    qr: null,
    checkedAt: '2026-11-16T13:00:00.000Z',
  })
  h.connectSession.mockReset()
})

afterEach(() => vi.restoreAllMocks())

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('GET /api/whatsapp/evolution/status', () => {
  it('requires admin before loading a connection or checking provider state', async () => {
    for (const role of ['viewer', 'agent'] as const) {
      h.role = role
      const response = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))

      expect(response.status).toBe(403)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(h.loadConnection).not.toHaveBeenCalled()
      expect(h.getSession).not.toHaveBeenCalled()
    }
    expect(h.roleCalls).toEqual(['admin', 'admin'])
  })

  it('returns auth 401 before storage/provider calls when there is no session', async () => {
    h.sessionPresent = false

    const response = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(h.loadConnection).not.toHaveBeenCalled()
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it('derives account from auth context and ignores query-supplied account or credentials', async () => {
    h.accountId = 'account-B'

    const response = await GET(new Request(
      'http://wacrm.test/api/whatsapp/evolution/status?accountId=account-A&instanceId=forged&token=query-token',
    ))

    expect(response.status).toBe(200)
    expect(h.loadConnection).toHaveBeenCalledExactlyOnceWith('account-B')
    expect(h.getSession).toHaveBeenCalledExactlyOnceWith(storedConnection('account-B').credentials)
    const body = await responseBody(response)
    expect(body).toEqual({
      state: 'connected',
      qr: null,
      checkedAt: '2026-11-16T13:00:00.000Z',
    })
    const wire = JSON.stringify(body)
    expect(wire).not.toContain('stored-provider-token')
    expect(wire).not.toContain('stored-webhook-secret')
    expect(wire).not.toContain('query-token')
  })

  it('returns connection_not_configured with no-store when no stored connection exists', async () => {
    h.connections['account-A'] = null

    const response = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))

    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(response)).toMatchObject({ error: 'connection_not_configured' })
    expect(h.getSession).not.toHaveBeenCalled()
    expect(h.saveSessionState).not.toHaveBeenCalled()
  })

  it('saves only the observed state and timestamp and never returns QR', async () => {
    const snapshot = { state: 'connected', qr: null, checkedAt: '2026-11-16T13:00:00.000Z' }
    h.getSession.mockResolvedValue(snapshot)

    const response = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(response)).toEqual(snapshot)
    expect(h.saveSessionState).toHaveBeenCalledExactlyOnceWith('account-A', {
      state: 'connected',
      checkedAt: snapshot.checkedAt,
    })
    expect(h.saveSessionState.mock.calls[0][1]).not.toHaveProperty('qr')
  })

  it('persists unknown with observation time and returns a recoverable network error', async () => {
    h.getSession.mockRejectedValue(new EvolutionError('network_error', 'secret network response'))

    const response = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))
    const body = await responseBody(response)

    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toMatchObject({ error: 'Evolution network is unavailable.', code: 'evolution_network_error' })
    expect(JSON.stringify(body)).not.toContain('secret network response')
    expect(h.saveSessionState).toHaveBeenCalledOnce()
    expect(h.saveSessionState.mock.calls[0][1].state).toBe('unknown')
    expect(Date.parse(h.saveSessionState.mock.calls[0][1].checkedAt)).not.toBeNaN()
  })

  it('maps store and unknown errors safely without logging unexpected objects', async () => {
    h.loadConnection.mockRejectedValueOnce(new h.MockEvolutionStoreError('credentials_unavailable', 500))
    const storeError = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))
    expect(storeError.status).toBe(500)
    expect(await responseBody(storeError)).toMatchObject({ code: 'credentials_unavailable' })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.loadConnection.mockRejectedValueOnce(new Error('private secret object'))
    const unknown = await GET(new Request('http://wacrm.test/api/whatsapp/evolution/status'))
    expect(unknown.status).toBe(500)
    expect(unknown.headers.get('Cache-Control')).toBe('no-store')
    expect(await responseBody(unknown)).toEqual({ error: 'Internal server error.', code: 'internal_error' })
    expect(consoleError).not.toHaveBeenCalled()
  })
})
