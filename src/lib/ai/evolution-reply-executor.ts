import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  createEvolutionSendAdapter,
  createEvolutionSendReservationAdapter,
} from '@/lib/whatsapp/evolution/send-adapter';
import type {
  EvolutionTextSendResult,
  EvolutionTextReservationResult,
} from '@/lib/whatsapp/evolution/send-adapter';
import type { EvolutionCredentials } from '@/lib/whatsapp/evolution/types';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { buildConversationContext } from './context';
import { loadAiConfig } from './config';
import { buildSystemPrompt } from './defaults';
import { generateReply } from './generate';
import { buildHandoffSummary } from './handoff';
import { latestUserMessage } from './query';
import { retrieveKnowledge } from './knowledge';
import { logAiUsage } from './usage';
import { supabaseAdmin } from './admin-client';
import {
  AiError,
  type AiConfig,
  type ChatMessage,
  type GenerateResult,
} from './types';
import { isEligibleInboundTextAutomation } from '@/lib/automations/inbound-text-eligibility';

export type EvolutionAiReplyOutcome =
  'done' | 'skipped' | 'in_progress' | 'unknown' | 'failed';

export interface EvolutionAiReplyInput {
  dispatchId: string;
  leaseToken: string;
}

export interface EvolutionAiReplyContext {
  dispatchId: string;
  leaseToken: string;
  accountId: string;
  authorId: string;
  connectionId: string;
  conversationId: string;
  contactId: string;
  externalMessageId: string;
  recipient: string;
  inboundText: string;
  aiReplyCount: number;
  autoReplyMax: number;
  handoffAgentId: string | null;
  assignedAgentId: string | null;
  aiReplyDisabled: boolean;
  config: AiConfig | null;
  messages: ChatMessage[];
  credentials: EvolutionCredentials;
}

export interface AiGenerationClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string;
  result: unknown;
  should_generate: boolean;
  lease_acquired: boolean;
}

export interface DispatchStepClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string;
  send_attempt_id?: string | null;
  should_execute: boolean;
  lease_acquired: boolean;
}

export interface StepSnapshot {
  stepId: string;
  state: string;
  requestId: string;
  result: unknown;
  hasSendAttempt: boolean;
}

export interface EvolutionAiReplyStore {
  load(input: EvolutionAiReplyInput): Promise<EvolutionAiReplyContext | null>;
  loadConfig(context: EvolutionAiReplyContext): Promise<AiConfig | null>;
  hasDeterministicResponder(context: EvolutionAiReplyContext): Promise<boolean>;
  isLatestInbound(context: EvolutionAiReplyContext): Promise<boolean>;
  readGenerationStep(
    input: EvolutionAiReplyInput
  ): Promise<StepSnapshot | null>;
  claimGeneration(input: EvolutionAiReplyInput): Promise<AiGenerationClaim>;
  readSendStep(context: EvolutionAiReplyContext): Promise<StepSnapshot | null>;
  completeStep(args: {
    context: EvolutionAiReplyContext;
    stepId: string;
    stepLeaseToken: string;
    state: 'done' | 'unknown' | 'failed' | 'skipped';
    requestId: string;
    result?: Record<string, unknown> | null;
    sendAttemptId?: string | null;
    errorCode?: string | null;
  }): Promise<void>;
  claimStep(
    context: EvolutionAiReplyContext,
    actionKey: string
  ): Promise<DispatchStepClaim>;
  completeHandoff(args: {
    context: EvolutionAiReplyContext;
    step: DispatchStepClaim;
    summary: string;
  }): Promise<void>;
  claimReplySlot(context: EvolutionAiReplyContext): Promise<boolean>;
  send(
    args: EvolutionAiReplyContext & {
      requestId: string;
      text: string;
      senderType: 'bot';
      senderId: string;
    }
  ): Promise<EvolutionTextSendResult>;
  reconcileSend(
    args: EvolutionAiReplyContext & {
      requestId: string;
      text: string;
      senderType: 'bot';
      senderId: string;
    }
  ): Promise<EvolutionTextReservationResult>;
  completeRoot(
    context: EvolutionAiReplyContext,
    state: 'done' | 'skipped' | 'unknown' | 'failed',
    errorCode?: string
  ): Promise<void>;
}

