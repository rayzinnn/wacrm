import { createHash } from 'node:crypto'

export type NormalizedEvent = {
  kind: 'connection'
  eventKey: string
  occurredAt: string
}

export class NormalizationError extends Error {
  constructor() {
    super('Invalid webhook event')
    this.name = 'NormalizationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReceiverTimestamp(value: string): boolean {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) && date.toISOString() === value
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeWebhook(payload: unknown, receivedAt: string): NormalizedEvent[] {
  if (!isReceiverTimestamp(receivedAt) || !isRecord(payload) || typeof payload.event !== 'string') {
    throw new NormalizationError()
  }

  if (payload.event !== 'connection.update') return []

  if (
    !nonEmptyString(payload.instance)
    || !isRecord(payload.data)
    || !nonEmptyString(payload.data.instance)
    || payload.data.instance !== payload.instance
    || typeof payload.data.state !== 'string'
    || !nonEmptyString(payload.date_time)
  ) {
    throw new NormalizationError()
  }

  const identity = JSON.stringify({
    event: 'connection.update',
    instance: payload.instance,
    state: payload.data.state,
    providerTime: payload.date_time,
  })
  const digest = createHash('sha256').update(identity).digest('hex')

  return [{
    kind: 'connection',
    eventKey: `sha256:${digest}`,
    occurredAt: receivedAt,
  }]
}
