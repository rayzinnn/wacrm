import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  role: 'admin',
  signedIn: true,
  userId: 'user-a',
  accountId: 'account-a',
}))

const store = vi.hoisted(() => {
  class EvolutionStoreError extends Error {
    constructor(
      readonly code:
        | 'actor_forbidden'
        | 'connection_conflict'
        | 'database_unavailable'
        | 'invalid_connection'
        | 'credentials_unavailable',
      readonly status = {
        actor_forbidden: 403,
        connection_conflict: 409,
        database_unavailable: 503,
        invalid_connection: 400,
        credentials_unavailable: 500,
      }[code],
    ) {
      super('Connection store error')
      this.name = 'EvolutionStoreError'
    }
  }

  const state = {
    summaries: new Map<string, Record<string, unknown>>(),
    summaryCalls: [] as string[],
    saveCalls: [] as [string, string, Record<string, string>][],
    stateCalls: [] as [string, { state: string; checkedAt: string }][],
    loadError: null as unknown,
    saveError: null as unknown,
    loadConnectionSummary: vi.fn(async (accountId: string) => {
      state.summaryCalls.push(accountId)
      if (state.loadError) throw state.loadError
      return state.summaries.get(accountId) ?? null
    }),
    saveConnection: vi.fn(async (accountId: string, actorUserId: string, input: Record<string, string>) => {
      state.saveCalls.push([accountId, actorUserId, input])
      if (state.saveError) throw state.saveError
    }),
    saveSessionState: vi.fn(async (accountId: string, snapshot: { state: string; checkedAt: string }) => {
      state.stateCalls.push([accountId, snapshot])
    }),
    EvolutionStoreError,
  }
  return state
})

const client = vi.hoisted(() => ({
  sessions: [] as Record<string, string>[],
  getSession: vi.fn(async (credentials: Record<string, string>) => {
    client.sessions.push(credentials)
    return {
      state: 'connected',
      qr: { dataUrl: 'data:image/png;base64,fixture-qr', expiresAt: 'never-return-this' },
      checkedAt: '2026-11-16T12:00:00.000Z',
    }
  }),
}))

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      if (table === 'profiles') {
        return { data: { account_id: auth.accountId, account_role: auth.role }, error: null }
      }
      if (table === 'accounts') return { data: { id: auth.accountId, name: 'Fixture account' }, error: null }
      return { data: null, error: null }
    }
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq']) query[method] = vi.fn(() => query)
    query.maybeSingle = vi.fn(async () => result())
    return query
  }

  return {
    auth: {
      getUser: vi.fn(async () =>
        auth.signedIn
          ? { data: { user: { id: auth.userId } }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/whatsapp/evolution/store', () => ({
  EvolutionStoreError: store.EvolutionStoreError,
  loadConnectionSummary: store.loadConnectionSummary,
  saveConnection: store.saveConnection,
  saveSessionState: store.saveSessionState,
}))

vi.mock('@/lib/whatsapp/evolution/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/client')>()
  return { ...actual, getSession: client.getSession }
})

import * as route from './route'
import { EvolutionError } from '@/lib/whatsapp/evolution/client'
import { __resetRateLimitForTests, RATE_LIMITS } from '@/lib/rate-limit'

const originalAllowedOrigins = process.env.EVOLUTION_ALLOWED_ORIGINS

const SAFE_SUMMARY = {
  id: 'internal-connection-id',
  provider: 'evolution',
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'fixture-instance',
  state: 'connected',
  checkedAt: '2026-11-16T12:00:00.000Z',
  token: 'raw-token-must-not-leak',
  token_encrypted: 'ciphertext-must-not-leak',
  webhook_secret_encrypted: 'webhook-ciphertext-must-not-leak',
}

const CREDENTIALS = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'fixture-instance',
  token: 'fixture-token',
}

