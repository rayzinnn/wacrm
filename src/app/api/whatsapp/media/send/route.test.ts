import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  capability: vi.fn(),
  loadConnection: vi.fn(),
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  conversationId: '11111111-1111-4111-8111-111111111111',
  contactId: '33333333-3333-4333-8333-333333333333',
  stageId: '22222222-2222-4222-8222-222222222222',
  conversationAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  contactAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  recipientPhone: '+15551234567',
  stage: null as Record<string, unknown> | null,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  downloadPaths: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  reservation: { attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: 'pending', should_send: true } as Record<string, unknown>,
  transport: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  UnauthorizedError: h.UnauthorizedError,
  ForbiddenError: class ForbiddenError extends Error {},
  toErrorResponse: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 401 }),
}))
vi.mock('@/lib/whatsapp/evolution/capabilities', () => ({ getEvolutionCapabilities: h.capability }))
vi.mock('@/lib/whatsapp/evolution/store', () => ({ loadConnection: h.loadConnection }))
vi.mock('@/lib/whatsapp/evolution/media-send', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/evolution/media-send')>()
  return { ...actual, sendMedia: h.transport }
})
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limit' }, { status: 429 }),
  RATE_LIMITS: { send: {} },
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => adminDb() }))

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
const SECRET = 'synthetic-server-only-evolution-token'

function userDb() {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>()
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
        maybeSingle: async () => {
          if (table === 'conversations' && filters.get('id') === h.conversationId && filters.get('account_id') === h.conversationAccountId) {
            return { data: { id: h.conversationId, contact_id: h.contactId }, error: null }
          }
          if (table === 'contacts' && filters.get('id') === h.contactId && filters.get('account_id') === h.contactAccountId) {
            return { data: { id: h.contactId, account_id: h.contactAccountId, phone: h.recipientPhone }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
}

function adminDb() {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>()
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { filters.set(key, value); return chain },
        gt: (key: string, value: unknown) => { filters.set(`${key}:gt`, value); return chain },
        maybeSingle: async () => {
          const stage = h.stage
          if (table !== 'evolution_outbound_media_stages' || !stage ||
            stage.id !== filters.get('id') || stage.account_id !== filters.get('account_id') ||
            stage.conversation_id !== filters.get('conversation_id') || stage.state !== filters.get('state') ||
            Date.parse(String(stage.expires_at)) <= Date.parse(String(filters.get('expires_at:gt')))) {
            return { data: null, error: null }
          }
          return { data: stage, error: null }
        },
      }
      return chain
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args })
      if (name === 'reserve_evolution_media_send') return { data: [h.reservation], error: null }
      return { data: [{ attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: args.p_outcome }], error: null }
    },
    storage: { from: () => ({ download: async (path: string) => {
      h.downloadPaths.push(path)
      return { data: new Blob([Uint8Array.from(h.bytes).buffer]), error: null }
    } }) },
  }
}

import { EvolutionMediaSendError } from '@/lib/whatsapp/evolution/media-send'
import { POST } from './route'

function seedStage() {
  const path = `account-${h.accountId}/outbound/${h.conversationId}/${h.stageId}/payload.png`
  h.stage = {
    id: h.stageId, account_id: h.accountId, conversation_id: h.conversationId,
    storage_path: path, content_type: 'image', media_type: 'image/png', filename: 'synthetic.png',
    size_bytes: PNG.byteLength, sha256: createHash('sha256').update(PNG).digest('hex'),
    state: 'staged', expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
}

function post(options: { body?: unknown; key?: string } = {}) {
  return POST(new Request('http://localhost/api/whatsapp/media/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': options.key ?? 'application-send-key-1',
    },
    body: JSON.stringify(options.body ?? {
      conversation_id: h.conversationId,
      media_ref: { version: 1, stage_id: h.stageId },
      caption: 'Synthetic caption',
    }),
  }))
}

beforeEach(() => {
  h.accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  h.userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  h.conversationId = '11111111-1111-4111-8111-111111111111'
  h.contactId = '33333333-3333-4333-8333-333333333333'
  h.stageId = '22222222-2222-4222-8222-222222222222'
  h.conversationAccountId = h.accountId
  h.contactAccountId = h.accountId
  h.recipientPhone = '+15551234567'
  h.bytes = PNG
  h.downloadPaths = []
  h.rpcCalls = []
  h.reservation = { attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: 'pending', should_send: true }
  h.transport.mockReset().mockResolvedValue({ externalMessageId: 'synthetic-provider-message-id' })
  h.capability.mockReturnValue({ media: ['image', 'document'] })
  h.requireRole.mockReset().mockImplementation(async () => ({
    accountId: h.accountId, userId: h.userId, supabase: userDb(),
  }))
  h.loadConnection.mockReset().mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444',
    accountId: h.accountId,
    credentials: { baseUrl: 'http://127.0.0.1:8080', instanceId: 'synthetic', token: SECRET },
  })
  seedStage()
})

