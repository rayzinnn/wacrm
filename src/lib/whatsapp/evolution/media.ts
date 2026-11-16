import 'server-only'

import { createHash } from 'node:crypto'
import { extensionForMime, sanitizeFilename } from '@/lib/media/filename'
import { assertAllowedEvolutionOrigin } from './client'
import type { EvolutionCredentials } from './types'

export type EvolutionMediaKind = 'image' | 'document' | 'audio' | 'video'

export interface EvolutionMediaRef {
  version: 1
  key: {
    remoteJid: string
    id: string
    fromMe: false
  }
}

export interface ResolvedEvolutionMedia {
  bytes: Uint8Array
  mimeType: string
  filename: string
  contentType: EvolutionMediaKind
  sha256: string
}

export type EvolutionMediaErrorCode =
  | 'invalid_credentials'
  | 'invalid_media_ref'
  | 'origin_not_allowed'
  | 'timeout'
  | 'network_error'
  | 'redirect_blocked'
  | 'http_error'
  | 'response_too_large'
  | 'invalid_response'
  | 'unsupported_media_type'
  | 'media_too_large'
  | 'invalid_media_content'

export class EvolutionMediaError extends Error {
  constructor(
    readonly code: EvolutionMediaErrorCode,
    readonly httpStatus: number | null = null,
  ) {
    super('Evolution media could not be resolved.')
    this.name = 'EvolutionMediaError'
  }
}

export const EVOLUTION_MEDIA_MAX_BYTES = 16 * 1024 * 1024
const MAX_BASE64_LENGTH = Math.ceil(EVOLUTION_MEDIA_MAX_BYTES / 3) * 4
const RESPONSE_JSON_OVERHEAD_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = MAX_BASE64_LENGTH + RESPONSE_JSON_OVERHEAD_BYTES
const REQUEST_TIMEOUT_MS = 15_000
const MAX_INSTANCE_NAME_LENGTH = 200
const MAX_MEDIA_ID_LENGTH = 200

const MEDIA_KIND_BY_RESPONSE_TYPE: Record<string, EvolutionMediaKind> = {
  imageMessage: 'image',
  documentMessage: 'document',
  audioMessage: 'audio',
  videoMessage: 'video',
}

const MIME_KIND: Record<string, EvolutionMediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'text/plain': 'document',
  'audio/ogg': 'audio',
  'audio/opus': 'audio',
  'audio/mpeg': 'audio',
  'audio/aac': 'audio',
  'audio/mp4': 'audio',
  'audio/amr': 'audio',
  'video/mp4': 'video',
  'video/3gpp': 'video',
  'video/3gp': 'video',
  'video/quicktime': 'video',
}

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt'],
  'audio/ogg': ['ogg'],
  'audio/opus': ['opus', 'ogg'],
  'audio/mpeg': ['mp3'],
  'audio/aac': ['aac'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/amr': ['amr'],
  'video/mp4': ['mp4'],
  'video/3gpp': ['3gp'],
  'video/3gp': ['3gp'],
  'video/quicktime': ['mov', 'qt'],
}

function fail(code: EvolutionMediaErrorCode, httpStatus: number | null = null): never {
  throw new EvolutionMediaError(code, httpStatus)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function validateCredentials(credentials: EvolutionCredentials): { origin: string; instance: string } {
  if (
    !credentials
    || typeof credentials.token !== 'string'
    || credentials.token.length === 0
    || credentials.token.length > 4096
    || /[\r\n]/.test(credentials.token)
    || typeof credentials.instanceId !== 'string'
    || credentials.instanceId.trim().length === 0
    || credentials.instanceId.length > MAX_INSTANCE_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/.test(credentials.instanceId)
  ) {
    fail('invalid_credentials')
  }

  try {
    return {
      origin: assertAllowedEvolutionOrigin(credentials.baseUrl),
      instance: encodeURIComponent(credentials.instanceId),
    }
  } catch {
    fail('origin_not_allowed')
  }
}

function validateMediaRef(value: EvolutionMediaRef): EvolutionMediaRef {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['version', 'key'])
    || value.version !== 1
    || !isRecord(value.key)
    || !hasExactKeys(value.key, ['remoteJid', 'id', 'fromMe'])
    || value.key.fromMe !== false
    || typeof value.key.remoteJid !== 'string'
    || !/^\d{8,15}@s\.whatsapp\.net$/.test(value.key.remoteJid)
    || typeof value.key.id !== 'string'
    || value.key.id.length === 0
    || value.key.id.length > MAX_MEDIA_ID_LENGTH
    || !/^[A-Za-z0-9_.:-]+$/.test(value.key.id)
  ) {
    fail('invalid_media_ref')
  }
  return value as EvolutionMediaRef
}

function mediaKind(value: unknown): EvolutionMediaKind {
  if (typeof value !== 'string' || !MEDIA_KIND_BY_RESPONSE_TYPE[value]) {
    fail('unsupported_media_type')
  }
  return MEDIA_KIND_BY_RESPONSE_TYPE[value]
}

function normalizeMime(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || /[\r\n]/.test(value)) {
    fail('unsupported_media_type')
  }
  const mimeType = value.split(';', 1)[0].trim().toLowerCase()
  if (!MIME_KIND[mimeType]) fail('unsupported_media_type')
  return mimeType
}

