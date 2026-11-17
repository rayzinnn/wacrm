import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig, GenerateResult } from './types';
vi.mock('@/lib/whatsapp/evolution/send-adapter', () => ({
  createEvolutionSendAdapter: vi.fn(),
  createEvolutionSendReservationAdapter: vi.fn(),
}));
import {
  executeEvolutionAiReply,
  createSupabaseEvolutionAiReplyStore,
  type EvolutionAiReplyContext,
  type EvolutionAiReplyStore,
} from './evolution-reply-executor';

const config: AiConfig = {
  provider: 'openai',
  model: 'synthetic',
  baseUrl: null,
  apiKey: 'mock-only',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: true,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: 'agent-a',
  embeddingsApiKey: null,
};

const context: EvolutionAiReplyContext = {
  dispatchId: 'dispatch-1',
  leaseToken: 'root-lease',
  accountId: 'account-a',
  authorId: 'agent-a',
  connectionId: 'connection-a',
  conversationId: 'conversation-a',
  contactId: 'contact-a',
  externalMessageId: 'external-inbound',
  recipient: '15550000123@s.whatsapp.net',
  inboundText: 'hello',
  aiReplyCount: 0,
  autoReplyMax: 3,
  handoffAgentId: 'agent-a',
  assignedAgentId: null,
  aiReplyDisabled: false,
  config,
  messages: [{ role: 'user', content: 'hello' }],
  credentials: {
    baseUrl: 'http://127.0.0.1:8080',
    instanceId: 'synthetic',
    token: 'mock-only',
  },
};

const generated: GenerateResult = {
  text: 'Synthetic reply',
  handoff: false,
  usage: null,
};
const generationClaim = {
  step_id: 'generation-step',
  state: 'processing',
  lease_token: 'generation-lease',
  request_id: 'evolution-step:generation-step',
  result: null,
  should_generate: true,
  lease_acquired: true,
};
const sendClaim = {
  step_id: 'send-step',
  state: 'processing',
  lease_token: 'send-lease',
  request_id: 'evolution-step:send-step',
  send_attempt_id: null,
  should_execute: true,
  lease_acquired: true,
};

function makeStore(overrides: Partial<EvolutionAiReplyStore> = {}) {
  const store: EvolutionAiReplyStore = {
    load: vi.fn(async () => context),
    loadConfig: vi.fn(async () => config),
    hasDeterministicResponder: vi.fn(async () => false),
    isLatestInbound: vi.fn(async () => true),
    readGenerationStep: vi.fn(async () => null),
    claimGeneration: vi.fn(async () => generationClaim),
    readSendStep: vi.fn(async () => null),
    completeStep: vi.fn(async () => undefined),
    claimStep: vi.fn(async (_ctx, actionKey) =>
      actionKey === 'reply:send'
        ? sendClaim
        : {
            ...sendClaim,
            step_id: 'handoff-step',
            lease_token: 'handoff-lease',
            should_execute: true,
          }
    ),
    completeHandoff: vi.fn(async () => undefined),
    claimReplySlot: vi.fn(async () => true),
    send: vi.fn(async () => ({
      attemptId: 'send-attempt',
      messageRowId: 'message-row',
      outcome: 'accepted' as const,
      shouldSend: true,
      externalMessageId: 'external-outbound',
      persistenceUncertain: false,
    })),
    reconcileSend: vi.fn(async () => ({
      attemptId: 'send-attempt',
      messageRowId: 'message-row',
      outcome: 'accepted' as const,
      shouldSend: false,
    })),
    completeRoot: vi.fn(async () => undefined),
    ...overrides,
  };
  return store;
}

const deps = (
  store: EvolutionAiReplyStore,
  overrides: Record<string, unknown> = {}
) => ({
  store,
  generate: vi.fn(async () => generated),
  retrieve: vi.fn(async () => []),
  logUsage: vi.fn(async () => undefined),
  rateLimit: vi.fn(() => ({ success: true })),
  ...overrides,
});