export interface EvolutionAiReplyDependencies {
  store: EvolutionAiReplyStore;
  generate?: (
    args: Parameters<typeof generateReply>[0]
  ) => Promise<GenerateResult>;
  retrieve?: (
    context: EvolutionAiReplyContext,
    query: string
  ) => Promise<string[]>;
  logUsage?: (
    context: EvolutionAiReplyContext,
    usage: GenerateResult['usage']
  ) => Promise<void>;
  rateLimit?: (
    key: string,
    options: typeof RATE_LIMITS.aiAutoReplyAccount
  ) => { success: boolean };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseGenerationResult(value: unknown): GenerateResult | null {
  if (
    !isRecord(value) ||
    typeof value.text !== 'string' ||
    typeof value.handoff !== 'boolean'
  )
    return null;
  const usage = value.usage;
  if (
    usage !== null &&
    usage !== undefined &&
    (!isRecord(usage) ||
      typeof usage.promptTokens !== 'number' ||
      typeof usage.completionTokens !== 'number' ||
      typeof usage.totalTokens !== 'number')
  )
    return null;
  return {
    text: value.text,
    handoff: value.handoff,
    usage: (usage ?? null) as GenerateResult['usage'],
  };
}

function rpcRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? (row as T) : null;
}

function errorCode(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    /^[a-z0-9][a-z0-9_]{0,47}$/.test(error.code)
  )
    return error.code;
  return 'ai_reply_worker_error';
}