describe('POST /api/whatsapp/media/send', () => {
  it('blocks disabled media before reading body, Storage, connection or transport', async () => {
    h.capability.mockReturnValue({ media: [] })
    const getReader = vi.fn()
    const req = {
      headers: new Headers({ 'Idempotency-Key': 'test' }),
      body: { getReader },
    } as unknown as Request
    const res = await POST(req)
    expect(res.status).toBe(422)
    expect(getReader).not.toHaveBeenCalled()
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.loadConnection).not.toHaveBeenCalled()
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('rejects an untrusted recipient field rather than accepting caller routing', async () => {
    const res = await post({ body: {
      conversation_id: h.conversationId,
      media_ref: { version: 1, stage_id: h.stageId },
      recipient: '15550000000@s.whatsapp.net',
    } })
    expect(res.status).toBe(400)
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('derives the recipient from the same-account conversation contact and hashes the application key', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, outcome: 'accepted', message_id: 'message-a' })
    expect(h.rpcCalls[0]).toMatchObject({
      name: 'reserve_evolution_media_send',
      args: {
        p_connection_id: '44444444-4444-4444-8444-444444444444',
        p_conversation_id: h.conversationId,
        p_sender_id: h.userId,
        p_request_id: `media-v1-${createHash('sha256').update(h.accountId).update('\0').update('application-send-key-1').digest('hex')}`,
        p_content_type: 'image', p_media_type: 'image/png', p_content_text: 'Synthetic caption',
      },
    })
    expect(h.transport).toHaveBeenCalledTimes(1)
    const [, message] = h.transport.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(message.recipient).toBe('15551234567@s.whatsapp.net')
    expect(message.recipient).not.toBe('15550000000@s.whatsapp.net')
    expect(message.requestId).toMatch(/^media-v1-[a-f0-9]{64}$/)
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(JSON.stringify(body)).not.toContain('storage_path')
  })

  it('replays the stable key without a second transport call', async () => {
    h.reservation = { attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: 'accepted', should_send: false }
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'accepted', message_id: 'message-a' })
    expect(h.transport).not.toHaveBeenCalled()
    expect(h.rpcCalls.map((call) => call.name)).toEqual(['reserve_evolution_media_send'])
  })

  it('blocks a conversation from another account before staging access', async () => {
    h.conversationAccountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers before stage, Storage, connection or transport access', async () => {
    h.requireRole.mockRejectedValue(new h.UnauthorizedError('unauthenticated'))
    const res = await post()
    expect(res.status).toBe(401)
    expect(h.loadConnection).not.toHaveBeenCalled()
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('blocks a stage bound to another conversation before Storage download', async () => {
    h.stage = { ...h.stage, conversation_id: '99999999-9999-4999-8999-999999999999' }
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('rejects expired stages before Storage or reservation', async () => {
    h.stage = { ...h.stage, expires_at: new Date(Date.now() - 1).toISOString() }
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.downloadPaths).toHaveLength(0)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('rejects corrupted staged bytes before reservation or transport', async () => {
    h.bytes = Uint8Array.from(PNG)
    h.bytes[0] = 0x00
    const res = await post()
    expect(res.status).toBe(422)
    expect(h.downloadPaths).toHaveLength(1)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('records an ambiguous timeout as unknown and returns only a sanitized result', async () => {
    h.transport.mockRejectedValue(new EvolutionMediaSendError('timeout', null, true))
    const res = await post()
    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body).toEqual({ error: 'delivery_unknown', outcome: 'unknown', message_id: 'message-a' })
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(JSON.stringify(body)).not.toContain('synthetic-provider-message-id')
    expect(JSON.stringify(body)).not.toContain('storage_path')
    expect(h.transport).toHaveBeenCalledTimes(1)
    expect(h.rpcCalls.at(-1)).toMatchObject({ name: 'complete_evolution_send', args: { p_outcome: 'unknown', p_error_code: 'timeout' } })
  })
})
