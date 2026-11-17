import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('server-only', () => ({}));
import { EvolutionError } from './client';
import { createEvolutionInteractiveSendAdapter, interactiveRequestHash } from './interactive-send-adapter';
import type { ProviderInteractive } from './interactive-client';

const message: ProviderInteractive = {
  kind: 'buttons', recipient: '15551234567@s.whatsapp.net', requestId: 'flow-step-1',
  title: 'Choose', buttons: [{ id: 'yes', displayText: 'Yes' }],
};
const input = {
  connectionId: 'connection-1', conversationId: 'conversation-1', senderId: 'user-1',
  credentials: { baseUrl: 'http://127.0.0.1:8080', instanceId: 'local', token: 'test' },
  message,
};
const reserved = { attempt_id: 'attempt-1', message_row_id: 'message-1',
  outcome: 'pending', should_send: true };

function harness(first = reserved) {
  const rpc = vi.fn(async (name: string) => ({ data: name === 'reserve_evolution_interactive_send'
    ? [first] : [{ attempt_id: 'attempt-1', message_row_id: 'message-1', outcome: 'accepted' }],
    error: null }));
  const transport = vi.fn(async () => ({ externalMessageId: 'provider-1' }));
  const send = createEvolutionInteractiveSendAdapter({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>, transport);
  return { rpc, transport, send };
}

describe('interactive send reservation', () => {
  it('binds the full payload to the request and completes one accepted POST', async () => {
    const h = harness();
    await expect(h.send(input)).resolves.toMatchObject({ outcome: 'accepted',
      shouldSend: true, persistenceUncertain: false });
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'reserve_evolution_interactive_send', {
      p_connection_id: 'connection-1', p_conversation_id: 'conversation-1',
      p_sender_id: 'user-1', p_request_id: 'flow-step-1',
      p_request_hash: interactiveRequestHash(message),
      p_message: { content_type: 'interactive', content_text: 'Choose', interactive_payload: message },
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'complete_evolution_send', {
      p_attempt_id: 'attempt-1', p_outcome: 'accepted',
      p_external_message_id: 'provider-1', p_error_code: null,
    });
    expect(interactiveRequestHash({ ...message, title: 'Different' }))
      .not.toBe(interactiveRequestHash(message));
  });

  it('never POSTs for a replayed or uncertain reservation', async () => {
    for (const outcome of ['pending', 'unknown', 'accepted'] as const) {
      const h = harness({ ...reserved, outcome, should_send: false });
      await expect(h.send(input)).resolves.toMatchObject({ outcome, shouldSend: false });
      expect(h.transport).not.toHaveBeenCalled();
      expect(h.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it('records an ambiguous provider failure without retrying', async () => {
    const h = harness();
    h.transport.mockRejectedValueOnce(new EvolutionError('timeout', 'timed out', { ambiguous: true }));
    h.rpc.mockImplementation(async (name: string) => ({ data: name === 'reserve_evolution_interactive_send'
      ? [reserved] : [{ attempt_id: 'attempt-1', message_row_id: 'message-1', outcome: 'unknown' }],
      error: null }));
    await expect(h.send(input)).resolves.toMatchObject({ outcome: 'unknown', persistenceUncertain: true });
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenLastCalledWith('complete_evolution_send',
      expect.objectContaining({ p_outcome: 'unknown', p_error_code: 'timeout' }));
  });
});
