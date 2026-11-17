import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  account: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  conversationExists: true,
  stage: null as Record<string, unknown> | null,
  downloads: [] as string[],
  object: null as Uint8Array | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.auth,
  toErrorResponse: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
}))
vi.mock('@/lib/whatsapp/evolution/capabilities', () => ({ getEvolutionCapabilities: h.capability }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limit' }, { status: 429 }),
  RATE_LIMITS: { whatsappMedia: {} },
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({
  from: () => {
    const filters = new Map<string, unknown>()
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
      gt: (key: string, value: unknown) => { filters.set(`${key}:gt`, value); return chain },
      maybeSingle: async () => h.stage && h.stage.id === filters.get('id') &&
        h.stage.account_id === filters.get('account_id') && h.stage.state === filters.get('state') &&
        Date.parse(String(h.stage.expires_at)) > Date.parse(String(filters.get('expires_at:gt')))
        ? { data: h.stage, error: null } : { data: null, error: null },
    }
    return chain
  },
  storage: { from: () => ({ download: async (path: string) => {
    h.downloads.push(path)
    return h.object ? { data: new Blob([Uint8Array.from(h.object).buffer]), error: null } : { data: null, error: { message: 'missing' } }
  } }) },
}) }))

import { GET } from './route'

const STAGE_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function seedStage() {
  const path = `account-${ACCOUNT}/outbound/${CONVERSATION_ID}/${STAGE_ID}/payload.png`
  h.stage = {
    id: STAGE_ID, account_id: ACCOUNT, conversation_id: CONVERSATION_ID,
    storage_path: path, content_type: 'image', media_type: 'image/png',
    filename: 'synthetic.png', size_bytes: PNG.byteLength,
    sha256: createHash('sha256').update(PNG).digest('hex'), state: 'staged',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
  h.object = PNG
}

beforeEach(() => {
  h.account = ACCOUNT
  h.conversationExists = true
  h.downloads = []
  h.auth.mockReset().mockImplementation(async () => ({
    accountId: h.account,
    userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    supabase: { from: () => {
      const filters = new Map<string, unknown>()
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
        maybeSingle: async () => h.conversationExists && filters.get('id') === CONVERSATION_ID && filters.get('account_id') === h.account
          ? { data: { id: CONVERSATION_ID }, error: null }
          : { data: null, error: null },
      }
      return chain
    } },
  }))
  h.capability.mockReturnValue({ media: [] })
  seedStage()
})

function get(stageId = STAGE_ID) {
  return GET(new Request(`http://localhost/api/whatsapp/media/staging/${stageId}`), { params: Promise.resolve({ stageId }) })
}

describe('GET /api/whatsapp/media/staging/[stageId]', () => {
  it('does not query the stage or download private bytes when unauthenticated', async () => {
    h.auth.mockRejectedValueOnce(new Error('unauthorized'))
    const res = await get()
    expect(res.status).toBe(401)
    expect(h.downloads).toHaveLength(0)
  })

  it('does not find another account stage or download its object', async () => {
    h.account = 'account-b'
    const res = await get()
    expect(res.status).toBe(404)
    expect(h.downloads).toHaveLength(0)
  })

  it('refuses a disabled media capability before reading private Storage', async () => {
    const res = await get()
    expect(res.status).toBe(422)
    expect(h.downloads).toHaveLength(0)
  })

  it('returns bytes only to an authorized account when capability is enabled', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toContain('inline')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
    expect(h.downloads).toEqual([String(h.stage?.storage_path)])
  })

  it('does not return corrupt or mismatched objects', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    h.object = new TextEncoder().encode('not png')
    const res = await get()
    expect(res.status).toBe(503)
  })

  it('does not fetch the object when the conversation is outside the account', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    h.conversationExists = false
    const res = await get()
    expect(res.status).toBe(404)
    expect(h.downloads).toHaveLength(0)
  })
})
