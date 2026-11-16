import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as {
    kind: 'rpc' | 'query';
    name: string;
    args?: Record<string, unknown>;
    filters?: [string, unknown][];
  }[],
  rows: {} as Record<string, unknown>,
  claim: null as Record<string, unknown> | null,
  rpcError: null as { code?: string; message: string } | null,
  completion: null as Record<string, unknown> | null,
  completionError: null as { code?: string; message: string } | null,
  send: vi.fn(),
  decrypt: vi.fn(() => 'decrypted-test-token'),
  allowOrigin: vi.fn((value: string) => value),
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
          mocks.calls.push({ kind: 'query', name: table, filters });
          return { data: mocks.rows[table] ?? null, error: null };
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.calls.push({ kind: 'rpc', name, args });
      if (name === 'claim_evolution_dispatch_step') {
        return {
          data: mocks.claim ? [mocks.claim] : null,
          error: mocks.rpcError,
        };
      }
      return {
        data: mocks.completion ? [mocks.completion] : null,
        error: mocks.completionError,
      };
    },
  }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/whatsapp/evolution/client', () => ({
  assertAllowedEvolutionOrigin: mocks.allowOrigin,
}));
vi.mock('@/lib/whatsapp/evolution/send-adapter', () => ({
  createEvolutionSendAdapter: () => mocks.send,
}));

import { executeEvolutionAutomationSendMessage } from './evolution-send-message-executor';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_TOKEN = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const EVENT_ID = '00000000-0000-4000-8000-000000000004';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000005';
const ACTION_KEY = '00000000-0000-4000-8000-000000000006';
const LEDGER_STEP_ID = '00000000-0000-4000-8000-000000000007';
const STEP_TOKEN = '00000000-0000-4000-8000-000000000008';
const USER_ID = '00000000-0000-4000-8000-000000000009';
const CONTACT_ID = '00000000-0000-4000-8000-000000000010';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000011';
const CONNECTION_ID = '00000000-0000-4000-8000-000000000012';
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000013';
const MESSAGE_ROW_ID = '00000000-0000-4000-8000-000000000014';
const RECIPIENT = '15551234567@s.whatsapp.net';
const REQUEST_ID = `evolution-step:${LEDGER_STEP_ID}`;

const input = {
  root: { id: ROOT_ID, lease_token: ROOT_TOKEN, account_id: ACCOUNT_ID },
  step: { id: ACTION_KEY },
};

function claim(
  shouldExecute: boolean,
  state = shouldExecute ? 'processing' : 'done',
  attemptId: string | null = null
) {
  mocks.claim = {
    step_id: LEDGER_STEP_ID,
    state,
    lease_token: shouldExecute || state === 'processing' ? STEP_TOKEN : null,
    request_id: REQUEST_ID,
    send_attempt_id: attemptId,
    should_execute: shouldExecute,
  };
  mocks.rows.evolution_dispatch_steps = {
    id: LEDGER_STEP_ID,
    dispatch_id: ROOT_ID,
    action_key: ACTION_KEY,
    state,
    lease_token: shouldExecute || state === 'processing' ? STEP_TOKEN : null,
    request_id: REQUEST_ID,
    send_attempt_id: attemptId,
  };
}

function sendResult(
  outcome: 'pending' | 'accepted' | 'rejected' | 'unknown',
  shouldSend: boolean
) {
  mocks.send.mockResolvedValue({
    attemptId: ATTEMPT_ID,
    messageRowId: MESSAGE_ROW_ID,
    outcome,
    shouldSend,
    externalMessageId: outcome === 'accepted' ? 'remote-message-1' : null,
    persistenceUncertain: outcome === 'unknown',
  });
}

function complete(state: string, attemptId: string | null = ATTEMPT_ID) {
  mocks.completion = { id: LEDGER_STEP_ID, state, send_attempt_id: attemptId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls = [];
  mocks.rpcError = null;
  mocks.completionError = null;
  mocks.completion = null;
  mocks.rows = {
    evolution_event_dispatches: {
      id: ROOT_ID,
      event_id: EVENT_ID,
      account_id: ACCOUNT_ID,
      engine: 'automation',
      automation_id: AUTOMATION_ID,
      user_id: USER_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      state: 'processing',
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      lease_token: ROOT_TOKEN,
    },
    evolution_events: {
      id: EVENT_ID,
      connection_id: CONNECTION_ID,
      state: 'done',
      normalized_event: {
        kind: 'message',
        contentType: 'text',
        fromMe: false,
        sentByApi: false,
        peer: RECIPIENT,
      },
    },
    conversations: {
      id: CONVERSATION_ID,
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
    },
    contacts: {
      id: CONTACT_ID,
      account_id: ACCOUNT_ID,
      phone_normalized: '15551234567',
    },
    whatsapp_connections: {
      id: CONNECTION_ID,
      account_id: ACCOUNT_ID,
      provider: 'evolution',
      base_url: 'http://127.0.0.1:8080',
      instance_name: 'local-instance',
      token_encrypted: 'encrypted-test-token',
    },
    automation_steps: {
      id: ACTION_KEY,
      automation_id: AUTOMATION_ID,
      step_type: 'send_message',
      step_config: { text: 'Olá, cliente' },
    },
  };
  claim(true);
  mocks.send.mockReset();
  mocks.decrypt.mockReset().mockReturnValue('decrypted-test-token');
  mocks.allowOrigin.mockReset().mockImplementation((value: string) => value);
});

