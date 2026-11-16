import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NormalizationError, normalizeWebhook } from './events'

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../infra/evolution/fixtures/connection-update.observed.sanitized.json', import.meta.url),
    'utf8',
  ),
) as { payload: unknown }

const receivedAt = '2026-11-16T04:55:08.512Z'
const replayReceivedAt = '2026-11-16T04:55:13.556Z'
const expectedEventKey = 'sha256:62848dfa72149d3beae49e2ea5efa8f25befe12cc16228a5bc5400a0128ff096'

describe('normalizeWebhook', () => {
  it('normalizes the observed connection callback using the receiver timestamp', () => {
    expect(normalizeWebhook(fixture.payload, receivedAt)).toEqual([
      { kind: 'connection', eventKey: expectedEventKey, occurredAt: receivedAt },
    ])
  })

  it('keeps event identity stable across retries received at different times', () => {
    const first = normalizeWebhook(fixture.payload, receivedAt)
    const retry = normalizeWebhook(fixture.payload, replayReceivedAt)

    expect(first[0].eventKey).toBe(expectedEventKey)
    expect(retry[0].eventKey).toBe(expectedEventKey)
    expect(first[0].occurredAt).toBe(receivedAt)
    expect(retry[0].occurredAt).toBe(replayReceivedAt)
  })

  it('uses fixed public fields regardless of payload property order', () => {
    const reordered = {
      apikey: 'different-secret',
      server_url: 'http://different.local/private',
      destination: 'http://different.local/other',
      date_time: '2026-11-16T01:55:08.581Z',
      data: { state: 'connecting', instance: '[PROBE]' },
      instance: '[PROBE]',
      event: 'connection.update',
    }

    expect(normalizeWebhook(reordered, receivedAt)).toEqual([
      { kind: 'connection', eventKey: expectedEventKey, occurredAt: receivedAt },
    ])
  })

  it('does not correct the provider local time into occurredAt', () => {
    expect((fixture.payload as Record<string, unknown>).date_time).toBe('2026-11-16T01:55:08.581Z')

    expect(normalizeWebhook(fixture.payload, receivedAt)[0].occurredAt).toBe('2026-11-16T04:55:08.512Z')
  })

  it('returns no normalized events for an unknown event', () => {
    expect(normalizeWebhook({ event: 'messages.upsert' }, receivedAt)).toEqual([])
  })

  it.each([
    ['non-object payload', null, receivedAt],
    ['empty instance', { event: 'connection.update', instance: '  ', data: { instance: '  ', state: 'open' } }, receivedAt],
    ['incoherent instance', { event: 'connection.update', instance: 'probe-a', data: { instance: 'probe-b', state: 'open' } }, receivedAt],
    ['non-string state', { event: 'connection.update', instance: 'probe-a', data: { instance: 'probe-a', state: 42 } }, receivedAt],
    ['missing event name', { instance: 'probe-a' }, receivedAt],
    ['non-UTC receivedAt', fixture.payload, '2026-11-16T01:55:08.512-03:00'],
    ['invalid receivedAt', fixture.payload, 'not-a-time'],
  ])('throws a generic typed error for %s', (_name, payload, timestamp) => {
    expect(() => normalizeWebhook(payload, timestamp)).toThrow(NormalizationError)
    expect(() => normalizeWebhook(payload, timestamp)).toThrow('Invalid webhook event')
  })

  it('does not include invalid payload contents in the typed error', () => {
    const error = (() => {
      try {
        normalizeWebhook({
          event: 'connection.update',
          instance: 'PRIVATE_PAYLOAD_MARKER',
          data: { instance: 'different-instance', state: 'connecting' },
        }, receivedAt)
      } catch (cause) {
        return cause
      }
    })()

    expect(error).toBeInstanceOf(NormalizationError)
    expect(error).toMatchObject({ message: 'Invalid webhook event' })
    expect((error as Error).message).not.toContain('PRIVATE_PAYLOAD_MARKER')
  })
})
