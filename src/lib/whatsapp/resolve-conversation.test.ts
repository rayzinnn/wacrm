import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { resolveConversationByPhone } from './resolve-conversation';
import { SendMessageError } from './send-message';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table. Terminal methods
// (maybeSingle/single) resolve to configured data; the builder
// itself is thenable so an awaited `update().eq()` resolves cleanly.
// ------------------------------------------------------------
type ContactRow = { id: string; phone: string; name?: string | null };

interface Script {
  evolutionConnection?: {
    id: string;
    account_id: string;
    created_by: string;
    provider: 'evolution';
  } | null; // whatsapp_connections.maybeSingle
  contactCandidates?: ContactRow[];
  /** Per-call results — overrides contactCandidates. Lets a
   *  test simulate "miss, then hit" for the unique-race path. */
  contactCandidatesByCall?: ContactRow[][];
  insertedContactId?: string; // contacts insert -> single
  insertContactError?: { code?: string } | null;
  /** Conversation lookup result (oldest-first `.order().limit(1)`).
   *  A single row or null; wrapped into a one-element array internally. */
  existingConversation?: { id: string } | null; // conversations select.limit(1)
  /** Per-call conversation lookup results — overrides existingConversation.
   *  Lets a test simulate "miss, then hit" for the unique-race path. */
  existingConversationByCall?: (({ id: string } | null))[];
  insertedConversationId?: string; // conversations insert -> single
  insertConversationError?: { code?: string } | null;
  updatedTables?: string[];
  queryFilters?: Array<[string, string, unknown]>;
  insertedRows?: Array<{ table: string; values: Record<string, unknown> }>;
}

