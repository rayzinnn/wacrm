import type { EvolutionCredentials, SessionSnapshot, SessionState } from './types'

const REQUEST_TIMEOUT_MS = 15_000
const QR_LOCAL_TTL_MS = 20_000
const MAX_QR_BYTES = 5 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export type EvolutionErrorCode =
  | 'invalid_credentials'
  | 'invalid_instance'
  | 'invalid_origin'
  | 'origin_not_allowed'
  | 'unauthorized'
  | 'redirect_blocked'
  | 'http_error'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'invalid_qr'

export class EvolutionError extends Error {
  readonly code: EvolutionErrorCode
  readonly httpStatus: number | null
  readonly retryable: boolean
  readonly ambiguous: boolean

  constructor(
    code: EvolutionErrorCode,
    message: string,
    options: {
      httpStatus?: number | null
      retryable?: boolean
      ambiguous?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'EvolutionError'
    this.code = code
    this.httpStatus = options.httpStatus ?? null
    this.retryable = options.retryable ?? false
    this.ambiguous = options.ambiguous ?? false
  }
}

type RequestKind = 'state' | 'connect'

function error(
  code: EvolutionErrorCode,
  message: string,
  options?: ConstructorParameters<typeof EvolutionError>[2],
): EvolutionError {
  return new EvolutionError(code, message, options)
}

function normalizeOrigin(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.includes('*') || baseUrl.includes('?') || baseUrl.includes('#')) {
    throw error('invalid_origin', 'Evolution URL must be a bare HTTP(S) origin.')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw error('invalid_origin', 'Evolution origin is invalid.')
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw error('invalid_origin', 'Evolution URL must be a bare HTTP(S) origin.')
  }

  return parsed.origin
}

function isPermittedTransport(origin: string): boolean {
  return origin.startsWith('https://') || origin === 'http://127.0.0.1:8080'
}

/** Validates and returns a canonical origin without performing network I/O. */
export function assertAllowedEvolutionOrigin(baseUrl: string): string {
  const origin = normalizeOrigin(baseUrl)
  if (!isPermittedTransport(origin)) {
    throw error('origin_not_allowed', 'Evolution origin is not allowlisted.')
  }

  const allowedOrigins = (process.env.EVOLUTION_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .flatMap((allowedOrigin) => {
      try {
        const canonical = normalizeOrigin(allowedOrigin)
        return isPermittedTransport(canonical) ? [canonical] : []
      } catch {
        return []
      }
    })
  if (!allowedOrigins.includes(origin)) {
    throw error('origin_not_allowed', 'Evolution origin is not allowlisted.')
  }

  return origin
}

function validateCredentials(credentials: EvolutionCredentials): string {
  if (!credentials || typeof credentials.token !== 'string' || credentials.token.length === 0) {
    throw error('invalid_credentials', 'Evolution credentials are invalid.')
  }
  if (typeof credentials.instanceId !== 'string' || credentials.instanceId.trim().length === 0) {
    throw error('invalid_instance', 'Evolution instance name is required.')
  }
  return assertAllowedEvolutionOrigin(credentials.baseUrl)
}

function getUrl(credentials: EvolutionCredentials, kind: RequestKind): string {
  const origin = validateCredentials(credentials)
  const instanceName = encodeURIComponent(credentials.instanceId)
  const route = kind === 'state' ? 'connectionState' : 'connect'
  return `${origin}/instance/${route}/${instanceName}`
}

async function requestJson(
  credentials: EvolutionCredentials,
  kind: RequestKind,
): Promise<{ body: unknown; httpStatus: number }> {
  const url = getUrl(credentials, kind)
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { apikey: credentials.token, accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual',
    })
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw error('redirect_blocked', 'Evolution redirect was blocked.', { httpStatus: response.status })
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw error('unauthorized', 'Evolution authentication failed.', { httpStatus: response.status })
      }
      const ambiguous = kind === 'connect' && response.status >= 500
      const retryable = !ambiguous && (response.status === 429 || response.status >= 500)
      throw error('http_error', 'Evolution request was rejected.', {
        httpStatus: response.status,
        retryable,
        ambiguous,
      })
    }

    try {
      return { body: await response.json(), httpStatus: response.status }
    } catch (cause) {
      if (timedOut || (cause instanceof Error && cause.name === 'AbortError')) throw cause
      throw error('invalid_response', 'Evolution returned an invalid response.', {
        httpStatus: response.status,
        ambiguous: kind === 'connect',
      })
    }
  } catch (cause) {
    if (cause instanceof EvolutionError) throw cause
    const aborted = cause instanceof Error && cause.name === 'AbortError'
    if (timedOut || aborted) {
      throw error('timeout', 'Evolution request timed out.', {
        retryable: false,
        ambiguous: kind === 'connect',
      })
    }
    throw error('network_error', 'Evolution request failed.', {
      retryable: kind === 'state',
      ambiguous: kind === 'connect',
    })
  } finally {
    clearTimeout(timeout)
  }
}

function mapProviderState(body: unknown): SessionState {
  if (!body || typeof body !== 'object' || !('instance' in body)) return 'unknown'
  const instance = (body as { instance?: unknown }).instance
  if (!instance || typeof instance !== 'object' || !('state' in instance)) return 'unknown'

  switch ((instance as { state?: unknown }).state) {
    case 'close':
      return 'disconnected'
    case 'connecting':
      return 'connecting'
    case 'open':
      return 'connected'
    default:
      return 'unknown'
  }
}

function qrDataUrl(value: unknown): string | null {
  const dataUrlPrefix = 'data:image/png;base64,'
  if (typeof value !== 'string' || !value.startsWith(dataUrlPrefix)) return null

  const encoded = value.slice(dataUrlPrefix.length)
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil(MAX_QR_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    return null
  }

  const bytes = Buffer.from(encoded, 'base64')
  if (
    bytes.length > MAX_QR_BYTES ||
    bytes.toString('base64') !== encoded ||
    bytes.length < 29 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) return null

  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width === 0 || height === 0 || width * height > 16_000_000) return null
  return dataUrlPrefix + bytes.toString('base64')
}

async function observeState(credentials: EvolutionCredentials, checkedAt: string): Promise<SessionSnapshot> {
  const { body } = await requestJson(credentials, 'state')
  return { state: mapProviderState(body), qr: null, checkedAt }
}

export function getSession(credentials: EvolutionCredentials): Promise<SessionSnapshot> {
  const checkedAt = new Date().toISOString()
  return observeState(credentials, checkedAt)
}

export async function connectSession(credentials: EvolutionCredentials): Promise<SessionSnapshot> {
  const checkedAt = new Date().toISOString()
  const { body, httpStatus } = await requestJson(credentials, 'connect')
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : null

  if (payload && Object.hasOwn(payload, 'base64') && payload.base64 !== null && payload.base64 !== '') {
    const dataUrl = qrDataUrl(payload.base64)
    if (!dataUrl) {
      throw error('invalid_qr', 'Evolution returned an invalid QR image.', { httpStatus })
    }
    return {
      state: 'connecting',
      qr: { dataUrl, expiresAt: new Date(Date.now() + QR_LOCAL_TTL_MS).toISOString() },
      checkedAt,
    }
  }

  try {
    return await observeState(credentials, checkedAt)
  } catch (cause) {
    if (cause instanceof EvolutionError) {
      throw new EvolutionError(cause.code, cause.message, {
        httpStatus: cause.httpStatus,
        retryable: false,
        ambiguous: true,
      })
    }
    throw error('network_error', 'Evolution state could not be confirmed after connect.', {
      retryable: false,
      ambiguous: true,
    })
  }
}
