import { supabaseAdmin } from '@/lib/flows/admin-client'

export type EvolutionMessageWorkerCounts = {
  claimed: number
  done: number
  retry: number
  failed: number
  stale: number
}

type WorkerOutcome = 'done' | 'retry' | 'failed' | 'stale'
type ClaimedMessageEvent = {
  id: string
  connection_id: string
  lease_token: string
  normalized_event: unknown
}

const CLAIM_LIMIT = 10
const CLAIM_LEASE_SECONDS = 60

export class EvolutionMessageWorkerError extends Error {
  readonly code = 'message_event_worker_unavailable'
  readonly status = 503

  constructor() {
    super('Evolution message event worker is unavailable.')
    this.name = 'EvolutionMessageWorkerError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isClaimedMessageEvent(value: unknown): value is ClaimedMessageEvent {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.connection_id === 'string'
    && value.connection_id.length > 0
    && typeof value.lease_token === 'string'
    && value.lease_token.length > 0
    && 'normalized_event' in value
}

function isStaleError(error: unknown): boolean {
  return isRecord(error) && (error.code === '40001' || error.code === 'P0002')
}

function isPermanentApplyError(error: unknown): boolean {
  if (!isRecord(error) || typeof error.code !== 'string') return false
  return error.code === '42501' || /^(22|23|28)[0-9A-Z]{3}$/.test(error.code)
}

function applyFailure(error: unknown): { code: string; retryable: boolean } {
  if (isPermanentApplyError(error)) {
    return {
      code: isRecord(error) && error.code === '23505' ? 'message_conflict' : 'invalid_message_event',
      retryable: false,
    }
  }
  return { code: 'database_unavailable', retryable: true }
}

async function persistFailure(
  db: ReturnType<typeof supabaseAdmin>,
  event: ClaimedMessageEvent,
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

async function processClaim(
  db: ReturnType<typeof supabaseAdmin>,
  event: ClaimedMessageEvent,
): Promise<WorkerOutcome> {
  if (!isRecord(event.normalized_event) || event.normalized_event.kind !== 'message') {
    return persistFailure(db, event, 'unsupported_event_kind', false)
  }

  let result: { data: unknown; error: unknown }
  try {
    result = await db.rpc('apply_evolution_event', {
      p_event_id: event.id,
      p_lease_token: event.lease_token,
    })
  } catch (error) {
    if (isStaleError(error)) return 'stale'
    const failure = applyFailure(error)
    return persistFailure(db, event, failure.code, failure.retryable)
  }

  if (result.error) {
    if (isStaleError(result.error)) return 'stale'
    const failure = applyFailure(result.error)
    return persistFailure(db, event, failure.code, failure.retryable)
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data
  if (!isRecord(row)) return persistFailure(db, event, 'invalid_apply_result', true)

  if (row.outcome === 'applied' || row.outcome === 'duplicate' || row.outcome === 'ignored') return 'done'
  if (row.outcome === 'failed') return 'failed'
  if (row.outcome === 'retry') return 'retry'
  return persistFailure(db, event, 'invalid_apply_result', true)
}

function countsFor(outcomes: WorkerOutcome[], claimed: number): EvolutionMessageWorkerCounts {
  return {
    claimed,
    done: outcomes.filter((outcome) => outcome === 'done').length,
    retry: outcomes.filter((outcome) => outcome === 'retry').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    stale: outcomes.filter((outcome) => outcome === 'stale').length,
  }
}

export async function runEvolutionMessageBatch(): Promise<EvolutionMessageWorkerCounts> {
  let db: ReturnType<typeof supabaseAdmin>
  let claims: unknown

  try {
    db = supabaseAdmin()
    const result = await db.rpc('claim_evolution_message_events', {
      p_limit: CLAIM_LIMIT,
      p_lease_seconds: CLAIM_LEASE_SECONDS,
    })
    if (
      result.error
      || !Array.isArray(result.data)
      || result.data.length > CLAIM_LIMIT
      || !result.data.every(isClaimedMessageEvent)
    ) {
      throw new EvolutionMessageWorkerError()
    }
    claims = result.data
  } catch {
    throw new EvolutionMessageWorkerError()
  }

  const batch = claims as ClaimedMessageEvent[]
  const outcomes = await Promise.all(batch.map(async (event): Promise<WorkerOutcome> => {
    try {
      return await processClaim(db, event)
    } catch {
      return persistFailure(db, event, 'worker_error', true)
    }
  }))

  return countsFor(outcomes, batch.length)
}
