import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mocks.admin,
}))

const CONNECTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const INSTANCE_ID = 'wacrm-local'
const WEBHOOK_SECRET = 'synthetic-webhook-secret-for-tests'
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TOKEN_CIPHERTEXT = 'synthetic-provider-token-ciphertext-must-not-be-read'

type DbRow = {
  id: string
  account_id: string
  instance_name: string
  webhook_secret_encrypted: string
  token_encrypted: string
}

function connectionRow(webhookSecretEncrypted: string): DbRow {
  return {
    id: CONNECTION_ID,
    account_id: ACCOUNT_ID,
    instance_name: INSTANCE_ID,
    webhook_secret_encrypted: webhookSecretEncrypted,
    token_encrypted: TOKEN_CIPHERTEXT,
  }
}

function headers(connectionId: string | null = CONNECTION_ID, secret: string | null = WEBHOOK_SECRET) {
  const values = new Headers()
  if (connectionId !== null) values.set('x-wacrm-connection', connectionId)
  if (secret !== null) values.set('x-wacrm-webhook-secret', secret)
  return values
}

describe('Evolution webhook authentication', () => {
  let row: DbRow | null
  let selectColumns: string[]
  let filters: Array<[string, unknown]>
  let queryError: { message: string; code: string } | null
  let queryThrows: Error | null
  let auth: typeof import('./webhook-auth')
  let encrypt: (value: string) => string
  let consoleSpies: ReturnType<typeof vi.spyOn>[]

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('ENCRYPTION_KEY', ENCRYPTION_KEY)
    row = null
    selectColumns = []
    filters = []
    queryError = null
    queryThrows = null
    consoleSpies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ]

    const query = {
      select(columns: string) {
        selectColumns.push(columns)
        return this
      },
      eq(field: string, value: unknown) {
        filters.push([field, value])
        return this
      },
      async maybeSingle() {
        if (queryThrows) throw queryThrows
        if (queryError) return { data: null, error: queryError }
        return { data: row, error: null }
      },
    }
    mocks.admin = { from: vi.fn(() => query) }

    ;({ encrypt } = await import('../encryption'))
    auth = await import('./webhook-auth')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function seed(secret = WEBHOOK_SECRET) {
    row = connectionRow(encrypt(secret))
  }

  it('returns only the authenticated connection context and selects no provider token', async () => {
    seed()

    const context = await auth.authenticateWebhook(headers(), {
      instance: INSTANCE_ID,
      apikey: 'body-key-must-not-authorize',
      owner: 'forged-owner',
      server_url: 'https://attacker.invalid',
      destination: 'https://attacker.invalid/callback',
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })

    expect(context).toEqual({ connectionId: CONNECTION_ID, accountId: ACCOUNT_ID, instanceId: INSTANCE_ID })
    expect(JSON.stringify(context)).not.toContain(TOKEN_CIPHERTEXT)

    expect(selectColumns).toEqual(['id,account_id,instance_name,webhook_secret_encrypted'])
    expect(filters).toEqual([['id', CONNECTION_ID]])
  })

  it.each([
    ['missing connection id', null],
    ['malformed connection id', 'connection-A'],
  ])('rejects %s before querying the database', async (_label, connectionId) => {
    await expect(auth.authenticateWebhook(headers(connectionId), { instance: INSTANCE_ID }))
      .rejects.toMatchObject({ code: 'webhook_unauthorized', status: 401 })
    expect(selectColumns).toEqual([])
    expect(filters).toEqual([])
  })

  it('rejects a missing secret before querying the database', async () => {
    await expect(auth.authenticateWebhook(headers(CONNECTION_ID, null), { instance: INSTANCE_ID }))
      .rejects.toMatchObject({ code: 'webhook_unauthorized', status: 401 })
    expect(selectColumns).toEqual([])
  })

  it('does not treat an apikey in the body as authorization', async () => {
    const bodyOnly = new Headers()
    bodyOnly.set('x-wacrm-connection', CONNECTION_ID)

    await expect(auth.authenticateWebhook(bodyOnly, { instance: INSTANCE_ID, apikey: WEBHOOK_SECRET }))
      .rejects.toMatchObject({ code: 'webhook_unauthorized', status: 401 })
    expect(selectColumns).toEqual([])
  })

  it('rejects a wrong secret and an unknown connection with the same generic 401', async () => {
    seed()
    const wrongSecret = 'wrong-secret-that-must-not-leak'
    const denied = await auth.authenticateWebhook(headers(CONNECTION_ID, wrongSecret), { instance: INSTANCE_ID })
      .catch((error: unknown) => error)

    expect(denied).toMatchObject({ code: 'webhook_unauthorized', status: 401 })
    row = null
    const missing = await auth.authenticateWebhook(headers(), { instance: INSTANCE_ID })
      .catch((error: unknown) => error)
    expect(missing).toMatchObject({ code: 'webhook_unauthorized', status: 401 })
    expect((missing as Error).message).toBe((denied as Error).message)
    expect(JSON.stringify([denied, missing])).not.toContain(wrongSecret)
    expect(JSON.stringify([denied, missing])).not.toContain(TOKEN_CIPHERTEXT)
  })

  it('checks the payload instance only after the secret authenticates', async () => {
    seed()

    await expect(auth.authenticateWebhook(headers(), { instance: 'some-other-instance', owner: INSTANCE_ID }))
      .rejects.toMatchObject({ code: 'webhook_correlation_mismatch', status: 403 })
    expect(selectColumns).toHaveLength(1)
  })

  it('accepts header names without case sensitivity', async () => {
    seed()
    const mixedCaseHeaders = new Headers({
      'X-Wacrm-Connection': CONNECTION_ID,
      'X-Wacrm-Webhook-Secret': WEBHOOK_SECRET,
    })

    await expect(auth.authenticateWebhook(mixedCaseHeaders, { instance: INSTANCE_ID }))
      .resolves.toEqual({ connectionId: CONNECTION_ID, accountId: ACCOUNT_ID, instanceId: INSTANCE_ID })
  })

  it('maps database and ciphertext failures to sanitized 503 errors', async () => {
    queryError = { code: 'XX000', message: `sensitive ${TOKEN_CIPHERTEXT}` }
    const dbFailure = await auth.authenticateWebhook(headers(), { instance: INSTANCE_ID })
      .catch((error: unknown) => error)
    expect(dbFailure).toMatchObject({ code: 'webhook_auth_unavailable', status: 503 })

    queryError = null
    queryThrows = new Error(`database ${TOKEN_CIPHERTEXT}`)
    const thrownDbFailure = await auth.authenticateWebhook(headers(), { instance: INSTANCE_ID })
      .catch((error: unknown) => error)
    expect(thrownDbFailure).toMatchObject({ code: 'webhook_auth_unavailable', status: 503 })

    queryThrows = null
    row = connectionRow('malformed-encrypted-secret')
    const cryptoFailure = await auth.authenticateWebhook(headers(), { instance: INSTANCE_ID })
      .catch((error: unknown) => error)
    expect(cryptoFailure).toMatchObject({ code: 'webhook_auth_unavailable', status: 503 })

    const failures = [dbFailure, thrownDbFailure, cryptoFailure]
    const serialized = failures.map((failure) => {
      if (failure instanceof Error) {
        return `${failure.name}:${failure.message}:${String((failure as Error & { cause?: unknown }).cause ?? '')}`
      }
      return String(failure)
    }).join('|')
    expect(serialized).not.toContain(TOKEN_CIPHERTEXT)
    expect(serialized).not.toContain('sensitive')
    expect(serialized).not.toContain('malformed-encrypted-secret')
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })
})
