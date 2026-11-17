import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { matchesEvolutionFlowTrigger } from '@/lib/flows/evolution-trigger';
import { buildEvolutionInteractiveMessage } from '@/lib/flows/evolution-interactive-config';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  assertAllowedEvolutionOrigin,
} from '@/lib/whatsapp/evolution/client';
import {
  createEvolutionSendAdapter,
  createEvolutionSendReservationAdapter,
  type EvolutionTextReservationResult,
  type EvolutionTextSendInput,
  type EvolutionTextSendResult,
} from '@/lib/whatsapp/evolution/send-adapter';
import type { EvolutionCredentials } from '@/lib/whatsapp/evolution/types';
import {
  createEvolutionInteractiveReservationAdapter,
  createEvolutionInteractiveSendAdapter,
  type EvolutionInteractiveSendInput,
  type EvolutionInteractiveSendResult,
} from '@/lib/whatsapp/evolution/interactive-send-adapter';

type JsonObject = Record<string, unknown>;

interface DispatchRoot {
  id: string;
  engine: string;
  state: string;
  lease_token: string | null;
  flow_id: string | null;
  flow_run_id: string | null;
  event_id: string | null;
  user_id: string;
  account_id: string;
  contact_id: string | null;
  conversation_id: string | null;
}

interface FlowRun {
  id: string;
  flow_id: string;
  account_id: string;
  contact_id: string | null;
  current_node_key: string | null;
  transition_seq: number;
  status: string;
  vars: unknown;
  user_id: string;
  conversation_id: string | null;
}

interface FlowNode {
  flow_id: string;
  node_key: string;
  node_type: string;
  config: unknown;
}

interface StepClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  should_execute: boolean;
  send_attempt_id?: string | null;
  lease_acquired?: boolean;
}

interface SendStepClaim extends StepClaim {
  send_attempt_id: string | null;
  lease_acquired: boolean;
}

interface EvolutionFlowSendContext {
  connectionId: string;
  conversationId: string;
  recipient: string;
  text: string;
  credentials: EvolutionCredentials;
  senderId: string;
}

interface TransitionInput {
  dispatchId: string;
  dispatchLeaseToken: string;
  stepId: string;
  stepLeaseToken: string;
  flowRunId: string;
  eventId: string;
  expectedTransitionSeq: number;
  eventType: 'started' | 'node_entered' | 'message_sent' | 'handoff' | 'completed';
  nodeKey: string;
  payload: JsonObject;
  nextNodeKey: string | null;
  nextStatus: 'active' | 'completed' | 'handed_off';
  endReason: string | null;
}

interface SetTagTransitionInput {
  dispatchId: string;
  dispatchLeaseToken: string;
  stepId: string;
  stepLeaseToken: string;
  flowRunId: string;
  eventId: string;
  expectedTransitionSeq: number;
  nodeKey: string;
  mode: 'add' | 'remove';
  tagId: string;
  nextNodeKey: string;
}

export interface EvolutionFlowStore {
  loadRoot(dispatchId: string): Promise<DispatchRoot | null>;
  isEntryEligible(root: DispatchRoot): Promise<boolean>;
  loadPromptEventId(run: FlowRun): Promise<string | null>;
  startRoot(dispatchId: string, leaseToken: string): Promise<string | null>;
  loadRun(runId: string): Promise<FlowRun | null>;
  loadNodes(flowId: string): Promise<FlowNode[]>;
  evaluateCondition(
    root: DispatchRoot,
    run: FlowRun,
    config: JsonObject
  ): Promise<boolean>;
  claimStep(
    dispatchId: string,
    leaseToken: string,
    actionKey: string
  ): Promise<StepClaim>;
  claimSendStep(
    dispatchId: string,
    leaseToken: string,
    actionKey: string
  ): Promise<SendStepClaim>;
  loadSendContext(
    root: DispatchRoot,
    run: FlowRun,
    config: JsonObject
  ): Promise<EvolutionFlowSendContext>;
  sendText(input: EvolutionTextSendInput): Promise<EvolutionTextSendResult>;
  reconcileSend(
    input: EvolutionTextSendInput
  ): Promise<EvolutionTextReservationResult>;
  sendInteractive(input: EvolutionInteractiveSendInput): Promise<EvolutionInteractiveSendResult>;
  reconcileInteractiveSend(input: EvolutionInteractiveSendInput): Promise<EvolutionTextReservationResult>;
  linkSendAttempt(input: {
    stepId: string;
    dispatchLeaseToken: string;
    stepLeaseToken: string;
    requestId: string;
    attemptId: string;
    state: 'processing' | 'failed' | 'unknown';
    errorCode: string | null;
  }): Promise<void>;
  completeTransition(input: TransitionInput): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
  }>;
  completeSetTagTransition(input: SetTagTransitionInput): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
  }>;
  completeCollectInputReply(input: Omit<TransitionInput, 'eventType' | 'payload' | 'nextNodeKey' | 'nextStatus' | 'endReason'>): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
  }>;
  completeHandoff(input: Omit<TransitionInput, 'eventType' | 'payload' | 'nextNodeKey' | 'nextStatus' | 'endReason'>): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
  }>;
  completeInteractivePrompt(input: Omit<TransitionInput, 'eventType' | 'payload' | 'nextNodeKey' | 'nextStatus' | 'endReason'>): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
    prompt_message_id: string;
  }>;
  completeInteractiveReply(input: Omit<TransitionInput, 'eventType' | 'payload' | 'nextNodeKey' | 'nextStatus' | 'endReason'>): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
    next_node_key: string;
  }>;
  completeRoot(
    dispatchId: string,
    leaseToken: string,
    state: 'done' | 'skipped' | 'failed',
    errorCode: string | null
  ): Promise<void>;
}