describe('executeEvolutionAiReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checkpoints one generated reply and sends through the stable Evolution key as bot', async () => {
    const store = makeStore();
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('done');
    expect(dependencies.generate).toHaveBeenCalledTimes(1);
    expect(store.completeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: generationClaim.step_id,
        stepLeaseToken: generationClaim.lease_token,
        state: 'done',
        requestId: generationClaim.request_id,
        result: generated,
      })
    );
    expect(store.claimReplySlot).toHaveBeenCalledOnce();
    expect(store.send).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: sendClaim.request_id,
        senderType: 'bot',
        senderId: context.authorId,
        text: generated.text,
      })
    );
  });

  it('resumes a durable generation checkpoint despite changed mutable gates without another model call', async () => {
    const resumedContext = {
      ...context,
      assignedAgentId: 'human-now',
      config: null,
    };
    const store = makeStore({
      load: vi.fn(async () => resumedContext),
      readGenerationStep: vi.fn(async () => ({
        stepId: generationClaim.step_id,
        state: 'done',
        requestId: generationClaim.request_id,
        result: generated,
        hasSendAttempt: false,
      })),
      claimGeneration: vi.fn(async () => ({
        ...generationClaim,
        state: 'done',
        lease_token: null,
        should_generate: false,
        lease_acquired: false,
        result: generated,
      })),
    });
    const dependencies = deps(store, {
      rateLimit: vi.fn(() => ({ success: false })),
    });
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('done');
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(store.hasDeterministicResponder).not.toHaveBeenCalled();
    expect(store.loadConfig).not.toHaveBeenCalled();
    expect(store.send).toHaveBeenCalledOnce();
  });

  it('leaves a checkpointed root recoverable when a later database read fails', async () => {
    const store = makeStore({
      readGenerationStep: vi.fn(async () => ({
        stepId: generationClaim.step_id,
        state: 'done',
        requestId: generationClaim.request_id,
        result: generated,
        hasSendAttempt: false,
      })),
      claimGeneration: vi.fn(async () => ({
        ...generationClaim,
        state: 'done',
        lease_token: null,
        should_generate: false,
        lease_acquired: false,
        result: generated,
      })),
      readSendStep: vi.fn(async () => {
        throw Object.assign(new Error('synthetic db read failure'), {
          code: '08006',
        });
      }),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('in_progress');
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(store.completeRoot).not.toHaveBeenCalled();
  });

  it('does not generate after an interrupted generation claim becomes unknown', async () => {
    const store = makeStore({
      claimGeneration: vi.fn(async () => ({
        ...generationClaim,
        state: 'unknown',
        lease_token: null,
        should_generate: false,
        lease_acquired: false,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('unknown');
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(store.send).not.toHaveBeenCalled();
  });

  it('marks a generation failure unknown and never retries the model', async () => {
    const store = makeStore();
    const dependencies = deps(store, {
      generate: vi.fn(async () => {
        throw new Error('synthetic provider failure');
      }),
    });
    const input = {
      dispatchId: context.dispatchId,
      leaseToken: context.leaseToken,
    };
    await expect(executeEvolutionAiReply(input, dependencies)).resolves.toBe(
      'unknown'
    );
    expect(store.completeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'unknown',
        stepId: generationClaim.step_id,
        requestId: generationClaim.request_id,
      })
    );
    expect(store.completeRoot).toHaveBeenCalledWith(
      context,
      'unknown',
      'generation_outcome_unknown'
    );
  });

  it('skips before generation when the persisted per-conversation cap is reached', async () => {
    const capped = { ...context, aiReplyCount: context.autoReplyMax };
    const store = makeStore({ load: vi.fn(async () => capped) });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('skipped');
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(store.claimGeneration).not.toHaveBeenCalled();
    expect(store.claimReplySlot).not.toHaveBeenCalled();
  });

  it('fences the handoff and does not claim a reply slot or send', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        step_id: 'handoff-step',
        state: 'processing',
        lease_token: 'handoff-lease',
        request_id: 'evolution-step:handoff-step',
        should_execute: true,
        lease_acquired: true,
      })),
    });
    const dependencies = deps(store, {
      generate: vi.fn(async () => ({ text: '', handoff: true, usage: null })),
    });
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('done');
    expect(store.completeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        step: expect.objectContaining({
          step_id: 'handoff-step',
          lease_token: 'handoff-lease',
        }),
      })
    );
    expect(store.claimReplySlot).not.toHaveBeenCalled();
    expect(store.send).not.toHaveBeenCalled();
  });

  it('does not apply handoff without an owned generic step claim', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        step_id: 'handoff-step',
        state: 'processing',
        lease_token: null,
        request_id: 'evolution-step:handoff-step',
        should_execute: false,
        lease_acquired: false,
      })),
    });
    const dependencies = deps(store, {
      generate: vi.fn(async () => ({ text: '', handoff: true, usage: null })),
    });
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('in_progress');
    expect(store.completeHandoff).not.toHaveBeenCalled();
  });

  it('uses the generic claim contract and derives ownership only from processing plus should_execute', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ ...sendClaim, send_attempt_id: null }],
      error: null,
    }));
    const store = createSupabaseEvolutionAiReplyStore({
      rpc,
    } as unknown as SupabaseClient);
    const claim = await store.claimStep(context, 'reply:handoff');
    expect(rpc).toHaveBeenCalledWith('claim_evolution_dispatch_step', {
      p_dispatch_id: context.dispatchId,
      p_dispatch_lease_token: context.leaseToken,
      p_action_key: 'reply:handoff',
      p_lease_seconds: 60,
    });
    expect(claim.lease_acquired).toBe(true);

    rpc.mockResolvedValueOnce({
      data: [{ ...sendClaim, should_execute: false, send_attempt_id: null }],
      error: null,
    });
    const notOwned = await store.claimStep(context, 'reply:handoff');
    expect(notOwned.lease_acquired).toBe(false);
  });

  it('preserves send claim flags and linked attempt for reservation-only recovery', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          ...sendClaim,
          should_execute: false,
          send_attempt_id: 'attempt-linked',
        },
      ],
      error: null,
    }));
    const store = createSupabaseEvolutionAiReplyStore({
      rpc,
    } as unknown as SupabaseClient);
    const claim = await store.claimStep(context, 'reply:send');
    expect(rpc).toHaveBeenCalledWith('claim_evolution_dispatch_send_step', {
      p_dispatch_id: context.dispatchId,
      p_dispatch_lease_token: context.leaseToken,
      p_action_key: 'reply:send',
      p_lease_seconds: 60,
    });
    expect(claim).toMatchObject({
      state: 'processing',
      lease_acquired: true,
      should_execute: false,
      send_attempt_id: 'attempt-linked',
    });
  });

  it('reconciles a linked pending send reservation without posting again', async () => {
    const linkedClaim = {
      ...sendClaim,
      should_execute: false,
      send_attempt_id: 'send-attempt',
    };
    const store = makeStore({
      readGenerationStep: vi.fn(async () => ({
        stepId: generationClaim.step_id,
        state: 'done',
        requestId: generationClaim.request_id,
        result: generated,
        hasSendAttempt: false,
      })),
      claimGeneration: vi.fn(async () => ({
        ...generationClaim,
        state: 'done',
        lease_token: null,
        should_generate: false,
        lease_acquired: false,
        result: generated,
      })),
      readSendStep: vi.fn(async () => ({
        stepId: sendClaim.step_id,
        state: 'processing',
        requestId: sendClaim.request_id,
        result: null,
        hasSendAttempt: true,
      })),
      isLatestInbound: vi.fn(async () => false),
      claimReplySlot: vi.fn(async () => false),
      claimStep: vi.fn(async () => linkedClaim),
      reconcileSend: vi.fn(async () => ({
        attemptId: 'send-attempt',
        messageRowId: 'message-row',
        outcome: 'pending' as const,
        shouldSend: false,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('in_progress');
    expect(store.send).not.toHaveBeenCalled();
    expect(store.reconcileSend).toHaveBeenCalledOnce();
    expect(store.completeStep).not.toHaveBeenCalled();
    expect(store.completeRoot).not.toHaveBeenCalled();
  });

  it('fails closed when the recovered reservation does not match the send step', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        ...sendClaim,
        should_execute: false,
        send_attempt_id: 'expected-attempt',
      })),
      reconcileSend: vi.fn(async () => ({
        attemptId: 'different-attempt',
        messageRowId: 'message-row',
        outcome: 'accepted' as const,
        shouldSend: false,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('unknown');
    expect(store.send).not.toHaveBeenCalled();
    expect(store.completeRoot).toHaveBeenCalledWith(
      context,
      'unknown',
      'send_reservation_mismatch'
    );
  });

  it('fails closed if a replayed reservation claims it should send', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        ...sendClaim,
        should_execute: false,
        send_attempt_id: 'send-attempt',
      })),
      reconcileSend: vi.fn(async () => ({
        attemptId: 'send-attempt',
        messageRowId: 'message-row',
        outcome: 'pending' as const,
        shouldSend: true,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('unknown');
    expect(store.send).not.toHaveBeenCalled();
    expect(store.completeRoot).toHaveBeenCalledWith(
      context,
      'unknown',
      'send_reservation_mismatch'
    );
  });

  it('fails closed if a send lease has no linked attempt and does not authorize execution', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        ...sendClaim,
        should_execute: false,
        lease_acquired: true,
        send_attempt_id: null,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('failed');
    expect(store.send).not.toHaveBeenCalled();
    expect(store.reconcileSend).not.toHaveBeenCalled();
  });

  it('never calls the send adapter without both a send lease and execution authorization', async () => {
    const store = makeStore({
      claimStep: vi.fn(async () => ({
        ...sendClaim,
        lease_acquired: false,
        lease_token: null,
        should_execute: true,
      })),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('in_progress');
    expect(store.send).not.toHaveBeenCalled();
    expect(store.reconcileSend).not.toHaveBeenCalled();
  });

  it('keeps the claimed root recoverable on a transient database error before generation', async () => {
    const store = makeStore({
      readGenerationStep: vi.fn(async () => {
        throw Object.assign(new Error('synthetic database outage'), {
          code: '08006',
        });
      }),
    });
    const dependencies = deps(store);
    await expect(
      executeEvolutionAiReply(
        { dispatchId: context.dispatchId, leaseToken: context.leaseToken },
        dependencies
      )
    ).resolves.toBe('in_progress');
    expect(dependencies.generate).not.toHaveBeenCalled();
    expect(store.claimGeneration).not.toHaveBeenCalled();
    expect(store.completeRoot).not.toHaveBeenCalled();
  });
});
