import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true
const tablesRead: string[] = []
const writes: string[] = []

const TEMPLATE_ID = '3f1c9d2e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
const TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'saved_template',
  status: 'APPROVED',
  category: 'Marketing',
  meta_template_id: 'graph-template-sentinel',
  language: 'en_US',
}

function makeSupabaseMock() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) b[method] = vi.fn(chain)
    b.update = vi.fn(() => {
      writes.push('update')
      return b
    })
    b.delete = vi.fn(() => {
      writes.push('delete')
      return b
    })
    b.single = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      if (table === 'message_templates') return { data: TEMPLATE, error: null }
      if (table === 'whatsapp_config') return { data: { waba_id: 'waba-sentinel', access_token: 'cipher-sentinel' }, error: null }
      return { data: null, error: null }
    })
    b.maybeSingle = vi.fn(async () => {
      if (table === 'profiles') return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
      if (table === 'accounts') return { data: { id: 'acct-1', name: 'Fixture' }, error: null }
      if (table === 'message_templates') return { data: TEMPLATE, error: null }
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

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn(() => 'token-sentinel') }))

const meta = vi.hoisted(() => ({
  editMessageTemplate: vi.fn(async () => ({})),
  deleteMessageTemplate: vi.fn(async () => ({})),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)
vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: vi.fn(async () => undefined),
}))

import { DELETE, PATCH } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function makeRequest(method: 'PATCH' | 'DELETE') {
  const request = new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: 'forged-account',
      id: TEMPLATE_ID,
      name: 'saved_template',
      category: 'Marketing',
      language: 'en_US',
      body_text: 'A saved template payload.',
    }),
  })
  const json = vi.spyOn(request, 'json')
  return { request, json }
}

function makeObservedContext() {
  let reads = 0
  const context = Object.defineProperty({}, 'params', {
    get() {
      reads += 1
      return Promise.resolve({ id: TEMPLATE_ID })
    },
  }) as { params: Promise<{ id: string }> }
  return { context, paramsRead: () => reads }
}

beforeEach(() => {
  __resetRateLimitForTests()
  callerRole = 'admin'
  signedIn = true
  tablesRead.length = 0
  writes.length = 0
  supabaseMock = makeSupabaseMock()
  meta.editMessageTemplate.mockClear()
  meta.deleteMessageTemplate.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/whatsapp/templates/[id] — unsupported capability gate', () => {
  it('PATCH returns 401 before reading params/body or touching business data', async () => {
    signedIn = false
    const { request, json } = makeRequest('PATCH')
    const observed = makeObservedContext()

    const response = await PATCH(request, observed.context)

    expect(response.status).toBe(401)
    expect(observed.paramsRead()).toBe(0)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual([])
    expect(meta.editMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['agent', 'viewer'])('PATCH returns 403 for %s before reading params/body or business data', async (role) => {
    callerRole = role
    const { request, json } = makeRequest('PATCH')
    const observed = makeObservedContext()

    const response = await PATCH(request, observed.context)

    expect(response.status).toBe(403)
    expect(observed.paramsRead()).toBe(0)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(meta.editMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('PATCH returns 422 for admin before reading a saved/forged payload or loading a row', async () => {
    const { request, json } = makeRequest('PATCH')
    const observed = makeObservedContext()

    const response = await PATCH(request, observed.context)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Templates are not supported by this provider.',
      code: 'unsupported_capability',
      capability: 'templates',
    })
    expect(observed.paramsRead()).toBe(0)
    expect(json).not.toHaveBeenCalled()
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(meta.editMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('DELETE returns 401 before reading params or touching business data', async () => {
    signedIn = false
    const { request } = makeRequest('DELETE')
    const observed = makeObservedContext()

    const response = await DELETE(request, observed.context)

    expect(response.status).toBe(401)
    expect(observed.paramsRead()).toBe(0)
    expect(tablesRead).toEqual([])
    expect(meta.deleteMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['agent', 'viewer'])('DELETE returns 403 for %s before reading params or business data', async (role) => {
    callerRole = role
    const { request } = makeRequest('DELETE')
    const observed = makeObservedContext()

    const response = await DELETE(request, observed.context)

    expect(response.status).toBe(403)
    expect(observed.paramsRead()).toBe(0)
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(meta.deleteMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('DELETE returns 422 for admin before reading params or deleting a saved row', async () => {
    const { request } = makeRequest('DELETE')
    const observed = makeObservedContext()

    const response = await DELETE(request, observed.context)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Templates are not supported by this provider.',
      code: 'unsupported_capability',
      capability: 'templates',
    })
    expect(observed.paramsRead()).toBe(0)
    expect(tablesRead).toEqual(['profiles', 'accounts'])
    expect(meta.deleteMessageTemplate).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