export type EvolutionFlowExecutionResult =
  | { status: 'skipped' }
  | { status: 'done'; flowRunId: string; transitions: number }
  | { status: 'waiting'; flowRunId: string; nodeKey: string }
  | {
      status: 'unsupported_node';
      flowRunId: string;
      nodeKey: string;
      nodeType: string;
    }
  | { status: 'terminal_non_success'; flowRunId: string; runStatus: string }
  | { status: 'transition_limit'; flowRunId: string; transitions: number };

export class EvolutionFlowExecutionError extends Error {
  constructor(readonly code: string) {
    super('Evolution Flow execution failed.');
    this.name = 'EvolutionFlowExecutionError';
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new EvolutionFlowExecutionError(code);
  return value;
}

function parseClaim(value: unknown): StepClaim {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isObject(row) ||
    typeof row.step_id !== 'string' ||
    typeof row.state !== 'string' ||
    typeof row.should_execute !== 'boolean' ||
    (row.lease_token !== null && typeof row.lease_token !== 'string') ||
    (row.request_id !== null && typeof row.request_id !== 'string')
  ) {
    throw new EvolutionFlowExecutionError('step_claim_invalid');
  }
  return row as unknown as StepClaim;
}

function parseSendClaim(value: unknown): SendStepClaim {
  const row = firstRow(value);
  if (
    !isObject(row) ||
    typeof row.step_id !== 'string' ||
    typeof row.state !== 'string' ||
    typeof row.should_execute !== 'boolean' ||
    typeof row.lease_acquired !== 'boolean' ||
    (row.lease_token !== null && typeof row.lease_token !== 'string') ||
    (row.request_id !== null && typeof row.request_id !== 'string') ||
    (row.send_attempt_id !== null && typeof row.send_attempt_id !== 'string')
  ) {
    throw new EvolutionFlowExecutionError('send_step_claim_invalid');
  }
  return row as unknown as SendStepClaim;
}

function parseTransition(value: unknown): {
  applied: boolean;
  transition_seq: number;
  status: string;
} {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !isObject(row) ||
    typeof row.applied !== 'boolean' ||
    !Number.isInteger(row.transition_seq) ||
    typeof row.status !== 'string'
  ) {
    throw new EvolutionFlowExecutionError('transition_response_invalid');
  }
  return row as unknown as {
    applied: boolean;
    transition_seq: number;
    status: string;
  };
}

function parseInteractiveTransition(
  value: unknown,
  field: 'prompt_message_id' | 'next_node_key'
) {
  const transition = parseTransition(value);
  const row = Array.isArray(value) ? value[0] : value;
  if (!isObject(row) || typeof row[field] !== 'string' || row[field].trim() === '')
    throw new EvolutionFlowExecutionError('interactive_transition_response_invalid');
  return { ...transition, [field]: row[field] };
}

function compareCondition(
  operator: unknown,
  subject: string | undefined,
  value: unknown
): boolean {
  switch (operator) {
    case 'present':
      return subject !== undefined && subject !== '';
    case 'absent':
      return subject === undefined || subject === '';
    case 'equals':
      return (
        subject !== undefined &&
        subject === (typeof value === 'string' ? value : '')
      );
    case 'contains':
      return (
        subject !== undefined &&
        subject.includes(typeof value === 'string' ? value : '')
      );
    default:
      throw new EvolutionFlowExecutionError('condition_operator_unsupported');
  }
}

function actionKey(run: FlowRun, nodeKey: string): string {
  const value = `${run.transition_seq}:${nodeKey}`;
  if (value.length > 200)
    throw new EvolutionFlowExecutionError('action_key_invalid');
  return value;
}

function sendTextFromConfig(config: JsonObject, vars: unknown): string {
  if (typeof config.text !== 'string' || config.text.trim() === '')
    throw new EvolutionFlowExecutionError('send_message_text_invalid');
  if (!isObject(vars) && /\{\{vars\.[a-zA-Z0-9_]+\}\}/.test(config.text))
    throw new EvolutionFlowExecutionError('run_vars_invalid');
  const text = config.text.replace(
    /\{\{vars\.([a-zA-Z0-9_]+)\}\}/g,
    (_match, key: string) => {
      const value = isObject(vars) ? vars[key] : undefined;
      return value === undefined || value === null ? '' : String(value);
    }
  );
  if (text.trim() === '')
    throw new EvolutionFlowExecutionError('send_message_text_invalid');
  return text;
}

function isInteractiveNode(nodeType: string): nodeType is 'send_buttons' | 'send_list' {
  return nodeType === 'send_buttons' || nodeType === 'send_list';
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'handed_off',
  'timed_out',
  'paused_by_agent',
  'cancelled',
  'failed',
]);
const MAX_TRANSITIONS = 40;

