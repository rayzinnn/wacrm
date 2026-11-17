import 'server-only'

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ForbiddenError, requireRole, toErrorResponse, UnauthorizedError } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sanitizeFilename } from '@/lib/media/filename'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity'
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities'
import { loadConnection } from '@/lib/whatsapp/evolution/store'
import {
  createEvolutionMediaSendAdapter,
  EvolutionMediaSendAdapterError,
} from '@/lib/whatsapp/evolution/media-send-adapter'
import { EvolutionMediaSendError } from '@/lib/whatsapp/evolution/media-send'
import type { ProviderMedia } from '@/lib/whatsapp/evolution/media-send'

export const runtime = 'nodejs'

const BUCKET = 'evolution-media'
const MAX_STAGE_BYTES = 16 * 1024 * 1024
const MAX_REQUEST_BYTES = 16 * 1024
const MEDIA = {
  'image/jpeg': { contentType: 'image', extension: 'jpg' },
  'image/png': { contentType: 'image', extension: 'png' },
  'application/pdf': { contentType: 'document', extension: 'pdf' },
} as const

type MediaMime = keyof typeof MEDIA
type Row = Record<string, unknown>

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function readJsonBounded(request: Request): Promise<unknown | 'too_large' | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        return 'too_large'
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!total) return null
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return null
  }
}

function requestIdFor(accountId: string, applicationKey: string): string {
  const digest = createHash('sha256').update(accountId).update('\0').update(applicationKey).digest('hex')
  return `media-v1-${digest}`
}

function parseInput(value: unknown): {
  conversationId: string
  stageId: string
  caption?: string
} | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !['conversation_id', 'media_ref', 'caption'].includes(key))) return null
  if (!isUuid(value.conversation_id) || !isRecord(value.media_ref) ||
    value.media_ref.version !== 1 || !isUuid(value.media_ref.stage_id)) return null
  if (value.caption !== undefined &&
    (typeof value.caption !== 'string' || value.caption.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.caption))) return null
  const caption = typeof value.caption === 'string' && value.caption.length > 0 ? value.caption : undefined
  return { conversationId: value.conversation_id, stageId: value.media_ref.stage_id, ...(caption ? { caption } : {}) }
}

function stageMime(value: unknown): MediaMime | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MEDIA, value)
    ? value as MediaMime
    : null
}

function hasSignature(bytes: Uint8Array, mime: MediaMime): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

function stableFilename(value: unknown, extension: string): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 &&
    value === sanitizeFilename(value) && value.split('.').pop()?.toLowerCase() === extension
}

