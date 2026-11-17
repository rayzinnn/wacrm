import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEvolutionMediaSendAdapter, type EvolutionMediaSendInput } from './media-send-adapter'
import { EvolutionMediaSendError } from './media-send'

vi.mock('server-only', () => ({}))

const input: EvolutionMediaSendInput = {
  connectionId: 'connection-a', conversationId: 'conversation-a', senderId: 'agent-a',
  credentials: { baseUrl: 'http://127.0.0.1:8080', instanceId: 'synthetic', token: 'synthetic-token' },
  message: {
    recipient: '5511999999999@s.whatsapp.net', requestId: 'synthetic-media-request',
    mediaType: 'image', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mimeType: 'image/png', fileName: 'synthetic.png', caption: 'synthetic caption',
  },
}

function harness(reservation = { attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: 'pending', should_send: true }) {
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'reserve_evolution_media_send' ? [reservation] : [{
      attempt_id: 'attempt-a', message_row_id: 'message-a', outcome: 'accepted',
    }], error: null,
  }))
  const transport = vi.fn(async () => ({ externalMessageId: 'provider-message-a' }))
  const send = createEvolutionMediaSendAdapter({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>, transport)
  return { rpc, transport, send }
}

describe('Evolution media reservation adapter', () => {
  it('reserves before sending and completes the same attempt once', async () => {
    const h = harness()
    await expect(h.send(input)).resolves.toMatchObject({ outcome: 'accepted', externalMessageId: 'provider-message-a' })
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'reserve_evolution_media_send', expect.objectContaining({
      p_connection_id: 'connection-a', p_request_id: input.message.requestId,
      p_conversation_id: 'conversation-a', p_sender_id: 'agent-a',
      p_content_type: 'image', p_media_type: 'image/png', p_content_text: 'synthetic caption',
      p_request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(h.transport).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenLastCalledWith('complete_evolution_send', expect.objectContaining({
      p_attempt_id: 'attempt-a', p_outcome: 'accepted', p_external_message_id: 'provider-message-a',
    }))
  })

  it.each(['pending', 'unknown', 'accepted', 'rejected'] as const)(
    'does not send on reservation replay with outcome %s', async (outcome) => {
      const h = harness({ attempt_id: 'attempt-a', message_row_id: 'message-a', outcome, should_send: false })
      const result = await h.send(input)
      expect(result.shouldSend).toBe(false)
      expect(result.outcome).toBe(outcome)
      expect(h.transport).not.toHaveBeenCalled()
    },
  )

  it('keeps an ambiguous timeout unknown and makes exactly one provider call', async () => {
    const h = harness()
    h.transport.mockRejectedValue(new EvolutionMediaSendError('timeout', null, true))
    await expect(h.send(input)).resolves.toMatchObject({ outcome: 'unknown', persistenceUncertain: true })
    expect(h.transport).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenLastCalledWith('complete_evolution_send', expect.objectContaining({
      p_outcome: 'unknown', p_error_code: 'timeout',
    }))
  })

  it('does not contact provider when reservation is unavailable', async () => {
    const h = harness()
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'synthetic failure' } } as never)
    await expect(h.send(input)).rejects.toMatchObject({ code: 'reservation_unavailable' })
    expect(h.transport).not.toHaveBeenCalled()
  })

  it('rejects invalid media before creating a durable reservation', async () => {
    const h = harness()
    await expect(h.send({ ...input, message: { ...input.message, bytes: new TextEncoder().encode('not png') } }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.transport).not.toHaveBeenCalled()
  })
})
