import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for the `contact_id` send path (issue #296): sending an approved
// template to a single contact from the Contact detail view. The route must
// find-or-create the contact's conversation server-side, then run the normal
// send + persistence path — no inbound message required to bootstrap a thread.
// ---------------------------------------------------------------------------

// Records of what the route wrote, so we can assert the right rows landed.
const conversationInserts: Array<Record<string, unknown>> = [];
const messageInserts: Array<Record<string, unknown>> = [];

// Toggles for the per-test scenario.
let existingConversation: Record<string, unknown> | null = null;
let contactRow: Record<string, unknown> | null = null;
// The caller's role, as `requireRole` reads it off the profile. Sending
// requires 'agent'; 'viewer' must be refused before the send core runs.
let callerRole: string = 'admin';
let callerAuthenticated = true;
// A conversation created during the request becomes retrievable by id —
// the shared send core re-loads the conversation (with its contact) from
// just the id, so the mock must model insert-then-select-by-id.
let createdConversation: Record<string, unknown> | null = null;
let conversationCreatedConcurrently: Record<string, unknown> | null = null;

const CONTACT = {
  id: 'contact-1',
  account_id: 'acct-1',
  phone: '+15551234567',
};

// Chainable Supabase mock. A fresh builder per `.from()` call tracks whether
// `.insert()` ran so the terminal resolves to the inserted row for creates
// and the canned select row otherwise.
function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false;

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          };
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null };
        case 'contacts':
          return { data: contactRow, error: null };
        case 'conversations':
          // Once created this request, a by-id reload returns it (with
          // its contact); otherwise fall back to the canned existing row.
          return {
            data: createdConversation ?? existingConversation,
            error: null,
          };
        case 'whatsapp_config':
          return {
            data: {
              id: 'cfg-1',
              account_id: 'acct-1',
              phone_number_id: 'PNID-1',
              access_token: 'enc-token',
            },
            error: null,
          };
        case 'message_templates':
          return { data: null, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const insertResult = () => {
      switch (table) {
        case 'conversations':
          if (conversationCreatedConcurrently) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value' },
            };
          }
          return {
            data: {
              id: 'conv-new',
              account_id: 'acct-1',
              contact_id: 'contact-1',
              contact: CONTACT,
            },
            error: null,
          };
        case 'messages':
          return { data: { id: 'msg-1' }, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const terminal = () =>
      Promise.resolve(didInsert ? insertResult() : selectResult());

    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of [
      'select',
      'eq',
      'in',
      'order',
      'limit',
      'update',
      'delete',
    ]) {
      b[m] = vi.fn(chain);
    }
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true;
      if (table === 'conversations') {
        conversationInserts.push(payload);
        if (conversationCreatedConcurrently) {
          existingConversation = conversationCreatedConcurrently;
          return b;
        }
        createdConversation = {
          id: 'conv-new',
          account_id: 'acct-1',
          contact_id: 'contact-1',
          contact: CONTACT,
        };
      }
      if (table === 'messages') messageInserts.push(payload);
      return b;
    });
    b.single = vi.fn(terminal);
    b.maybeSingle = vi.fn(terminal);
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(didInsert ? insertResult() : selectResult());
    return b;
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: callerAuthenticated ? { id: 'user-1' } : null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  };
}

let supabaseMock = makeSupabaseMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

const sendCore = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/send-message')>()),
  sendMessageToConversation: sendCore,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['update', 'eq', 'select']) b[m] = vi.fn(chain);
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return b;
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}));

const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage,
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));

import { POST } from './route';

function postContactTemplate(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: 'contact-1',
        message_type: 'template',
        template_name: 'order_update',
        template_language: 'en_US',
        template_message_params: { body: ['Acme', '#1234'] },
        template_params: ['Acme', '#1234'],
        ...overrides,
      }),
    })
  );
}

function postContactText(requestId = 'dashboard-stable-request') {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId,
      },
      body: JSON.stringify({
        contact_id: 'contact-1',
        message_type: 'text',
        content_text: 'hello',
      }),
    })
  );
}

