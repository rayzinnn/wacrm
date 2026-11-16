import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mocks.admin,
}))

type Row = Record<string, unknown>
type QueryLog = {
  table: string
  operation: string
  columns: string
  filters: Array<[string, unknown]>
  orFilter: string | null
  values: Row | Row[] | null
}

class FakeQuery {
  private operation = 'select'
  private columns = '*'
  private filters: Array<[string, unknown]> = []
  private orFilter: string | null = null
  private values: Row | Row[] | null = null

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
  ) {}

  select(columns = '*') {
    this.columns = columns
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  or(filter: string) {
    this.orFilter = filter
    return this
  }

  insert(values: Row | Row[]) {
    this.operation = 'insert'
    this.values = values
    return this
  }

  update(values: Row) {
    this.operation = 'update'
    this.values = values
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.execute())
  }

  single() {
    return Promise.resolve(this.execute())
  }

  private execute(): { data: Row | null; error: { code?: string; message?: string } | null } {
    const log: QueryLog = {
      table: this.table,
      operation: this.operation,
      columns: this.columns,
      filters: this.filters,
      orFilter: this.orFilter,
      values: this.values,
    }
    this.db.queries.push(log)

    if (this.db.selectError && this.operation === 'select') {
      return { data: null, error: this.db.selectError }
    }

    if (this.table === 'profiles' && this.operation === 'select') {
      const row = this.db.profiles.find((candidate) => this.matches(candidate))
      return { data: row ? this.project(row) : null, error: null }
    }

    if (this.table !== 'whatsapp_connections') return { data: null, error: null }

    if (this.operation === 'select') {
      const row = this.db.connections.find((candidate) => this.matches(candidate))
      return { data: row ? this.project(row) : null, error: null }
    }

    if (this.operation === 'insert') {
      this.db.beforeInsert?.()
      if (this.db.insertError) return { data: null, error: this.db.insertError }
      const row = Array.isArray(this.values) ? this.values[0] : this.values
      if (!row) return { data: null, error: { code: 'XX000', message: 'missing row' } }
      const duplicate = this.db.connections.some((candidate) =>
        candidate.account_id === row.account_id ||
        (candidate.base_url === row.base_url && candidate.instance_name === row.instance_name),
      )
      if (duplicate) return { data: null, error: { code: '23505', message: 'unique violation' } }
      const saved = {
        id: `connection-${this.db.connections.length + 1}`,
        state: 'disconnected',
        state_checked_at: null,
        created_at: '2026-11-16T00:00:00.000Z',
        updated_at: '2026-11-16T00:00:00.000Z',
        ...row,
      }
      this.db.connections.push(saved)
      return { data: this.project(saved), error: null }
    }

    if (this.operation === 'update') {
      if (this.db.updateError) return { data: null, error: this.db.updateError }
      const row = this.db.connections.find((candidate) => this.matches(candidate) && this.matchesOr(candidate))
      if (!row) return { data: null, error: null }
      Object.assign(row, this.values)
      return { data: this.project(row), error: null }
    }

    return { data: null, error: null }
  }

  private matches(row: Row) {
    return this.filters.every(([field, value]) => row[field] === value)
  }

  private matchesOr(row: Row) {
    if (!this.orFilter) return true
    const value = this.orFilter.split(',').find((part) => part.startsWith('state_checked_at.lte.'))
      ?.slice('state_checked_at.lte.'.length)
    return row.state_checked_at == null || (typeof value === 'string' && String(row.state_checked_at) <= value)
  }

  private project(row: Row): Row {
    if (this.columns === '*' || this.columns.trim() === '') return { ...row }
    return Object.fromEntries(this.columns.split(',').map((column) => [column.trim(), row[column.trim()]]))
  }
}

class FakeDatabase {
  profiles: Row[] = []
  connections: Row[] = []
  queries: QueryLog[] = []
  insertError: { code?: string; message?: string } | null = null
  selectError: { code?: string; message?: string } | null = null
  updateError: { code?: string; message?: string } | null = null
  beforeInsert: (() => void) | null = null

  from(table: string) {
    return new FakeQuery(this, table)
  }
}

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'
const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TOKEN = 'provider-token-do-not-log'
const ORIGIN = 'http://127.0.0.1:8080'