export function createEvolutionFlowExecutor(store: EvolutionFlowStore) {
  return async function processEvolutionFlowRoot(input: {
    dispatchId: string;
    leaseToken: string;
  }): Promise<EvolutionFlowExecutionResult> {
    const root = await store.loadRoot(input.dispatchId);
    if (!root) throw new EvolutionFlowExecutionError('root_not_found');
    if (root.engine !== 'flow' || !root.flow_id || !root.event_id)
      throw new EvolutionFlowExecutionError('root_lineage_invalid');
    if (root.state === 'done') {
      if (!root.flow_run_id)
        throw new EvolutionFlowExecutionError('root_run_missing');
      const completedRun = await store.loadRun(root.flow_run_id);
      if (!completedRun)
        throw new EvolutionFlowExecutionError('root_terminal_mismatch');
      if (completedRun.status === 'active' && completedRun.current_node_key)
        return { status: 'waiting', flowRunId: root.flow_run_id, nodeKey: completedRun.current_node_key };
      if (completedRun.status !== 'completed' && completedRun.status !== 'handed_off')
        throw new EvolutionFlowExecutionError('root_terminal_mismatch');
      return { status: 'done', flowRunId: root.flow_run_id, transitions: 0 };
    }
    if (root.state !== 'processing' || root.lease_token !== input.leaseToken)
      throw new EvolutionFlowExecutionError('stale_root_lease');

    if (!root.flow_run_id && !(await store.isEntryEligible(root))) {
      await store.completeRoot(root.id, input.leaseToken, 'skipped', null);
      return { status: 'skipped' };
    }

    const flowRunId = await store.startRoot(root.id, input.leaseToken);
    if (!flowRunId) return { status: 'skipped' };
    const nodes = await store.loadNodes(root.flow_id);
    const nodesByKey = new Map(nodes.map((node) => [node.node_key, node]));
    let transitions = 0;

    while (transitions < MAX_TRANSITIONS) {
      const run = await store.loadRun(flowRunId);
      if (
        !run ||
        run.flow_id !== root.flow_id ||
        run.account_id !== root.account_id ||
        run.contact_id !== root.contact_id
      )
        throw new EvolutionFlowExecutionError('run_lineage_invalid');
      if (TERMINAL_STATUSES.has(run.status)) {
        if (run.status === 'completed' || run.status === 'handed_off') {
          await store.completeRoot(root.id, input.leaseToken, 'done', null);
          return { status: 'done', flowRunId, transitions };
        }
        await store.completeRoot(
          root.id,
          input.leaseToken,
          'failed',
          `flow_run_${run.status}`
        );
        return {
          status: 'terminal_non_success',
          flowRunId,
          runStatus: run.status,
        };
      }
      if (run.status !== 'active' || !run.current_node_key)
        throw new EvolutionFlowExecutionError('run_state_invalid');

      if (!root.flow_run_id && transitions === 0 && run.transition_seq > 0) {
        const activeNode = nodesByKey.get(run.current_node_key);
        const promptEventId = activeNode?.node_type === 'collect_input'
          ? await store.loadPromptEventId(run)
          : null;
        if (!promptEventId || promptEventId === root.event_id) {
          await store.completeRoot(root.id, input.leaseToken, 'skipped', null);
          return { status: 'skipped' };
        }
      }

      const node = nodesByKey.get(run.current_node_key);
      if (!node || node.flow_id !== root.flow_id)
        throw new EvolutionFlowExecutionError('current_node_missing');
      if (
        node.node_type !== 'start' &&
        node.node_type !== 'condition' &&
        node.node_type !== 'set_tag' &&
        node.node_type !== 'send_message' &&
        node.node_type !== 'collect_input' &&
        !isInteractiveNode(node.node_type) &&
        node.node_type !== 'handoff' &&
        node.node_type !== 'end'
      ) {
        return {
          status: 'unsupported_node',
          flowRunId,
          nodeKey: node.node_key,
          nodeType: node.node_type,
        };
      }
      if (!isObject(node.config))
        throw new EvolutionFlowExecutionError('node_config_invalid');

      const promptEventId = node.node_type === 'collect_input' || isInteractiveNode(node.node_type)
        ? await store.loadPromptEventId(run)
        : null;
      if (promptEventId) {
        if (promptEventId === root.event_id) {
          await store.completeRoot(root.id, input.leaseToken, 'done', null);
          return { status: 'waiting', flowRunId, nodeKey: node.node_key };
        }
        const replyClaim = await store.claimStep(
          root.id, input.leaseToken, actionKey(run, node.node_key)
        );
        if (!replyClaim.should_execute) {
          if (replyClaim.state === 'done') {
            const refreshed = await store.loadRun(flowRunId);
            if (!refreshed || refreshed.transition_seq <= run.transition_seq)
              throw new EvolutionFlowExecutionError('reply_checkpoint_inconsistent');
            transitions += 1;
            continue;
          }
          return { status: 'waiting', flowRunId, nodeKey: node.node_key };
        }
        if (replyClaim.state !== 'processing' || !replyClaim.lease_token || !replyClaim.request_id)
          throw new EvolutionFlowExecutionError('reply_step_claim_invalid');
        const replyInput = {
          dispatchId: root.id,
          dispatchLeaseToken: input.leaseToken,
          stepId: replyClaim.step_id,
          stepLeaseToken: replyClaim.lease_token,
          flowRunId,
          eventId: root.event_id,
          expectedTransitionSeq: run.transition_seq,
          nodeKey: node.node_key,
        };
        const replyTransition = isInteractiveNode(node.node_type)
          ? await store.completeInteractiveReply(replyInput)
          : await store.completeCollectInputReply(replyInput);
        if (replyTransition.applied &&
            (replyTransition.transition_seq !== run.transition_seq + 1 || replyTransition.status !== 'active'))
          throw new EvolutionFlowExecutionError('reply_transition_invalid');
        if (!replyTransition.applied && replyTransition.transition_seq <= run.transition_seq)
          throw new EvolutionFlowExecutionError('reply_checkpoint_inconsistent');
        if ('next_node_key' in replyTransition &&
            (typeof replyTransition.next_node_key !== 'string' ||
              !nodesByKey.has(replyTransition.next_node_key)))
          throw new EvolutionFlowExecutionError('reply_target_missing');
        transitions += 1;
        continue;
      }

      let eventType: TransitionInput['eventType'];
      let payload: JsonObject = {};
      let nextNodeKey: string | null;
      let nextStatus: TransitionInput['nextStatus'] = 'active';
      let endReason: string | null = null;
      let tagMode: 'add' | 'remove' | null = null;
      let tagId: string | null = null;

      if (node.node_type === 'start') {
        eventType = 'started';
        nextNodeKey = requiredString(
          node.config.next_node_key,
          'start_target_invalid'
        );
      } else if (node.node_type === 'condition') {
        eventType = 'node_entered';
        const branch = (await store.evaluateCondition(root, run, node.config))
          ? 'yes'
          : 'no';
        payload = { branch };
        nextNodeKey = requiredString(
          branch === 'yes' ? node.config.true_next : node.config.false_next,
          'condition_target_invalid'
        );
      } else if (node.node_type === 'set_tag') {
        eventType = 'node_entered';
        if (node.config.mode !== 'add' && node.config.mode !== 'remove')
          throw new EvolutionFlowExecutionError('set_tag_mode_invalid');
        const configuredTagId = requiredString(
          node.config.tag_id,
          'set_tag_id_invalid'
        );
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            configuredTagId
          )
        )
          throw new EvolutionFlowExecutionError('set_tag_id_invalid');
        tagMode = node.config.mode;
        tagId = configuredTagId;
        nextNodeKey = requiredString(
          node.config.next_node_key,
          'set_tag_target_invalid'
        );
      } else if (node.node_type === 'send_message') {
        eventType = 'message_sent';
        payload = { outcome: 'accepted' };
        nextNodeKey = requiredString(
          node.config.next_node_key,
          'send_message_target_invalid'
        );
      } else if (node.node_type === 'collect_input') {
        requiredString(node.config.prompt_text, 'collect_input_prompt_invalid');
        requiredString(node.config.var_key, 'collect_input_var_invalid');
        requiredString(node.config.next_node_key, 'collect_input_target_invalid');
        eventType = 'message_sent';
        payload = { outcome: 'accepted' };
        nextNodeKey = node.node_key;
      } else if (isInteractiveNode(node.node_type)) {
        eventType = 'message_sent';
        nextNodeKey = node.node_key;
      } else if (node.node_type === 'handoff') {
        eventType = 'handoff';
        nextNodeKey = node.node_key;
        nextStatus = 'handed_off';
        endReason = 'handoff_node';
      } else {
        eventType = 'completed';
        nextNodeKey = null;
        nextStatus = 'completed';
        endReason = 'end_node';
      }

      if (nextNodeKey !== null && !nodesByKey.has(nextNodeKey))
        throw new EvolutionFlowExecutionError('next_node_missing');

      const isSendMessage = node.node_type === 'send_message' ||
        node.node_type === 'collect_input' || isInteractiveNode(node.node_type);
      const claim = isSendMessage
        ? await store.claimSendStep(
            root.id,
            input.leaseToken,
            actionKey(run, node.node_key)
          )
        : await store.claimStep(
            root.id,
            input.leaseToken,
            actionKey(run, node.node_key)
          );
      if (
        !claim.should_execute &&
        (!isSendMessage || !claim.lease_acquired)
      ) {
        if (claim.state === 'done') {
          const refreshed = await store.loadRun(flowRunId);
          if (!refreshed || refreshed.transition_seq <= run.transition_seq)
            throw new EvolutionFlowExecutionError('checkpoint_inconsistent');
          transitions += 1;
          continue;
        }
        if (isSendMessage && ['failed', 'unknown', 'skipped'].includes(claim.state))
          throw new EvolutionFlowExecutionError(`send_step_${claim.state}`);
        return { status: 'waiting', flowRunId, nodeKey: node.node_key };
      }
      if (
        claim.state !== 'processing' ||
        !claim.lease_token ||
        !claim.request_id ||
        (isSendMessage &&
          (!claim.lease_acquired ||
            claim.request_id !== `evolution-step:${claim.step_id}` ||
            (claim.should_execute && claim.send_attempt_id !== null) ||
            (!claim.should_execute && !claim.send_attempt_id)))
      )
        throw new EvolutionFlowExecutionError(
          isSendMessage ? 'send_step_claim_invalid' : 'step_claim_invalid'
        );

      if (isSendMessage) {
        const sendContext = await store.loadSendContext(root, run,
          node.node_type === 'collect_input'
            ? { text: node.config.prompt_text }
            : node.config);
        const textSendInput: EvolutionTextSendInput = {
          ...sendContext,
          senderType: 'bot',
          senderId: sendContext.senderId,
          requestId: claim.request_id,
        };
        const interactiveSendInput: EvolutionInteractiveSendInput | null =
          isInteractiveNode(node.node_type) ? {
            connectionId: sendContext.connectionId,
            conversationId: sendContext.conversationId,
            senderId: sendContext.senderId,
            credentials: sendContext.credentials,
            message: buildEvolutionInteractiveMessage(
              node.node_type, node.config, run.vars,
              sendContext.recipient, claim.request_id
            ),
          } : null;
        let attemptId: string;
        let outcome: 'pending' | 'accepted' | 'rejected' | 'unknown';

        if (claim.should_execute) {
          const sent = interactiveSendInput
            ? await store.sendInteractive(interactiveSendInput)
            : await store.sendText(textSendInput);
          if (!sent.shouldSend || !sent.attemptId) {
            throw new EvolutionFlowExecutionError('send_reservation_invalid');
          }
          attemptId = sent.attemptId;
          outcome = sent.outcome;
        } else {
          const replay = interactiveSendInput
            ? await store.reconcileInteractiveSend(interactiveSendInput)
            : await store.reconcileSend(textSendInput);
          if (
            replay.attemptId !== claim.send_attempt_id ||
            replay.shouldSend
          ) {
            throw new EvolutionFlowExecutionError('send_reservation_replay_invalid');
          }
          attemptId = replay.attemptId;
          outcome = replay.outcome;
        }

        if (outcome === 'pending') {
          await store.linkSendAttempt({
            stepId: claim.step_id,
            dispatchLeaseToken: input.leaseToken,
            stepLeaseToken: claim.lease_token,
            requestId: claim.request_id,
            attemptId,
            state: 'processing',
            errorCode: null,
          });
          return { status: 'waiting', flowRunId, nodeKey: node.node_key };
        }
        if (outcome === 'rejected' || outcome === 'unknown') {
          await store.linkSendAttempt({
            stepId: claim.step_id,
            dispatchLeaseToken: input.leaseToken,
            stepLeaseToken: claim.lease_token,
            requestId: claim.request_id,
            attemptId,
            state: outcome === 'rejected' ? 'failed' : 'unknown',
            errorCode:
              outcome === 'rejected' ? 'provider_rejected' : 'delivery_unknown',
          });
          throw new EvolutionFlowExecutionError(
            outcome === 'rejected' ? 'send_rejected' : 'send_outcome_unknown'
          );
        }

        await store.linkSendAttempt({
          stepId: claim.step_id,
          dispatchLeaseToken: input.leaseToken,
          stepLeaseToken: claim.lease_token,
          requestId: claim.request_id,
          attemptId,
          state: 'processing',
          errorCode: null,
        });
      }

      const transitionInput = {
        dispatchId: root.id,
        dispatchLeaseToken: input.leaseToken,
        stepId: claim.step_id,
        stepLeaseToken: claim.lease_token,
        flowRunId,
        eventId: root.event_id,
        expectedTransitionSeq: run.transition_seq,
        eventType,
        nodeKey: node.node_key,
        payload,
        nextNodeKey,
        nextStatus,
        endReason,
      };
      const transition =
        tagMode && tagId
          ? await store.completeSetTagTransition({
              dispatchId: root.id,
              dispatchLeaseToken: input.leaseToken,
              stepId: claim.step_id,
              stepLeaseToken: claim.lease_token,
              flowRunId,
              eventId: root.event_id,
              expectedTransitionSeq: run.transition_seq,
              nodeKey: node.node_key,
              mode: tagMode,
              tagId,
              nextNodeKey: requiredString(
                nextNodeKey,
                'set_tag_target_invalid'
              ),
            })
          : node.node_type === 'handoff'
            ? await store.completeHandoff({
                dispatchId: root.id,
                dispatchLeaseToken: input.leaseToken,
                stepId: claim.step_id,
                stepLeaseToken: claim.lease_token,
                flowRunId,
                eventId: root.event_id,
                expectedTransitionSeq: run.transition_seq,
                nodeKey: node.node_key,
              })
          : isInteractiveNode(node.node_type)
            ? await store.completeInteractivePrompt({
                dispatchId: root.id,
                dispatchLeaseToken: input.leaseToken,
                stepId: claim.step_id,
                stepLeaseToken: claim.lease_token,
                flowRunId,
                eventId: root.event_id,
                expectedTransitionSeq: run.transition_seq,
                nodeKey: node.node_key,
              })
          : await store.completeTransition(transitionInput);
      if (transition.applied) {
        if (
          transition.transition_seq !== run.transition_seq + 1 ||
          transition.status !== nextStatus
        ) {
          throw new EvolutionFlowExecutionError('transition_sequence_invalid');
        }
      } else {
        const refreshed = await store.loadRun(flowRunId);
        if (
          !refreshed ||
          refreshed.transition_seq !== run.transition_seq + 1 ||
          refreshed.transition_seq !== transition.transition_seq ||
          refreshed.status !== nextStatus ||
          refreshed.status !== transition.status ||
          refreshed.current_node_key !== nextNodeKey
        ) {
          throw new EvolutionFlowExecutionError('checkpoint_inconsistent');
        }
      }
      transitions += 1;
    }

    return { status: 'transition_limit', flowRunId, transitions };
  };
}

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function throwOnError(error: { code?: string } | null, code: string): void {
  if (error) throw new EvolutionFlowExecutionError(code);
}

