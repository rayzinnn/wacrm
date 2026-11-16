import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    if (mocks.admin === 'throw-client') throw new Error('private client secret')
    return mocks.admin
  },
}))

import { EventQueueError, enqueueEvents } from './event-queue'
import type { NormalizedEvent } from './events'

const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const firstEvent: NormalizedEvent = {
  kind: 'connection',
  eventKey: 'sha256:first',
  occurredAt: '2026-11-16T04:55:08.512Z',
}
const secondEvent: NormalizedEvent = {
  kind: 'connection',
  eventKey: 'sha256:second',
  occurredAt: '2026-11-16T04:55:13.556Z',
}

const inboundMessage: NormalizedEvent = {
  kind: 'message',
  eventKey: 'message:sha256:message-1',
  externalMessageId: '[MESSAGE_ID_2]',
  peer: '5521999990000@s.whatsapp.net',
  occurredAt: '2026-11-16T16:53:58.000Z',
  fromMe: false,
  sentByApi: false,
  contentType: 'text',
  text: 'synthetic inbound text',
  mediaRef: null,
}

function configureAdmin(data: Array<{ id: string }> | null, error: unknown = null) {
  const select = vi.fn().mockResolvedValue({ data, error })
  const upsert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ upsert })
  mocks.admin = { from }
  return { from, upsert, select }
}

afterEach(() => {
  mocks.admin = undefined
  vi.clearAllMocks()
})