/** Executes one already-claimed AI root. It never claims roots or installs a schedule. */
export async function executeEvolutionAiReply(
  input: EvolutionAiReplyInput,
  dependencies: EvolutionAiReplyDependencies
): Promise<EvolutionAiReplyOutcome> {
  const { store } = dependencies;
  const generate = dependencies.generate ?? generateReply;
  const retrieve =
    dependencies.retrieve ??
    ((context, query) =>
      context.config
        ? retrieveKnowledge(
            storeDb(store),
            context.accountId,
            context.config,
            query
          )
        : Promise.resolve([]));
  const usageLogger =
    dependencies.logUsage ??
    ((context, usage) =>
      context.config
        ? logAiUsage(storeDb(store), {
            accountId: context.accountId,
            conversationId: context.conversationId,
            mode: 'auto_reply',
            provider: context.config.provider,
            model: context.config.model,
            usage,
          })
        : Promise.resolve());
  const rateLimit = dependencies.rateLimit ?? checkRateLimit;

  let context: EvolutionAiReplyContext | null = null;
  try {
    context = await store.load(input);
    if (!context) return 'in_progress';
    // Read the checkpoint first. A saved output bypasses rate/config/assignment
    // gates; a still-pending first generation runs those gates before its
    // one-shot claim so transient DB failures do not consume the generation lease.
    const generationStep = await store.readGenerationStep(input);
    let generationConfig: AiConfig | null = null;
    if (!generationStep || generationStep.state === 'pending') {
      generationConfig = await store.loadConfig(context);
      const eligible =
        !!generationConfig?.isActive &&
        generationConfig.autoReplyEnabled &&
        !context.aiReplyDisabled &&
        !context.assignedAgentId &&
        context.aiReplyCount < context.autoReplyMax &&
        !(await store.hasDeterministicResponder(context)) &&
        (await store.isLatestInbound(context)) &&
        context.messages.length > 0 &&
        context.messages.some((message) => message.role === 'user') &&
        rateLimit(
          `ai-autoreply:${context.accountId}`,
          RATE_LIMITS.aiAutoReplyAccount
        ).success;
      if (!eligible) {
        await store.completeRoot(context, 'skipped');
        return 'skipped';
      }
      context = { ...context, config: generationConfig };
    }

    const claim = await store.claimGeneration(input);
    let result: GenerateResult;
    if (claim.state === 'done') {
      const persisted = parseGenerationResult(claim.result);
      if (!persisted) throw new Error('invalid_generation_checkpoint');
      result = persisted;
    } else if (
      claim.state === 'unknown' ||
      claim.state === 'failed' ||
      claim.state === 'skipped'
    ) {
      await store.completeRoot(
        context,
        claim.state === 'failed'
          ? 'failed'
          : claim.state === 'skipped'
            ? 'skipped'
            : 'unknown',
        claim.state === 'unknown' ? 'generation_outcome_unknown' : undefined
      );
      return claim.state;
    } else if (
      claim.state === 'processing' &&
      !claim.should_generate &&
      !claim.lease_acquired
    ) {
      return 'in_progress';
    } else if (
      claim.should_generate &&
      claim.lease_acquired &&
      claim.lease_token
    ) {
      const config = generationConfig ?? context.config;
      if (!config)
        throw Object.assign(new Error('ai_config_unavailable'), {
          code: 'ai_config_unavailable',
        });
      let knowledge: string[];
      try {
        knowledge = await retrieve(
          { ...context, config },
          latestUserMessage(context.messages)
        );
      } catch (error) {
        await store.completeStep({
          context,
          stepId: claim.step_id,
          stepLeaseToken: claim.lease_token,
          state: 'failed',
          requestId: claim.request_id,
          errorCode: errorCode(error),
        });
        await store.completeRoot(context, 'failed', errorCode(error));
        return 'failed';
      }
      const systemPrompt = buildSystemPrompt({
        userPrompt: config.systemPrompt,
        mode: 'auto_reply',
        knowledge,
      });
      try {
        result = await generate({
          config,
          systemPrompt,
          messages: context.messages,
        });
      } catch (error) {
        const knownProviderRejection =
          error instanceof AiError && error.status >= 400 && error.status < 500;
        const terminalState = knownProviderRejection ? 'failed' : 'unknown';
        await store.completeStep({
          context,
          stepId: claim.step_id,
          stepLeaseToken: claim.lease_token,
          state: terminalState,
          requestId: claim.request_id,
          errorCode: errorCode(error),
        });
        await store.completeRoot(
          context,
          terminalState,
          terminalState === 'unknown'
            ? 'generation_outcome_unknown'
            : errorCode(error)
        );
        return terminalState;
      }
      await store.completeStep({
        context,
        stepId: claim.step_id,
        stepLeaseToken: claim.lease_token,
        state: 'done',
        requestId: claim.request_id,
        result: result as unknown as Record<string, unknown>,
      });
      try {
        await usageLogger({ ...context, config }, result.usage);
      } catch {
        /* Usage accounting must not affect the durable reply. */
      }
    } else {
      return 'in_progress';
    }

    if (result.handoff || !result.text.trim()) {
      const step = await store.claimStep(context, 'reply:handoff');
      if (step.state === 'done') {
        await store.completeRoot(context, 'done');
        return 'done';
      }
      if (
        step.state === 'failed' ||
        step.state === 'unknown' ||
        step.state === 'skipped'
      ) {
        const terminal = step.state === 'skipped' ? 'skipped' : step.state;
        await store.completeRoot(context, terminal);
        return terminal;
      }
      if (
        step.state !== 'processing' ||
        step.should_execute !== true ||
        !step.lease_acquired ||
        !step.lease_token
      )
        return 'in_progress';
      const summary = buildHandoffSummary({
        messages: context.messages,
        replyCount: context.aiReplyCount,
      });
      await store.completeHandoff({ context, step, summary });
      await store.completeRoot(context, 'done');
      return 'done';
    }

    const sendSnapshot = await store.readSendStep(context);
    if (sendSnapshot?.state === 'done') {
      await store.completeRoot(context, 'done');
      return 'done';
    }
    if (
      sendSnapshot?.state === 'failed' ||
      sendSnapshot?.state === 'unknown' ||
      sendSnapshot?.state === 'skipped'
    ) {
      const terminal =
        sendSnapshot.state === 'skipped' ? 'skipped' : sendSnapshot.state;
      await store.completeRoot(context, terminal);
      return terminal;
    }
    // A durable reservation already consumed the slot and must be reconciled
    // even if a newer inbound arrived. Current eligibility checks apply only
    // before the first reservation.
    if (!sendSnapshot?.hasSendAttempt) {
      if (!(await store.isLatestInbound(context))) {
        await store.completeRoot(context, 'skipped');
        return 'skipped';
      }
      if (!(await store.claimReplySlot(context))) {
        await store.completeRoot(context, 'skipped');
        return 'skipped';
      }
    }
    const step = await store.claimStep(context, 'reply:send');
    if (step.state === 'done') {
      await store.completeRoot(context, 'done');
      return 'done';
    }
    if (
      step.state === 'failed' ||
      step.state === 'unknown' ||
      step.state === 'skipped'
    ) {
      const terminal = step.state === 'skipped' ? 'skipped' : step.state;
      await store.completeRoot(context, terminal);
      return terminal;
    }
    if (
      step.state !== 'processing' ||
      !step.lease_acquired ||
      !step.lease_token
    )
      return 'in_progress';
    let sent: {
      attemptId: string;
      outcome: 'pending' | 'accepted' | 'rejected' | 'unknown';
      externalMessageId: string | null;
    };
    if (step.should_execute === true) {
      sent = await store.send({
        ...context,
        requestId: step.request_id,
        text: result.text,
        senderType: 'bot',
        senderId: context.authorId,
      });
    } else if (step.send_attempt_id) {
      // Existing attempt: reconcile the durable reservation without transport.
      const reservation = await store.reconcileSend({
        ...context,
        requestId: step.request_id,
        text: result.text,
        senderType: 'bot',
        senderId: context.authorId,
      });
      if (
        reservation.shouldSend ||
        reservation.attemptId !== step.send_attempt_id
      ) {
        throw Object.assign(new Error('send_reservation_mismatch'), {
          code: 'send_reservation_mismatch',
        });
      }
      sent = {
        attemptId: reservation.attemptId,
        outcome: reservation.outcome,
        externalMessageId: null,
      };
    } else {
      throw Object.assign(new Error('send_attempt_missing'), {
        code: 'send_attempt_missing',
      });
    }
    if (sent.outcome === 'pending') return 'in_progress';
    const finalState =
      sent.outcome === 'accepted'
        ? 'done'
        : sent.outcome === 'rejected'
          ? 'failed'
          : 'unknown';
    await store.completeStep({
      context,
      stepId: step.step_id,
      stepLeaseToken: step.lease_token,
      state: finalState,
      requestId: step.request_id,
      sendAttemptId: sent.attemptId,
      result: {
        outcome: sent.outcome,
        externalMessageId: sent.externalMessageId,
      },
      errorCode: finalState === 'done' ? undefined : `send_${sent.outcome}`,
    });
    await store.completeRoot(
      context,
      finalState,
      finalState === 'done' ? undefined : `send_${sent.outcome}`
    );
    return finalState;
  } catch (error) {
    const code = errorCode(error);
    if (context && code === 'send_reservation_mismatch') {
      try {
        await store.completeRoot(context, 'unknown', code);
        return 'unknown';
      } catch {
        /* Preserve the active lease for a retry if finalization failed. */
      }
    } else if (
      context &&
      (code === 'send_attempt_missing' ||
        code === 'invalid_generation_checkpoint' ||
        code === 'invalid_generation_step' ||
        code === 'invalid_send_step')
    ) {
      try {
        await store.completeRoot(context, 'failed', code);
        return 'failed';
      } catch {
        /* Preserve the active lease for a retry if finalization failed. */
      }
    }
    return 'in_progress';
  }
}