function declaredFileLength(value: unknown): bigint | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return BigInt(value)

  if (
    isRecord(value)
    && Number.isInteger(value.low)
    && Number.isInteger(value.high)
  ) {
    const low = BigInt((value.low as number) >>> 0)
    const high = BigInt((value.high as number) >>> 0)
    return (high << 32n) | low
  }

  fail('invalid_response')
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) fail('invalid_response')
    if (BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES)) fail('response_too_large')
  }

  if (!response.body) fail('invalid_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        controller.abort()
        void reader.cancel().catch(() => undefined)
        fail('response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) fail('invalid_response')
    return parsed
  } catch (error) {
    if (error instanceof EvolutionMediaError) throw error
    fail('invalid_response')
  }
}

function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_BASE64_LENGTH
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    fail(typeof value === 'string' && value.length > MAX_BASE64_LENGTH ? 'media_too_large' : 'invalid_response')
  }

  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.length > EVOLUTION_MEDIA_MAX_BYTES || bytes.toString('base64') !== value) {
    fail(bytes.length > EVOLUTION_MEDIA_MAX_BYTES ? 'media_too_large' : 'invalid_response')
  }
  return bytes
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function hasMp4Container(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70
}

function hasValidSignature(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
    case 'image/gif':
      return String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a'
        || String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a'
    case 'application/pdf':
      return String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && new TextDecoder().decode(bytes).includes('word/document.xml')
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && new TextDecoder().decode(bytes).includes('xl/workbook.xml')
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && new TextDecoder().decode(bytes).includes('ppt/presentation.xml')
    case 'text/plain':
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
      } catch {
        return false
      }
    case 'audio/ogg':
      return startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])
    case 'audio/opus':
      return startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])
        && String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 256))).includes('OpusHead')
    case 'audio/mpeg':
      return startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    case 'audio/aac':
      return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0
    case 'audio/mp4':
    case 'video/mp4':
    case 'video/3gpp':
    case 'video/3gp':
      return hasMp4Container(bytes)
    case 'video/quicktime':
      return hasMp4Container(bytes) && String.fromCharCode(...bytes.subarray(8, 12)) === 'qt  '
    case 'audio/amr':
      return startsWith(bytes, [0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a])
    default:
      return false
  }
}

function verifiedFilename(raw: unknown, mimeType: string, kind: EvolutionMediaKind): string {
  const expectedExtensions = MIME_EXTENSIONS[mimeType]
  const defaultExtension = expectedExtensions?.[0] ?? extensionForMime(mimeType)
  if (!expectedExtensions || defaultExtension === 'bin') fail('unsupported_media_type')

  if (raw === undefined || raw === null || raw === '') return `media-${kind}.${defaultExtension}`
  if (typeof raw !== 'string' || raw.length > 1024) fail('invalid_media_content')

  const cleaned = sanitizeFilename(raw)
  if (!cleaned) fail('invalid_media_content')
  const extension = cleaned.split('.').pop()?.toLowerCase()
  if (!extension || !expectedExtensions.includes(extension)) fail('invalid_media_content')
  return cleaned
}

function validateDownloadedMedia(payload: Record<string, unknown>): ResolvedEvolutionMedia {
  const kind = mediaKind(payload.mediaType)
  const mimeType = normalizeMime(payload.mimetype)
  if (MIME_KIND[mimeType] !== kind) fail('unsupported_media_type')

  const bytes = decodeBase64(payload.base64)
  if (!hasValidSignature(bytes, mimeType)) fail('invalid_media_content')

  const size = isRecord(payload.size) ? payload.size : null
  const reportedLength = declaredFileLength(size?.fileLength)
  if (reportedLength !== null && reportedLength !== BigInt(bytes.byteLength)) fail('invalid_media_content')

  return {
    bytes,
    mimeType,
    filename: verifiedFilename(payload.fileName, mimeType, kind),
    contentType: kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** Resolves one persisted Evolution message key. It never accepts or follows a media URL. */
export async function resolveMedia(
  credentials: EvolutionCredentials,
  mediaRef: EvolutionMediaRef,
): Promise<ResolvedEvolutionMedia> {
  const key = validateMediaRef(mediaRef).key
  const { origin, instance } = validateCredentials(credentials)
  // Until the transport pins external DNS results, media downloads are local-dev only.
  // The origin validator admits this one literal loopback endpoint; hostnames are rejected here.
  if (origin !== 'http://127.0.0.1:8080') fail('origin_not_allowed')

  const url = `${origin}/chat/getBase64FromMediaMessage/${instance}`
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: credentials.token,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: { key },
          convertToMp4: false,
        }),
        signal: controller.signal,
        redirect: 'manual',
      })
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError'
      fail(timedOut || aborted ? 'timeout' : 'network_error')
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      fail('redirect_blocked', response.status)
    }
    if (!response.ok) fail('http_error', response.status)

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') fail('invalid_response', response.status)

    try {
      const responseBytes = await readBoundedBody(response, controller)
      return validateDownloadedMedia(parseJson(responseBytes))
    } catch (cause) {
      if (cause instanceof EvolutionMediaError) throw cause
      if (timedOut || (cause instanceof Error && cause.name === 'AbortError')) fail('timeout')
      fail('network_error')
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const evolutionMediaLimits = {
  maxBytes: EVOLUTION_MEDIA_MAX_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  timeoutMs: REQUEST_TIMEOUT_MS,
} as const
