import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'

export type WebhookAuthErrorCode =
  | 'webhook_unauthorized'
  | 'webhook_correlation_mismatch'
  | 'webhook_auth_unavailable'

const ERROR_DETAILS: Record<WebhookAuthErrorCode, { status: number; message: string }> = {
  webhook_unauthorized: { status: 401, message: 'Webhook authentication failed.' },
  webhook_correlation_mismatch: {
    status: 403,
    message: 'Webhook instance does not match the authenticated connection.',
  },
  webhook_auth_unavailable: { status: 503, message: 'Webhook authentication is unavailable.' },
}

export class WebhookAuthError extends Error {
  readonly status: number

  constructor(readonly code: WebhookAuthErrorCode) {
    const details = ERROR_DETAILS[code]
    super(details.message)
    this.name = 'WebhookAuthError'
    this.status = details.status
  }
}

export interface WebhookAuthContext {
  connectionId: string
  accountId: string
  instanceId: string
}

type WebhookConnectionRow = {
  id: string
  account_id: string
  instance_name: string
  webhook_secret_encrypted: string
}

type WebhookLookupResult = {
  data: WebhookConnectionRow | null
  error: unknown
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function authError(code: WebhookAuthErrorCode): WebhookAuthError {
  return new WebhookAuthError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function authenticateWebhook(
  headers: Headers,
  payload: unknown,
): Promise<WebhookAuthContext> {
  const connectionId = headers.get('x-wacrm-connection')
  const suppliedSecret = headers.get('x-wacrm-webhook-secret')
  if (!connectionId || !UUID_PATTERN.test(connectionId) || !suppliedSecret) {
    throw authError('webhook_unauthorized')
  }

  let result: WebhookLookupResult
  try {
    result = await (supabaseAdmin()
      .from('whatsapp_connections')
      .select('id,account_id,instance_name,webhook_secret_encrypted')
      .eq('id', connectionId)
      .maybeSingle() as unknown as Promise<WebhookLookupResult>)
  } catch {
    throw authError('webhook_auth_unavailable')
  }

  if (result.error) throw authError('webhook_auth_unavailable')
  const row = result.data
  if (!row) throw authError('webhook_unauthorized')

  let expectedSecret: string
  try {
    expectedSecret = decrypt(row.webhook_secret_encrypted)
  } catch {
    throw authError('webhook_auth_unavailable')
  }

  const suppliedBytes = Buffer.from(suppliedSecret, 'utf8')
  const expectedBytes = Buffer.from(expectedSecret, 'utf8')
  if (
    suppliedBytes.length === 0 ||
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw authError('webhook_unauthorized')
  }

  if (!isRecord(payload) || payload.instance !== row.instance_name) {
    throw authError('webhook_correlation_mismatch')
  }

  return {
    connectionId: row.id,
    accountId: row.account_id,
    instanceId: row.instance_name,
  }
}