// The production store also owns DB reads used by AI helpers; this avoids passing
// provider secrets or the privileged client through the public executor input.
const dbByStore = new WeakMap<object, SupabaseClient>();
function storeDb(store: EvolutionAiReplyStore): SupabaseClient {
  const db = dbByStore.get(store as object);
  if (!db) throw new Error('ai_reply_store_database_unavailable');
  return db;
}

interface RootRow extends Record<string, unknown> {
  id: string;
  event_id: string;
  account_id: string;
  ai_config_id: string;
  user_id: string;
  contact_id: string;
  conversation_id: string;
  lease_token: string;
  lease_until: string;
  state: string;
}

interface EventRow extends Record<string, unknown> {
  connection_id: string;
  state: string;
  normalized_event: unknown;
}

interface ConversationRow extends Record<string, unknown> {
  assigned_agent_id: string | null;
  ai_autoreply_disabled: boolean;
  ai_reply_count: number;
  contact_id: string;
}

interface ConnectionRow extends Record<string, unknown> {
  id: string;
  provider: string;
  account_id: string;
  base_url: string;
  instance_name: string;
  token_encrypted: string;
}

/** Constructs the server-only Supabase-backed store; tests inject a fake store instead. */
export function createSupabaseEvolutionAiReplyStore(
  db: SupabaseClient
): EvolutionAiReplyStore {
  const store: EvolutionAiReplyStore = {
    async load(input) {
      const { data: rootData, error: rootError } = await db
        .from('evolution_event_dispatches')
        .select(
          'id,event_id,account_id,ai_config_id,user_id,contact_id,conversation_id,lease_token,lease_until,state,engine'
        )
        .eq('id', input.dispatchId)
        .maybeSingle();
      if (rootError) throw rootError;
      if (!isRecord(rootData)) return null;
      const root = rootData as RootRow & { engine: string };
      if (
        root.engine !== 'ai' ||
        root.state !== 'processing' ||
        root.lease_token !== input.leaseToken ||
        Date.parse(root.lease_until) <= Date.now()
      )
        return null;

      const [
        { data: eventData, error: eventError },
        { data: configData, error: configError },
        { data: conversationData, error: conversationError },
      ] = await Promise.all([
        db
          .from('evolution_events')
          .select('connection_id,state,normalized_event')
          .eq('id', root.event_id)
          .maybeSingle(),
        db
          .from('ai_configs')
          .select(
            'account_id,created_by,auto_reply_max_per_conversation,handoff_agent_id'
          )
          .eq('id', root.ai_config_id)
          .maybeSingle(),
        db
          .from('conversations')
          .select(
            'assigned_agent_id,ai_autoreply_disabled,ai_reply_count,contact_id,account_id'
          )
          .eq('id', root.conversation_id)
          .maybeSingle(),
      ]);
      if (eventError) throw eventError;
      if (configError) throw configError;
      if (conversationError) throw conversationError;
      if (
        !isRecord(eventData) ||
        !isRecord(configData) ||
        !isRecord(conversationData)
      )
        return null;
      const event = eventData as EventRow;
      const normalized = event.normalized_event;
      const configRow = configData;
      const conversation = conversationData as ConversationRow & {
        account_id: string;
      };
      if (
        event.state !== 'done' ||
        conversation.account_id !== root.account_id ||
        conversation.contact_id !== root.contact_id ||
        configRow.account_id !== root.account_id ||
        configRow.created_by !== root.user_id ||
        !isRecord(normalized) ||
        normalized.kind !== 'message' ||
        normalized.contentType !== 'text' ||
        normalized.fromMe !== false ||
        normalized.sentByApi !== false ||
        typeof normalized.externalMessageId !== 'string' ||
        typeof normalized.peer !== 'string' ||
        typeof normalized.text !== 'string' ||
        !/^\d{8,15}@s\.whatsapp\.net$/.test(normalized.peer)
      )
        return null;

      const { data: connectionData, error: connectionError } = await db
        .from('whatsapp_connections')
        .select('id,provider,account_id,base_url,instance_name,token_encrypted')
        .eq('id', event.connection_id)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!isRecord(connectionData)) return null;
      const connection = connectionData as ConnectionRow;
      if (
        connection.provider !== 'evolution' ||
        connection.account_id !== root.account_id ||
        typeof connection.token_encrypted !== 'string' ||
        !connection.token_encrypted
      )
        return null;
      const messages = await buildConversationContext(db, root.conversation_id);
      if (!messages.length) return null;
      return {
        dispatchId: root.id,
        leaseToken: input.leaseToken,
        accountId: root.account_id,
        authorId: root.user_id,
        connectionId: connection.id,
        conversationId: root.conversation_id,
        contactId: root.contact_id,
        externalMessageId: normalized.externalMessageId,
        recipient: normalized.peer,
        inboundText: normalized.text,
        aiReplyCount:
          typeof conversation.ai_reply_count === 'number'
            ? conversation.ai_reply_count
            : 0,
        autoReplyMax: Number(configRow.auto_reply_max_per_conversation),
        handoffAgentId:
          typeof configRow.handoff_agent_id === 'string'
            ? configRow.handoff_agent_id
            : null,
        assignedAgentId: conversation.assigned_agent_id,
        aiReplyDisabled: conversation.ai_autoreply_disabled,
        config: null,
        messages,
        credentials: {
          baseUrl: connection.base_url,
          instanceId: connection.instance_name,
          token: decrypt(connection.token_encrypted),
        },
      };
    },
    async loadConfig(context) {
      const config = await loadAiConfig(db, context.accountId);
      return config
        ? {
            ...config,
            autoReplyMaxPerConversation: context.autoReplyMax,
            handoffAgentId: context.handoffAgentId,
          }
        : null;
    },
    async hasDeterministicResponder(context) {
      const { data, error } = await db
        .from('automations')
        .select('trigger_type,trigger_config')
        .eq('account_id', context.accountId)
        .eq('is_active', true);
      if (error) throw error;
      if (!Array.isArray(data)) return false;
      const { data: firstRows, error: firstError } = await db
        .from('messages')
        .select('message_id')
        .eq('conversation_id', context.conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: true })
        .limit(1);
      if (firstError) throw firstError;
      const isFirstInbound =
        Array.isArray(firstRows) &&
        firstRows[0]?.message_id === context.externalMessageId;
      return data.some(
        (row) =>
          isRecord(row) &&
          typeof row.trigger_type === 'string' &&
          isEligibleInboundTextAutomation({
            trigger_type: row.trigger_type as Parameters<
              typeof isEligibleInboundTextAutomation
            >[0]['trigger_type'],
            trigger_config: row.trigger_config,
            text: context.inboundText,
            isFirstInbound,
          })
      );
    },
    async isLatestInbound(context) {
      const { data, error } = await db
        .from('messages')
        .select('message_id')
        .eq('conversation_id', context.conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (
        Array.isArray(data) &&
        data.length > 0 &&
        data[0].message_id === context.externalMessageId
      );
    },
    async readGenerationStep(input) {
      const { data, error } = await db
        .from('evolution_dispatch_steps')
        .select('id,state,request_id,result,send_attempt_id')
        .eq('dispatch_id', input.dispatchId)
        .eq('action_key', 'reply')
        .maybeSingle();
      if (error) throw error;
      if (!isRecord(data)) return null;
      if (
        typeof data.id !== 'string' ||
        typeof data.state !== 'string' ||
        data.request_id !== `evolution-step:${data.id}` ||
        data.send_attempt_id !== null
      ) {
        throw Object.assign(new Error('invalid_generation_step'), {
          code: 'invalid_generation_step',
        });
      }
      return {
        stepId: data.id,
        state: data.state,
        requestId: data.request_id,
        result: data.result,
        hasSendAttempt: false,
      };
    },
    async claimGeneration(input) {
      const { data, error } = await db.rpc(
        'claim_evolution_ai_reply_generation',
        {
          p_dispatch_id: input.dispatchId,
          p_dispatch_lease_token: input.leaseToken,
        }
      );
      if (error) throw error;
      const row = rpcRow<AiGenerationClaim>(data);
      if (!row) throw new Error('invalid_generation_claim');
      return row;
    },
    async readSendStep(context) {
      const { data, error } = await db
        .from('evolution_dispatch_steps')
        .select('id,state,request_id,send_attempt_id')
        .eq('dispatch_id', context.dispatchId)
        .eq('action_key', 'reply:send')
        .maybeSingle();
      if (error) throw error;
      if (!isRecord(data)) return null;
      if (
        typeof data.id !== 'string' ||
        typeof data.state !== 'string' ||
        data.request_id !== `evolution-step:${data.id}`
      ) {
        throw Object.assign(new Error('invalid_send_step'), {
          code: 'invalid_send_step',
        });
      }
      let hasSendAttempt = typeof data.send_attempt_id === 'string';
      if (!hasSendAttempt) {
        const { data: attempt, error: attemptError } = await db
          .from('evolution_send_attempts')
          .select('id')
          .eq('account_id', context.accountId)
          .eq('request_id', data.request_id)
          .maybeSingle();
        if (attemptError) throw attemptError;
        hasSendAttempt = isRecord(attempt) && typeof attempt.id === 'string';
      }
      return {
        stepId: data.id,
        state: data.state,
        requestId: data.request_id,
        result: null,
        hasSendAttempt,
      };
    },
    async completeStep(args) {
      const { error } = await db.rpc('complete_evolution_dispatch_step', {
        p_step_id: args.stepId,
        p_dispatch_lease_token: args.context.leaseToken,
        p_lease_token: args.stepLeaseToken,
        p_state: args.state,
        p_request_id: args.requestId,
        p_send_attempt_id: args.sendAttemptId ?? null,
        p_result: args.result ?? null,
        p_error_code: args.errorCode ?? null,
      });
      if (error) throw error;
    },
    async claimStep(context, actionKey) {
      const rpc =
        actionKey === 'reply:send'
          ? 'claim_evolution_dispatch_send_step'
          : 'claim_evolution_dispatch_step';
      const args =
        actionKey === 'reply:send'
          ? {
              p_dispatch_id: context.dispatchId,
              p_dispatch_lease_token: context.leaseToken,
              p_action_key: actionKey,
              p_lease_seconds: 60,
            }
          : {
              p_dispatch_id: context.dispatchId,
              p_dispatch_lease_token: context.leaseToken,
              p_action_key: actionKey,
              p_lease_seconds: 60,
            };
      const { data, error } = await db.rpc(rpc, args);
      if (error) throw error;
      const row = rpcRow<DispatchStepClaim>(data);
      if (!row) throw new Error('invalid_dispatch_step_claim');
      if (actionKey !== 'reply:send') {
        // The generic RPC returns six columns and has no lease_acquired flag.
        // Only the first claim's explicit should_execute + processing state
        // tells this caller it owns the lease and may fence the handoff.
        return {
          ...row,
          lease_acquired:
            row.state === 'processing' &&
            row.should_execute === true &&
            !!row.lease_token,
        };
      }
      return row;
    },
    async completeHandoff({ context, step, summary }) {
      const { error } = await db.rpc('complete_evolution_ai_handoff', {
        p_dispatch_id: context.dispatchId,
        p_dispatch_lease_token: context.leaseToken,
        p_step_id: step.step_id,
        p_step_lease_token: step.lease_token,
        p_summary: summary,
        p_handoff_agent_id: context.handoffAgentId,
      });
      if (error) throw error;
    },
    async claimReplySlot(context) {
      const { data, error } = await db.rpc('claim_ai_reply_slot_for_dispatch', {
        p_dispatch_id: context.dispatchId,
        p_dispatch_lease_token: context.leaseToken,
        p_max_replies: context.autoReplyMax,
      });
      if (error) throw error;
      return data === true;
    },
    async send(args) {
      return createEvolutionSendAdapter(db)({
        connectionId: args.connectionId,
        conversationId: args.conversationId,
        senderType: args.senderType,
        senderId: args.senderId,
        requestId: args.requestId,
        recipient: args.recipient,
        text: args.text,
        credentials: args.credentials,
      });
    },
    async reconcileSend(args) {
      return createEvolutionSendReservationAdapter(db)({
        connectionId: args.connectionId,
        conversationId: args.conversationId,
        senderType: args.senderType,
        senderId: args.senderId,
        requestId: args.requestId,
        recipient: args.recipient,
        text: args.text,
        credentials: args.credentials,
      });
    },
    async completeRoot(context, state, code) {
      const { error } = await db.rpc('complete_evolution_dispatch', {
        p_dispatch_id: context.dispatchId,
        p_lease_token: context.leaseToken,
        p_state: state,
        p_result: null,
        p_error_code: code ?? null,
      });
      if (error) throw error;
    },
  };
  dbByStore.set(store as object, db);
  return store;
}

/** Production entry point for a single claimed root; intentionally not scheduled or routed. */
export async function executeClaimedEvolutionAiReply(
  input: EvolutionAiReplyInput
): Promise<EvolutionAiReplyOutcome> {
  const db = supabaseAdmin();
  return executeEvolutionAiReply(input, {
    store: createSupabaseEvolutionAiReplyStore(db),
  });
}