function createSupabaseStore(
  db: Pick<SupabaseClient, 'from' | 'rpc'>
): EvolutionFlowStore {
  const sendText = createEvolutionSendAdapter(db);
  const reconcileSend = createEvolutionSendReservationAdapter(db);
  const sendInteractive = createEvolutionInteractiveSendAdapter(db);
  const reconcileInteractiveSend = createEvolutionInteractiveReservationAdapter(db);
  return {
    async loadRoot(dispatchId) {
      const { data, error } = await db
        .from('evolution_event_dispatches')
        .select(
          'id,engine,state,lease_token,flow_id,flow_run_id,event_id,user_id,account_id,contact_id,conversation_id'
        )
        .eq('id', dispatchId)
        .maybeSingle();
      throwOnError(error, 'root_read_failed');
      return (data as DispatchRoot | null) ?? null;
    },
    async isEntryEligible(root) {
      if (!root.flow_id || !root.event_id) return false;
      const [{ data: flow, error: flowError }, { data: event, error: eventError }] =
        await Promise.all([
          db.from('flows')
            .select('account_id,status,trigger_type,trigger_config')
            .eq('id', root.flow_id)
            .maybeSingle(),
          db.from('evolution_events')
            .select('normalized_event')
            .eq('id', root.event_id)
            .maybeSingle(),
        ]);
      throwOnError(flowError, 'flow_read_failed');
      throwOnError(eventError, 'event_read_failed');
      if (!isObject(flow) || flow.account_id !== root.account_id || flow.status !== 'active')
        return false;
      const normalized = isObject(event) ? event.normalized_event : null;
      if (!isObject(normalized) || normalized.kind !== 'message' ||
          normalized.contentType !== 'text' || typeof normalized.text !== 'string' ||
          normalized.fromMe !== false || normalized.sentByApi !== false)
        return false;
      if (root.contact_id) {
        const { data: activeRun, error: activeRunError } = await db
          .from('flow_runs')
          .select('id,flow_id,account_id,user_id,contact_id,conversation_id,current_node_key,transition_seq,status,vars')
          .eq('account_id', root.account_id)
          .eq('contact_id', root.contact_id)
          .eq('status', 'active')
          .maybeSingle();
        throwOnError(activeRunError, 'active_run_read_failed');
        if (activeRun) {
          const run = activeRun as FlowRun;
          if (run.flow_id !== root.flow_id || run.conversation_id !== root.conversation_id ||
              run.user_id !== root.user_id || !run.current_node_key)
            return false;
          const { data: node, error: nodeError } = await db
            .from('flow_nodes')
            .select('node_type')
            .eq('flow_id', run.flow_id)
            .eq('node_key', run.current_node_key)
            .maybeSingle();
          throwOnError(nodeError, 'active_node_read_failed');
          if (node?.node_type !== 'collect_input') return false;
          const promptEventId = await this.loadPromptEventId(run);
          return promptEventId !== null && promptEventId !== root.event_id;
        }
      }

      let isFirstInbound = false;
      if (flow.trigger_type === 'first_inbound_message') {
        if (!root.contact_id || typeof normalized.externalMessageId !== 'string')
          throw new EvolutionFlowExecutionError('entry_event_invalid');
        const { data: conversations, error: conversationsError } = await db
          .from('conversations')
          .select('id')
          .eq('account_id', root.account_id)
          .eq('contact_id', root.contact_id);
        throwOnError(conversationsError, 'conversations_read_failed');
        const conversationIds = (conversations ?? []).map((row) => row.id);
        if (conversationIds.length === 0) return false;
        const { data: inbound, error: inboundError } = await db
          .from('messages')
          .select('message_id')
          .in('conversation_id', conversationIds)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(1);
        throwOnError(inboundError, 'inbound_history_read_failed');
        isFirstInbound = inbound?.length === 1 &&
          inbound[0].message_id === normalized.externalMessageId;
      }
      return matchesEvolutionFlowTrigger(
        String(flow.trigger_type), flow.trigger_config, normalized.text, isFirstInbound
      );
    },
    async loadPromptEventId(run) {
      if (!run.current_node_key) return null;
      const { data, error } = await db
        .from('flow_run_events')
        .select('evolution_event_id')
        .eq('flow_run_id', run.id)
        .eq('event_type', 'message_sent')
        .eq('node_key', run.current_node_key)
        .eq('transition_seq', run.transition_seq)
        .maybeSingle();
      throwOnError(error, 'prompt_checkpoint_read_failed');
      return typeof data?.evolution_event_id === 'string' ? data.evolution_event_id : null;
    },
    async startRoot(dispatchId, leaseToken) {
      const { data, error } = await db.rpc('start_evolution_event_dispatch', {
        p_dispatch_id: dispatchId,
        p_lease_token: leaseToken,
      });
      throwOnError(error, 'root_start_failed');
      const row = firstRow(data);
      if (!isObject(row) || row.state !== 'processing') return null;
      return typeof row.flow_run_id === 'string' ? row.flow_run_id : null;
    },
    async loadRun(runId) {
      const { data, error } = await db
        .from('flow_runs')
        .select(
          'id,flow_id,account_id,user_id,contact_id,conversation_id,current_node_key,transition_seq,status,vars'
        )
        .eq('id', runId)
        .maybeSingle();
      throwOnError(error, 'run_read_failed');
      return (data as FlowRun | null) ?? null;
    },
    async loadNodes(flowId) {
      const { data, error } = await db
        .from('flow_nodes')
        .select('flow_id,node_key,node_type,config')
        .eq('flow_id', flowId);
      throwOnError(error, 'nodes_read_failed');
      return (data as FlowNode[] | null) ?? [];
    },
    async evaluateCondition(root, run, config) {
      const subject = config.subject;
      const subjectKey = requiredString(
        config.subject_key,
        'condition_config_invalid'
      );
      let value: string | undefined;
      if (subject === 'var') {
        if (!isObject(run.vars))
          throw new EvolutionFlowExecutionError('run_vars_invalid');
        const raw = run.vars[subjectKey];
        value =
          raw === undefined || raw === null
            ? undefined
            : typeof raw === 'string'
              ? raw
              : String(raw);
      } else if (subject === 'tag') {
        if (!root.contact_id)
          throw new EvolutionFlowExecutionError('condition_contact_missing');
        const { count, error } = await db
          .from('contact_tags')
          .select('contact_id', { count: 'exact', head: true })
          .eq('contact_id', root.contact_id)
          .eq('tag_id', subjectKey);
        throwOnError(error, 'condition_read_failed');
        value = (count ?? 0) > 0 ? subjectKey : undefined;
      } else if (subject === 'contact_field') {
        if (!root.contact_id)
          throw new EvolutionFlowExecutionError('condition_contact_missing');
        if (!['name', 'email', 'phone', 'company'].includes(subjectKey))
          throw new EvolutionFlowExecutionError('condition_field_unsupported');
        const { data, error } = await db
          .from('contacts')
          .select(subjectKey)
          .eq('id', root.contact_id)
          .eq('account_id', root.account_id)
          .maybeSingle();
        throwOnError(error, 'condition_read_failed');
        const raw = isObject(data) ? data[subjectKey] : undefined;
        value = typeof raw === 'string' && raw !== '' ? raw : undefined;
      } else {
        throw new EvolutionFlowExecutionError('condition_subject_unsupported');
      }
      return compareCondition(config.operator, value, config.value);
    },
    async claimStep(dispatchId, leaseToken, actionKeyValue) {
      const { data, error } = await db.rpc('claim_evolution_dispatch_step', {
        p_dispatch_id: dispatchId,
        p_dispatch_lease_token: leaseToken,
        p_action_key: actionKeyValue,
        p_lease_seconds: 60,
      });
      throwOnError(error, 'step_claim_failed');
      return parseClaim(data);
    },
    async claimSendStep(dispatchId, leaseToken, actionKeyValue) {
      const { data, error } = await db.rpc(
        'claim_evolution_dispatch_send_step',
        {
          p_dispatch_id: dispatchId,
          p_dispatch_lease_token: leaseToken,
          p_action_key: actionKeyValue,
          p_lease_seconds: 60,
        }
      );
      throwOnError(error, 'send_step_claim_failed');
      return parseSendClaim(data);
    },
    async loadSendContext(root, run, config) {
      if (
        !root.event_id ||
        !root.user_id ||
        !root.conversation_id ||
        !root.contact_id ||
        run.user_id !== root.user_id ||
        run.conversation_id !== root.conversation_id
      )
        throw new EvolutionFlowExecutionError('send_root_lineage_invalid');

      const { data: eventData, error: eventError } = await db
        .from('evolution_events')
        .select('id,connection_id,state,normalized_event')
        .eq('id', root.event_id)
        .maybeSingle();
      throwOnError(eventError, 'send_event_read_failed');
      if (!isObject(eventData) || eventData.id !== root.event_id || eventData.state !== 'done')
        throw new EvolutionFlowExecutionError('send_event_invalid');
      const normalized = isObject(eventData.normalized_event)
        ? eventData.normalized_event
        : null;
      if (
        !normalized ||
        normalized.kind !== 'message' ||
        (normalized.contentType !== 'text' &&
          !(normalized.contentType === 'interactive' && root.flow_run_id)) ||
        normalized.fromMe !== false ||
        normalized.sentByApi !== false ||
        typeof normalized.peer !== 'string' ||
        !/^\d{8,15}@s\.whatsapp\.net$/.test(normalized.peer)
      )
        throw new EvolutionFlowExecutionError('send_event_invalid');

      const [conversationResult, contactResult, connectionResult] = await Promise.all([
        db
          .from('conversations')
          .select('id,account_id,contact_id')
          .eq('id', root.conversation_id)
          .eq('account_id', root.account_id)
          .maybeSingle(),
        db
          .from('contacts')
          .select('id,account_id,phone_normalized')
          .eq('id', root.contact_id)
          .eq('account_id', root.account_id)
          .maybeSingle(),
        db
          .from('whatsapp_connections')
          .select('id,account_id,provider,base_url,instance_name,token_encrypted')
          .eq('id', eventData.connection_id)
          .eq('account_id', root.account_id)
          .maybeSingle(),
      ]);
      throwOnError(conversationResult.error, 'send_conversation_read_failed');
      throwOnError(contactResult.error, 'send_contact_read_failed');
      throwOnError(connectionResult.error, 'send_connection_read_failed');

      const conversation = conversationResult.data;
      const contact = contactResult.data;
      const connection = connectionResult.data;
      const peerDigits = normalized.peer.slice(0, normalized.peer.indexOf('@'));
      if (
        !isObject(conversation) ||
        conversation.id !== root.conversation_id ||
        conversation.account_id !== root.account_id ||
        conversation.contact_id !== root.contact_id ||
        !isObject(contact) ||
        contact.id !== root.contact_id ||
        contact.account_id !== root.account_id ||
        contact.phone_normalized !== peerDigits
      )
        throw new EvolutionFlowExecutionError('send_contact_lineage_invalid');
      if (
        !isObject(connection) ||
        connection.id !== eventData.connection_id ||
        connection.account_id !== root.account_id ||
        connection.provider !== 'evolution' ||
        typeof connection.instance_name !== 'string' ||
        !connection.instance_name.trim() ||
        typeof connection.token_encrypted !== 'string' ||
        !connection.token_encrypted
      )
        throw new EvolutionFlowExecutionError('send_connection_invalid');

      let credentials: EvolutionCredentials;
      try {
        credentials = {
          baseUrl: assertAllowedEvolutionOrigin(String(connection.base_url)),
          instanceId: connection.instance_name,
          token: decrypt(connection.token_encrypted),
        };
      } catch {
        throw new EvolutionFlowExecutionError('send_credentials_unavailable');
      }
      if (!credentials.token)
        throw new EvolutionFlowExecutionError('send_credentials_unavailable');

      return {
        connectionId: connection.id,
        conversationId: conversation.id,
        recipient: normalized.peer,
        text: sendTextFromConfig(config, run.vars),
        credentials,
        senderId: root.user_id,
      };
    },
    sendText,
    reconcileSend,
    sendInteractive,
    reconcileInteractiveSend,
    async linkSendAttempt(input) {
      const { data, error } = await db.rpc(
        'complete_evolution_dispatch_step',
        {
          p_step_id: input.stepId,
          p_dispatch_lease_token: input.dispatchLeaseToken,
          p_lease_token: input.stepLeaseToken,
          p_state: input.state,
          p_request_id: input.requestId,
          p_send_attempt_id: input.attemptId,
          p_result: null,
          p_error_code: input.errorCode,
        }
      );
      throwOnError(error, 'send_attempt_checkpoint_failed');
      const row = firstRow(data);
      if (
        !isObject(row) ||
        row.id !== input.stepId ||
        row.state !== input.state ||
        row.send_attempt_id !== input.attemptId
      )
        throw new EvolutionFlowExecutionError('send_attempt_checkpoint_invalid');
    },
    async completeTransition(input) {
      const { data, error } = await db.rpc(
        'complete_evolution_flow_transition',
        {
          p_dispatch_id: input.dispatchId,
          p_dispatch_lease_token: input.dispatchLeaseToken,
          p_step_id: input.stepId,
          p_step_lease_token: input.stepLeaseToken,
          p_flow_run_id: input.flowRunId,
          p_event_id: input.eventId,
          p_expected_transition_seq: input.expectedTransitionSeq,
          p_event_type: input.eventType,
          p_node_key: input.nodeKey,
          p_payload: input.payload,
          p_next_node_key: input.nextNodeKey,
          p_next_status: input.nextStatus,
          p_end_reason: input.endReason,
        }
      );
      throwOnError(error, 'transition_failed');
      return parseTransition(data);
    },
    async completeSetTagTransition(input) {
      const { data, error } = await db.rpc('complete_evolution_flow_set_tag', {
        p_dispatch_id: input.dispatchId,
        p_dispatch_lease_token: input.dispatchLeaseToken,
        p_step_id: input.stepId,
        p_step_lease_token: input.stepLeaseToken,
        p_flow_run_id: input.flowRunId,
        p_event_id: input.eventId,
        p_expected_transition_seq: input.expectedTransitionSeq,
        p_node_key: input.nodeKey,
        p_mode: input.mode,
        p_tag_id: input.tagId,
        p_next_node_key: input.nextNodeKey,
      });
      throwOnError(error, 'set_tag_transition_failed');
      return parseTransition(data);
    },
    async completeCollectInputReply(input) {
      const { data, error } = await db.rpc(
        'complete_evolution_flow_collect_input_reply',
        {
          p_dispatch_id: input.dispatchId,
          p_dispatch_lease_token: input.dispatchLeaseToken,
          p_step_id: input.stepId,
          p_step_lease_token: input.stepLeaseToken,
          p_flow_run_id: input.flowRunId,
          p_event_id: input.eventId,
          p_expected_transition_seq: input.expectedTransitionSeq,
          p_node_key: input.nodeKey,
        }
      );
      throwOnError(error, 'collect_input_reply_failed');
      return parseTransition(data);
    },
    async completeHandoff(input) {
      const { data, error } = await db.rpc('complete_evolution_flow_handoff', {
        p_dispatch_id: input.dispatchId,
        p_dispatch_lease_token: input.dispatchLeaseToken,
        p_step_id: input.stepId,
        p_step_lease_token: input.stepLeaseToken,
        p_flow_run_id: input.flowRunId,
        p_event_id: input.eventId,
        p_expected_transition_seq: input.expectedTransitionSeq,
        p_node_key: input.nodeKey,
      });
      throwOnError(error, 'handoff_transition_failed');
      return parseTransition(data);
    },
    async completeInteractivePrompt(input) {
      const { data, error } = await db.rpc('complete_evolution_flow_interactive_prompt', {
        p_dispatch_id: input.dispatchId,
        p_dispatch_lease_token: input.dispatchLeaseToken,
        p_step_id: input.stepId,
        p_step_lease_token: input.stepLeaseToken,
        p_flow_run_id: input.flowRunId,
        p_event_id: input.eventId,
        p_expected_transition_seq: input.expectedTransitionSeq,
        p_node_key: input.nodeKey,
      });
      throwOnError(error, 'interactive_prompt_transition_failed');
      return parseInteractiveTransition(data, 'prompt_message_id') as Awaited<ReturnType<EvolutionFlowStore['completeInteractivePrompt']>>;
    },
    async completeInteractiveReply(input) {
      const { data, error } = await db.rpc('complete_evolution_flow_interactive_reply', {
        p_dispatch_id: input.dispatchId,
        p_dispatch_lease_token: input.dispatchLeaseToken,
        p_step_id: input.stepId,
        p_step_lease_token: input.stepLeaseToken,
        p_flow_run_id: input.flowRunId,
        p_event_id: input.eventId,
        p_expected_transition_seq: input.expectedTransitionSeq,
        p_node_key: input.nodeKey,
      });
      throwOnError(error, 'interactive_reply_transition_failed');
      return parseInteractiveTransition(data, 'next_node_key') as Awaited<ReturnType<EvolutionFlowStore['completeInteractiveReply']>>;
    },
    async completeRoot(dispatchId, leaseToken, state, errorCode) {
      const { error } = await db.rpc('complete_evolution_dispatch', {
        p_dispatch_id: dispatchId,
        p_lease_token: leaseToken,
        p_state: state,
        p_result: null,
        p_error_code: errorCode,
      });
      throwOnError(error, 'root_completion_failed');
    },
  };
}

/** Process a single already-claimed Evolution Flow dispatch root. */
export async function processEvolutionFlowRoot(input: {
  dispatchId: string;
  leaseToken: string;
}): Promise<EvolutionFlowExecutionResult> {
  const db = supabaseAdmin();
  return createEvolutionFlowExecutor(createSupabaseStore(db))(input);
}