describe('Evolution connection store', () => {
  let db: FakeDatabase
  let store: typeof import('./store')
  let encrypt: (value: string) => string
  let decrypt: (value: string) => string

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('ENCRYPTION_KEY', '1111111111111111111111111111111111111111111111111111111111111111')
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', `${ORIGIN}/`)
    db = new FakeDatabase()
    db.profiles = [
      { user_id: OWNER_A, account_id: ACCOUNT_A, account_role: 'owner' },
      { user_id: OWNER_B, account_id: ACCOUNT_B, account_role: 'owner' },
    ]
    mocks.admin = db
    ;({ encrypt, decrypt } = await import('../encryption'))
    store = await import('./store')
  })

  afterEach(() => vi.unstubAllEnvs())

  function credentials(overrides: Partial<{ baseUrl: string; instanceId: string; token: string }> = {}) {
    return {
      baseUrl: overrides.baseUrl ?? `${ORIGIN}/`,
      instanceId: overrides.instanceId ?? 'wacrm-local',
      token: overrides.token ?? TOKEN,
    }
  }

  async function seedConnection(accountId = ACCOUNT_A) {
    db.connections.push({
      id: 'connection-stable-id',
      account_id: accountId,
      created_by: accountId === ACCOUNT_A ? OWNER_A : OWNER_B,
      provider: 'evolution',
      base_url: ORIGIN,
      instance_name: 'wacrm-local',
      token_encrypted: encrypt('stored-provider-token'),
      webhook_secret_encrypted: encrypt('stored-webhook-secret'),
      state: 'connected',
      state_checked_at: '2026-11-16T10:00:00.000Z',
      created_at: '2026-11-16T09:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    })
  }

  it('encrypts token and independent webhook secret with real AES-GCM and loads them', async () => {
    await store.saveConnection(ACCOUNT_A, OWNER_A, credentials())
    const stored = db.connections[0]

    expect(stored.token_encrypted).not.toBe(TOKEN)
    expect(stored.webhook_secret_encrypted).not.toBe(stored.token_encrypted)
    expect(decrypt(String(stored.token_encrypted))).toBe(TOKEN)
    const webhookSecret = decrypt(String(stored.webhook_secret_encrypted))
    expect(webhookSecret).toMatch(/^[a-f0-9]{64}$/)
    expect(webhookSecret).not.toBe(TOKEN)

    const loaded = await store.loadConnection(ACCOUNT_A)
    expect(loaded?.credentials.token).toBe(TOKEN)
    expect(loaded?.webhookSecret).toBe(decrypt(String(stored.webhook_secret_encrypted)))
  })

  it('canonicalizes the allowed origin before persisting credentials', async () => {
    await store.saveConnection(ACCOUNT_A, OWNER_A, credentials())
    expect(db.connections[0].base_url).toBe(ORIGIN)
  })

  it('scopes reads to the requested account', async () => {
    await seedConnection(ACCOUNT_B)
    expect(await store.loadConnection(ACCOUNT_A)).toBeNull()
    expect(db.queries.at(-1)?.filters).toContainEqual(['account_id', ACCOUNT_A])
  })

  it('returns a safe summary without selecting encrypted credentials', async () => {
    await seedConnection()
    const summary = await store.loadConnectionSummary(ACCOUNT_A)
    expect(summary).toEqual({
      id: 'connection-stable-id',
      provider: 'evolution',
      baseUrl: ORIGIN,
      instanceId: 'wacrm-local',
      state: 'connected',
      checkedAt: '2026-11-16T10:00:00.000Z',
    })
    const selected = db.queries.at(-1)?.columns ?? ''
    expect(selected).not.toContain('token_encrypted')
    expect(selected).not.toContain('webhook_secret_encrypted')
    expect(Object.keys(summary ?? {}).sort()).toEqual(['baseUrl', 'checkedAt', 'id', 'instanceId', 'provider', 'state'])
    expect(JSON.stringify(summary)).not.toContain('stored-provider-token')
    expect(JSON.stringify(summary)).not.toContain('stored-webhook-secret')
  })

  it('rotates only the provider token while preserving connection identity and webhook secret', async () => {
    await seedConnection()
    const secret = db.connections[0].webhook_secret_encrypted
    await store.saveConnection(ACCOUNT_A, OWNER_A, credentials({ token: 'rotated-token' }))
    const loaded = await store.loadConnection(ACCOUNT_A)
    expect(db.connections[0]).toMatchObject({
      id: 'connection-stable-id',
      created_by: OWNER_A,
      base_url: ORIGIN,
      instance_name: 'wacrm-local',
      webhook_secret_encrypted: secret,
    })
    expect(loaded?.credentials.token).toBe('rotated-token')
  })

  it('rejects an origin or instance change without mutating the existing connection', async () => {
    await seedConnection()
    const before = { ...db.connections[0] }
    await expect(store.saveConnection(ACCOUNT_A, OWNER_A, credentials({ instanceId: 'another-instance' })))
      .rejects.toMatchObject({ code: 'connection_conflict', status: 409 })
    expect(db.connections[0]).toEqual(before)
  })

  it('accepts an admin actor from the requested account', async () => {
    db.profiles.push({ user_id: 'admin-a', account_id: ACCOUNT_A, account_role: 'admin' })
    await store.saveConnection(ACCOUNT_A, 'admin-a', credentials())
    expect(db.connections).toHaveLength(1)
    expect(db.connections[0].created_by).toBe('admin-a')
    expect(db.queries.find((query) => query.table === 'profiles')?.filters).toContainEqual(['account_id', ACCOUNT_A])
  })

  it('rejects a base origin change without mutating the existing connection', async () => {
    await seedConnection()
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', `${ORIGIN},https://evolution.example`)
    const before = { ...db.connections[0] }
    await expect(store.saveConnection(ACCOUNT_A, OWNER_A, credentials({ baseUrl: 'https://evolution.example' })))
      .rejects.toMatchObject({ code: 'connection_conflict', status: 409 })
    expect(db.connections[0]).toEqual(before)
  })

  it.each([
    { label: 'owner from another account', userId: OWNER_B, profileAccountId: ACCOUNT_B, role: 'owner' },
    { label: 'agent in the same account', userId: 'agent-a', profileAccountId: ACCOUNT_A, role: 'agent' },
    { label: 'viewer in the same account', userId: 'viewer-a', profileAccountId: ACCOUNT_A, role: 'viewer' },
  ])('rejects $label before inserting', async ({ userId, profileAccountId, role }) => {
    if (userId !== OWNER_B) db.profiles.push({ user_id: userId, account_id: profileAccountId, account_role: role })
    await expect(store.saveConnection(ACCOUNT_A, userId, credentials()))
      .rejects.toMatchObject({ code: 'actor_forbidden', status: 403 })
    expect(db.queries.find((query) => query.table === 'profiles')?.filters).toContainEqual(['account_id', ACCOUNT_A])
    expect(db.queries.filter((query) => query.operation === 'insert')).toHaveLength(0)
  })

  it('rejects a disallowed origin before writing', async () => {
    await expect(store.saveConnection(ACCOUNT_A, OWNER_A, credentials({ baseUrl: 'http://localhost:8080' })))
      .rejects.toMatchObject({ code: 'origin_not_allowed' })
    expect(db.queries.filter((query) => query.operation === 'insert' || query.operation === 'update')).toHaveLength(0)
  })

  it('sanitizes a unique conflict without overwriting a concurrent identity', async () => {
    db.beforeInsert = () => {
      db.connections.push({
        id: 'concurrent-identity',
        account_id: ACCOUNT_A,
        created_by: OWNER_A,
        provider: 'evolution',
        base_url: ORIGIN,
        instance_name: 'wacrm-local',
        token_encrypted: encrypt('concurrent-token'),
        webhook_secret_encrypted: encrypt('concurrent-webhook-secret'),
        state: 'disconnected',
        state_checked_at: null,
      })
    }
    const result = await store.saveConnection(ACCOUNT_A, OWNER_A, credentials()).catch((error) => error)
    expect(result).toMatchObject({ code: 'connection_conflict', status: 409 })
    expect(String(result)).not.toContain(TOKEN)
    expect(String(result)).not.toContain('concurrent-webhook-secret')
    expect(db.connections).toHaveLength(1)
    expect(db.connections[0]).toMatchObject({ id: 'concurrent-identity', created_by: OWNER_A })
  })

  it('does not let an older session observation replace newer state metadata', async () => {
    await seedConnection()
    await store.saveSessionState(ACCOUNT_A, {
      state: 'disconnected',
      checkedAt: '2026-11-16T09:59:00.000Z',
    })
    expect(db.connections[0]).toMatchObject({
      state: 'connected',
      state_checked_at: '2026-11-16T10:00:00.000Z',
    })
  })

  it('stores only a valid state and server ISO timestamp, never a QR field', async () => {
    await seedConnection()
    await store.saveSessionState(ACCOUNT_A, {
      state: 'connecting',
      checkedAt: '2026-11-16T10:05:00.000Z',
    })
    expect(db.connections[0]).toMatchObject({
      state: 'connecting',
      state_checked_at: '2026-11-16T10:05:00.000Z',
    })
    const update = db.queries.find((query) => query.operation === 'update')
    expect(Object.keys(update?.values as Row)).toEqual(['state', 'state_checked_at'])
    await expect(store.saveSessionState(ACCOUNT_A, {
      state: 'not-a-session-state' as never,
      checkedAt: 'yesterday',
    })).rejects.toMatchObject({ code: 'invalid_connection', status: 400 })
  })

  it('sanitizes decryption failures without exposing ciphertext or the cause', async () => {
    await seedConnection()
    db.connections[0].token_encrypted = 'ciphertext-that-must-not-escape'
    await expect(store.loadConnection(ACCOUNT_A)).rejects.toMatchObject({
      code: 'credentials_unavailable',
      status: 500,
      message: 'Evolution credentials are unavailable.',
    })
  })

  it('maps database failures to a constant unavailable error', async () => {
    db.selectError = { code: 'XX000', message: `database included ${TOKEN}` }
    const result = await store.loadConnectionSummary(ACCOUNT_A).catch((error) => error)
    expect(result).toMatchObject({
      code: 'database_unavailable',
      status: 503,
      message: 'Evolution connection storage is unavailable.',
    })
    expect(String(result)).not.toContain(TOKEN)
  })
})
