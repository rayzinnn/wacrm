import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true
const tablesRead: string[] = []

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const method of ['select', 'eq', 'is', 'order', 'limit']) b[method] = vi.fn(chain)
    b.insert = vi.fn(chain)
    b.update = vi.fn(chain)
    b.delete = vi.fn(chain)
    b.single = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      if (table === 'whatsapp_config') return { data: { waba_id: 'waba-sentinel', access_token: 'cipher-sentinel' }, error: null }
      if (table === 'message_templates') return { data: { id: 'saved-template', name: 'order_update' }, error: null }
      return { data: null, error: null }
    })
    b.maybeSingle = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      if (table === 'message_templates') return { data: null, error: null }
      return { data: null, error: null }
    })
    b.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null })
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

const meta = vi.hoisted(() => ({
  submitMessageTemplate: vi.fn(async () => ({ id: 'graph-template-sentinel', status: 'PENDING' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn(() => 'token-sentinel') }))
vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: vi.fn(async () => undefined),
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

const SAVED_OR_FORGED_TEMPLATE = {
  accountId: 'forged-account',
  id: 'saved-template',
  name: 'order_update',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your order shipped.',
}

function makeRequest() {
  const request = new Request('http://localhost/api/whatsapp/templates/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SAVED_OR_FORGED_TEMPLATE),
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
  meta.submitMessageTemplate.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', 'false')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /api/whatsapp/templates/submit — unsupported capability gate', () => {
  it('returns 401 without reading the request or accessing business tables', async () => {
    signedIn = false
    const { request, json } = makeRequest()

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual([])
    expect(meta.submitMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['agent', 'viewer'])('returns 403 for %s before reading or using business data', async (role) => {
    callerRole = role
    const { request, json } = makeRequest()

    const response = await POST(request)

    expect(response.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(meta.submitMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 422 for an authorized admin before reading even a valid saved/forged payload', async () => {
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
    expect(meta.submitMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