function post(body: unknown) {
  return route.POST(new Request('http://localhost/api/whatsapp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function expectNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store')
}

beforeEach(() => {
  __resetRateLimitForTests()
  auth.role = 'admin'
  auth.signedIn = true
  auth.userId = 'user-a'
  auth.accountId = 'account-a'
  supabaseMock = makeSupabaseMock()
  store.summaries.clear()
  store.summaryCalls.length = 0
  store.saveCalls.length = 0
  store.stateCalls.length = 0
  store.loadError = null
  store.saveError = null
  store.loadConnectionSummary.mockClear()
  store.saveConnection.mockClear()
  store.saveSessionState.mockClear()
  client.sessions.length = 0
  client.getSession.mockClear()
  client.getSession.mockResolvedValue({
    state: 'connected',
    qr: { dataUrl: 'data:image/png;base64,fixture-qr', expiresAt: 'never-return-this' },
    checkedAt: '2026-11-16T12:00:00.000Z',
  })
  process.env.EVOLUTION_ALLOWED_ORIGINS = 'http://127.0.0.1:8080'
})

afterEach(() => {
  if (originalAllowedOrigins === undefined) delete process.env.EVOLUTION_ALLOWED_ORIGINS
  else process.env.EVOLUTION_ALLOWED_ORIGINS = originalAllowedOrigins
})

describe('GET /api/whatsapp/config', () => {
  it('requires a session and returns the standard 401 envelope', async () => {
    auth.signedIn = false

    const response = await route.GET()
    const body = await json(response)

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ error: expect.any(String) })
    expect(body).not.toHaveProperty('code')
    expectNoStore(response)
    expect(store.loadConnectionSummary).not.toHaveBeenCalled()
    expect(client.getSession).not.toHaveBeenCalled()
  })

  it('derives A and B scopes from their authenticated accounts without calling Evolution', async () => {
    auth.role = 'viewer'
    store.summaries.set('account-a', SAFE_SUMMARY)
    store.summaries.set('account-b', { ...SAFE_SUMMARY, instanceId: 'instance-b' })

    const responseA = await route.GET()
    const bodyA = await json(responseA)
    auth.userId = 'user-b'
    auth.accountId = 'account-b'
    const responseB = await route.GET()
    const bodyB = await json(responseB)

    expect(store.summaryCalls).toEqual(['account-a', 'account-b'])
    expect(bodyA).toMatchObject({ configured: true, provider: 'evolution', state: 'connected' })
    expect(bodyB).toMatchObject({ configured: true, provider: 'evolution', state: 'connected' })
    expect(bodyB).not.toHaveProperty('instanceId')
    expect(client.getSession).not.toHaveBeenCalled()
    for (const [response, body] of [[responseA, bodyA], [responseB, bodyB]] as const) {
      expect(body).toHaveProperty('capabilities')
      expect(body).not.toHaveProperty('id')
      expect(JSON.stringify(body)).not.toContain('raw-token-must-not-leak')
      expect(JSON.stringify(body)).not.toContain('ciphertext-must-not-leak')
      expect(JSON.stringify(body)).not.toContain('webhook-ciphertext-must-not-leak')
      expect(JSON.stringify(body)).not.toContain('fixture-qr')
      expectNoStore(response)
    }
  })

  it('returns baseUrl and instanceId only to an owner or admin', async () => {
    store.summaries.set('account-a', SAFE_SUMMARY)
    auth.role = 'viewer'

    const viewerResponse = await route.GET()
    const viewerBody = await json(viewerResponse)
    auth.role = 'owner'
    const ownerResponse = await route.GET()
    const ownerBody = await json(ownerResponse)

    expect(viewerBody).not.toHaveProperty('baseUrl')
    expect(viewerBody).not.toHaveProperty('instanceId')
    expect(ownerBody).toMatchObject({ baseUrl: CREDENTIALS.baseUrl, instanceId: CREDENTIALS.instanceId })
    expect(ownerBody).not.toHaveProperty('id')
    expectNoStore(viewerResponse)
    expectNoStore(ownerResponse)
  })

  it('returns a disconnected DTO when no connection exists', async () => {
    const response = await route.GET()
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ configured: false, provider: 'evolution', state: 'disconnected', checkedAt: null })
    expect(body).not.toHaveProperty('baseUrl')
    expect(body).not.toHaveProperty('instanceId')
    expectNoStore(response)
  })

  it('maps a database store outage to 503 without exposing its message', async () => {
    store.loadError = new store.EvolutionStoreError('database_unavailable')

    const response = await route.GET()
    const body = await json(response)

    expect(response.status).toBe(503)
    expect(body).toMatchObject({ code: 'database_unavailable' })
    expect(JSON.stringify(body)).not.toContain('Connection store error')
    expectNoStore(response)
  })

  it('uses the store code and status for actor authorization failures', async () => {
    store.loadError = new store.EvolutionStoreError('actor_forbidden')

    const response = await route.GET()

    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ code: 'actor_forbidden' })
    expectNoStore(response)
  })
})

