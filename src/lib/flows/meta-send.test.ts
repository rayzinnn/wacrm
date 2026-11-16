import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: dependencies.supabaseAdmin,
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: dependencies.sendTextMessage,
  sendMediaMessage: dependencies.sendMediaMessage,
  sendInteractiveButtons: dependencies.sendInteractiveButtons,
  sendInteractiveList: dependencies.sendInteractiveList,
}));

import {
  FLOW_SEND_CAPABILITY_ERROR,
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from './meta-send';

const args = {
  accountId: 'account-fixture',
  userId: 'user-fixture',
  conversationId: 'conversation-fixture',
  contactId: 'contact-fixture',
};

const senders = [
  {
    name: 'text',
    run: () => engineSendText({ ...args, text: 'Fixture message' }),
  },
  {
    name: 'media',
    run: () =>
      engineSendMedia({
        ...args,
        kind: 'image',
        link: 'https://example.invalid/fixture.png',
      }),
  },
  {
    name: 'interactive buttons',
    run: () =>
      engineSendInteractiveButtons({
        ...args,
        bodyText: 'Fixture message',
        buttons: [{ id: 'continue', title: 'Continue' }],
      }),
  },
  {
    name: 'interactive list',
    run: () =>
      engineSendInteractiveList({
        ...args,
        bodyText: 'Fixture message',
        buttonLabel: 'Choose',
        sections: [{ rows: [{ id: 'continue', title: 'Continue' }] }],
      }),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flow send capability gate', () => {
  it.each(senders)(
    'fails closed for $name before persistence or transport',
    async ({ run }) => {
      await expect(run()).rejects.toMatchObject({
        name: 'FlowSendCapabilityError',
        message: FLOW_SEND_CAPABILITY_ERROR,
      });

      expect(dependencies.supabaseAdmin).not.toHaveBeenCalled();
      expect(dependencies.sendTextMessage).not.toHaveBeenCalled();
      expect(dependencies.sendMediaMessage).not.toHaveBeenCalled();
      expect(dependencies.sendInteractiveButtons).not.toHaveBeenCalled();
      expect(dependencies.sendInteractiveList).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
