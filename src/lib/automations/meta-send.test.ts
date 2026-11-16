import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transports = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendTemplate: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  supabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: transports.sendText,
  sendTemplateMessage: transports.sendTemplate,
}));

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: transports.sendInteractiveButtons,
  engineSendInteractiveList: transports.sendInteractiveList,
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: transports.supabaseAdmin,
}));

import {
  AUTOMATION_SEND_CAPABILITY_ERROR,
  engineSendInteractive,
  engineSendTemplate,
  engineSendText,
} from './meta-send';

const sendArgs = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
};

const scenarios = [
  {
    name: 'text',
    run: () => engineSendText({ ...sendArgs, text: 'Fixture text' }),
  },
  {
    name: 'template',
    run: () =>
      engineSendTemplate({ ...sendArgs, templateName: 'fixture_template' }),
  },
  {
    name: 'interactive',
    run: () =>
      engineSendInteractive({
        ...sendArgs,
        payload: {
          kind: 'buttons',
          body: 'Fixture body',
          buttons: [{ id: 'choice', title: 'Continue' }],
        },
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

describe('automation send capability gate', () => {
  it.each(scenarios)(
    'fails closed for $name before any persistence or transport',
    async ({ run }) => {
      await expect(run()).rejects.toMatchObject({
        name: 'AutomationSendCapabilityError',
        message: AUTOMATION_SEND_CAPABILITY_ERROR,
      });

      expect(transports.supabaseAdmin).not.toHaveBeenCalled();
      expect(transports.sendText).not.toHaveBeenCalled();
      expect(transports.sendTemplate).not.toHaveBeenCalled();
      expect(transports.sendInteractiveButtons).not.toHaveBeenCalled();
      expect(transports.sendInteractiveList).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
