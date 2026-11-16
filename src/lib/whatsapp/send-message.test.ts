import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

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

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

// ============================================================
// Full send path — what actually lands in `messages` (issue #483).
// ============================================================

const sendTemplateMessage = vi.fn(async () => ({ messageId: 'wamid.1' }));
const evolution = vi.hoisted(() => ({
  rpc: vi.fn(),
  events: [] as string[],
  flowPauses: [] as Array<Record<string, unknown>>,
}));

// Stub only the senders — the module also exports INTERACTIVE_LIMITS,
// which `interactive.ts` needs for the payload validation covered above.
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendTemplateMessage: (...args: unknown[]) =>
    (sendTemplateMessage as unknown as (...a: unknown[]) => unknown)(...args),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
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

const applyPendingMessageStatuses = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/lib/whatsapp/message-status-sync', () => ({
  applyPendingMessageStatuses,
}));

interface CapturedWrites {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  conversationFilters?: Array<[string, unknown]>;
  conversationGuards?: string[];
}

/**
 * Supabase fake covering the tables the send path touches. Each table
 * gets a builder that is both chainable and awaitable, so the same
 * object serves `.single()` lookups and the bare `select().eq().eq()`
 * the template resolver uses.
 */
function sendPathDb(
  templateRows: unknown[],
  captured: CapturedWrites,
  contact: Record<string, unknown> = { id: 'ct-1', phone: '+15551234567' },
  conversationLastMessageAt: string | null = null
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    contact,
  };
  const config = {
    id: 'cfg-1',
    phone_number_id: 'pn-1',
    access_token: 'token',
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
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        // Bare-await result — only message_templates is read this way.
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
          if (
            table === 'conversations' &&
            pendingConversationUpdate &&
            !conversationUpdateGuarded
          ) {
            captured.conversation = pendingConversationUpdate;
          }
          resolve({
            data: table === 'message_templates' ? templateRows : [],
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

const TEMPLATE_ROW = {
  id: 'tpl-1',
  user_id: 'u-1',
  name: 'order_update',
  category: 'Utility',
  language: 'en',
  body_text: 'Your order {{1}} ships on {{2}}',
  created_at: '2026-01-01T00:00:00Z',
};

describe('sendMessageToConversation — template persistence (#483)', () => {
  it('stores the substituted body when the caller sends no text', async () => {
    const captured: CapturedWrites = {};
    const result = await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
      }
    );

    expect(result.whatsappMessageId).toBe('wamid.1');
    // Was NULL before the fix — the Inbox rendered an empty bubble.
    expect(captured.message?.content_text).toBe(
      'Your order A123 ships on Friday'
    );
    expect(captured.message?.template_name).toBe('order_update');
    // …and the conversation-list preview reads the body, not '[template]'.
    expect(captured.conversation?.last_message_text).toBe(
      'Your order A123 ships on Friday'
    );
  });

  it('records which teammate sent the message', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateMessageParams: { body: ['A1', 'Friday'] },
        senderId: 'user-42',
      }
    );
    expect(captured.message?.sender_id).toBe('user-42');
  });

  it('leaves sender_id empty when no teammate is known', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateMessageParams: { body: ['A1', 'Friday'] },
      }
    );
    expect(captured.message?.sender_id).toBeNull();
  });

  it('reads body values out of the structured params shape too', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateMessageParams: { body: ['B456', 'Monday'] },
      }
    );
    expect(captured.message?.content_text).toBe(
      'Your order B456 ships on Monday'
    );
  });

  it("does not override the composer's pre-rendered text", async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
        contentText: 'rendered by the composer',
      }
    );
    expect(captured.message?.content_text).toBe('rendered by the composer');
  });

  it("sends the local row's language when the caller names none", async () => {
    sendTemplateMessage.mockClear();
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
      }
    );
    // Previously pinned to 'en_US', which matched no row and made Meta
    // reject the send as a missing translation.
    expect(
      (
        sendTemplateMessage.mock.calls[0] as unknown as [{ language: string }]
      )[0].language
    ).toBe('en');
  });

  it('leaves content_text null when the account has no local template row', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'never_synced',
      templateParams: ['A123'],
    });
    // Nothing to render from — the bubble falls back to the template
    // name rather than inventing a body.
    expect(captured.message?.content_text).toBeNull();
    expect(captured.conversation?.last_message_text).toBe('[template]');
  });

  it('stores the header image so the Inbox can render it (#655)', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb(
        [
          {
            ...TEMPLATE_ROW,
            header_type: 'image',
            header_media_url: 'https://cdn.example.com/banner.png',
          },
        ],
        captured
      ),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
      }
    );
    expect(captured.message?.media_url).toBe(
      'https://cdn.example.com/banner.png'
    );
  });

  it('stores no media for a template without a media header', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
        mediaUrl: 'https://cdn.example.com/ignored.png',
      }
    );
    expect(captured.message?.media_url).toBeNull();
  });
});

// ============================================================
// Business-scoped user IDs (issue #519)
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
    const { sendTextMessage } = await import('@/lib/whatsapp/meta-api');

    const result = await sendMessageToConversation(
      sendPathDb([], captured),
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
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(captured.message).toBeUndefined();
    expect(captured.conversation).toMatchObject({ last_message_text: 'hi' });
    expect(captured.conversationFilters).toContainEqual([
      'account_id',
      'acct-1',
    ]);
    expect(applyPendingMessageStatuses).not.toHaveBeenCalled();
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
      sendPathDb([], firstWrites),
      'acct-1',
      params
    );
    evolution.flowPauses.length = 0;
    const replay = await sendMessageToConversation(
      sendPathDb([], replayWrites),
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
        [],
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
      sendMessageToConversation(sendPathDb([], captured), 'acct-1', params)
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

  it('does not send a phone-less BSUID through the Evolution text transport', async () => {
    await expect(
      sendMessageToConversation(
        sendPathDb(
          [],
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
