import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertValidProviderMedia, EvolutionMediaSendError, sendMedia, type ProviderMedia } from './media-send'
import type { EvolutionCredentials, ProviderAcceptance } from './types'

type Outcome = 'pending' | 'accepted' | 'rejected' | 'unknown'
type Reservation = { attempt_id: string; message_row_id: string; outcome: Outcome; should_send: boolean }
type Completion = { attempt_id: string; message_row_id: string; outcome: Outcome }

export type EvolutionMediaSendInput = {
  connectionId: string
  conversationId: string
  senderId: string
  credentials: EvolutionCredentials
  message: ProviderMedia
}

export type EvolutionMediaSendResult = {
  attemptId: string
  messageRowId: string
  outcome: Outcome
  shouldSend: boolean
  externalMessageId: string | null
  persistenceUncertain: boolean
}

export class EvolutionMediaSendAdapterError extends Error {
  constructor(readonly code: 'invalid_input' | 'reservation_unavailable' | 'reservation_invalid') {
    super('Evolution media send could not be reserved.')
    this.name = 'EvolutionMediaSendAdapterError'
  }
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value
  return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
}

function readReservation(value: unknown): Reservation | null {
  const row = firstRow(value)
  return row && typeof row.attempt_id === 'string' && typeof row.message_row_id === 'string' &&
    typeof row.should_send === 'boolean' && ['pending', 'accepted', 'rejected', 'unknown'].includes(String(row.outcome))
    ? row as Reservation : null
}

function readCompletion(value: unknown): Completion | null {
  const row = firstRow(value)
  return row && typeof row.attempt_id === 'string' && typeof row.message_row_id === 'string' &&
    ['pending', 'accepted', 'rejected', 'unknown'].includes(String(row.outcome))
    ? row as Completion : null
}

function hashRequest(message: ProviderMedia): string {
  return createHash('sha256').update(JSON.stringify({
    recipient: message.recipient,
    mediaType: message.mediaType,
    mimeType: message.mimeType.toLowerCase(),
    fileName: message.fileName,
    caption: message.caption ?? null,
    bytesSha256: createHash('sha256').update(message.bytes).digest('hex'),
  })).digest('hex')
}

function validate(input: EvolutionMediaSendInput): void {
  if (!input?.connectionId || !input.conversationId || !input.senderId || !input.message?.requestId ||
    input.message.requestId.trim().length === 0 || input.message.requestId.length > 200 ||
    !/^\d{8,15}@s\.whatsapp\.net$/.test(input.message.recipient)) {
    throw new EvolutionMediaSendAdapterError('invalid_input')
  }
  try { assertValidProviderMedia(input.message) }
  catch { throw new EvolutionMediaSendAdapterError('invalid_input') }
}

async function reserve(db: Pick<SupabaseClient, 'rpc'>, input: EvolutionMediaSendInput): Promise<Reservation> {
  validate(input)
  let result: Awaited<ReturnType<typeof db.rpc>>
  try {
    result = await db.rpc('reserve_evolution_media_send', {
      p_connection_id: input.connectionId,
      p_request_id: input.message.requestId,
      p_request_hash: hashRequest(input.message),
      p_conversation_id: input.conversationId,
      p_sender_id: input.senderId,
      p_content_type: input.message.mediaType,
      p_media_type: input.message.mimeType.toLowerCase(),
      p_content_text: input.message.caption ?? null,
    })
  } catch { throw new EvolutionMediaSendAdapterError('reservation_unavailable') }
  if (result.error) throw new EvolutionMediaSendAdapterError('reservation_unavailable')
  const parsed = readReservation(result.data)
  if (!parsed) throw new EvolutionMediaSendAdapterError('reservation_invalid')
  return parsed
}

export function createEvolutionMediaReservationAdapter(db: Pick<SupabaseClient, 'rpc'>) {
  return async (input: EvolutionMediaSendInput) => {
    const r = await reserve(db, input)
    return { attemptId: r.attempt_id, messageRowId: r.message_row_id, outcome: r.outcome, shouldSend: r.should_send }
  }
}

export function createEvolutionMediaSendAdapter(
  db: Pick<SupabaseClient, 'rpc'>,
  transport: (credentials: EvolutionCredentials, message: ProviderMedia) => Promise<ProviderAcceptance> = sendMedia,
) {
  return async (input: EvolutionMediaSendInput): Promise<EvolutionMediaSendResult> => {
    const r = await reserve(db, input)
    if (!r.should_send) return {
      attemptId: r.attempt_id, messageRowId: r.message_row_id, outcome: r.outcome,
      shouldSend: false, externalMessageId: null,
      persistenceUncertain: r.outcome === 'pending' || r.outcome === 'unknown',
    }
    if (r.outcome !== 'pending') throw new EvolutionMediaSendAdapterError('reservation_invalid')

    let outcome: Exclude<Outcome, 'pending'> = 'unknown'
    let externalMessageId: string | null = null
    let errorCode: string | null = 'worker_error'
    try {
      externalMessageId = (await transport(input.credentials, input.message)).externalMessageId
      outcome = 'accepted'
      errorCode = null
    } catch (cause) {
      outcome = cause instanceof EvolutionMediaSendError && !cause.ambiguous ? 'rejected' : 'unknown'
      errorCode = cause instanceof EvolutionMediaSendError ? cause.code : 'worker_error'
    }

    let result: Awaited<ReturnType<typeof db.rpc>>
    try {
      result = await db.rpc('complete_evolution_send', {
        p_attempt_id: r.attempt_id, p_outcome: outcome,
        p_external_message_id: externalMessageId, p_error_code: errorCode,
      })
    } catch { return {
      attemptId: r.attempt_id, messageRowId: r.message_row_id, outcome: 'unknown',
      shouldSend: true, externalMessageId, persistenceUncertain: true,
    } }
    const completed = result.error ? null : readCompletion(result.data)
    if (!completed || completed.attempt_id !== r.attempt_id || completed.message_row_id !== r.message_row_id || completed.outcome !== outcome) {
      return { attemptId: r.attempt_id, messageRowId: r.message_row_id, outcome: 'unknown',
        shouldSend: true, externalMessageId, persistenceUncertain: true }
    }
    return { attemptId: r.attempt_id, messageRowId: r.message_row_id, outcome,
      shouldSend: true, externalMessageId: outcome === 'accepted' ? externalMessageId : null,
      persistenceUncertain: outcome === 'unknown' }
  }
}