function enabled(contentType: string): boolean {
  return getEvolutionCapabilities().media.includes(contentType as 'image' | 'document')
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    if (!isUuid(accountId) || !isUuid(userId)) return json({ error: 'account_unavailable' }, 403)

    // This gate precedes body parsing, credential lookup, Storage reads and transport creation.
    if (!getEvolutionCapabilities().media.some((kind) => kind === 'image' || kind === 'document')) {
      return json({ error: 'unsupported_capability', code: 'unsupported_capability', capability: 'media' }, 422)
    }

    const limit = checkRateLimit(`evolution-media-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const applicationKey = request.headers.get('Idempotency-Key')
    if (!applicationKey || applicationKey !== applicationKey.trim() || applicationKey.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(applicationKey)) {
      return json({ error: 'idempotency_key_required' }, 400)
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
      return json({ error: 'invalid_request' }, 413)
    }
    const input = parseInput(await readJsonBounded(request))
    if (!input) return json({ error: 'invalid_request' }, 400)

    const { data: conversation, error: conversationError } = await supabase.from('conversations')
      .select('id,contact_id').eq('id', input.conversationId).eq('account_id', accountId).maybeSingle()
    if (conversationError) return json({ error: 'media_send_unavailable' }, 503)
    if (!conversation || conversation.id !== input.conversationId || !isUuid(conversation.contact_id)) {
      return json({ error: 'conversation_not_found' }, 404)
    }

    const { data: contact, error: contactError } = await supabase.from('contacts')
      .select('id,account_id,phone').eq('id', conversation.contact_id).eq('account_id', accountId).maybeSingle()
    if (contactError) return json({ error: 'media_send_unavailable' }, 503)
    if (!contact || contact.id !== conversation.contact_id || contact.account_id !== accountId) {
      return json({ error: 'conversation_not_found' }, 404)
    }
    const target = resolveContactSendTarget({ phone: typeof contact.phone === 'string' ? contact.phone : null })
    if (!target?.isPhone) return json({ error: 'invalid_contact_phone' }, 400)
    const recipient = `${target.target}@s.whatsapp.net`

    const connection = await loadConnection(accountId)
    if (!connection || connection.accountId !== accountId || !isUuid(connection.id)) {
      return json({ error: 'evolution_not_configured' }, 503)
    }

    const db = supabaseAdmin()
    const { data: stageData, error: stageError } = await db.from('evolution_outbound_media_stages')
      .select('id,account_id,conversation_id,storage_path,content_type,media_type,filename,size_bytes,sha256,state,expires_at')
      .eq('id', input.stageId).eq('account_id', accountId).eq('conversation_id', input.conversationId)
      .eq('state', 'staged').gt('expires_at', new Date().toISOString()).maybeSingle()
    if (stageError) return json({ error: 'media_stage_unavailable' }, 503)
    const stage = isRecord(stageData) ? stageData : null
    if (!stage || stage.id !== input.stageId || stage.account_id !== accountId ||
      stage.conversation_id !== input.conversationId || stage.state !== 'staged') {
      return json({ error: 'media_stage_not_found' }, 404)
    }

    const mime = stageMime(stage.media_type)
    if (!mime || MEDIA[mime].contentType !== stage.content_type || !enabled(MEDIA[mime].contentType)) {
      return json({ error: 'unsupported_capability', code: 'unsupported_capability', capability: 'media' }, 422)
    }
    if (!isUuid(stage.conversation_id) || !Number.isSafeInteger(stage.size_bytes) ||
      (stage.size_bytes as number) < 1 || (stage.size_bytes as number) > MAX_STAGE_BYTES ||
      typeof stage.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(stage.sha256) ||
      !stableFilename(stage.filename, MEDIA[mime].extension) ||
      typeof stage.expires_at !== 'string' || !Number.isFinite(Date.parse(stage.expires_at)) ||
      Date.parse(stage.expires_at) <= Date.now()) {
      return json({ error: 'media_stage_invalid' }, 404)
    }
    const storagePath = `account-${accountId}/outbound/${input.conversationId}/${input.stageId}/payload.${MEDIA[mime].extension}`
    if (stage.storage_path !== storagePath) return json({ error: 'media_stage_invalid' }, 404)

    const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(storagePath)
    if (downloadError || !blob || blob.size !== stage.size_bytes || blob.size > MAX_STAGE_BYTES) {
      return json({ error: 'media_stage_unavailable' }, 503)
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength !== stage.size_bytes || bytes.byteLength > MAX_STAGE_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== stage.sha256 || !hasSignature(bytes, mime)) {
      return json({ error: 'media_stage_invalid' }, 422)
    }

    const message: ProviderMedia = {
      recipient,
      requestId: requestIdFor(accountId, applicationKey),
      mediaType: MEDIA[mime].contentType,
      bytes,
      mimeType: mime,
      fileName: stage.filename,
      ...(input.caption ? { caption: input.caption } : {}),
    }
    const send = createEvolutionMediaSendAdapter(db)
    const result = await send({
      connectionId: connection.id,
      conversationId: input.conversationId,
      senderId: userId,
      credentials: connection.credentials,
      message,
    })

    if (result.outcome === 'accepted') {
      return json({ success: true, outcome: 'accepted', message_id: result.messageRowId }, 200)
    }
    if (result.outcome === 'unknown' || result.outcome === 'pending' || result.persistenceUncertain) {
      return json({ error: 'delivery_unknown', outcome: 'unknown', message_id: result.messageRowId }, 504)
    }
    if (result.outcome === 'rejected') return json({ error: 'evolution_rejected' }, 502)
    return json({ error: 'media_send_unavailable' }, 503)
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return toErrorResponse(error)
    if (error instanceof EvolutionMediaSendAdapterError) {
      const status = error.code === 'invalid_input' ? 400 : 503
      return json({ error: error.code === 'invalid_input' ? 'invalid_media_send' : 'media_send_unavailable' }, status)
    }
    if (error instanceof EvolutionMediaSendError) {
      return json({ error: error.ambiguous ? 'delivery_unknown' : 'evolution_rejected' }, error.ambiguous ? 504 : 502)
    }
    return json({ error: 'media_send_unavailable' }, 500)
  }
}
