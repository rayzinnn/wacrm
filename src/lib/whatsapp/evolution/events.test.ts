import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NormalizationError, normalizeWebhook } from './events'

const connectionFixture = JSON.parse(
  readFileSync(
    new URL('../../../../infra/evolution/fixtures/connection-update.observed.sanitized.json', import.meta.url),
    'utf8',
  ),
) as { payload: unknown }

const messageFixture = JSON.parse(
  readFileSync(
    new URL('../../../../infra/evolution/fixtures/message-upsert.observed.sanitized.json', import.meta.url),
    'utf8',
  ),
) as { payload: unknown; receivedAt: string; expected: Array<Record<string, unknown>>; observed: Record<string, unknown> }

const receivedAt = '2026-11-16T04:55:08.512Z'
const replayReceivedAt = '2026-11-16T04:55:13.556Z'
const expectedConnectionKey = 'sha256:62848dfa72149d3beae49e2ea5efa8f25befe12cc16228a5bc5400a0128ff096'
const messageKey = 'message:sha256:9b44b0ec439c2baf87ccb6711fa7419fdcd17c1f78f0498452b858fe9d82a870'
const unixSeconds = 1794848038
const occurredAt = '2026-11-16T16:53:58.000Z'

type TestPayload = Record<string, unknown>

function payloadData(payload: TestPayload): Record<string, unknown> {
  return payload.data as Record<string, unknown>
}

function payloadKey(payload: TestPayload): Record<string, unknown> {
  return payloadData(payload).key as Record<string, unknown>
}

function payloadMessage(payload: TestPayload): Record<string, unknown> {
  return payloadData(payload).message as Record<string, unknown>
}

function messagePayload(): TestPayload {
  return JSON.parse(JSON.stringify(messageFixture.payload).replaceAll('[TEST_PEER]', '5521999990000'))
}

function expectedMessage(): Array<Record<string, unknown>> {
  return JSON.parse(JSON.stringify(messageFixture.expected).replaceAll('[TEST_PEER]', '5521999990000'))
}

function cloneMessagePayload(): TestPayload {
  return JSON.parse(JSON.stringify(messagePayload()))
}

