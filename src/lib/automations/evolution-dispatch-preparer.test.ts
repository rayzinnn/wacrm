import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown> | null>,
  queries: [] as { table: string; filters: [string, unknown][] }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  startData: undefined as unknown,
  startError: null as { code?: string; message: string } | null,
  completeData: undefined as unknown,
  completeError: null as { code?: string; message: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          h.queries.push({ table, filters: [...filters] });
          const row = h.tables[table];
          return {
            data:
              row && filters.every(([column, value]) => row[column] === value)
                ? row
                : null,
            error: null,
          };
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      if (name === 'start_evolution_event_dispatch') {
        return { data: h.startData, error: h.startError };
      }
      return { data: h.completeData, error: h.completeError };
    },
  }),
}));

import { prepareEvolutionAutomationDispatch } from './evolution-dispatch-preparer';

const DISPATCH_ID = '00000000-0000-4000-8000-000000000001';
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const EVENT_ID = '00000000-0000-4000-8000-000000000004';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000005';
const USER_ID = '00000000-0000-4000-8000-000000000006';
const CONTACT_ID = '00000000-0000-4000-8000-000000000007';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000008';
const CONNECTION_ID = '00000000-0000-4000-8000-000000000009';
const LOG_ID = '00000000-0000-4000-8000-000000000010';

function reservedRoot() {
  return {
    id: DISPATCH_ID,
    event_id: EVENT_ID,
    account_id: ACCOUNT_ID,
    engine: 'automation',
    automation_id: AUTOMATION_ID,
    flow_id: null,
    ai_config_id: null,
    user_id: USER_ID,
    contact_id: CONTACT_ID,
    conversation_id: CONVERSATION_ID,
    automation_log_id: null,
    state: 'processing',
    lease_until: new Date(Date.now() + 60_000).toISOString(),
    lease_token: LEASE_TOKEN,
  };
}

function normalizedEvent() {
  return {
    kind: 'message',
    eventKey: 'synthetic-event',
    externalMessageId: 'synthetic-message',
    peer: '15551234567@s.whatsapp.net',
    occurredAt: '2026-11-16T10:00:00.000Z',
    fromMe: false,
    sentByApi: false,
    contentType: 'text',
    text: 'Hello, I need help',
    mediaRef: null,
  };
}

function input(isFirstInbound?: boolean) {
  return {
    dispatch_id: DISPATCH_ID,
    lease_token: LEASE_TOKEN,
    account_id: ACCOUNT_ID,
    isFirstInbound,
  };
}

beforeEach(() => {
  h.tables = {
    evolution_event_dispatches: reservedRoot(),
    evolution_events: {
      id: EVENT_ID,
      connection_id: CONNECTION_ID,
      state: 'done',
      normalized_event: normalizedEvent(),
    },
    whatsapp_connections: {
      id: CONNECTION_ID,
      account_id: ACCOUNT_ID,
      provider: 'evolution',
    },
    automations: {
      id: AUTOMATION_ID,
      account_id: ACCOUNT_ID,
      user_id: USER_ID,
      trigger_type: 'keyword_match',
      trigger_config: { keywords: ['help'], match_type: 'contains' },
      is_active: true,
    },
  };
  h.queries = [];
  h.rpcCalls = [];
  h.startData = [
    {
      dispatch_id: DISPATCH_ID,
      automation_log_id: LOG_ID,
      flow_run_id: null,
      state: 'processing',
    },
  ];
  h.startError = null;
  h.completeData = { id: DISPATCH_ID, state: 'skipped' };
  h.completeError = null;
});

