import { NextResponse } from 'next/server'
import { ForbiddenError, toErrorResponse, UnauthorizedError } from '@/lib/auth/account'
import { EvolutionError } from './client'
import { EvolutionStoreError, type EvolutionStoreErrorCode } from './store'

const NO_STORE = { 'Cache-Control': 'no-store' }

const STORE_ERROR_DETAILS: Record<EvolutionStoreErrorCode, { status: number; message: string }> = {
  actor_forbidden: { status: 403, message: 'Account owner or admin role is required.' },
  connection_conflict: { status: 409, message: 'Evolution connection conflicts with an existing identity.' },
  database_unavailable: { status: 503, message: 'Evolution connection storage is unavailable.' },
  invalid_connection: { status: 400, message: 'Evolution connection input is invalid.' },
  credentials_unavailable: { status: 500, message: 'Evolution credentials are unavailable.' },
}

const EVOLUTION_ERROR_MESSAGES = {
  invalid_credentials: 'Evolution credentials are invalid.',
  invalid_instance: 'Evolution instance name is invalid.',
  invalid_origin: 'Evolution origin is invalid.',
  origin_not_allowed: 'Evolution origin is not permitted.',
  unauthorized: 'Evolution provider authentication failed.',
  redirect_blocked: 'Evolution redirect was blocked.',
  http_error: 'Evolution request was rejected.',
  timeout: 'Evolution request timed out.',
  network_error: 'Evolution network is unavailable.',
  invalid_response: 'Evolution returned an invalid response.',
  invalid_qr: 'Evolution returned an invalid QR image.',
} as const

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function evolutionStatus(error: EvolutionError): number {
  switch (error.code) {
    case 'invalid_credentials':
    case 'invalid_instance':
    case 'invalid_origin':
    case 'origin_not_allowed':
    case 'unauthorized':
      return 400
    case 'timeout':
      return 504
    case 'http_error':
      return error.httpStatus === 429 ? 429 : 502
    case 'network_error':
    case 'redirect_blocked':
    case 'invalid_response':
    case 'invalid_qr':
      return 502
  }
}

/** Maps safe Evolution/store failures and never logs or serializes unknown errors. */
export function toEvolutionErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    const authResponse = toErrorResponse(err)
    authResponse.headers.set('Cache-Control', 'no-store')
    return authResponse
  }

  if (err instanceof EvolutionStoreError) {
    const details = STORE_ERROR_DETAILS[err.code]
    return response({ error: details.message, code: err.code }, details.status)
  }

  if (err instanceof EvolutionError) {
    return response(
      {
        error: EVOLUTION_ERROR_MESSAGES[err.code],
        code: `evolution_${err.code}`,
        ambiguous: err.ambiguous,
      },
      evolutionStatus(err),
    )
  }

  return response({ error: 'Internal server error.', code: 'internal_error' }, 500)
}