describe('POST /api/whatsapp/config', () => {
  it('requires a session before querying the store or Evolution', async () => {
    auth.signedIn = false

    const response = await post(CREDENTIALS)

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ error: expect.any(String) })
    expect(store.saveConnection).not.toHaveBeenCalled()
    expect(client.getSession).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it.each(['agent', 'viewer'])('rejects %s before any store write or network request', async (role) => {
    auth.role = role

    const response = await post(CREDENTIALS)

    expect(response.status).toBe(403)
    expect(store.saveConnection).not.toHaveBeenCalled()
    expect(store.saveSessionState).not.toHaveBeenCalled()
    expect(client.getSession).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it('saves validated credentials and session state only under the authenticated account', async () => {
    auth.role = 'admin'
    auth.userId = 'user-b'
    auth.accountId = 'account-b'

    const response = await post(CREDENTIALS)
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(client.getSession).toHaveBeenCalledWith(CREDENTIALS)
    expect(store.saveCalls).toEqual([['account-b', 'user-b', CREDENTIALS]])
    expect(store.stateCalls).toEqual([['account-b', { state: 'connected', checkedAt: '2026-11-16T12:00:00.000Z' }]])
    expect(body).toMatchObject({ configured: true, provider: 'evolution', state: 'connected', checkedAt: '2026-11-16T12:00:00.000Z' })
    expect(body).toMatchObject({ baseUrl: CREDENTIALS.baseUrl, instanceId: CREDENTIALS.instanceId })
    expect(body).not.toHaveProperty('id')
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.token)
    expect(JSON.stringify(body)).not.toContain('fixture-qr')
    expectNoStore(response)
  })

  it('rejects a forged accountId instead of accepting caller-selected tenancy', async () => {
    const response = await post({ ...CREDENTIALS, accountId: 'account-b' })
    const body = await json(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ code: 'invalid_payload' })
    expect(client.getSession).not.toHaveBeenCalled()
    expect(store.saveConnection).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it('rejects a forbidden origin before fetching the provider', async () => {
    const response = await post({ ...CREDENTIALS, baseUrl: 'http://localhost:8080' })

    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({ code: 'evolution_origin_not_allowed' })
    expect(client.getSession).not.toHaveBeenCalled()
    expect(store.saveConnection).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it('maps provider 401 to a sanitized 400 credential error, not a session 401', async () => {
    client.getSession.mockRejectedValueOnce(new EvolutionError('unauthorized', 'provider rejected fixture-token', { httpStatus: 401 }))

    const response = await post(CREDENTIALS)
    const body = await json(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ code: 'evolution_unauthorized' })
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.token)
    expect(JSON.stringify(body)).not.toContain('provider rejected')
    expect(store.saveConnection).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it.each([
    ['timeout', null, 504],
    ['network_error', null, 502],
    ['redirect_blocked', 302, 502],
    ['invalid_response', 200, 502],
    ['invalid_qr', 200, 502],
    ['http_error', 429, 429],
    ['invalid_instance', 400, 400],
  ] as const)('maps Evolution %s to its stable HTTP status and code', async (code, httpStatus, status) => {
    client.getSession.mockRejectedValueOnce(new EvolutionError(code, `provider detail: ${CREDENTIALS.token}`, { httpStatus }))

    const response = await post(CREDENTIALS)
    const body = await json(response)

    expect(response.status).toBe(status)
    expect(body).toMatchObject({ code: `evolution_${code}` })
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.token)
    expectNoStore(response)
  })

  it('maps a connection race to 409 and does not reveal the store error', async () => {
    store.saveError = new store.EvolutionStoreError('connection_conflict')

    const response = await post(CREDENTIALS)
    const body = await json(response)

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ code: 'connection_conflict' })
    expect(JSON.stringify(body)).not.toContain('Connection store error')
    expect(store.saveSessionState).not.toHaveBeenCalled()
    expectNoStore(response)
  })

  it('maps unknown persistence errors to a generic 500 without logging raw details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.saveError = new Error(`database detail ${CREDENTIALS.token}`)

    const response = await post(CREDENTIALS)
    const body = await json(response)

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ code: 'internal_error' })
    expect(JSON.stringify(body)).not.toContain(CREDENTIALS.token)
    expect(errorSpy).not.toHaveBeenCalled()
    expectNoStore(response)
    errorSpy.mockRestore()
  })

  it('returns a local generic 400 for malformed JSON without logging the body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post('{"token":"must-not-leak')
    const body = await json(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ code: 'invalid_request' })
    expect(JSON.stringify(body)).not.toContain('must-not-leak')
    expect(errorSpy).not.toHaveBeenCalled()
    expectNoStore(response)
    errorSpy.mockRestore()
  })

  it('keeps the admin rate limit and returns an error code with standard headers', async () => {
    let response: Response | undefined
    for (let index = 0; index <= RATE_LIMITS.whatsappAdmin.limit; index += 1) {
      response = await post(CREDENTIALS)
    }

    expect(response?.status).toBe(429)
    expect(await json(response!)).toMatchObject({ code: 'rate_limited' })
    expect(response?.headers.get('Retry-After')).toBeTruthy()
    expect(client.getSession).toHaveBeenCalledTimes(RATE_LIMITS.whatsappAdmin.limit)
    expectNoStore(response!)
  })

  it('does not export destructive DELETE for configuration reset', () => {
    expect(route).not.toHaveProperty('DELETE')
  })
})
