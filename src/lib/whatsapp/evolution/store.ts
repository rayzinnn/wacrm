import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { assertAllowedEvolutionOrigin } from './client'
import type { EvolutionCredentials, SessionSnapshot, SessionState } from './types'

export interface StoredConnection {
  id: string
  accountId: string
  createdBy: string
  credentials: EvolutionCredentials
  webhookSecret: string
  state: SessionState
  checkedAt: string | null
}

export interface ConnectionSummary {
  id: string
  provider: 'evolution'
  baseUrl: string
  instanceId: string
  state: SessionState
  checkedAt: string | null
}

export type EvolutionStoreErrorCode =
  | 'actor_forbidden'
  | 'connection_conflict'
  | 'database_unavailable'
  | 'invalid_connection'
  | 'credentials_unavailable'

const ERROR_DETAILS: Record<EvolutionStoreErrorCode, { status: number; message: string }> = {
  actor_forbidden: { status: 403, message: 'Account owner or admin role is required.' },
  connection_conflict: { status: 409, message: 'Evolution connection conflicts with an existing identity.' },
  database_unavailable: { status: 503, message: 'Evolution connection storage is unavailable.' },
  invalid_connection: { status: 400, message: 'Evolution connection input is invalid.' },
  credentials_unavailable: { status: 500, message: 'Evolution credentials are unavailable.' },
}

export class EvolutionStoreError extends Error {
  readonly status: number

  constructor(readonly code: EvolutionStoreErrorCode) {
    const detail = ERROR_DETAILS[code]
    super(detail.message)
    this.name = 'EvolutionStoreError'
    this.status = detail.status
  }
}

type ConnectionRow = {
  id: string
  account_id: string
  created_by: string
  provider: 'evolution'
  base_url: string
  instance_name: string
  token_encrypted: string
  webhook_secret_encrypted: string
  state: SessionState
  state_checked_at: string | null
}

const CONNECTION_COLUMNS =
  'id,account_id,created_by,provider,base_url,instance_name,token_encrypted,webhook_secret_encrypted,state,state_checked_at'
const SUMMARY_COLUMNS = 'id,provider,base_url,instance_name,state,state_checked_at'
const SESSION_STATES = new Set<SessionState>(['disconnected', 'connecting', 'connected', 'unknown'])

function storeError(code: EvolutionStoreErrorCode): EvolutionStoreError {
  return new EvolutionStoreError(code)
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505'
}

function throwDatabaseError(error: { code?: string } | null): void {
  if (isUniqueViolation(error)) throw storeError('connection_conflict')
  if (error) throw storeError('database_unavailable')
}

function isSessionState(value: unknown): value is SessionState {
  return typeof value === 'string' && SESSION_STATES.has(value as SessionState)
}

function isServerTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

async function findConnection(accountId: string, columns: string) {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_connections')
    .select(columns)
    .eq('account_id', accountId)
    .maybeSingle()
  throwDatabaseError(error)
  return data
}

export async function loadConnection(accountId: string): Promise<StoredConnection | null> {
  const row = await findConnection(accountId, CONNECTION_COLUMNS) as ConnectionRow | null
  if (!row) return null

  try {
    return {
      id: row.id,
      accountId: row.account_id,
      createdBy: row.created_by,
      credentials: {
        baseUrl: row.base_url,
        instanceId: row.instance_name,
        token: decrypt(row.token_encrypted),
      },
      webhookSecret: decrypt(row.webhook_secret_encrypted),
      state: row.state,
      checkedAt: row.state_checked_at,
    }
  } catch {
    throw storeError('credentials_unavailable')
  }
}

export async function loadConnectionSummary(accountId: string): Promise<ConnectionSummary | null> {
  const row = await findConnection(accountId, SUMMARY_COLUMNS) as Pick<
    ConnectionRow,
    'id' | 'provider' | 'base_url' | 'instance_name' | 'state' | 'state_checked_at'
  > | null
  if (!row) return null
  return {
    id: row.id,
    provider: 'evolution',
    baseUrl: row.base_url,
    instanceId: row.instance_name,
    state: row.state,
    checkedAt: row.state_checked_at,
  }
}

export async function saveConnection(
  accountId: string,
  actorUserId: string,
  input: EvolutionCredentials,
): Promise<void> {
  const baseUrl = assertAllowedEvolutionOrigin(input?.baseUrl)
  if (!input || typeof input.instanceId !== 'string' || input.instanceId.trim() === '' ||
      typeof input.token !== 'string' || input.token.length === 0) {
    throw storeError('invalid_connection')
  }

  const db = supabaseAdmin()
  const { data: actor, error: actorError } = await db
    .from('profiles')
    .select('account_id,account_role')
    .eq('user_id', actorUserId)
    .eq('account_id', accountId)
    .maybeSingle()
  throwDatabaseError(actorError)
  if (
    !actor || actor.account_id !== accountId ||
    (actor.account_role !== 'owner' && actor.account_role !== 'admin')
  ) {
    throw storeError('actor_forbidden')
  }

  const { data: existing, error: lookupError } = await db
    .from('whatsapp_connections')
    .select(CONNECTION_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  throwDatabaseError(lookupError)

  if (existing) {
    if (existing.base_url !== baseUrl || existing.instance_name !== input.instanceId) {
      throw storeError('connection_conflict')
    }
    const { data, error } = await db
      .from('whatsapp_connections')
      .update({ token_encrypted: encrypt(input.token) })
      .eq('account_id', accountId)
      .eq('id', existing.id)
      .select('id')
      .maybeSingle()
    throwDatabaseError(error)
    if (!data) throw storeError('connection_conflict')
    return
  }

  const webhookSecret = randomBytes(32).toString('hex')
  const { error } = await db
    .from('whatsapp_connections')
    .insert({
      account_id: accountId,
      created_by: actorUserId,
      provider: 'evolution',
      base_url: baseUrl,
      instance_name: input.instanceId,
      token_encrypted: encrypt(input.token),
      webhook_secret_encrypted: encrypt(webhookSecret),
    })
    .select('id')
    .single()
  throwDatabaseError(error)
}

export async function saveSessionState(
  accountId: string,
  snapshot: Pick<SessionSnapshot, 'state' | 'checkedAt'>,
): Promise<void> {
  if (!snapshot || !isSessionState(snapshot.state) || !isServerTimestamp(snapshot.checkedAt)) {
    throw storeError('invalid_connection')
  }

  const { error } = await supabaseAdmin()
    .from('whatsapp_connections')
    .update({ state: snapshot.state, state_checked_at: snapshot.checkedAt })
    .eq('account_id', accountId)
    .eq('provider', 'evolution')
    .or(`state_checked_at.is.null,state_checked_at.lte.${snapshot.checkedAt}`)
    .select('id')
    .maybeSingle()
  throwDatabaseError(error)
}
