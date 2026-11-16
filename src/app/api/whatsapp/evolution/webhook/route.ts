import { EventQueueError, enqueueEvents } from '@/lib/whatsapp/evolution/event-queue'
import { NormalizationError, normalizeWebhook } from '@/lib/whatsapp/evolution/events'
import { WebhookAuthError, authenticateWebhook } from '@/lib/whatsapp/evolution/webhook-auth'
import { MAX_WEBHOOK_BODY_BYTES, readCappedBody } from '@/lib/whatsapp/webhook-body'

export const runtime = 'nodejs'

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS })
}

export async function POST(request: Request): Promise<Response> {
  const receivedAt = new Date().toISOString()

  let rawBody: string | null
  try {
    rawBody = await readCappedBody(request, MAX_WEBHOOK_BODY_BYTES)
  } catch {
    return jsonResponse(400, {
      error: 'Could not read webhook body.',
      code: 'invalid_request_body',
    })
  }

  if (rawBody === null) {
    return jsonResponse(413, {
      error: 'Webhook payload is too large.',
      code: 'payload_too_large',
    })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.', code: 'invalid_json' })
  }

  try {
    const context = await authenticateWebhook(request.headers, payload)
    const events = normalizeWebhook(payload, receivedAt)

    if (events.length === 0) {
      return jsonResponse(200, { inserted: 0, duplicates: 0, ignored: true })
    }

    const counts = await enqueueEvents(context.connectionId, events)
    return jsonResponse(200, { inserted: counts.inserted, duplicates: counts.duplicates, ignored: false })
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      return jsonResponse(error.status, { error: error.message, code: error.code })
    }
    if (error instanceof NormalizationError) {
      return jsonResponse(400, { error: 'Invalid webhook event.', code: 'invalid_webhook_event' })
    }
    if (error instanceof EventQueueError) {
      return jsonResponse(503, { error: 'Webhook processing is unavailable.', code: 'webhook_unavailable' })
    }
    return jsonResponse(503, { error: 'Webhook processing is unavailable.', code: 'webhook_unavailable' })
  }
}
