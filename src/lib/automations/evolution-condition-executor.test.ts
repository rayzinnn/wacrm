import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as {
    name: string;
    args?: Record<string, unknown>;
    table?: string;
    filters?: [string, unknown][];
  }[],
  root: null as Record<string, unknown> | null,
  claim: null as Record<string, unknown> | null,
  claimError: null as { code?: string; message: string } | null,
  persisted: null as Record<string, unknown> | null,
  ledger: null as Record<string, unknown> | null,
  event: null as Record<string, unknown> | null,
  contactOwned: true,
  tagCount: 1 as number | null,
  completed: null as Record<string, unknown> | null,
  completeError: null as { code?: string; message: string } | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args });
      if (name === 'claim_evolution_dispatch_step') {
        return { data: h.claim ? [h.claim] : null, error: h.claimError };
      }
      if (h.ledger) {
        h.ledger.state = String(args.p_state);
        h.ledger.result = args.p_result ?? null;
      }
      return {
        data: h.completed ? [h.completed] : null,
        error: h.completeError,
      };
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          h.calls.push({ name: 'select', table, filters });
          if (table === 'evolution_event_dispatches')
            return { data: h.root, error: null };
          if (table === 'evolution_events')
            return { data: h.event, error: null };
          if (table === 'contacts') {
            return {
              data: h.contactOwned ? { id: CONTACT_ID } : null,
              error: null,
            };
          }
          if (table === 'automation_steps')
            return { data: h.persisted, error: null };
          if (table === 'evolution_dispatch_steps') {
            return { data: h.ledger, error: null };
          }
          return { data: null, error: null };
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown
        ) => {
          h.calls.push({ name: 'select', table, filters });
          return Promise.resolve({ count: h.tagCount, error: null }).then(
            resolve,
            reject
          );
        },
      };
      return query;
    },
  }),
}));

import { executeEvolutionAutomationCondition } from './evolution-condition-executor';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_TOKEN = '00000000-0000-4000-8000-000000000002';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const CONTACT_ID = '00000000-0000-4000-8000-000000000004';
const AUTOMATION_ID = '00000000-0000-4000-8000-000000000005';
const ACTION_KEY = '00000000-0000-4000-8000-000000000006';
const DISPATCH_STEP_ID = '00000000-0000-4000-8000-000000000007';
const STEP_TOKEN = '00000000-0000-4000-8000-000000000008';
const NOW = new Date(Date.now() + 60_000).toISOString();

function input() {
  return {
    root: { id: ROOT_ID, lease_token: ROOT_TOKEN, account_id: ACCOUNT_ID },
    step: { id: ACTION_KEY },
  };
}

function claim(
  should_execute: boolean,
  state = should_execute ? 'processing' : 'done'
) {
  h.claim = {
    step_id: DISPATCH_STEP_ID,
    state,
    lease_token: should_execute ? STEP_TOKEN : null,
    request_id: `evolution-step:${DISPATCH_STEP_ID}`,
    send_attempt_id: null,
    should_execute,
  };
  h.ledger = {
    id: DISPATCH_STEP_ID,
    dispatch_id: ROOT_ID,
    action_key: ACTION_KEY,
    state,
    lease_token: should_execute ? STEP_TOKEN : null,
    request_id: `evolution-step:${DISPATCH_STEP_ID}`,
    send_attempt_id: null,
    result: null,
  };
}

function completed(state: string, result: unknown = null) {
  h.completed = { id: DISPATCH_STEP_ID, state, result };
}

beforeEach(() => {
  h.calls = [];
  h.root = {
    id: ROOT_ID,
    event_id: '00000000-0000-4000-8000-000000000010',
    account_id: ACCOUNT_ID,
    engine: 'automation',
    automation_id: AUTOMATION_ID,
    contact_id: CONTACT_ID,
    state: 'processing',
    lease_until: NOW,
    lease_token: ROOT_TOKEN,
  };
  h.claim = null;
  h.claimError = null;
  h.ledger = null;
  h.event = {
    id: '00000000-0000-4000-8000-000000000010',
    state: 'done',
    normalized_event: {
      kind: 'message',
      contentType: 'text',
      fromMe: false,
      sentByApi: false,
      text: 'persisted text',
    },
  };
  h.contactOwned = true;
  h.persisted = {
    id: ACTION_KEY,
    automation_id: AUTOMATION_ID,
    step_type: 'condition',
    step_config: {
      subject: 'tag_presence',
      operand: '00000000-0000-4000-8000-000000000009',
    },
  };
  h.tagCount = 1;
  h.completed = null;
  h.completeError = null;
});