describe('normalizeWebhook', () => {
  it('normalizes the observed connection callback without changing its contract', () => {
    expect(normalizeWebhook(connectionFixture.payload, receivedAt)).toEqual([
      { kind: 'connection', eventKey: expectedConnectionKey, occurredAt: receivedAt },
    ])
  })

  it('keeps connection event identity stable across retries received at different times', () => {
    const first = normalizeWebhook(connectionFixture.payload, receivedAt)
    const retry = normalizeWebhook(connectionFixture.payload, replayReceivedAt)

    expect(first[0].eventKey).toBe(expectedConnectionKey)
    expect(retry[0].eventKey).toBe(expectedConnectionKey)
    expect(first[0].occurredAt).toBe(receivedAt)
    expect(retry[0].occurredAt).toBe(replayReceivedAt)
  })

  it('normalizes the observed inbound text fixture to the approved literal projection', () => {
    expect(normalizeWebhook(messagePayload(), messageFixture.receivedAt)).toEqual(expectedMessage())
  })

  it('keeps the message key stable when text or receiver time changes', () => {
    const changed = cloneMessagePayload()
    payloadMessage(changed).conversation = 'Edited inbound text'

    const first = normalizeWebhook(messagePayload(), messageFixture.receivedAt)[0]
    const replay = normalizeWebhook(changed, replayReceivedAt)[0]

    expect(first?.kind).toBe('message')
    expect(replay?.kind).toBe('message')
    if (first?.kind !== 'message' || replay?.kind !== 'message') {
      throw new Error('Expected normalized message events')
    }
    expect(first.eventKey).toBe(messageKey)
    expect(replay.eventKey).toBe(messageKey)
    expect(replay.occurredAt).toBe(occurredAt)
    expect(replay.text).toBe('Edited inbound text')
  })

  it('uses the message timestamp and does not require provider date_time', () => {
    const payload = cloneMessagePayload()
    delete payload.date_time

    expect(normalizeWebhook(payload, replayReceivedAt)).toEqual(expectedMessage())
  })

  it.each([undefined, null, '', '  ', 42])('rejects a malformed message envelope instance: %s', (instance) => {
    const payload = cloneMessagePayload()
    payload.instance = instance

    expect(() => normalizeWebhook(payload, messageFixture.receivedAt)).toThrow(NormalizationError)
    expect(() => normalizeWebhook(payload, messageFixture.receivedAt)).toThrow('Invalid webhook event')
  })

  it('converts valid integer Unix seconds and keeps identity independent of timestamp', () => {
    const first = normalizeWebhook(messagePayload(), messageFixture.receivedAt)[0]
    const payload = cloneMessagePayload()
    payloadData(payload).messageTimestamp = unixSeconds + 2
    const changedTimestamp = normalizeWebhook(payload, replayReceivedAt)[0]

    expect(first?.kind).toBe('message')
    expect(changedTimestamp?.kind).toBe('message')
    if (first?.kind !== 'message' || changedTimestamp?.kind !== 'message') {
      throw new Error('Expected normalized message events')
    }
    expect(changedTimestamp.occurredAt).toBe('2026-11-16T16:54:00.000Z')
    expect(changedTimestamp.eventKey).toBe(first.eventKey)
    expect(changedTimestamp.eventKey).toBe(messageKey)
  })

  it('preserves valid conversation text exactly without trimming', () => {
    const payload = cloneMessagePayload()
    payloadMessage(payload).conversation = '  inbound text stays intact  '
    const normalized = normalizeWebhook(payload, messageFixture.receivedAt)[0]

    expect(normalized?.kind).toBe('message')
    if (normalized?.kind !== 'message') throw new Error('Expected a normalized message event')
    expect(normalized.text).toBe('  inbound text stays intact  ')
  })

  it.each([
    ['buttonsResponseMessage', { buttonsResponseMessage: { selectedButtonId: 'OPTION_YES', selectedDisplayText: 'Yes, continue' } }, 'button', 'OPTION_YES', 'Yes, continue'],
    ['templateButtonReplyMessage', { templateButtonReplyMessage: { selectedId: 'OPTION_NO', selectedDisplayText: 'No thanks' } }, 'button', 'OPTION_NO', 'No thanks'],
    ['listResponseMessage', { listResponseMessage: { singleSelectReply: { selectedRowId: 'ROW_HOURS' }, title: 'Opening hours' } }, 'list', 'ROW_HOURS', 'Opening hours'],
  ] as const)('normalizes explicit Baileys selection from %s', (messageType, message, replyKind, replyId, label) => {
    const payload = cloneMessagePayload()
    payloadKey(payload).id = 'SYNTHETIC_INTERACTIVE_MESSAGE_ID'
    payloadData(payload).messageType = messageType
    payloadData(payload).message = message

    expect(normalizeWebhook(payload, messageFixture.receivedAt)).toEqual([expect.objectContaining({
      kind: 'message',
      eventKey: expect.stringMatching(/^message:sha256:/),
      externalMessageId: 'SYNTHETIC_INTERACTIVE_MESSAGE_ID',
      peer: '5521999990000@s.whatsapp.net',
      occurredAt,
      fromMe: false,
      sentByApi: false,
      contentType: 'interactive',
      text: label,
      mediaRef: null,
      interactiveReplyId: replyId,
      interactiveReplyKind: replyKind,
    })])
  })

  it('does not infer an interactive reply from labels and filters echoes and groups', () => {
    const missingId = cloneMessagePayload()
    payloadData(missingId).messageType = 'buttonsResponseMessage'
    payloadData(missingId).message = { buttonsResponseMessage: { selectedDisplayText: 'Sensitive label only' } }
    expect(normalizeWebhook(missingId, messageFixture.receivedAt)).toEqual([])

    const echo = cloneMessagePayload()
    payloadData(echo).messageType = 'buttonsResponseMessage'
    payloadData(echo).message = { buttonsResponseMessage: { selectedButtonId: 'SYNTHETIC_REPLY_ID' } }
    payloadKey(echo).fromMe = true
    expect(normalizeWebhook(echo, messageFixture.receivedAt)).toEqual([])

    const group = cloneMessagePayload()
    payloadData(group).messageType = 'listResponseMessage'
    payloadData(group).message = { listResponseMessage: { singleSelectReply: { selectedRowId: 'SYNTHETIC_ROW_ID' } } }
    payloadKey(group).remoteJid = '123456789012345678@g.us'
    expect(normalizeWebhook(group, messageFixture.receivedAt)).toEqual([])
  })

  it.each([
    ['unresolved LID', '[TEST_PEER]@lid'],
    ['group JID', '123456789012345678@g.us'],
    ['broadcast JID', 'status@broadcast'],
    ['too-short PN JID', '1234567@s.whatsapp.net'],
    ['too-long PN JID', '1234567890123456@s.whatsapp.net'],
    ['non-digit PN JID', '55219abc@s.whatsapp.net'],
  ])('ignores unsupported identity: %s', (_name, peer) => {
    const payload = cloneMessagePayload()
    payloadKey(payload).remoteJid = peer
    delete payloadMessage(payload).conversation

    expect(normalizeWebhook(payload, messageFixture.receivedAt)).toEqual([])
  })

  it('ignores self messages without inferring sentByApi', () => {
    const payload = cloneMessagePayload()
    payloadKey(payload).fromMe = true
    delete payloadMessage(payload).conversation

    expect(normalizeWebhook(payload, messageFixture.receivedAt)).toEqual([])
  })

  it.each(['extendedTextMessage', 'stickerMessage', 'ptvMessage', 'documentWithCaptionMessage'])('ignores unsupported message type %s', (messageType) => {
    const payload = cloneMessagePayload()
    payloadData(payload).messageType = messageType
    payloadData(payload).message = { [`${messageType}`]: { text: 'synthetic unsupported content' } }

    expect(normalizeWebhook(payload, messageFixture.receivedAt)).toEqual([])
  })

  it.each([
    ['imageMessage', 'image'],
    ['documentMessage', 'document'],
    ['audioMessage', 'audio'],
    ['videoMessage', 'video'],
  ] as const)('normalizes the source-shaped synthetic %s envelope to a key-only reference', (messageType, contentType) => {
    const payload = cloneMessagePayload()
    const mediaMarker = `SYNTHETIC_${contentType.toUpperCase()}_BYTES_MARKER`
    const urlMarker = 'https://synthetic.invalid/private-media-url-marker'
    const tokenMarker = 'SYNTHETIC_MEDIA_TOKEN_MARKER'
    const captionMarker = 'SYNTHETIC_PRIVATE_CAPTION_MARKER'
    payloadKey(payload).id = 'SYNTHETIC_MEDIA_MESSAGE_ID'
    payloadData(payload).messageType = messageType
    payloadData(payload).message = {
      [messageType]: {
        url: urlMarker,
        mediaKey: tokenMarker,
        fileSha256: mediaMarker,
        caption: captionMarker,
      },
    }

    const result = normalizeWebhook(payload, messageFixture.receivedAt)

    expect(result).toEqual([{
      kind: 'message',
      eventKey: expect.stringMatching(/^message:sha256:/),
      externalMessageId: 'SYNTHETIC_MEDIA_MESSAGE_ID',
      peer: '5521999990000@s.whatsapp.net',
      occurredAt,
      fromMe: false,
      sentByApi: false,
      contentType,
      text: null,
      mediaRef: {
        version: 1,
        key: {
          remoteJid: '5521999990000@s.whatsapp.net',
          id: 'SYNTHETIC_MEDIA_MESSAGE_ID',
          fromMe: false,
        },
      },
    }])
    const serialized = JSON.stringify(result)
    for (const sensitiveMarker of [urlMarker, tokenMarker, mediaMarker, captionMarker]) {
      expect(serialized).not.toContain(sensitiveMarker)
    }
  })

  it.each(['imageMessage', 'documentMessage', 'audioMessage', 'videoMessage'])(
    'rejects a recognized media envelope without its matching message object: %s',
    (messageType) => {
      const payload = cloneMessagePayload()
      payloadKey(payload).id = 'SYNTHETIC_MALFORMED_MEDIA_ID'
      payloadData(payload).messageType = messageType
      payloadData(payload).message = { conversation: 'not the declared media object' }

      expect(() => normalizeWebhook(payload, messageFixture.receivedAt)).toThrow(NormalizationError)
    },
  )

  it.each(['messages.update', 'send.message', 'SEND_MESSAGE', 'unknown.event'])('ignores unsupported event %s', (event) => {
    const payload = cloneMessagePayload()
    payload.event = event

    expect(normalizeWebhook(payload, messageFixture.receivedAt)).toEqual([])
  })

  it('drops envelope secrets and message context from the normalized message', () => {
    const payload = cloneMessagePayload()
    payload.apikey = 'private-api-key-marker'
    payload.destination = 'https://private.example/callback'
    payloadData(payload).contextInfo = { messageSecret: 'private-message-secret-marker' }
    payloadMessage(payload).messageContextInfo = { deviceListMetadata: 'private-device-metadata-marker' }

    const result = normalizeWebhook(payload, messageFixture.receivedAt)

    expect(result).toEqual(expectedMessage())
    expect(JSON.stringify(result)).not.toContain('private-api-key-marker')
    expect(JSON.stringify(result)).not.toContain('private-message-secret-marker')
    expect(JSON.stringify(result)).not.toContain('private-device-metadata-marker')
  })

  it.each([
    ['missing data', (payload: TestPayload) => { delete payload.data }],
    ['wrong data type', (payload: TestPayload) => { payload.data = 'bad' }],
    ['missing key', (payload: TestPayload) => { delete payloadData(payload).key }],
    ['wrong key type', (payload: TestPayload) => { payloadData(payload).key = 'bad' }],
    ['missing message', (payload: TestPayload) => { delete payloadData(payload).message }],
    ['wrong message type', (payload: TestPayload) => { payloadData(payload).message = [] }],
    ['empty ID', (payload: TestPayload) => { payloadKey(payload).id = '  ' }],
    ['wrong ID type', (payload: TestPayload) => { payloadKey(payload).id = 42 }],
    ['wrong peer type', (payload: TestPayload) => { payloadKey(payload).remoteJid = 42 }],
    ['wrong fromMe type', (payload: TestPayload) => { payloadKey(payload).fromMe = 'false' }],
    ['wrong messageType type', (payload: TestPayload) => { payloadData(payload).messageType = 42 }],
    ['wrong timestamp type', (payload: TestPayload) => { payloadData(payload).messageTimestamp = '1794848038' }],
    ['fractional timestamp', (payload: TestPayload) => { payloadData(payload).messageTimestamp = 1794848038.5 }],
    ['out-of-range timestamp', (payload: TestPayload) => { payloadData(payload).messageTimestamp = Number.MAX_SAFE_INTEGER }],
    ['wrong conversation type', (payload: TestPayload) => { payloadMessage(payload).conversation = 42 }],
    ['empty text', (payload: TestPayload) => { payloadMessage(payload).conversation = '  ' }],
  ])('throws the fixed error for malformed known message shape: %s', (_name, mutate) => {
    const payload = cloneMessagePayload()
    mutate(payload)

    expect(() => normalizeWebhook(payload, messageFixture.receivedAt)).toThrow(NormalizationError)
    expect(() => normalizeWebhook(payload, messageFixture.receivedAt)).toThrow('Invalid webhook event')
  })

  it('does not include malformed payload content in the fixed error', () => {
    const payload = cloneMessagePayload()
    payloadMessage(payload).conversation = 'PRIVATE_INBOUND_MARKER'
    payloadKey(payload).id = ''
    const error = (() => {
      try {
        normalizeWebhook(payload, messageFixture.receivedAt)
      } catch (cause) {
        return cause
      }
    })()

    expect(error).toBeInstanceOf(NormalizationError)
    expect((error as Error).message).toBe('Invalid webhook event')
    expect((error as Error).message).not.toContain('PRIVATE_INBOUND_MARKER')
  })

  it('throws a generic typed error for malformed connection and receiver timestamps', () => {
    expect(() => normalizeWebhook({ event: 'connection.update', instance: 'probe', data: null }, receivedAt)).toThrow(NormalizationError)
    expect(() => normalizeWebhook(connectionFixture.payload, 'not-a-time')).toThrow(NormalizationError)
    expect(() => normalizeWebhook(connectionFixture.payload, '2026-11-16T01:55:08.512-03:00')).toThrow(NormalizationError)
  })
})
