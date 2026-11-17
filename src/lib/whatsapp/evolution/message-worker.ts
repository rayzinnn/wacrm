import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { EvolutionMediaKind } from './capabilities'
import { enabledEvolutionInboundMedia } from './inbound-media-capability'
import { EvolutionMediaError, resolveMedia } from './media'
import type { EvolutionMediaRef } from './media'
import { EvolutionMediaStorageError, stageEvolutionInboundMedia } from './media-storage'
import type { EvolutionCredentials } from './types'

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
  media_state?: unknown
}

type MediaConnectionRow = {
  id: string
  provider: string
  base_url: string
  instance_name: string
  token_encrypted: string
}

const MEDIA_KINDS = new Set<EvolutionMediaKind>(['image', 'document', 'audio', 'video'])

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

function mediaFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof EvolutionMediaStorageError) {
    if (error.code === 'storage_unavailable' || error.code === 'stage_unavailable') {
      return { code: 'media_storage_unavailable', retryable: true }
    }
    return { code: 'invalid_media_event', retryable: false }
  }

  if (error instanceof EvolutionMediaError) {
    if (
      error.code === 'timeout'
      || error.code === 'network_error'
      || error.httpStatus === 408
      || error.httpStatus === 429
      || (error.httpStatus !== null && error.httpStatus >= 500)
    ) return { code: 'media_provider_unavailable', retryable: true }

    return { code: 'invalid_media_event', retryable: false }
  }

  return { code: 'media_worker_error', retryable: true }
}

async function loadMediaCredentials(
  db: ReturnType<typeof supabaseAdmin>,
  event: ClaimedMessageEvent,
): Promise<EvolutionCredentials> {
  let lookup: { data: unknown; error: unknown }
  try {
    lookup = await db
      .from('whatsapp_connections')
      .select('id,provider,base_url,instance_name,token_encrypted')
      .eq('id', event.connection_id)
      .maybeSingle()
  } catch {
    throw new MediaWorkerFailure('database_unavailable', true)
  }
  if (lookup.error) throw new MediaWorkerFailure('database_unavailable', true)
  if (!isRecord(lookup.data) || lookup.data.id !== event.connection_id) {
    throw new MediaWorkerFailure('connection_unavailable', false)
  }

  const row = lookup.data as MediaConnectionRow
  if (row.provider !== 'evolution') throw new MediaWorkerFailure('unsupported_provider', false)
  if (
    typeof row.base_url !== 'string'
    || typeof row.instance_name !== 'string'
    || row.instance_name.trim() === ''
    || typeof row.token_encrypted !== 'string'
    || row.token_encrypted.length === 0
  ) throw new MediaWorkerFailure('credentials_unavailable', false)

  try {
    const token = decrypt(row.token_encrypted)
    if (!token) throw new Error('empty token')
    return { baseUrl: row.base_url, instanceId: row.instance_name, token }
  } catch {
    throw new MediaWorkerFailure('credentials_unavailable', false)
  }
}

class MediaWorkerFailure extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super('Evolution media worker failed.')
    this.name = 'MediaWorkerFailure'
  }
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

  const normalized = event.normalized_event
  const contentType = normalized.contentType
  if (contentType === 'interactive') return applyClaim(db, event)
  if (contentType !== 'text') {
    if (typeof contentType !== 'string' || !MEDIA_KINDS.has(contentType as EvolutionMediaKind)) {
      return persistFailure(db, event, 'unsupported_media_kind', false)
    }
    if (!enabledEvolutionInboundMedia().includes(contentType as EvolutionMediaKind)) {
      return persistFailure(db, event, 'unsupported_media_kind', false)
    }

    if (event.media_state === 'stored') return applyClaim(db, event)
    if (event.media_state !== 'pending') {
      return persistFailure(db, event, 'invalid_media_event', false)
    }

    try {
      if (normalized.text !== null || !isRecord(normalized.mediaRef)) {
        return persistFailure(db, event, 'invalid_media_event', false)
      }
      const credentials = await loadMediaCredentials(db, event)
      const media = await resolveMedia(credentials, normalized.mediaRef as unknown as EvolutionMediaRef)
      if (media.contentType !== contentType) {
        return persistFailure(db, event, 'invalid_media_event', false)
      }
      const stage = await stageEvolutionInboundMedia({
        eventId: event.id,
        leaseToken: event.lease_token,
        media,
      })
      if (stage === 'stale') return 'stale'
      if (stage === 'conflict') return persistFailure(db, event, 'media_storage_conflict', false)
      return applyClaim(db, event)
    } catch (error) {
      if (isStaleError(error)) return 'stale'
      if (error instanceof MediaWorkerFailure) {
        return persistFailure(db, event, error.code, error.retryable)
      }
      const failure = mediaFailure(error)
      return persistFailure(db, event, failure.code, failure.retryable)
    }
  }

  return applyClaim(db, event)
}

async function applyClaim(
  db: ReturnType<typeof supabaseAdmin>,
  event: ClaimedMessageEvent,
): Promise<WorkerOutcome> {
  let result: { data: unknown; error: unknown }
  try {
    const rpc = isRecord(event.normalized_event) && event.normalized_event.contentType === 'interactive'
      ? 'apply_evolution_interactive_reply'
      : 'apply_evolution_event'
    result = await db.rpc(rpc, {
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
