import 'server-only'

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sanitizeFilename } from '@/lib/media/filename'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities'

export const runtime = 'nodejs'

const BUCKET = 'evolution-media'
const MAX_BYTES = 16 * 1024 * 1024
const MIME = {
  'image/jpeg': { kind: 'image', extension: 'jpg', disposition: 'inline' },
  'image/png': { kind: 'image', extension: 'png', disposition: 'inline' },
  'application/pdf': { kind: 'document', extension: 'pdf', disposition: 'attachment' },
} as const

type Row = Record<string, unknown>
function row(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function supported(contentType: string): contentType is keyof typeof MIME {
  return Object.prototype.hasOwnProperty.call(MIME, contentType)
}

function validSignature(bytes: Uint8Array, mime: keyof typeof MIME): boolean {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ stageId: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`evolution-media-fetch:${userId}`, RATE_LIMITS.whatsappMedia)
    if (!limit.success) return rateLimitResponse(limit)

    const { stageId } = await params
    if (!isUuid(stageId) || !isUuid(accountId)) return json({ error: 'media_not_found' }, 404)

    const db = supabaseAdmin()
    const { data, error } = await db.from('evolution_outbound_media_stages').select(
      'id,account_id,conversation_id,storage_path,content_type,media_type,filename,size_bytes,sha256,state,expires_at',
    ).eq('id', stageId).eq('account_id', accountId).eq('state', 'staged')
      .gt('expires_at', new Date().toISOString()).maybeSingle()
    if (error) return json({ error: 'media_unavailable' }, 503)
    const stage = row(data)
    if (!stage || stage.id !== stageId || stage.account_id !== accountId || !isUuid(stage.conversation_id)) {
      return json({ error: 'media_not_found' }, 404)
    }

    if (typeof stage.content_type !== 'string' || !supported(String(stage.media_type)) ||
      MIME[String(stage.media_type) as keyof typeof MIME].kind !== stage.content_type ||
      !getEvolutionCapabilities().media.includes(stage.content_type as 'image' | 'document')) {
      return json({ error: 'unsupported_capability', code: 'unsupported_capability', capability: stage.content_type ?? 'media' }, 422)
    }
    const mime = stage.media_type as keyof typeof MIME
    const descriptor = MIME[mime]
    if (typeof stage.size_bytes !== 'number' || !Number.isSafeInteger(stage.size_bytes) ||
      stage.size_bytes < 1 || stage.size_bytes > MAX_BYTES ||
      typeof stage.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(stage.sha256) ||
      typeof stage.filename !== 'string' || stage.filename !== sanitizeFilename(stage.filename) ||
      stage.filename.length < 1 || stage.filename.length > 80 ||
      stage.filename.split('.').pop()?.toLowerCase() !== descriptor.extension) {
      return json({ error: 'media_not_found' }, 404)
    }

    const expectedPath = `account-${accountId}/outbound/${stage.conversation_id}/${stageId}/payload.${descriptor.extension}`
    if (stage.storage_path !== expectedPath) return json({ error: 'media_not_found' }, 404)

    const { data: conversation, error: conversationError } = await supabase.from('conversations')
      .select('id').eq('id', stage.conversation_id).eq('account_id', accountId).maybeSingle()
    if (conversationError) return json({ error: 'media_unavailable' }, 503)
    if (!conversation) return json({ error: 'media_not_found' }, 404)

    const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(expectedPath)
    if (downloadError || !blob || blob.size !== stage.size_bytes || blob.size > MAX_BYTES) {
      return json({ error: 'media_unavailable' }, 503)
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength !== stage.size_bytes || bytes.byteLength > MAX_BYTES ||
      createHash('sha256').update(bytes).digest('hex') !== stage.sha256 || !validSignature(bytes, mime)) {
      return json({ error: 'media_unavailable' }, 503)
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `${descriptor.disposition}; filename*=UTF-8''${encodeURIComponent(stage.filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
