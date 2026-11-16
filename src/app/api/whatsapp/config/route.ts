import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { canEditSettings } from '@/lib/auth/roles'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { assertAllowedEvolutionOrigin, getSession } from '@/lib/whatsapp/evolution/client'
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities'
import { loadConnectionSummary, saveConnection, saveSessionState } from '@/lib/whatsapp/evolution/store'
import { toEvolutionErrorResponse } from '@/lib/whatsapp/evolution/http-errors'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }
const INVALID_PAYLOAD = {
  error: 'The WhatsApp connection request is invalid.',
  code: 'invalid_payload',
}

function jsonError(error: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: NO_STORE_HEADERS })
}

function noStore(response: Response): NextResponse {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function rateLimitedResponse(result: Parameters<typeof rateLimitResponse>[0]): Promise<NextResponse> {
  const response = rateLimitResponse(result)
  const body = await response.json() as { error: string; retry_after_seconds?: number }
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return NextResponse.json(
    { error: body.error, code: 'rate_limited', retry_after_seconds: body.retry_after_seconds },
    { status: response.status, headers },
  )
}

function safeDto(input: {
  configured: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'unknown'
  checkedAt: string | null
  baseUrl?: string
  instanceId?: string
}) {
  return {
    configured: input.configured,
    provider: 'evolution' as const,
    state: input.state,
    checkedAt: input.checkedAt,
    capabilities: getEvolutionCapabilities(),
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
  }
}

export async function GET() {
  try {
    const context = await requireRole('viewer')
    const summary = await loadConnectionSummary(context.accountId)
    const canSeeConnectionDetails = canEditSettings(context.role)

    return NextResponse.json(
      safeDto({
        configured: summary !== null,
        state: summary?.state ?? 'disconnected',
        checkedAt: summary?.checkedAt ?? null,
        ...(summary && canSeeConnectionDetails
          ? { baseUrl: summary.baseUrl, instanceId: summary.instanceId }
          : {}),
      }),
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return noStore(toEvolutionErrorResponse(error))
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireRole('admin')
    const limit = checkRateLimit(`whatsapp-admin:${context.userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitedResponse(limit)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('The request body is invalid.', 'invalid_request', 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError(INVALID_PAYLOAD.error, INVALID_PAYLOAD.code, 400)
    }

    const payload = body as Record<string, unknown>
    const allowedKeys = new Set(['baseUrl', 'instanceId', 'token'])
    if (
      Object.keys(payload).some((key) => !allowedKeys.has(key)) ||
      typeof payload.baseUrl !== 'string' || payload.baseUrl.trim().length === 0 ||
      typeof payload.instanceId !== 'string' || payload.instanceId.trim().length === 0 ||
      typeof payload.token !== 'string' || payload.token.trim().length === 0
    ) {
      return jsonError(INVALID_PAYLOAD.error, INVALID_PAYLOAD.code, 400)
    }

    const baseUrl = assertAllowedEvolutionOrigin(payload.baseUrl)
    const credentials = {
      baseUrl,
      instanceId: payload.instanceId.trim(),
      token: payload.token,
    }

    const snapshot = await getSession(credentials)
    await saveConnection(context.accountId, context.userId, credentials)
    await saveSessionState(context.accountId, {
      state: snapshot.state,
      checkedAt: snapshot.checkedAt,
    })

    return NextResponse.json(
      safeDto({
        configured: true,
        state: snapshot.state,
        checkedAt: snapshot.checkedAt,
        baseUrl: credentials.baseUrl,
        instanceId: credentials.instanceId,
      }),
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return noStore(toEvolutionErrorResponse(error))
  }
}
