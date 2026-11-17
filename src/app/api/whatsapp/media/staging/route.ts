import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sanitizeFilename } from '@/lib/media/filename'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities'

export const runtime = 'nodejs'

const BUCKET = 'evolution-media'
const MAX_BYTES = 16 * 1024 * 1024
const TYPES = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
} as const

type MediaMime = keyof typeof TYPES

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function isUuid(value: string | null): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function descriptor(value: string | null) {
  const mime = value?.split(';', 1)[0].trim().toLowerCase()
  return mime && Object.prototype.hasOwnProperty.call(TYPES, mime)
    ? { mime: mime as MediaMime, ...TYPES[mime as MediaMime] }
    : null
}

function validSignature(bytes: Uint8Array, mime: MediaMime): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

async function readBoundedBody(request: Request): Promise<Uint8Array | 'too_large' | null> {
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
      if (total > MAX_BYTES) {
        void reader.cancel().catch(() => undefined)
        return 'too_large'
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total === 0) return null
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function filenameFor(raw: string | null, extension: string): string | null {
  const source = raw?.trim() || `media.${extension}`
  if (source.length > 500) return null
  const safe = sanitizeFilename(source)
  if (!safe || safe.length > 80 || safe.split('.').pop()?.toLowerCase() !== extension) return null
  return safe
}

function allowed(kind: string): boolean {
  return getEvolutionCapabilities().media.includes(kind as 'image' | 'document')
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    if (!isUuid(accountId) || !isUuid(userId)) return json({ error: 'account_unavailable' }, 403)
    const limit = checkRateLimit(`evolution-media-stage:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const media = descriptor(request.headers.get('content-type'))
    if (!media || !allowed(media.kind)) {
      return json({ error: 'unsupported_capability', code: 'unsupported_capability', capability: media?.kind ?? 'media' }, 422)
    }

    const url = new URL(request.url)
    const conversationId = url.searchParams.get('conversation_id')
    if (!isUuid(conversationId)) return json({ error: 'invalid_conversation' }, 400)

    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)) {
      return json({ error: 'media_too_large' }, 413)
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations').select('id').eq('id', conversationId).eq('account_id', accountId).maybeSingle()
    if (conversationError) return json({ error: 'staging_unavailable' }, 503)
    if (!conversation) return json({ error: 'conversation_not_found' }, 404)

    const bytes = await readBoundedBody(request)
    if (bytes === 'too_large') return json({ error: 'media_too_large' }, 413)
    if (!bytes || bytes.byteLength > MAX_BYTES) return json({ error: 'invalid_media' }, 400)
    if (!validSignature(bytes, media.mime)) return json({ error: 'invalid_media' }, 415)

    const filename = filenameFor(url.searchParams.get('filename'), media.extension)
    if (!filename) return json({ error: 'invalid_filename' }, 400)

    const stageId = randomUUID()
    const storagePath = `account-${accountId}/outbound/${conversationId}/${stageId}/payload.${media.extension}`
    const db = supabaseAdmin()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const { error: insertError } = await db.from('evolution_outbound_media_stages').insert({
      id: stageId,
      account_id: accountId,
      conversation_id: conversationId,
      uploaded_by: userId,
      storage_path: storagePath,
      content_type: media.kind,
      media_type: media.mime,
      filename,
      size_bytes: bytes.byteLength,
      sha256,
      state: 'uploading',
    })
    if (insertError) return json({ error: 'staging_unavailable' }, 503)

    const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: media.mime,
      upsert: false,
      cacheControl: '0',
    })
    if (uploadError) return json({ error: 'staging_unavailable' }, 503)

    const { data: staged, error: stageError } = await db.from('evolution_outbound_media_stages')
      .update({ state: 'staged' }).eq('id', stageId).eq('account_id', accountId).eq('state', 'uploading')
      .select('id').maybeSingle()
    if (stageError || staged?.id !== stageId) return json({ error: 'staging_unavailable' }, 503)

    return json({
      media_ref: { version: 1, stage_id: stageId },
      content_type: media.kind,
      media_type: media.mime,
      filename,
      size_bytes: bytes.byteLength,
    }, 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}