function makeDb(script: Script): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';
  let contactLookupCalls = 0;
  let convLookupCalls = 0;
  script.queryFilters ??= [];
  script.insertedRows ??= [];

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (values: Record<string, unknown>) => {
      mode = 'insert';
      script.insertedRows?.push({ table, values });
      return builder;
    },
    update: () => {
      mode = 'update';
      script.updatedTables?.push(table);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      script.queryFilters?.push([table, column, value]);
      return builder;
    },
    order: () => builder,
    limit: () => {
      // Only the conversation lookup terminates on `.limit(1)`.
      if (table === 'conversations' && mode === 'select') {
        const row = script.existingConversationByCall
          ? (script.existingConversationByCall[convLookupCalls] ?? null)
          : (script.existingConversation ?? null);
        convLookupCalls++;
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    in: () => {
      const data = script.contactCandidatesByCall
        ? (script.contactCandidatesByCall[contactLookupCalls] ?? [])
        : (script.contactCandidates ?? []);
      contactLookupCalls++;
      return Promise.resolve({ data, error: null });
    },
    maybeSingle: () => {
      if (table === 'whatsapp_connections')
        return Promise.resolve({
          data:
            script.evolutionConnection?.account_id ===
              script.queryFilters?.find(
                ([filterTable, column]) =>
                  filterTable === 'whatsapp_connections' && column === 'account_id'
              )?.[2] &&
            script.evolutionConnection?.provider ===
              script.queryFilters?.find(
                ([filterTable, column]) =>
                  filterTable === 'whatsapp_connections' && column === 'provider'
              )?.[2]
              ? script.evolutionConnection
              : null,
          error: null,
        });
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'contacts' && mode === 'insert') {
        if (script.insertContactError)
          return Promise.resolve({
            data: null,
            error: script.insertContactError,
          });
        return Promise.resolve({
          data: { id: script.insertedContactId },
          error: null,
        });
      }
      if (table === 'conversations' && mode === 'insert') {
        if (script.insertConversationError)
          return Promise.resolve({
            data: null,
            error: script.insertConversationError,
          });
        return Promise.resolve({
          data: { id: script.insertedConversationId },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Thenable: `await db.from().update().eq()` lands here.
    then: (resolve: (v: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null }),
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveConversationByPhone', () => {
  it('rejects an invalid phone before any DB call', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    await expect(
      resolveConversationByPhone(db, 'acct', 'not-a-phone')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('rejects a national-format number (no leading +) before any DB call (#586)', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    // Would otherwise be sent to +41 55 555 12 12 (Switzerland) and
    // reported as a successful send.
    await expect(
      resolveConversationByPhone(db, 'acct', '4155551212')
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    // Digits with a country code but no `+` are indistinguishable from
    // the above, so they are refused as well.
    await expect(
      resolveConversationByPhone(db, 'acct', '14155550123')
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('fails with whatsapp_not_configured when no Evolution connection exists', async () => {
    const db = makeDb({ evolutionConnection: null });
    await resolveConversationByPhone(db, 'acct', '+14155550123').catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured');
        expect(e.status).toBe(400);
      }
    );
    await expect(
      resolveConversationByPhone(db, 'acct', '+14155550123')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('isolates the Evolution connection by account and provider', async () => {
    const connection = {
      id: 'connection-a',
      account_id: 'account-a',
      created_by: 'owner-a',
      provider: 'evolution' as const,
    };
    const accountAScript = {
      evolutionConnection: connection,
      contactCandidates: [{ id: 'contact-a', phone: '14155550123' }],
      existingConversation: { id: 'conversation-a' },
      queryFilters: [] as Array<[string, string, unknown]>,
    };
    const accountA = makeDb(accountAScript);
    await expect(
      resolveConversationByPhone(accountA, 'account-a', '+14155550123')
    ).resolves.toMatchObject({ conversationId: 'conversation-a' });
    expect(accountAScript.queryFilters).toContainEqual([
      'whatsapp_connections',
      'account_id',
      'account-a',
    ]);
    expect(accountAScript.queryFilters).toContainEqual([
      'whatsapp_connections',
      'provider',
      'evolution',
    ]);

    const accountBScript = { evolutionConnection: connection, insertedRows: [] };
    const accountB = makeDb(accountBScript);
    await expect(
      resolveConversationByPhone(accountB, 'account-b', '+14155550123')
    ).rejects.toMatchObject({
      code: 'whatsapp_not_configured',
      status: 400,
    });
    expect(accountBScript.insertedRows).toEqual([]);
  });

  it('returns the existing contact + conversation without creating', async () => {
    const db = makeDb({
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversation: { id: 'cv1' },
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+1 (415) 555-0123'
    );
    expect(res).toEqual({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
      conversationCreated: false,
    });
  });

  it('creates contact + conversation when none exist', async () => {
    const script = {
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' as const },
      contactCandidates: [],
      insertedContactId: 'c2',
      existingConversation: null,
      insertedConversationId: 'cv2',
    };
    const db = makeDb(script);
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+14155550199',
      'Jane'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c2',
      contactCreated: true,
      conversationCreated: true,
    });
    expect(script.insertedRows).toEqual(
      expect.arrayContaining([
        {
          table: 'contacts',
          values: expect.objectContaining({
            account_id: 'acct',
            user_id: 'owner-1',
          }),
        },
        {
          table: 'conversations',
          values: expect.objectContaining({
            account_id: 'acct',
            user_id: 'owner-1',
          }),
        },
      ])
    );
  });

  it('never renames an existing contact when a name is passed', async () => {
    const updatedTables: string[] = [];
    const db = makeDb({
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' },
      contactCandidates: [{ id: 'c1', phone: '14155550123', name: 'Jane Doe' }],
      existingConversation: { id: 'cv1' },
      updatedTables,
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+14155550123',
      'Somebody Else'
    );
    expect(res.contactId).toBe('c1');
    expect(updatedTables).toEqual([]);
  });

  it('reports a newly created conversation for an existing contact', async () => {
    const db = makeDb({
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversation: null,
      insertedConversationId: 'cv-new',
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res).toEqual({
      conversationId: 'cv-new',
      contactId: 'c1',
      contactCreated: false,
      conversationCreated: true,
    });
  });

  it('re-resolves an existing contact when the insert loses a unique race', async () => {
    // First lookup misses (→ we attempt an insert), the insert hits a
    // 23505 unique violation, and the post-race re-lookup now returns
    // the row a concurrent writer created.
    const db = makeDb({
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' },
      contactCandidatesByCall: [[], [{ id: 'c-raced', phone: '14155550123' }]],
      insertContactError: { code: '23505' },
      existingConversation: { id: 'cv-raced' },
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res.contactId).toBe('c-raced');
    expect(res.contactCreated).toBe(false);
    expect(res.conversationId).toBe('cv-raced');
    expect(res.conversationCreated).toBe(false);
  });

  it('re-resolves the conversation when the insert loses a unique race', async () => {
    // Existing contact, conversation lookup misses first (→ attempt an
    // insert), the insert hits a 23505 from a concurrent create, and the
    // post-race re-lookup returns the winning conversation — no duplicate
    // conversation is created (issue #363).
    const db = makeDb({
      evolutionConnection: { id: 'connection-1', account_id: 'acct', created_by: 'owner-1', provider: 'evolution' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversationByCall: [null, { id: 'cv-raced' }],
      insertConversationError: { code: '23505' },
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res).toEqual({
      conversationId: 'cv-raced',
      contactId: 'c1',
      contactCreated: false,
      conversationCreated: false,
    });
  });
});
