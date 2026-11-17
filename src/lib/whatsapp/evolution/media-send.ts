import 'server-only'

import { sanitizeFilename } from '@/lib/media/filename'
import { assertAllowedEvolutionOrigin } from './client'
import type { EvolutionCredentials, ProviderAcceptance } from './types'

export type EvolutionOutboundMediaType = 'image' | 'document'

export interface ProviderMedia {
  recipient: string
  /** Stable application reservation key. It is deliberately not sent to Evolution. */
  requestId: string
  mediaType: EvolutionOutboundMediaType
  bytes: Uint8Array
  mimeType: string
  fileName: string
  caption?: string
}

export type EvolutionMediaSendErrorCode =
  | 'invalid_credentials'
  | 'origin_not_allowed'
  | 'invalid_media'
  | 'timeout'
  | 'network_error'
  | 'redirect_blocked'
  | 'http_error'
  | 'invalid_response'

export class EvolutionMediaSendError extends Error {
  constructor(
    readonly code: EvolutionMediaSendErrorCode,
    readonly httpStatus: number | null = null,
    readonly ambiguous = false,
  ) {
    super('Evolution media send could not be confirmed.')
    this.name = 'EvolutionMediaSendError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_MEDIA_BYTES = 16 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_INSTANCE_NAME_LENGTH = 200
const MAX_REQUEST_ID_LENGTH = 200
const MAX_FILENAME_LENGTH = 80
const MAX_CAPTION_LENGTH = 4096

const MIME_BY_MEDIA_TYPE: Record<EvolutionOutboundMediaType, readonly string[]> = {
  image: ['image/jpeg', 'image/png'],
  document: ['application/pdf'],
}

function fail(
  code: EvolutionMediaSendErrorCode,
  httpStatus: number | null = null,
  ambiguous = false,
): never {
  throw new EvolutionMediaSendError(code, httpStatus, ambiguous)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateCredentials(credentials: EvolutionCredentials): { origin: string; instance: string } {
  if (
    !credentials
    || typeof credentials.token !== 'string'
    || credentials.token.trim().length === 0
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

function hasValidSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value)
  }
  return mimeType === 'application/pdf'
    && bytes.length >= 5
    && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

function validateInput(input: ProviderMedia): {
  number: string
  mediaType: EvolutionOutboundMediaType
  mimeType: string
  fileName: string
  caption?: string
} {
  if (
    !input
    || typeof input.recipient !== 'string'
    || !/^\d{8,15}@s\.whatsapp\.net$/.test(input.recipient)
    || typeof input.requestId !== 'string'
    || input.requestId.trim().length === 0
    || input.requestId.length > MAX_REQUEST_ID_LENGTH
    || (input.mediaType !== 'image' && input.mediaType !== 'document')
    || !(input.bytes instanceof Uint8Array)
    || input.bytes.byteLength === 0
    || input.bytes.byteLength > MAX_MEDIA_BYTES
    || typeof input.mimeType !== 'string'
    || !MIME_BY_MEDIA_TYPE[input.mediaType]?.includes(input.mimeType.toLowerCase())
    || typeof input.fileName !== 'string'
    || input.fileName.length === 0
    || input.fileName.length > MAX_FILENAME_LENGTH * 4
    || (input.caption !== undefined
      && (typeof input.caption !== 'string' || input.caption.length > MAX_CAPTION_LENGTH))
  ) {
    fail('invalid_media')
  }

  const mimeType = input.mimeType.toLowerCase()
  const fileName = sanitizeFilename(input.fileName)
  const extension = fileName.split('.').pop()?.toLowerCase()
  const expectedExtensions = mimeType === 'image/jpeg'
    ? ['jpg', 'jpeg']
    : mimeType === 'image/png'
      ? ['png']
      : ['pdf']

  if (
    !fileName
    || !extension
    || !expectedExtensions.includes(extension)
    || !hasValidSignature(input.bytes, mimeType)
  ) {
    fail('invalid_media')
  }

  return {
    number: input.recipient.slice(0, input.recipient.indexOf('@')),
    mediaType: input.mediaType,
    mimeType,
    fileName,
    ...(input.caption !== undefined && input.caption.length > 0 ? { caption: input.caption } : {}),
  }
}

async function readJsonBounded(response: Response, controller: AbortController): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json' || !response.body) fail('invalid_response', response.status, true)

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES) {
      fail('invalid_response', response.status, true)
    }
  }

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
        fail('invalid_response', response.status, true)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
  } catch {
    fail('invalid_response', response.status, true)
  }
}

function responseId(body: unknown, recipient: string): string | null {
  if (!isRecord(body) || !isRecord(body.key)) return null
  const { id, remoteJid, fromMe } = body.key
  if (
    typeof id !== 'string'
    || id.trim().length === 0
    || id.length > 200
    || remoteJid !== recipient
    || fromMe !== true
  ) return null
  return id
}

/** Sends one Base64 image or PDF document attempt. It never retries a POST. */
export async function sendMedia(
  credentials: EvolutionCredentials,
  input: ProviderMedia,
): Promise<ProviderAcceptance> {
  const media = validateInput(input)
  const { origin, instance } = validateCredentials(credentials)
  const url = `${origin}/message/sendMedia/${instance}`
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
          number: media.number,
          mediatype: media.mediaType,
          media: Buffer.from(input.bytes).toString('base64'),
          mimetype: media.mimeType,
          fileName: media.fileName,
          ...(media.caption ? { caption: media.caption } : {}),
        }),
        signal: controller.signal,
        redirect: 'manual',
      })
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError'
      fail(timedOut || aborted ? 'timeout' : 'network_error', null, true)
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      fail('redirect_blocked', response.status, true)
    }
    if (!response.ok) {
      fail('http_error', response.status, ![401, 403, 404, 422].includes(response.status))
    }
    if (response.status !== 201) fail('invalid_response', response.status, true)

    let body: unknown
    try {
      body = await readJsonBounded(response, controller)
    } catch (cause) {
      if (cause instanceof EvolutionMediaSendError) throw cause
      const aborted = cause instanceof Error && cause.name === 'AbortError'
      fail(timedOut || aborted ? 'timeout' : 'invalid_response', response.status, true)
    }

    const externalMessageId = responseId(body, input.recipient)
    if (!externalMessageId) fail('invalid_response', response.status, true)
    return { externalMessageId }
  } catch (cause) {
    if (cause instanceof EvolutionMediaSendError) throw cause
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    fail(timedOut || aborted ? 'timeout' : 'network_error', null, true)
  } finally {
    clearTimeout(timeout)
  }
}

export const evolutionMediaSendLimits = {
  maxBytes: MAX_MEDIA_BYTES,
  timeoutMs: REQUEST_TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
} as const
