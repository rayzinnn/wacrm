import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  roleCalls: [] as string[],
  forbiddenImports: [] as string[],
  businessRead: vi.fn(),
  after: vi.fn(),
  graph: vi.fn(),
  fetch: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: mocks.after }
})
vi.mock('@/lib/whatsapp/broadcast-core', () => {
  mocks.forbiddenImports.push('broadcast-core')
  return { deliverBroadcast: mocks.graph, finalizeBroadcastStatus: vi.fn() }
})
vi.mock('@/lib/whatsapp/broadcast-resume', () => {
  mocks.forbiddenImports.push('broadcast-resume')
  return {
    claimBroadcastDelivery: vi.fn(),
    markBroadcastSending: vi.fn(),
    planBroadcastResume: vi.fn(),
    releaseBroadcastDelivery: vi.fn(),
    RESUME_SCOPES: [],
  }
})
vi.mock('@/lib/flows/admin-client', () => {
  mocks.forbiddenImports.push('admin-client')
  return { supabaseAdmin: vi.fn() }
})
vi.mock('@/lib/rate-limit', () => {
  mocks.forbiddenImports.push('rate-limit')
  return { checkRateLimit: mocks.rateLimit, rateLimitResponse: vi.fn(), RATE_LIMITS: { broadcast: {} } }
})
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account'
import { POST } from './route'

const forbiddenImportsAtLoad = [...mocks.forbiddenImports]

beforeEach(() => {
  mocks.roleCalls = []
  mocks.businessRead.mockReset()
  mocks.after.mockReset()
  mocks.graph.mockReset()
  mocks.fetch.mockReset()
  mocks.rateLimit.mockReset()
  mocks.requireRole.mockReset().mockImplementation(async (minimum: string) => {
    mocks.roleCalls.push(minimum)
    return { supabase: { from: mocks.businessRead }, userId: 'user-1', accountId: 'account-1' }
  })
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => vi.unstubAllGlobals())

function malformedRequest() {
  return { json: vi.fn(async () => { throw new Error('body must stay unread') }) } as unknown as Request
}

function malformedParams() {
  return Object.defineProperty({}, 'params', {
    get() { throw new Error('params must stay unread') },
  })
}

async function expectUnavailable(response: Response) {
  expect(response.status).toBe(422)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({
    error: 'unsupported_capability',
    code: 'unsupported_capability',
    capability: 'broadcasts',
  })
}

describe('POST /api/whatsapp/broadcast/[id]/resume', () => {
  it('authorizes first and returns no-store 422 without reading malformed body/params or side effects', async () => {
    const request = malformedRequest()
    const context = malformedParams()
    const invoke = POST as unknown as (request: Request, context: unknown) => Promise<Response>

    const response = await invoke(request, context)

    await expectUnavailable(response)
    expect(mocks.roleCalls).toEqual(['agent'])
    expect(request.json).not.toHaveBeenCalled()
    expect(mocks.businessRead).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.graph).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(forbiddenImportsAtLoad).toEqual([])
  })

  it.each([
    ['unauthenticated', new UnauthorizedError(), 401],
    ['insufficient role', new ForbiddenError(), 403],
  ])('preserves auth %s before touching request data or route params', async (_label, authError, status) => {
    const request = malformedRequest()
    const context = malformedParams()
    const invoke = POST as unknown as (request: Request, context: unknown) => Promise<Response>
    mocks.requireRole.mockImplementationOnce(async (minimum: string) => {
      mocks.roleCalls.push(minimum)
      throw authError
    })

    const response = await invoke(request, context)

    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(request.json).not.toHaveBeenCalled()
    expect(mocks.businessRead).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.graph).not.toHaveBeenCalled()
  })
})
