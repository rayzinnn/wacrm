import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true
const tablesRead: string[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const method of ['select', 'eq', 'order', 'limit']) b[method] = vi.fn(chain)
    b.update = vi.fn(chain)
    b.insert = vi.fn(chain)
    b.single = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      if (table === 'whatsapp_config') return { data: { waba_id: 'waba-sentinel', access_token: 'cipher-sentinel' }, error: null }
      return { data: null, error: null }
    })
    b.maybeSingle = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      return { data: null, error: null }
    })
    b.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => signedIn
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: { user: null }, error: { message: 'no session' } }),
    },
    from: vi.fn((table: string) => {
      tablesRead.push(table)
      return builder(table)
    }),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'token-sentinel'),
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function makeRequest() {
  const request = new Request('http://localhost/api/whatsapp/templates/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'forged-account', id: 'saved-template', name: 'saved_template' }),
  })
  const json = vi.spyOn(request, 'json')
  return { request, json }
}

beforeEach(() => {
  __resetRateLimitForTests()
  callerRole = 'admin'
  signedIn = true
  tablesRead.length = 0
  supabaseMock = makeSupabaseMock()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: [{
      id: 'graph-template-sentinel',
      name: 'saved_template',
      language: 'en_US',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Saved template body.' }],
    }],
  }), { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/whatsapp/templates/sync — unsupported capability gate', () => {
  it('returns 401 for a missing session before business I/O or Graph fetch', async () => {
    signedIn = false
    const { request, json } = makeRequest()

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['agent', 'viewer'])('returns 403 for %s before business I/O or Graph fetch', async (role) => {
    callerRole = role
    const { request, json } = makeRequest()

    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 422 for an authorized admin before reading template/config rows or calling Graph', async () => {
    const { request, json } = makeRequest()
    const response = await POST(request)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Templates are not supported by this provider.',
      code: 'unsupported_capability',
      capability: 'templates',
    })
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(fetch).not.toHaveBeenCalled()
  })
})
