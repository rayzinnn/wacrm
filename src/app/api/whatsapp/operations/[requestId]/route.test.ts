import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  signedIn: true,
  linked: true,
  accountId: 'account-A',
  role: 'viewer',
  attempt: {
    id: 'attempt-1',
    account_id: 'account-A',
    request_id: 'request-1',
    conversation_id: 'conversation-A',
    message_row_id: 'message-row-1',
    external_message_id: 'external-1',
    outcome: 'rejected',
    error_code: 'http_error',
    request_hash: 'private-hash',
  } as Record<string, unknown> | null,
  conversation: { id: 'conversation-A', account_id: 'account-A' } as Record<string, unknown> | null,
  attemptError: null as { message: string } | null,
  conversationError: null as { message: string } | null,
  calls: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    getCurrentAccount: vi.fn(async () => {
      if (!h.signedIn) throw new actual.UnauthorizedError()
      if (!h.linked) throw new actual.ForbiddenError()
      return {
        accountId: h.accountId,
        userId: 'user-' + h.accountId,
        role: h.role,
        account: { id: h.accountId, name: 'Fixture' },
        supabase: {} as never,
      }
    }),
  }
})

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const query = { table, columns: '', filters: [] as Array<[string, unknown]> }
      h.calls.push(query)
      const builder = {
        select(columns: string) {
          query.columns = columns
          return builder
        },
        eq(column: string, value: unknown) {
          query.filters.push([column, value])
          return builder
        },
        async maybeSingle() {
          if (table === 'evolution_send_attempts') {
            return { data: h.attempt && h.attempt.account_id === h.accountId && h.attempt.request_id === query.filters.find(([key]) => key === 'request_id')?.[1] ? h.attempt : null, error: h.attemptError }
          }
          return {
            data: h.conversation && h.conversation.id === query.filters.find(([key]) => key === 'id')?.[1] && h.conversation.account_id === h.accountId ? h.conversation : null,
            error: h.conversationError,
          }
        },
      }
      return builder
    },
  }),
}))

import { GET } from './route'

function call(requestId = 'request-1') {
  return GET(new Request(`http://localhost/api/whatsapp/operations/${requestId}`), {
    params: Promise.resolve({ requestId }),
  })
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
}

beforeEach(() => {
  h.signedIn = true
  h.linked = true
  h.accountId = 'account-A'
  h.role = 'viewer'
  h.attempt = {
    id: 'attempt-1',
    account_id: 'account-A',
    request_id: 'request-1',
    conversation_id: 'conversation-A',
    message_row_id: 'message-row-1',
    external_message_id: 'external-1',
    outcome: 'rejected',
    error_code: 'http_error',
    request_hash: 'private-hash',
  }
  h.conversation = { id: 'conversation-A', account_id: 'account-A' }
  h.attemptError = null
  h.conversationError = null
  h.calls = []
})

describe('GET /api/whatsapp/operations/[requestId]', () => {
  it('returns a member-scoped status with IDs and only the sanitized error code', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(await response.json()).toEqual({
      requestId: 'request-1',
      attemptId: 'attempt-1',
      conversationId: 'conversation-A',
      messageRowId: 'message-row-1',
      externalMessageId: 'external-1',
      state: 'rejected',
      errorCode: 'http_error',
    })
    expect(h.calls[0]).toMatchObject({
      table: 'evolution_send_attempts',
      columns: 'id,request_id,conversation_id,message_row_id,external_message_id,outcome,error_code',
      filters: [['account_id', 'account-A'], ['request_id', 'request-1']],
    })
    expect(h.calls[1].filters).toEqual([['id', 'conversation-A'], ['account_id', 'account-A']])
  })

  it('rejects anonymous callers before reading operation data', async () => {
    h.signedIn = false
    const response = await call()

    expect(response.status).toBe(401)
    expectNoStore(response)
    expect(h.calls).toEqual([])
  })

  it('rejects a caller without an account membership', async () => {
    h.linked = false
    const response = await call()

    expect(response.status).toBe(403)
    expectNoStore(response)
    expect(h.calls).toEqual([])
  })

  it('does not reveal an attempt key belonging to account B', async () => {
    h.attempt = { ...h.attempt!, account_id: 'account-B' }
    const response = await call()

    expect(response.status).toBe(404)
    expectNoStore(response)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].filters).toEqual([['account_id', 'account-A'], ['request_id', 'request-1']])
  })

  it('does not let an account B member read an account A key', async () => {
    h.accountId = 'account-B'
    const response = await call()

    expect(response.status).toBe(404)
    expectNoStore(response)
    expect(h.calls[0].filters).toEqual([['account_id', 'account-B'], ['request_id', 'request-1']])
  })

  it('does not return an attempt whose conversation belongs to another account', async () => {
    h.conversation = { id: 'conversation-A', account_id: 'account-B' }
    const response = await call()

    expect(response.status).toBe(404)
    expectNoStore(response)
    expect(h.calls[1].filters).toEqual([['id', 'conversation-A'], ['account_id', 'account-A']])
  })

  it('returns not found for a key unknown to the caller account', async () => {
    const response = await call('key-owned-by-another-account')

    expect(response.status).toBe(404)
    expectNoStore(response)
    expect(h.calls[0].filters).toEqual([['account_id', 'account-A'], ['request_id', 'key-owned-by-another-account']])
  })

  it('replaces malformed stored error text with a generic code', async () => {
    h.attempt = { ...h.attempt!, error_code: 'bearertoken' }
    const response = await call()

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect(await response.json()).toMatchObject({ errorCode: 'worker_error' })
  })

  it('returns a no-store service failure instead of a false status on database error', async () => {
    h.attemptError = { message: 'private database detail' }
    const response = await call()

    expect(response.status).toBe(503)
    expectNoStore(response)
    expect(await response.json()).toEqual({
      error: 'operation_status_unavailable',
      code: 'operation_status_unavailable',
    })
  })
})
