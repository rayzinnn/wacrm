import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  supabase: { __client: true },
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (callback: () => unknown) => {
    mocks.afterCallbacks.push(callback);
  },
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: mocks.supabase,
    accountId: 'account-1',
    createdBy: 'user-1',
  })),
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: mocks.sendMessageToConversation,
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: mocks.dispatchWebhookEvent,
}));

import { POST } from './route';

function sendRequest(options: { requestId?: string; type?: string } = {}) {
  return new Request('https://x.test/api/v1/messages', {
    method: 'POST',
    headers: options.requestId ? { 'Idempotency-Key': options.requestId } : {},
    body: JSON.stringify({
      to: '+14155550123',
      text: 'Hi',
      name: 'Jane',
      ...(options.type ? { type: options.type } : {}),
    }),
  });
}

beforeEach(() => {
  mocks.afterCallbacks = [];
  mocks.resolveConversationByPhone.mockReset();
  mocks.sendMessageToConversation.mockReset();
  mocks.dispatchWebhookEvent.mockReset();
  mocks.sendMessageToConversation.mockResolvedValue({
    messageId: 'm1',
    whatsappMessageId: 'wamid.1',
  });
});

describe('POST /api/v1/messages', () => {
  it('dispatches conversation.created when the API opens a new conversation', async () => {
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: true,
      conversationCreated: true,
    });

    const res = await POST(sendRequest({ requestId: 'v1-stable-request-1' }));
    expect(res.status).toBe(201);

    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]();
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      mocks.supabase,
      'account-1',
      'conversation.created',
      { conversation_id: 'cv1', contact_id: 'c1' }
    );
    expect(mocks.sendMessageToConversation).toHaveBeenCalledWith(
      mocks.supabase,
      'account-1',
      expect.objectContaining({
        requestId: 'v1-stable-request-1',
        senderId: 'user-1',
      })
    );
  });

  it('does not dispatch conversation.created for an existing conversation', async () => {
    mocks.resolveConversationByPhone.mockResolvedValue({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
      conversationCreated: false,
    });

    const res = await POST(sendRequest({ requestId: 'v1-stable-request-2' }));
    expect(res.status).toBe(201);
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotency key before resolving or creating a conversation', async () => {
    const res = await POST(sendRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('idempotency_key_required');
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('blocks unsupported types before resolving a conversation', async () => {
    const res = await POST(
      sendRequest({ requestId: 'v1-stable-request-3', type: 'image' })
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('unsupported_capability');
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });
});
