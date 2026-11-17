import { createHash } from 'node:crypto'
import { readEvolutionInteractiveReply } from './interactive-reply'

export type NormalizedConnectionEvent = {
  kind: 'connection'
  eventKey: string
  occurredAt: string
}

export type NormalizedTextMessageEvent = {
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

export type NormalizedInteractiveReplyEvent = Omit<NormalizedTextMessageEvent, 'contentType' | 'text' | 'mediaRef'> & {
  contentType: 'interactive'
  text: string | null
  mediaRef: null
  interactiveReplyId: string
  interactiveReplyKind: 'button' | 'list'
}

export type NormalizedMediaKind = 'image' | 'document' | 'audio' | 'video'

export type EvolutionMediaRef = {
  version: 1
  key: {
    remoteJid: string
    id: string
    fromMe: false
  }
}

export type NormalizedMediaMessageEvent = Omit<NormalizedTextMessageEvent, 'contentType' | 'text' | 'mediaRef'> & {
  contentType: NormalizedMediaKind
  text: null
  mediaRef: EvolutionMediaRef
}

export type NormalizedMessageEvent = NormalizedTextMessageEvent | NormalizedMediaMessageEvent | NormalizedInteractiveReplyEvent
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

const MEDIA_TYPE_BY_MESSAGE_TYPE: Record<string, NormalizedMediaKind> = {
  imageMessage: 'image',
  documentMessage: 'document',
  audioMessage: 'audio',
  videoMessage: 'video',
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

  if (data.key.fromMe) return []
  if (!/^\d{8,15}@s\.whatsapp\.net$/.test(data.key.remoteJid)) return []

  const externalMessageId = data.key.id
  const eventKey = createHash('sha256')
    .update(JSON.stringify([externalMessageId]))
    .digest('hex')

  const baseEvent = {
    kind: 'message',
    eventKey: `message:sha256:${eventKey}`,
    externalMessageId,
    peer: data.key.remoteJid,
    occurredAt,
    fromMe: false,
    sentByApi: false,
  } as const

  const interactiveReply = readEvolutionInteractiveReply(data.messageType, data.message)
  if (interactiveReply) {
    if (data.key.id.length > 200 || !/^[A-Za-z0-9_.:-]+$/.test(data.key.id)) {
      throw new NormalizationError()
    }
    return [{
      ...baseEvent,
      contentType: 'interactive',
      text: interactiveReply.label,
      mediaRef: null,
      interactiveReplyId: interactiveReply.replyId,
      interactiveReplyKind: interactiveReply.kind,
    }]
  }

  if (data.messageType === 'conversation') {
    if (!nonEmptyString(data.message.conversation)) throw new NormalizationError()
    return [{
      ...baseEvent,
      contentType: 'text',
      text: data.message.conversation,
      mediaRef: null,
    }]
  }

  const mediaKind = MEDIA_TYPE_BY_MESSAGE_TYPE[data.messageType]
  if (!mediaKind) return []
  if (
    data.key.id.length > 200
    || !/^[A-Za-z0-9_.:-]+$/.test(data.key.id)
    || !isRecord(data.message[data.messageType])
  ) {
    throw new NormalizationError()
  }

  return [{
    ...baseEvent,
    contentType: mediaKind,
    text: null,
    mediaRef: {
      version: 1,
      key: {
        remoteJid: data.key.remoteJid,
        id: data.key.id,
        fromMe: false,
      },
    },
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
