import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { assertAllowedEvolutionOrigin, EvolutionError, getSession } from './client'
import type { SessionState } from './types'

export class EvolutionEventWorkerError extends Error {
  readonly code = 'event_worker_unavailable'
  readonly status = 503

  constructor() {
    super('Evolution event worker is unavailable.')
    this.name = 'EvolutionEventWorkerError'
  }
}

type WorkerCounts = {
  claimed: number
  done: number
  retry: number
  failed: number
  stale: number
}

type WorkerOutcome = 'done' | 'retry' | 'failed' | 'stale'
type ClaimedEvent = {
  id: string
  connection_id: string
  lease_token: string
  normalized_event: unknown
}
type ConnectionCredentialRow = {
  id: string
  provider: string
  base_url: string
  instance_name: string
  token_encrypted: string
}

const CONNECTION_COLUMNS = 'id,provider,base_url,instance_name,token_encrypted'
const SESSION_STATES = new Set<SessionState>(['disconnected', 'connecting', 'connected', 'unknown'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStaleError(error: unknown): boolean {
  return isRecord(error) && (error.code === '40001' || error.code === 'P0002')
}

function isServerTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function providerFailure(error: unknown): { code: string; retryable: boolean } {
  if (!(error instanceof EvolutionError)) return { code: 'worker_error', retryable: true }

  if (error.code === 'unauthorized' || error.httpStatus === 401 || error.httpStatus === 403) {
    return { code: 'provider_unauthorized', retryable: false }
  }
  if (
    error.code === 'network_error'
    || error.code === 'timeout'
    || error.httpStatus === 429
    || (error.httpStatus !== null && error.httpStatus >= 500)
  ) {
    return { code: 'provider_unavailable', retryable: true }
  }
  if (error.code === 'invalid_credentials' || error.code === 'invalid_instance') {
    return { code: 'credentials_unavailable', retryable: false }
  }
  if (error.code === 'invalid_origin' || error.code === 'origin_not_allowed') {
    return { code: 'origin_not_allowed', retryable: false }
  }
  return { code: 'provider_rejected', retryable: false }
}

async function persistFailure(
  db: ReturnType<typeof supabaseAdmin>,
  event: ClaimedEvent,
  code: string,
  retryable: boolean,
): Promise<WorkerOutcome> {
  try {
    const { data, error } = await db.rpc('fail_evolution_event', {
      p_event_id: event.id,
      p_lease_token: event.lease_token,
      p_error_code: code,
      p_retryable: retryable,
    })
    if (error) return isStaleError(error) ? 'stale' : 'retry'

    const row = Array.isArray(data) ? data[0] : data
    if (!isRecord(row)) return 'retry'
    if (row.state === 'failed') return 'failed'
    return 'retry'
  } catch (error) {
    return isStaleError(error) ? 'stale' : 'retry'
  }
}

async function processClaim(db: ReturnType<typeof supabaseAdmin>, event: ClaimedEvent): Promise<WorkerOutcome> {
  if (!isRecord(event.normalized_event) || event.normalized_event.kind !== 'connection') {
    return persistFailure(db, event, 'unsupported_event_kind', false)
  }

  let lookup: { data: unknown; error: unknown }
  try {
    lookup = await db
      .from('whatsapp_connections')
      .select(CONNECTION_COLUMNS)
      .eq('id', event.connection_id)
      .maybeSingle()
  } catch {
    return persistFailure(db, event, 'database_unavailable', true)
  }
  if (lookup.error) return persistFailure(db, event, 'database_unavailable', true)

  if (!isRecord(lookup.data) || lookup.data.id !== event.connection_id) {
    return persistFailure(db, event, 'connection_unavailable', false)
  }
  const row = lookup.data as ConnectionCredentialRow
  if (row.provider !== 'evolution') return persistFailure(db, event, 'unsupported_provider', false)
  if (
    typeof row.base_url !== 'string'
    || typeof row.instance_name !== 'string'
    || row.instance_name.trim() === ''
    || typeof row.token_encrypted !== 'string'
    || row.token_encrypted.length === 0
  ) {
    return persistFailure(db, event, 'credentials_unavailable', false)
  }

  let baseUrl: string
  try {
    baseUrl = assertAllowedEvolutionOrigin(row.base_url)
  } catch {
    return persistFailure(db, event, 'origin_not_allowed', false)
  }

  let token: string
  try {
    token = decrypt(row.token_encrypted)
  } catch {
    return persistFailure(db, event, 'credentials_unavailable', false)
  }
  if (token.length === 0) return persistFailure(db, event, 'credentials_unavailable', false)

  let snapshot: Awaited<ReturnType<typeof getSession>>
  try {
    snapshot = await getSession({ baseUrl, instanceId: row.instance_name, token })
  } catch (error) {
    const failure = providerFailure(error)
    return persistFailure(db, event, failure.code, failure.retryable)
  }
  if (!SESSION_STATES.has(snapshot.state) || !isServerTimestamp(snapshot.checkedAt)) {
    return persistFailure(db, event, 'invalid_provider_response', false)
  }

  try {
    const { data, error } = await db.rpc('complete_evolution_connection_event', {
      p_event_id: event.id,
      p_lease_token: event.lease_token,
      p_state: snapshot.state,
      p_checked_at: snapshot.checkedAt,
    })
    if (error) {
      if (isStaleError(error)) return 'stale'
      return 'retry'
    }
    const result = Array.isArray(data) ? data[0] : data
    if (isRecord(result) && (result.outcome === 'applied' || result.outcome === 'duplicate')) return 'done'
    return 'retry'
  } catch (error) {
    return isStaleError(error) ? 'stale' : 'retry'
  }
}

function countsFor(outcomes: WorkerOutcome[], claimed: number): WorkerCounts {
  return {
    claimed,
    done: outcomes.filter((outcome) => outcome === 'done').length,
    retry: outcomes.filter((outcome) => outcome === 'retry').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    stale: outcomes.filter((outcome) => outcome === 'stale').length,
  }
}

export async function runEvolutionEventBatch(): Promise<WorkerCounts> {
  let db: ReturnType<typeof supabaseAdmin>
  let claims: unknown
  try {
    db = supabaseAdmin()
    const result = await db.rpc('claim_evolution_events', {
      p_limit: 10,
      p_lease_seconds: 60,
    })
    if (result.error || !Array.isArray(result.data) || result.data.length > 10) {
      throw new EvolutionEventWorkerError()
    }
    claims = result.data
  } catch {
    throw new EvolutionEventWorkerError()
  }

  const batch = claims as ClaimedEvent[]
  const outcomes = await Promise.all(batch.map(async (event): Promise<WorkerOutcome> => {
    try {
      return await processClaim(db, event)
    } catch {
      return persistFailure(db, event, 'worker_error', true)
    }
  }))

  return countsFor(outcomes, batch.length)
}
