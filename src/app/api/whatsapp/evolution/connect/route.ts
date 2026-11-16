import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { EvolutionError, configureWebhook, connectSession } from '@/lib/whatsapp/evolution/client'
import { toEvolutionErrorResponse } from '@/lib/whatsapp/evolution/http-errors'
import { loadConnection, saveSessionState } from '@/lib/whatsapp/evolution/store'

const NO_STORE = { 'Cache-Control': 'no-store' }
const WEBHOOK_CALLBACK_PATH = '/api/whatsapp/evolution/webhook'

function configuredWebhookCallbackUrl(): string {
  const configuredBaseUrl = process.env.EVOLUTION_WEBHOOK_BASE_URL
  if (!configuredBaseUrl) return ''

  try {
    return `${new URL(configuredBaseUrl).origin}${WEBHOOK_CALLBACK_PATH}`
  } catch {
    return `${configuredBaseUrl}${WEBHOOK_CALLBACK_PATH}`
  }
}

export async function POST(_request: Request) {
  void _request
  try {
    const { accountId } = await requireRole('admin')
    const connection = await loadConnection(accountId)
    if (!connection) {
      return NextResponse.json(
        { error: 'connection_not_configured', code: 'connection_not_configured' },
        { status: 409, headers: NO_STORE },
      )
    }

    await configureWebhook(
      connection.credentials,
      configuredWebhookCallbackUrl(),
      connection.webhookSecret,
      connection.id,
    )

    const observedAt = new Date().toISOString()
    let snapshot
    try {
      snapshot = await connectSession(connection.credentials)
    } catch (err) {
      if (err instanceof EvolutionError && (err.code === 'timeout' || err.code === 'network_error')) {
        await saveSessionState(accountId, { state: 'unknown', checkedAt: observedAt })
      }
      throw err
    }

    await saveSessionState(accountId, { state: snapshot.state, checkedAt: snapshot.checkedAt })
    return NextResponse.json(snapshot, { headers: NO_STORE })
  } catch (err) {
    return toEvolutionErrorResponse(err)
  }
}
