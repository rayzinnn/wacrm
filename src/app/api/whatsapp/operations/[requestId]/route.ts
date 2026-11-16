import { NextResponse } from 'next/server'
import { ForbiddenError, getCurrentAccount, UnauthorizedError } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'

const NO_STORE = { 'Cache-Control': 'no-store' }
const SAFE_ERROR_CODES = new Set([
  'invalid_credentials',
  'invalid_instance',
  'invalid_origin',
  'origin_not_allowed',
  'unauthorized',
  'redirect_blocked',
  'http_error',
  'timeout',
  'network_error',
  'invalid_response',
  'invalid_qr',
  'worker_error',
])

type RouteContext = { params: Promise<{ requestId: string }> }

type SendAttempt = {
  id: string
  request_id: string
  conversation_id: string
  message_row_id: string | null
  external_message_id: string | null
  outcome: 'pending' | 'accepted' | 'rejected' | 'unknown'
  error_code: string | null
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function sanitizeErrorCode(value: string | null): string | null {
  if (value === null) return null
  return SAFE_ERROR_CODES.has(value) ? value : 'worker_error'
}

export async function GET(_request: Request, { params }: RouteContext) {
  void _request

  try {
    const { accountId } = await getCurrentAccount()
    const { requestId } = await params

    if (!requestId || requestId.trim() !== requestId || requestId.length > 200) {
      return json({ error: 'invalid_request_id', code: 'invalid_request_id' }, 400)
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('evolution_send_attempts')
      .select('id,request_id,conversation_id,message_row_id,external_message_id,outcome,error_code')
      .eq('account_id', accountId)
      .eq('request_id', requestId)
      .maybeSingle()

    if (error) {
      return json({ error: 'operation_status_unavailable', code: 'operation_status_unavailable' }, 503)
    }
    if (!data) {
      return json({ error: 'operation_not_found', code: 'operation_not_found' }, 404)
    }

    const attempt = data as SendAttempt
    const { data: conversation, error: conversationError } = await db
      .from('conversations')
      .select('id')
      .eq('id', attempt.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (conversationError) {
      return json({ error: 'operation_status_unavailable', code: 'operation_status_unavailable' }, 503)
    }
    if (!conversation) {
      return json({ error: 'operation_not_found', code: 'operation_not_found' }, 404)
    }

    return json({
      requestId: attempt.request_id,
      attemptId: attempt.id,
      conversationId: attempt.conversation_id,
      messageRowId: attempt.message_row_id,
      externalMessageId: attempt.external_message_id,
      state: attempt.outcome,
      errorCode: sanitizeErrorCode(attempt.error_code),
    })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return json({ error: 'unauthorized', code: 'unauthorized' }, 401)
    }
    if (error instanceof ForbiddenError) {
      return json({ error: 'forbidden', code: 'forbidden' }, 403)
    }
    return json({ error: 'internal_error', code: 'internal_error' }, 500)
  }
}
