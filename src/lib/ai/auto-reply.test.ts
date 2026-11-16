import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  loadAccountMetaCredentials: vi.fn(),
  sendTypingIndicator: vi.fn(),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: dependencies.supabaseAdmin,
}));
vi.mock('./config', () => ({ loadAiConfig: dependencies.loadAiConfig }));
vi.mock('./context', () => ({
  buildConversationContext: dependencies.buildConversationContext,
}));
vi.mock('./knowledge', () => ({
  retrieveKnowledge: dependencies.retrieveKnowledge,
}));
vi.mock('./generate', () => ({ generateReply: dependencies.generateReply }));
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: dependencies.engineSendText,
  loadAccountMetaCredentials: dependencies.loadAccountMetaCredentials,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: dependencies.sendTypingIndicator,
}));

import {
  AI_REPLY_CAPABILITY_ERROR,
  dispatchInboundToAiReply,
} from './auto-reply';

const args = {
  accountId: 'account-fixture',
  conversationId: 'conversation-fixture',
  contactId: 'contact-fixture',
  configOwnerUserId: 'user-fixture',
  inboundMessageId: 'wamid-fixture',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legacy AI auto-reply capability gate', () => {
  it('rejects before database, generation, or network activity', async () => {
    await expect(dispatchInboundToAiReply(args)).rejects.toMatchObject({
      name: 'AiReplyCapabilityError',
      message: AI_REPLY_CAPABILITY_ERROR,
    });

    expect(dependencies.supabaseAdmin).not.toHaveBeenCalled();
    expect(dependencies.loadAiConfig).not.toHaveBeenCalled();
    expect(dependencies.buildConversationContext).not.toHaveBeenCalled();
    expect(dependencies.retrieveKnowledge).not.toHaveBeenCalled();
    expect(dependencies.generateReply).not.toHaveBeenCalled();
    expect(dependencies.engineSendText).not.toHaveBeenCalled();
    expect(dependencies.loadAccountMetaCredentials).not.toHaveBeenCalled();
    expect(dependencies.sendTypingIndicator).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
