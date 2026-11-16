import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionCredentials } from './types';

vi.mock('server-only', () => ({}));

const credentials: EvolutionCredentials = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'wacrm-test',
  token: 'test-token-only',
};

const input = {
  connectionId: 'connection-1',
  conversationId: 'conversation-1',
  senderType: 'agent' as const,
  senderId: 'agent-1',
  requestId: 'request-1',
  recipient: '5511999999999@s.whatsapp.net',
  text: 'Olá, teste local',
  credentials,
};

function rpcHarness(
  reservations: unknown[],
  completion: unknown = [
    {
      attempt_id: 'attempt-1',
      outcome: 'accepted',
      message_row_id: 'message-1',
    },
  ]
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'reserve_evolution_send')
      return { data: reservations.shift(), error: null };
    if (name === 'complete_evolution_send')
      return { data: completion, error: null };
    return { data: null, error: { code: 'unexpected_rpc' } };
  });
  return { rpc, db: { rpc } as unknown as Pick<SupabaseClient, 'rpc'> };
}

describe('Evolution text send adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('replays the existing reservation without another provider POST', async () => {
    const { createEvolutionSendAdapter } = await import('./send-adapter');
    const { rpc, db } = rpcHarness([
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-1',
          outcome: 'pending',
          should_send: true,
        },
      ],
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-1',
          outcome: 'accepted',
          should_send: false,
        },
      ],
    ]);
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        key: { id: 'remote-1', fromMe: true, remoteJid: input.recipient },
      })
    );
    const send = createEvolutionSendAdapter(db);

    await expect(send(input)).resolves.toMatchObject({
      outcome: 'accepted',
      shouldSend: true,
    });
    await expect(send(input)).resolves.toMatchObject({
      outcome: 'accepted',
      shouldSend: false,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'reserve_evolution_send',
      'complete_evolution_send',
      'reserve_evolution_send',
    ]);
  });

  it('persists an ambiguous provider result as unknown and does not retry the POST', async () => {
    const { createEvolutionSendAdapter } = await import('./send-adapter');
    const { rpc, db } = rpcHarness(
      [
        [
          {
            attempt_id: 'attempt-1',
            message_row_id: 'message-1',
            outcome: 'pending',
            should_send: true,
          },
        ],
      ],
      [
        {
          attempt_id: 'attempt-1',
          outcome: 'unknown',
          message_row_id: 'message-1',
        },
      ]
    );
    vi.mocked(fetch).mockRejectedValue(
      new TypeError('simulated network failure')
    );
    const send = createEvolutionSendAdapter(db);

    await expect(send(input)).resolves.toMatchObject({
      outcome: 'unknown',
      shouldSend: true,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toMatchObject([
      'complete_evolution_send',
      { p_attempt_id: 'attempt-1', p_outcome: 'unknown' },
    ]);
  });

  it('returns unknown when completion fails after provider acceptance without repeating the POST', async () => {
    const { createEvolutionSendAdapter } = await import('./send-adapter');
    const rpc = vi.fn(async (name: string) => {
      if (name === 'reserve_evolution_send') {
        return {
          data: [
            {
              attempt_id: 'attempt-1',
              message_row_id: 'message-1',
              outcome: 'pending',
              should_send: true,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { code: 'database_unavailable' } };
    });
    const db = { rpc } as unknown as Pick<SupabaseClient, 'rpc'>;
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        key: { id: 'remote-1', fromMe: true, remoteJid: input.recipient },
      })
    );
    const send = createEvolutionSendAdapter(db);

    await expect(send(input)).resolves.toMatchObject({
      outcome: 'unknown',
      shouldSend: true,
      externalMessageId: 'remote-1',
      persistenceUncertain: true,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does not POST when the reservation result is already uncertain', async () => {
    const { createEvolutionSendAdapter } = await import('./send-adapter');
    const { rpc, db } = rpcHarness([
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-1',
          outcome: 'unknown',
          should_send: false,
        },
      ],
    ]);
    const send = createEvolutionSendAdapter(db);

    await expect(send(input)).resolves.toMatchObject({
      outcome: 'unknown',
      shouldSend: false,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reconciles an existing reservation without ever calling the provider transport', async () => {
    const { createEvolutionSendReservationAdapter } =
      await import('./send-adapter');
    const { rpc, db } = rpcHarness([
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-1',
          outcome: 'pending',
          should_send: false,
        },
      ],
    ]);
    const reconcile = createEvolutionSendReservationAdapter(db);

    await expect(reconcile(input)).resolves.toEqual({
      attemptId: 'attempt-1',
      messageRowId: 'message-1',
      outcome: 'pending',
      shouldSend: false,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('reserve_evolution_send');
    expect(fetch).not.toHaveBeenCalled();
  });
});
