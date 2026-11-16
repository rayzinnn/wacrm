import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';
import { loadConnection } from './evolution/store';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('rejects every known non-text capability before database or provider I/O', async () => {
    for (const messageType of [
      'template',
      'interactive',
      'image',
      'video',
      'document',
      'audio',
    ]) {
      await expect(
        sendMessageToConversation(noDb(), 'acct-1', {
          ...base,
          messageType,
        })
      ).rejects.toMatchObject({
        code: 'unsupported_capability',
        message: 'This message type is not currently enabled for Evolution',
        status: 422,
      });
    }
    expect(loadConnection).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(evolution.rpc).not.toHaveBeenCalled();
  });

});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('unsupported_capability', 'blocked', 422);
    expect(e.code).toBe('unsupported_capability');
    expect(e.status).toBe(422);
    expect(e).toBeInstanceOf(Error);
  });
});

// ============================================================
// Evolution send path: reservations persist message rows before transport.
// ============================================================

const evolution = vi.hoisted(() => ({
  rpc: vi.fn(),
  events: [] as string[],
  flowPauses: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: (name: string, args: Record<string, unknown>) =>
      evolution.rpc(name, args),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.update = (row: Record<string, unknown>) => {
        if (table === 'flow_runs') evolution.flowPauses.push(row);
        return builder;
      };
      builder.eq = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return builder;
    },
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('./evolution/store', () => ({
  loadConnection: vi.fn(async (accountId: string) =>
    accountId === 'acct-1'
      ? {
          id: 'connection-1',
          accountId,
          createdBy: 'user-1',
          credentials: {
            baseUrl: 'http://127.0.0.1:8080',
            instanceId: 'wacrm-test',
            token: 'test-token',
          },
          webhookSecret: 'not-used',
          state: 'connected',
          checkedAt: null,
        }
      : null
  ),
}));

interface CapturedWrites {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  conversationFilters?: Array<[string, unknown]>;
  conversationGuards?: string[];
}

/**
 * Supabase fake covering the text send path. The conversation update
 * builder is chainable and awaitable to match the summary update query.
 */
function sendPathDb(
  captured: CapturedWrites,
  contact: Record<string, unknown> = { id: 'ct-1', phone: '+15551234567' },
  conversationLastMessageAt: string | null = null
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    contact,
  };
  return {
    from(table: string) {
      let pendingConversationUpdate: Record<string, unknown> | undefined;
      let conversationUpdateGuarded = false;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          if (table === 'conversations')
            captured.conversationFilters?.push([column, value]);
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') captured.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') pendingConversationUpdate = row;
          return builder;
        },
        or: (filter: string) => {
          if (table === 'conversations') {
            conversationUpdateGuarded = true;
            captured.conversationGuards?.push(filter);
            const createdAt = filter.split('.lte.')[1];
            if (
              pendingConversationUpdate &&
              (!conversationLastMessageAt ||
                (createdAt &&
                  Date.parse(conversationLastMessageAt) <=
                    Date.parse(createdAt)))
            ) {
              captured.conversation = pendingConversationUpdate;
            }
          }
          return builder;
        },
        maybeSingle: async () =>
          table === 'messages'
            ? {
                data: {
                  message_id: 'remote-1',
                  content_text: 'hi',
                  created_at: '2026-11-16T10:00:00.000Z',
                },
                error: null,
              }
            : { data: null, error: null },
        single: async () => {
          if (table === 'conversations') {
            return { data: conversation, error: null };
          }
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        // Bare-await result for conversation summary updates.
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
          if (
            table === 'conversations' &&
            pendingConversationUpdate &&
            !conversationUpdateGuarded
          ) {
            captured.conversation = pendingConversationUpdate;
          }
          resolve({
            data: [],
            error: null,
          });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  evolution.events.length = 0;
  evolution.flowPauses.length = 0;
  vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      evolution.events.push('post');
      return Response.json({
        key: {
          id: 'remote-1',
          fromMe: true,
          remoteJid: '15551234567@s.whatsapp.net',
        },
      });
    })
  );
  evolution.rpc.mockImplementation(async (name: string) => {
    evolution.events.push(`rpc:${name}`);
    if (name === 'reserve_evolution_send') {
      return {
        data: [
          {
            attempt_id: 'attempt-1',
            message_row_id: 'message-row-1',
            outcome: 'pending',
            should_send: true,
          },
        ],
        error: null,
      };
    }
    return {
      data: [
        {
          attempt_id: 'attempt-1',
          outcome: 'accepted',
          message_row_id: 'message-row-1',
        },
      ],
      error: null,
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ============================================================
// Evolution text requires a phone-addressable recipient.
//
describe('sendMessageToConversation — Evolution text delivery', () => {
  const params = {
    conversationId: 'cv-1',
    messageType: 'text',
    contentText: 'hi',
    senderId: 'user-42',
    requestId: 'caller-owned-request-1',
  };

  it('reserves before one Evolution POST and does not fabricate a message row', async () => {
    const captured: CapturedWrites = { conversationFilters: [] };

    const result = await sendMessageToConversation(
      sendPathDb(captured),
      'acct-1',
      params
    );

    expect(evolution.events).toEqual([
      'rpc:reserve_evolution_send',
      'post',
      'rpc:complete_evolution_send',
    ]);
    expect(evolution.rpc.mock.calls[0]).toMatchObject([
      'reserve_evolution_send',
      {
        p_connection_id: 'connection-1',
        p_conversation_id: 'cv-1',
        p_sender_type: 'agent',
        p_sender_id: 'user-42',
        p_request_id: params.requestId,
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'http://127.0.0.1:8080/message/sendText/wacrm-test'
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(captured.message).toBeUndefined();
    expect(captured.conversation).toMatchObject({ last_message_text: 'hi' });
    expect(captured.conversationFilters).toContainEqual([
      'account_id',
      'acct-1',
    ]);
    expect(result).toEqual({
      messageId: 'message-row-1',
      whatsappMessageId: 'remote-1',
    });
  });

  it('replays an accepted reservation without another POST or message row', async () => {
    const reservations = [
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-row-1',
          outcome: 'pending',
          should_send: true,
        },
      ],
      [
        {
          attempt_id: 'attempt-1',
          message_row_id: 'message-row-1',
          outcome: 'accepted',
          should_send: false,
        },
      ],
    ];
    evolution.rpc.mockImplementation(async (name: string) => {
      evolution.events.push(`rpc:${name}`);
      if (name === 'reserve_evolution_send')
        return { data: reservations.shift(), error: null };
      return {
        data: [
          {
            attempt_id: 'attempt-1',
            outcome: 'accepted',
            message_row_id: 'message-row-1',
          },
        ],
        error: null,
      };
    });
    const firstWrites: CapturedWrites = {};
    const replayWrites: CapturedWrites = { conversationGuards: [] };

    const first = await sendMessageToConversation(
      sendPathDb(firstWrites),
      'acct-1',
      params
    );
    evolution.flowPauses.length = 0;
    const replay = await sendMessageToConversation(
      sendPathDb(replayWrites),
      'acct-1',
      params
    );

    expect(first).toEqual(replay);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(evolution.events).toEqual([
      'rpc:reserve_evolution_send',
      'post',
      'rpc:complete_evolution_send',
      'rpc:reserve_evolution_send',
    ]);
    expect(firstWrites.message).toBeUndefined();
    expect(replayWrites.message).toBeUndefined();
    expect(replayWrites.conversation).toMatchObject({
      last_message_text: 'hi',
      last_message_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    expect(replayWrites.conversationGuards).toContain(
      'last_message_at.is.null,last_message_at.lte.2026-11-16T10:00:00.000Z'
    );
    expect(evolution.flowPauses).toHaveLength(1);
    expect(evolution.flowPauses[0]).toMatchObject({
      status: 'paused_by_agent',
      end_reason: 'agent_replied',
    });
  });

  it('does not let an older accepted replay overwrite a newer conversation summary', async () => {
    evolution.rpc.mockImplementation(async (name: string) => {
      evolution.events.push(`rpc:${name}`);
      return {
        data: [
          {
            attempt_id: 'attempt-1',
            message_row_id: 'message-row-1',
            outcome: 'accepted',
            should_send: false,
          },
        ],
        error: null,
      };
    });
    const captured: CapturedWrites = { conversationGuards: [] };

    const result = await sendMessageToConversation(
      sendPathDb(
        captured,
        { id: 'ct-1', phone: '+15551234567' },
        '2026-11-16T10:05:00.000Z'
      ),
      'acct-1',
      params
    );

    expect(result).toEqual({
      messageId: 'message-row-1',
      whatsappMessageId: 'remote-1',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(captured.message).toBeUndefined();
    expect(captured.conversation).toBeUndefined();
    expect(captured.conversationGuards).toContain(
      'last_message_at.is.null,last_message_at.lte.2026-11-16T10:00:00.000Z'
    );
    expect(evolution.flowPauses).toHaveLength(1);
  });

  it('returns delivery_unknown after an ambiguous transport failure and pauses the active flow', async () => {
    vi.mocked(fetch).mockRejectedValue(
      new TypeError('simulated private network detail')
    );
    const captured: CapturedWrites = {};

    await expect(
      sendMessageToConversation(sendPathDb(captured), 'acct-1', params)
    ).rejects.toMatchObject({ code: 'delivery_unknown', status: 504 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(evolution.rpc.mock.calls[1]).toMatchObject([
      'complete_evolution_send',
      { p_outcome: 'unknown' },
    ]);
    expect(captured.message).toBeUndefined();
    expect(captured.conversation).toBeUndefined();
    expect(evolution.flowPauses).toContainEqual(
      expect.objectContaining({
        status: 'paused_by_agent',
        end_reason: 'agent_replied',
      })
    );
  });

  it('requires a caller-supplied request id before any database or transport call', async () => {
    await expect(
      sendMessageToConversation(noDb(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hi',
        senderId: 'user-42',
      })
    ).rejects.toMatchObject({ code: 'idempotency_key_required', status: 400 });
    expect(fetch).not.toHaveBeenCalled();
    expect(evolution.rpc).not.toHaveBeenCalled();
  });

  it('rejects Evolution text when the contact has no phone number', async () => {
    await expect(
      sendMessageToConversation(
        sendPathDb(
          {},
          { id: 'ct-1', phone: '', wa_user_id: 'US.13491234567890123456' }
        ),
        'acct-1',
        params
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
    expect(evolution.rpc).not.toHaveBeenCalled();
  });
});
