import { createHash } from 'node:crypto'

export type NormalizedConnectionEvent = {
  kind: 'connection'
  eventKey: string
  occurredAt: string
}

export type NormalizedMessageEvent = {
  kind: 'message'
  eventKey: string
  externalMessageId: string
  peer: string
  occurredAt: string
  fromMe: false
  sentByApi: false
  contentType: 'text'
  text: string
  mediaRef: null
}

export type NormalizedEvent = NormalizedConnectionEvent | NormalizedMessageEvent

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

function normalizeConnection(payload: Record<string, unknown>, receivedAt: string): NormalizedConnectionEvent[] {
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

function messageTimestampToIso(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new NormalizationError()
  }

  const date = new Date(value * 1000)
  if (!Number.isFinite(date.valueOf())) throw new NormalizationError()

  try {
    return date.toISOString()
  } catch {
    throw new NormalizationError()
  }
}

function normalizeInboundText(payload: Record<string, unknown>): NormalizedMessageEvent[] {
  if (!nonEmptyString(payload.instance) || !isRecord(payload.data)) throw new NormalizationError()

  const data = payload.data
  if (!isRecord(data.key) || !isRecord(data.message)) throw new NormalizationError()
  if (
    !nonEmptyString(data.key.id)
    || typeof data.key.remoteJid !== 'string'
    || !nonEmptyString(data.key.remoteJid)
    || typeof data.key.fromMe !== 'boolean'
    || typeof data.messageType !== 'string'
  ) {
    throw new NormalizationError()
  }

  const occurredAt = messageTimestampToIso(data.messageTimestamp)

  if (data.messageType !== 'conversation' || data.key.fromMe) return []
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(data.key.remoteJid)) return []
  if (!nonEmptyString(data.message.conversation)) throw new NormalizationError()

  const externalMessageId = data.key.id
  const eventKey = createHash('sha256')
    .update(JSON.stringify([externalMessageId]))
    .digest('hex')

  return [{
    kind: 'message',
    eventKey: `message:sha256:${eventKey}`,
    externalMessageId,
    peer: data.key.remoteJid,
    occurredAt,
    fromMe: false,
    sentByApi: false,
    contentType: 'text',
    text: data.message.conversation,
    mediaRef: null,
  }]
}

export function normalizeWebhook(payload: unknown, receivedAt: string): NormalizedEvent[] {
  if (!isReceiverTimestamp(receivedAt) || !isRecord(payload) || typeof payload.event !== 'string') {
    throw new NormalizationError()
  }

  if (payload.event === 'connection.update') return normalizeConnection(payload, receivedAt)
  if (payload.event === 'messages.upsert') return normalizeInboundText(payload)
  return []
}
