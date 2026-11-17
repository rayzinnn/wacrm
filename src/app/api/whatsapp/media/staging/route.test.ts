import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  callerAccount: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  callerUser: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  conversationAccount: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  conversationId: '11111111-1111-4111-8111-111111111111',
  stages: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  uploads: [] as Array<{ path: string; bytes: Uint8Array; options: Record<string, unknown> }>,
  downloads: [] as string[],
  deletes: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.auth,
  toErrorResponse: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 401 }),
}))
vi.mock('@/lib/whatsapp/evolution/capabilities', () => ({ getEvolutionCapabilities: h.capability }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limit' }, { status: 429 }),
  RATE_LIMITS: { send: {}, whatsappMedia: {} },
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => adminDb() }))

function userDb() {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>()
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
        maybeSingle: async () => table === 'conversations' &&
          filters.get('id') === h.conversationId && filters.get('account_id') === h.conversationAccount
          ? { data: { id: h.conversationId }, error: null }
          : { data: null, error: null },
      }
      return chain
    },
  }
}

function adminDb() {
  return {
    from(table: string) {
      let values: Record<string, unknown> = {}
      const filters = new Map<string, unknown>()
      const chain = {
        insert: async (input: Record<string, unknown>) => {
          values = input
          h.inserted.push(input)
          return { error: null }
        },
        update: (input: Record<string, unknown>) => { values = input; return chain },
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
        gt: (key: string, value: unknown) => { filters.set(`${key}:gt`, value); return chain },
        maybeSingle: async () => {
          if (table === 'evolution_outbound_media_stages') {
            const row = h.stages.find((stage) => stage.id === filters.get('id') &&
              stage.account_id === filters.get('account_id') && stage.state === filters.get('state'))
            if (values.state === 'staged' && row) Object.assign(row, values)
            if (filters.has('expires_at:gt') && row && Date.parse(String(row.expires_at)) <= Date.parse(String(filters.get('expires_at:gt')))) {
              return { data: null, error: null }
            }
            return { data: row ?? (values.id ? { id: values.id } : null), error: null }
          }
          return { data: null, error: null }
        },
        single: async () => ({ data: null, error: null }),
      }
      return chain
    },
    storage: { from: () => ({
      upload: async (path: string, bytes: Uint8Array, options: Record<string, unknown>) => {
        h.uploads.push({ path, bytes, options })
        const row = h.inserted.at(-1)
        if (row) h.stages.push({ ...row, state: 'uploading', expires_at: new Date(Date.now() + 86400000).toISOString() })
        return { error: null }
      },
      download: async (path: string) => {
        h.downloads.push(path)
        const stored = h.uploads.find((upload) => upload.path === path)
        return stored ? { data: new Blob([Uint8Array.from(stored.bytes).buffer]), error: null } : { data: null, error: { message: 'missing' } }
      },
      remove: async (paths: string[]) => { h.deletes.push(...paths); return { error: null } },
    }) },
  }
}

import { POST } from './route'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
const PDF = new TextEncoder().encode('%PDF-synthetic')

function request(bytes = PNG, contentType = 'image/png', filename = 'synthetic.png') {
  return new Request(`http://localhost/api/whatsapp/media/staging?conversation_id=${h.conversationId}&filename=${encodeURIComponent(filename)}`, {
    method: 'POST', headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) }, body: bytes,
  })
}

beforeEach(() => {
  h.callerAccount = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  h.callerUser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  h.conversationAccount = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  h.conversationId = '11111111-1111-4111-8111-111111111111'
  h.stages = []
  h.inserted = []
  h.uploads = []
  h.downloads = []
  h.deletes = []
  h.auth.mockReset().mockImplementation(async () => ({
    accountId: h.callerAccount, userId: h.callerUser, supabase: userDb(),
  }))
  h.capability.mockReturnValue({ media: [] })
})

describe('POST /api/whatsapp/media/staging', () => {
  it('does not read or stage an unauthenticated upload', async () => {
    h.auth.mockRejectedValueOnce(new Error('unauthorized'))
    const res = await POST(request())
    expect(res.status).toBe(401)
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('blocks disabled media before consuming the body or touching Storage', async () => {
    const bodyRead = vi.fn()
    const req = {
      url: `http://localhost/api/whatsapp/media/staging?conversation_id=${h.conversationId}`,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: { getReader: bodyRead },
    } as unknown as Request
    const res = await POST(req)
    expect(res.status).toBe(422)
    expect(bodyRead).not.toHaveBeenCalled()
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('rejects a conversation from another account before upload', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    h.callerAccount = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const res = await POST(request())
    expect(res.status).toBe(404)
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('rejects invalid signature before inserting or uploading', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    const res = await POST(request(new TextEncoder().encode('not an image')))
    expect(res.status).toBe(415)
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it.each([
    ['image/png', PNG, 'synthetic.png', 'image'],
    ['image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x01]), 'synthetic.jpg', 'image'],
    ['application/pdf', PDF, 'synthetic.pdf', 'document'],
  ] as const)('stages only validated %s bytes behind a stable private reference', async (mime, bytes, filename, kind) => {
    h.capability.mockReturnValue({ media: [kind] })
    const res = await POST(request(bytes, mime, filename))
    expect(res.status).toBe(201)
    const payload = await res.json() as { media_ref: { version: number; stage_id: string }; filename: string }
    expect(payload.media_ref.version).toBe(1)
    expect(payload.media_ref.stage_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.filename).toBe(filename)
    expect(JSON.stringify(payload)).not.toContain('storage_path')
    expect(JSON.stringify(payload)).not.toContain('publicUrl')
    expect(h.inserted[0]).toMatchObject({ account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', conversation_id: h.conversationId, uploaded_by: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', media_type: mime, state: 'uploading' })
    expect(h.uploads[0].path).toBe(`account-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/outbound/${h.conversationId}/${payload.media_ref.stage_id}/payload.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'pdf'}`)
    expect(h.uploads[0].options).toMatchObject({ contentType: mime, upsert: false, cacheControl: '0' })
  })

  it('enforces the 16 MiB cap from declared length before conversation or upload work', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    const req = new Request(`http://localhost/api/whatsapp/media/staging?conversation_id=${h.conversationId}`, {
      method: 'POST', headers: { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024 + 1) }, body: PNG,
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('enforces the 16 MiB cap while streaming when Content-Length is absent', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    const body = new Uint8Array(16 * 1024 * 1024 + 1)
    body.set(PNG)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(body); controller.close() },
    })
    const req = new Request(`http://localhost/api/whatsapp/media/staging?conversation_id=${h.conversationId}&filename=synthetic.png`, {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const res = await POST(req)
    expect(res.status).toBe(413)
    expect(h.inserted).toHaveLength(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('accepts a synthetic file exactly at the 16 MiB ceiling', async () => {
    h.capability.mockReturnValue({ media: ['image'] })
    const bytes = new Uint8Array(16 * 1024 * 1024)
    bytes.set(PNG)
    const res = await POST(request(bytes))
    expect(res.status).toBe(201)
    expect(h.uploads[0].bytes.byteLength).toBe(16 * 1024 * 1024)
  })
})