describe('POST /api/whatsapp/send — contact_id template path', () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = null;
    createdConversation = null;
    conversationCreatedConcurrently = null;
    contactRow = CONTACT;
    callerRole = 'admin';
    callerAuthenticated = true;
    supabaseMock = makeSupabaseMock();
    sendTemplateMessage.mockClear();
    sendCore.mockReset();
    sendCore.mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'remote-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a conversation for a contact with none, then sends text with the caller key', async () => {
    const res = await postContactText('stable-key-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.whatsapp_message_id).toBe('remote-1');

    // A conversation was created for this contact.
    expect(conversationInserts).toHaveLength(1);
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
    });

    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-new',
        senderId: 'user-1',
        requestId: 'stable-key-1',
      })
    );
    expect(messageInserts).toHaveLength(0);
  });

  it('requires an Idempotency-Key before creating a conversation', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: 'contact-1',
          message_type: 'text',
          content_text: 'hello',
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller before reading or creating a conversation', async () => {
    callerAuthenticated = false;
    const res = await postContactText();
    expect(res.status).toBe(401);
    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('returns 422 unsupported_capability for templates while Evolution is disabled', async () => {
    const res = await postContactTemplate();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'unsupported_capability',
      code: 'unsupported_capability',
      capability: 'template',
    });
    expect(conversationInserts).toHaveLength(0);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('preserves the caller-selected request id verbatim', async () => {
    const res = await postContactText('caller_key.with/punctuation');
    expect(res.status).toBe(200);
    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ requestId: 'caller_key.with/punctuation' })
    );
  });

  it('does not send a text request outside the caller account', async () => {
    contactRow = null;
    const res = await postContactText();
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toMatch(/contact not found/i);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('keeps the contact conversation reuse path', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    };
    const res = await postContactText();
    expect(res.status).toBe(200);
    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ conversationId: 'conv-existing' })
    );
  });

  it('keeps the concurrent conversation creation recovery path', async () => {
    conversationCreatedConcurrently = {
      id: 'conv-raced',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    };
    const res = await postContactText();
    expect(res.status).toBe(200);
    expect(conversationInserts).toHaveLength(1);
    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ conversationId: 'conv-raced' })
    );
  });

  it('keeps missing conversation/contact validation', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'stable-key-1',
        },
        body: JSON.stringify({ message_type: 'text', content_text: 'hello' }),
      })
    );
    expect(res.status).toBe(400);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('requires valid text content before conversation lookup', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'stable-key-1',
        },
        body: JSON.stringify({ contact_id: 'contact-1', message_type: 'text' }),
      })
    );
    expect(res.status).toBe(400);
    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('rate limits before parsing or creating a conversation', async () => {
    const { __resetRateLimitForTests, RATE_LIMITS } =
      await import('@/lib/rate-limit');
    __resetRateLimitForTests();
    for (let index = 0; index < RATE_LIMITS.send.limit; index++) {
      await POST(
        new Request('http://localhost/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      );
    }
    const limited = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(limited.status).toBe(429);
    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).not.toHaveBeenCalled();
    __resetRateLimitForTests();
  });

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    };

    const res = await postContactText();
    expect(res.status).toBe(200);

    expect(conversationInserts).toHaveLength(0);
    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ conversationId: 'conv-existing' })
    );
    expect(messageInserts).toHaveLength(0);
  });

  it('reuses the conversation a concurrent request created when the insert hits the unique index', async () => {
    conversationCreatedConcurrently = {
      id: 'conv-raced',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    };

    const res = await postContactText();
    expect(res.status).toBe(200);

    expect(conversationInserts).toHaveLength(1);
    expect(sendCore).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ conversationId: 'conv-raced' })
    );
    expect(messageInserts).toHaveLength(0);
  });

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null;

    const res = await postContactText();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/contact not found/i);
    expect(sendCore).not.toHaveBeenCalled();
  });

  it('400s when neither conversation_id nor contact_id is provided', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_type: 'template', template_name: 'x' }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/whatsapp/send — role enforcement', () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    };
    createdConversation = null;
    contactRow = CONTACT;
    callerRole = 'admin';
    callerAuthenticated = true;
    supabaseMock = makeSupabaseMock();
    sendTemplateMessage.mockClear();
    sendCore.mockReset();
    sendCore.mockResolvedValue({
      messageId: 'message-1',
      whatsappMessageId: 'remote-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a viewer with 403 and never reaches the send core', async () => {
    // A viewer is read-only (`canSendMessages`). The route used to resolve
    // account_id straight off the profile with no role check: RLS blocked
    // the message INSERT. The role gate must come before any outbound call.
    callerRole = 'viewer';

    const res = await postContactText();

    expect(res.status).toBe(403);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(sendCore).not.toHaveBeenCalled();
    expect(messageInserts).toHaveLength(0);
  });

  it('allows an agent through', async () => {
    callerRole = 'agent';

    const res = await postContactText();

    expect(res.status).toBe(200);
    expect(sendCore).toHaveBeenCalledTimes(1);
  });
});