describe('executeEvolutionAutomationSendMessage', () => {
  it('reserves and completes an accepted text with the distinct ledger step ID', async () => {
    sendResult('accepted', true);
    complete('done');

    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      executed: true,
      step_id: LEDGER_STEP_ID,
      action_key: ACTION_KEY,
      request_id: REQUEST_ID,
      send_attempt_id: ATTEMPT_ID,
      message_row_id: MESSAGE_ROW_ID,
      outcome: 'accepted',
      state: 'done',
    });
    expect(mocks.send).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      conversationId: CONVERSATION_ID,
      recipient: RECIPIENT,
      text: 'Olá, cliente',
      credentials: {
        baseUrl: 'http://127.0.0.1:8080',
        instanceId: 'local-instance',
        token: 'decrypted-test-token',
      },
      senderType: 'bot',
      senderId: USER_ID,
      requestId: REQUEST_ID,
    });
    expect(
      mocks.calls.find((call) => call.name === 'claim_evolution_dispatch_step')
    ).toMatchObject({
      args: { p_action_key: ACTION_KEY },
    });
    expect(
      mocks.calls.find(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toMatchObject({
      args: {
        p_step_id: LEDGER_STEP_ID,
        p_dispatch_lease_token: ROOT_TOKEN,
        p_lease_token: STEP_TOKEN,
        p_request_id: REQUEST_ID,
        p_send_attempt_id: ATTEMPT_ID,
        p_state: 'done',
        p_result: null,
      },
    });
  });

  it('records a definitive rejection as failed with a sanitized code', async () => {
    sendResult('rejected', true);
    complete('failed');

    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      state: 'failed',
      outcome: 'rejected',
      error_code: 'provider_rejected',
    });
    expect(
      mocks.calls.find(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toMatchObject({
      args: {
        p_state: 'failed',
        p_error_code: 'provider_rejected',
        p_send_attempt_id: ATTEMPT_ID,
      },
    });
  });

  it('records an uncertain provider result as terminal unknown and never retries it', async () => {
    sendResult('unknown', true);
    complete('unknown');

    const first = await executeEvolutionAutomationSendMessage(input);
    expect(first).toMatchObject({ state: 'unknown', outcome: 'unknown' });

    claim(false, 'unknown', ATTEMPT_ID);
    mocks.calls = [];
    const replay = await executeEvolutionAutomationSendMessage(input);

    expect(replay).toMatchObject({
      executed: false,
      state: 'unknown',
      send_attempt_id: ATTEMPT_ID,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      mocks.calls.some(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toBe(false);
  });

  it('fails closed on a processing attempt that may belong to another worker', async () => {
    claim(false, 'processing', ATTEMPT_ID);

    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      executed: false,
      state: 'processing',
      send_attempt_id: ATTEMPT_ID,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      mocks.calls.some(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toBe(false);
  });

  it('does not invoke the adapter or completion for a terminal accepted replay', async () => {
    claim(false, 'done', ATTEMPT_ID);

    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      executed: false,
      state: 'done',
      send_attempt_id: ATTEMPT_ID,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      mocks.calls.some(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toBe(false);
  });

  it('fails the step without reserving or sending when the connection is outside the root account', async () => {
    complete('failed', null);
    mocks.rows.whatsapp_connections = {
      ...(mocks.rows.whatsapp_connections as Record<string, unknown>),
      account_id: '00000000-0000-4000-8000-000000000099',
    };

    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      state: 'failed',
      error_code: 'connection_lineage_invalid',
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      mocks.calls.find(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toMatchObject({
      args: { p_state: 'failed', p_error_code: 'connection_lineage_invalid' },
    });
  });

  it('fails closed on unvalidated interpolation in persisted text', async () => {
    mocks.rows.automation_steps = {
      ...(mocks.rows.automation_steps as Record<string, unknown>),
      step_config: { text: 'Olá {{ contact.name }}' },
    };

    complete('failed', null);
    const result = await executeEvolutionAutomationSendMessage(input);

    expect(result).toMatchObject({
      state: 'failed',
      error_code: 'interpolation_context_required',
    });
    expect(
      mocks.calls.find(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toMatchObject({
      args: {
        p_state: 'failed',
        p_error_code: 'interpolation_context_required',
      },
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('fences an uncertain reservation without authorizing a second transport call', async () => {
    mocks.send.mockRejectedValue(
      new Error('simulated reservation uncertainty')
    );
    complete('unknown');

    const first = await executeEvolutionAutomationSendMessage(input);

    expect(first).toMatchObject({
      state: 'unknown',
      error_code: 'send_result_unknown',
    });
    expect(
      mocks.calls.find(
        (call) => call.name === 'complete_evolution_dispatch_step'
      )
    ).toMatchObject({
      args: {
        p_state: 'unknown',
        p_send_attempt_id: null,
        p_request_id: REQUEST_ID,
      },
    });

    claim(false, 'unknown', ATTEMPT_ID);
    mocks.calls = [];
    const replay = await executeEvolutionAutomationSendMessage(input);

    expect(replay).toMatchObject({ executed: false, state: 'unknown' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