describe('prepareEvolutionAutomationDispatch', () => {
  it('starts a reserved root and returns same-account inbound text context', async () => {
    const prepared = await prepareEvolutionAutomationDispatch(input());

    expect(prepared).toMatchObject({
      state: 'ready',
      context: {
        dispatch: {
          id: DISPATCH_ID,
          lease_token: LEASE_TOKEN,
          account_id: ACCOUNT_ID,
          automation_id: AUTOMATION_ID,
          user_id: USER_ID,
          contact_id: CONTACT_ID,
          conversation_id: CONVERSATION_ID,
          automation_log_id: LOG_ID,
        },
        event: {
          id: EVENT_ID,
          external_message_id: 'synthetic-message',
          text: 'Hello, I need help',
        },
        automation: {
          id: AUTOMATION_ID,
          account_id: ACCOUNT_ID,
          trigger_type: 'keyword_match',
        },
      },
    });
    expect(h.rpcCalls).toEqual([
      {
        name: 'start_evolution_event_dispatch',
        args: { p_dispatch_id: DISPATCH_ID, p_lease_token: LEASE_TOKEN },
      },
    ]);
    expect(h.queries.map((query) => query.table)).toEqual([
      'evolution_event_dispatches',
      'evolution_events',
      'whatsapp_connections',
      'automations',
    ]);
    expect(h.queries.at(-1)?.filters).toEqual([
      ['id', AUTOMATION_ID],
      ['account_id', ACCOUNT_ID],
    ]);
  });

  it('resumes an already-started root without rechecking eligibility', async () => {
    h.tables.evolution_event_dispatches = {
      ...h.tables.evolution_event_dispatches,
      automation_log_id: LOG_ID,
    };
    h.tables.automations = {
      ...h.tables.automations,
      is_active: false,
      trigger_config: { keywords: ['no longer matches'], match_type: 'exact' },
    };

    const prepared = await prepareEvolutionAutomationDispatch(input());

    expect(prepared.state).toBe('ready');
    expect(h.rpcCalls.map((call) => call.name)).toEqual([
      'start_evolution_event_dispatch',
    ]);
  });

  it('completes a nonmatching trigger as skipped without preparing execution', async () => {
    h.tables.automations = {
      ...h.tables.automations,
      trigger_config: { keywords: ['billing'], match_type: 'exact' },
    };

    const prepared = await prepareEvolutionAutomationDispatch(input());

    expect(prepared).toEqual({
      state: 'skipped',
      dispatch_id: DISPATCH_ID,
      reason: 'trigger_not_eligible',
    });
    expect(h.rpcCalls.map((call) => call.name)).toEqual([
      'complete_evolution_dispatch',
    ]);
    expect(h.rpcCalls[0]).toEqual({
      name: 'complete_evolution_dispatch',
      args: {
        p_dispatch_id: DISPATCH_ID,
        p_lease_token: LEASE_TOKEN,
        p_state: 'skipped',
        p_result: null,
        p_error_code: null,
      },
    });
  });

  it('requires an explicit first-inbound flag', async () => {
    h.tables.automations = {
      ...h.tables.automations,
      trigger_type: 'first_inbound_message',
      trigger_config: {},
    };

    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).resolves.toMatchObject({
      state: 'skipped',
      reason: 'trigger_not_eligible',
    });
    h.rpcCalls = [];
    await expect(
      prepareEvolutionAutomationDispatch(input(true))
    ).resolves.toMatchObject({
      state: 'ready',
    });
  });

  it('preserves a skipped result returned by the idempotent start RPC', async () => {
    h.startData = [
      {
        dispatch_id: DISPATCH_ID,
        automation_log_id: null,
        flow_run_id: null,
        state: 'skipped',
      },
    ];

    await expect(prepareEvolutionAutomationDispatch(input())).resolves.toEqual({
      state: 'skipped',
      dispatch_id: DISPATCH_ID,
      reason: 'already_skipped',
    });
    expect(h.queries).toHaveLength(4);
    expect(h.rpcCalls.map((call) => call.name)).toEqual([
      'start_evolution_event_dispatch',
    ]);
  });

  it('fails closed before start for a non-automation, stale, or mismatched root', async () => {
    h.tables.evolution_event_dispatches = { ...reservedRoot(), engine: 'flow' };
    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).rejects.toMatchObject({
      code: 'root_lineage_invalid',
    });
    expect(h.rpcCalls).toHaveLength(0);

    h.tables.evolution_event_dispatches = {
      ...reservedRoot(),
      lease_token: USER_ID,
    };
    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).rejects.toMatchObject({
      code: 'root_lineage_invalid',
    });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('fails closed when event connection or automation tenant lineage differs', async () => {
    h.tables.whatsapp_connections = {
      id: CONNECTION_ID,
      account_id: USER_ID,
      provider: 'evolution',
    };
    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).rejects.toMatchObject({
      code: 'connection_lineage_invalid',
    });
    expect(h.rpcCalls).toHaveLength(0);

    h.rpcCalls = [];
    h.tables.whatsapp_connections = {
      id: CONNECTION_ID,
      account_id: ACCOUNT_ID,
      provider: 'evolution',
    };
    h.tables.automations = {
      ...h.tables.automations,
      account_id: USER_ID,
    };
    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).rejects.toMatchObject({
      code: 'automation_load_failed',
    });
  });

  it('keeps the root fenced when start reports a stale lease', async () => {
    h.startError = { code: '55000', message: 'expired' };

    await expect(
      prepareEvolutionAutomationDispatch(input())
    ).rejects.toMatchObject({
      code: 'stale_lease',
    });
    expect(h.queries).toHaveLength(4);
    expect(h.rpcCalls.map((call) => call.name)).toEqual([
      'start_evolution_event_dispatch',
    ]);
  });
});