describe('enqueueEvents', () => {
  it('inserts a batch atomically and counts returned rows', async () => {
    const query = configureAdmin([{ id: 'event-1' }, { id: 'event-2' }])

    await expect(enqueueEvents(connectionId, [firstEvent, secondEvent])).resolves.toEqual({
      inserted: 2,
      duplicates: 0,
    })

    expect(query.from).toHaveBeenCalledTimes(1)
    expect(query.from).toHaveBeenCalledWith('evolution_events')
    expect(query.upsert).toHaveBeenCalledTimes(1)
    expect(query.upsert).toHaveBeenCalledWith([
      {
        connection_id: connectionId,
        event_key: 'sha256:first',
        normalized_event: {
          kind: 'connection',
          eventKey: 'sha256:first',
          occurredAt: '2026-11-16T04:55:08.512Z',
        },
      },
      {
        connection_id: connectionId,
        event_key: 'sha256:second',
        normalized_event: {
          kind: 'connection',
          eventKey: 'sha256:second',
          occurredAt: '2026-11-16T04:55:13.556Z',
        },
      },
    ], { onConflict: 'connection_id,event_key', ignoreDuplicates: true })
    expect(query.select).toHaveBeenCalledTimes(1)
    expect(query.select).toHaveBeenCalledWith('id')
  })

  it('counts persisted retries as duplicates without overwriting them', async () => {
    const query = configureAdmin([])

    await expect(enqueueEvents(connectionId, [firstEvent])).resolves.toEqual({
      inserted: 0,
      duplicates: 1,
    })

    expect(query.upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'connection_id,event_key',
      ignoreDuplicates: true,
    })
  })

  it('deduplicates repeated keys inside the input batch before upsert', async () => {
    const query = configureAdmin([{ id: 'event-1' }])
    const replayWithDifferentArrival: NormalizedEvent = {
      ...firstEvent,
      occurredAt: '2026-11-16T04:56:00.000Z',
    }

    await expect(enqueueEvents(connectionId, [firstEvent, replayWithDifferentArrival])).resolves.toEqual({
      inserted: 1,
      duplicates: 1,
    })

    expect(query.upsert).toHaveBeenCalledTimes(1)
    expect(query.upsert).toHaveBeenCalledWith([
      {
        connection_id: connectionId,
        event_key: 'sha256:first',
        normalized_event: {
          kind: 'connection',
          eventKey: 'sha256:first',
          occurredAt: '2026-11-16T04:55:08.512Z',
        },
      },
    ], { onConflict: 'connection_id,event_key', ignoreDuplicates: true })
  })

  it('returns zeros for an empty batch without creating the admin client', async () => {
    await expect(enqueueEvents(connectionId, [])).resolves.toEqual({ inserted: 0, duplicates: 0 })
    expect(mocks.admin).toBeUndefined()
  })

  it('projects normalized event fields explicitly and drops extra secrets', async () => {
    const query = configureAdmin([{ id: 'event-1' }])
    const eventWithExtras = {
      ...firstEvent,
      apikey: 'secret-must-not-persist',
      payload: { token: 'raw-body-secret' },
    } as NormalizedEvent

    await enqueueEvents(connectionId, [eventWithExtras])

    expect(query.upsert.mock.calls[0][0]).toEqual([
      {
        connection_id: connectionId,
        event_key: 'sha256:first',
        normalized_event: {
          kind: 'connection',
          eventKey: 'sha256:first',
          occurredAt: '2026-11-16T04:55:08.512Z',
        },
      },
    ])
    expect(JSON.stringify(query.upsert.mock.calls[0][0])).not.toContain('secret-must-not-persist')
    expect(JSON.stringify(query.upsert.mock.calls[0][0])).not.toContain('raw-body-secret')
  })

  it('projects message fields explicitly and removes raw context and secrets', async () => {
    const query = configureAdmin([{ id: 'event-message-1' }])
    const eventWithExtras = {
      ...inboundMessage,
      apikey: 'private-api-key-marker',
      payload: { contextInfo: { messageSecret: 'private-message-secret-marker' } },
      messageContextInfo: { deviceListMetadata: 'private-device-metadata-marker' },
    } as NormalizedEvent

    await enqueueEvents(connectionId, [eventWithExtras])

    const rows = query.upsert.mock.calls[0][0]
    expect(rows).toEqual([{
      connection_id: connectionId,
      event_key: 'message:sha256:message-1',
      normalized_event: {
        kind: 'message',
        eventKey: 'message:sha256:message-1',
        externalMessageId: '[MESSAGE_ID_2]',
        peer: '5521999990000@s.whatsapp.net',
        occurredAt: '2026-11-16T16:53:58.000Z',
        fromMe: false,
        sentByApi: false,
        contentType: 'text',
        text: 'synthetic inbound text',
        mediaRef: null,
      },
    }])
    const stored = JSON.stringify(rows)
    expect(stored).not.toContain('private-api-key-marker')
    expect(stored).not.toContain('private-message-secret-marker')
    expect(stored).not.toContain('private-device-metadata-marker')
    expect(stored).not.toContain('contextInfo')
  })

  it('deduplicates inbound message replay by event key and keeps the first projection', async () => {
    const query = configureAdmin([{ id: 'event-message-1' }])
    const replay: NormalizedEvent = {
      ...inboundMessage,
      text: 'different text on replay',
      occurredAt: '2026-11-16T16:54:10.000Z',
    }

    await expect(enqueueEvents(connectionId, [inboundMessage, replay])).resolves.toEqual({
      inserted: 1,
      duplicates: 1,
    })

    expect(query.upsert).toHaveBeenCalledTimes(1)
    expect(query.upsert.mock.calls[0][0][0].normalized_event).toMatchObject({
      eventKey: 'message:sha256:message-1',
      text: 'synthetic inbound text',
      occurredAt: '2026-11-16T16:53:58.000Z',
    })
  })

  it('sanitizes returned database errors', async () => {
    configureAdmin(null, { code: 'XX000', message: 'private database detail' })

    const error = await enqueueEvents(connectionId, [firstEvent]).catch((cause) => cause)

    expect(error).toBeInstanceOf(EventQueueError)
    expect(error).toMatchObject({
      code: 'event_queue_unavailable',
      status: 503,
      message: 'Evolution event queue is unavailable.',
    })
    expect((error as Error).message).not.toContain('private database detail')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it.each(['client construction', 'database query'])('sanitizes thrown failures from %s', async (source) => {
    mocks.admin = source === 'client construction'
      ? 'throw-client'
      : { from: () => { throw new Error('private query secret') } }

    const error = await enqueueEvents(connectionId, [firstEvent]).catch((cause) => cause)

    expect(error).toBeInstanceOf(EventQueueError)
    expect(error).toMatchObject({ code: 'event_queue_unavailable', status: 503 })
    expect((error as Error).message).toBe('Evolution event queue is unavailable.')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })
})
