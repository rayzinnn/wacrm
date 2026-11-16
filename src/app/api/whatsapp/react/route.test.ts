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
vi.mock('@/lib/whatsapp/meta-api', () => {
  mocks.forbiddenImports.push('meta-api')
  return { sendReactionMessage: mocks.graph }
})
vi.mock('@/lib/whatsapp/encryption', () => {
  mocks.forbiddenImports.push('encryption')
  return { decrypt: vi.fn() }
})
vi.mock('@/lib/whatsapp/wa-identity', () => {
  mocks.forbiddenImports.push('wa-identity')
  return { resolveContactSendTarget: vi.fn() }
})
vi.mock('@/lib/rate-limit', () => {
  mocks.forbiddenImports.push('rate-limit')
  return { checkRateLimit: mocks.rateLimit, rateLimitResponse: vi.fn(), RATE_LIMITS: { react: {} } }
})
vi.mock('@/lib/inbox/business-reaction', () => {
  mocks.forbiddenImports.push('business-reaction')
  return { removeBusinessReaction: vi.fn(), setBusinessReaction: vi.fn() }
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

async function expectUnavailable(response: Response) {
  expect(response.status).toBe(422)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({
    error: 'unsupported_capability',
    code: 'unsupported_capability',
    capability: 'reactions',
  })
}

describe('POST /api/whatsapp/react', () => {
  it('authorizes first and returns no-store 422 without reading the malformed body or side effects', async () => {
    const request = malformedRequest()

    const response = await POST(request)

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
  ])('preserves auth %s before touching request data', async (_label, authError, status) => {
    const request = malformedRequest()
    mocks.requireRole.mockImplementationOnce(async (minimum: string) => {
      mocks.roleCalls.push(minimum)
      throw authError
    })

    const response = await POST(request)

    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(request.json).not.toHaveBeenCalled()
    expect(mocks.businessRead).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.graph).not.toHaveBeenCalled()
  })
})