describe('executeEvolutionAutomationCondition', () => {
  it.each([
    [1, 'yes'],
    [0, 'no'],
  ])('persists the exact %s condition branch', async (count, branch) => {
    claim(true);
    h.tagCount = count;
    completed('done', { branch });

    const result = await executeEvolutionAutomationCondition(input());

    expect(result).toMatchObject({
      executed: true,
      step_id: DISPATCH_STEP_ID,
      action_key: ACTION_KEY,
      state: 'done',
      branch,
      result: { branch },
    });
    expect(
      h.calls.find((call) => call.name === 'claim_evolution_dispatch_step')
    ).toMatchObject({
      args: { p_action_key: ACTION_KEY },
    });
    expect(
      h.calls.find((call) => call.name === 'complete_evolution_dispatch_step')
    ).toMatchObject({
      args: {
        p_step_id: DISPATCH_STEP_ID,
        p_dispatch_lease_token: ROOT_TOKEN,
        p_lease_token: STEP_TOKEN,
        p_state: 'done',
        p_result: { branch },
      },
    });
  });

  it('replays the stored branch without reading configuration or reevaluating', async () => {
    claim(false);
    h.ledger!.result = { branch: 'no' };

    const result = await executeEvolutionAutomationCondition(input());

    expect(result).toMatchObject({
      executed: false,
      step_id: DISPATCH_STEP_ID,
      action_key: ACTION_KEY,
      branch: 'no',
    });
    expect(h.calls.some((call) => call.table === 'automation_steps')).toBe(
      false
    );
    expect(h.calls.some((call) => call.table === 'contact_tags')).toBe(false);
    expect(
      h.calls.some((call) => call.name === 'complete_evolution_dispatch_step')
    ).toBe(false);
  });

  it('uses persisted inbound text instead of forged caller context', async () => {
    claim(true);
    completed('done', { branch: 'no' });
    h.persisted = {
      id: ACTION_KEY,
      automation_id: AUTOMATION_ID,
      step_type: 'condition',
      step_config: { subject: 'message_content', value: 'correct' },
    };

    const forgedInput = {
      ...input(),
      context: { message_text: 'this correct text is forged by the caller' },
    } as Parameters<typeof executeEvolutionAutomationCondition>[0];
    const result = await executeEvolutionAutomationCondition(forgedInput);

    expect(result).toMatchObject({
      executed: true,
      state: 'done',
      branch: 'no',
    });
    expect(
      h.calls.find((call) => call.table === 'evolution_events')
    ).toMatchObject({
      filters: [['id', '00000000-0000-4000-8000-000000000010']],
    });
  });

  it('fails closed without counting tags for a contact owned by another account', async () => {
    claim(true);
    completed('failed');
    h.contactOwned = false;

    const result = await executeEvolutionAutomationCondition(input());

    expect(result).toMatchObject({
      executed: false,
      state: 'failed',
      error_code: 'condition_contact_lineage_invalid',
    });
    expect(h.calls.some((call) => call.table === 'contact_tags')).toBe(false);
  });

  it('does not evaluate after a stale root claim', async () => {
    h.claimError = { code: '55000', message: 'stale root' };

    await expect(
      executeEvolutionAutomationCondition(input())
    ).rejects.toMatchObject({
      code: 'stale_lease',
    });
    expect(h.calls.some((call) => call.table === 'contact_tags')).toBe(false);
  });

  it('fails and checkpoints invalid persisted condition configuration', async () => {
    claim(true);
    completed('failed');
    h.persisted = {
      id: ACTION_KEY,
      automation_id: AUTOMATION_ID,
      step_type: 'condition',
      step_config: { subject: 'unknown' },
    };

    const result = await executeEvolutionAutomationCondition(input());

    expect(result).toMatchObject({
      executed: false,
      state: 'failed',
      error_code: 'condition_config_invalid',
    });
    expect(
      h.calls.find((call) => call.name === 'complete_evolution_dispatch_step')
    ).toMatchObject({
      args: {
        p_state: 'failed',
        p_result: null,
        p_error_code: 'condition_config_invalid',
      },
    });
  });

  it('fails closed when the persisted event is not inbound text', async () => {
    claim(true);
    completed('failed');
    h.persisted = {
      id: ACTION_KEY,
      automation_id: AUTOMATION_ID,
      step_type: 'condition',
      step_config: { subject: 'message_content', value: 'hello' },
    };
    h.event!.normalized_event = {
      ...((h.event!.normalized_event as Record<string, unknown>) ?? {}),
      fromMe: true,
    };

    const result = await executeEvolutionAutomationCondition(input());

    expect(result).toMatchObject({
      executed: false,
      state: 'failed',
      error_code: 'condition_context_invalid',
    });
    expect(h.calls.some((call) => call.table === 'contact_tags')).toBe(false);
  });

  it('surfaces a stale step completion without changing its branch', async () => {
    claim(true);
    h.completeError = { code: '55000', message: 'stale step' };

    await expect(
      executeEvolutionAutomationCondition(input())
    ).rejects.toMatchObject({
      code: 'stale_lease',
    });
  });
});
