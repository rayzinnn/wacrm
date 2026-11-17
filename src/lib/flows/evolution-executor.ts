import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';

type JsonObject = Record<string, unknown>;

interface DispatchRoot {
  id: string;
  engine: string;
  state: string;
  lease_token: string | null;
  flow_id: string | null;
  flow_run_id: string | null;
  event_id: string | null;
  account_id: string;
  contact_id: string | null;
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
}

interface TransitionInput {
  dispatchId: string;
  dispatchLeaseToken: string;
  stepId: string;
  stepLeaseToken: string;
  flowRunId: string;
  eventId: string;
  expectedTransitionSeq: number;
  eventType: 'started' | 'node_entered' | 'completed';
  nodeKey: string;
  payload: JsonObject;
  nextNodeKey: string | null;
  nextStatus: 'active' | 'completed';
  endReason: string | null;
}

export interface EvolutionFlowStore {
  loadRoot(dispatchId: string): Promise<DispatchRoot | null>;
  startRoot(dispatchId: string, leaseToken: string): Promise<string | null>;
  loadRun(runId: string): Promise<FlowRun | null>;
  loadNodes(flowId: string): Promise<FlowNode[]>;
  evaluateCondition(
    root: DispatchRoot,
    run: FlowRun,
    config: JsonObject,
  ): Promise<boolean>;
  claimStep(
    dispatchId: string,
    leaseToken: string,
    actionKey: string,
  ): Promise<StepClaim>;
  completeTransition(input: TransitionInput): Promise<{
    applied: boolean;
    transition_seq: number;
    status: string;
  }>;
  completeRoot(
    dispatchId: string,
    leaseToken: string,
    state: 'done' | 'failed',
    errorCode: string | null,
  ): Promise<void>;
}

export type EvolutionFlowExecutionResult =
  | { status: 'done'; flowRunId: string; transitions: number }
  | { status: 'waiting'; flowRunId: string; nodeKey: string }
  | { status: 'unsupported_node'; flowRunId: string; nodeKey: string; nodeType: string }
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

function compareCondition(
  operator: unknown,
  subject: string | undefined,
  value: unknown,
): boolean {
  switch (operator) {
    case 'present':
      return subject !== undefined && subject !== '';
    case 'absent':
      return subject === undefined || subject === '';
    case 'equals':
      return subject !== undefined && subject === (typeof value === 'string' ? value : '');
    case 'contains':
      return subject !== undefined && subject.includes(typeof value === 'string' ? value : '');
    default:
      throw new EvolutionFlowExecutionError('condition_operator_unsupported');
  }
}

function actionKey(run: FlowRun, nodeKey: string): string {
  const value = `evolution-flow:${run.id}:${run.transition_seq}:${nodeKey}`;
  if (value.length > 200) throw new EvolutionFlowExecutionError('action_key_invalid');
  return value;
}

const TERMINAL_STATUSES = new Set(['completed', 'handed_off', 'timed_out', 'paused_by_agent', 'cancelled', 'failed']);
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
      if (!root.flow_run_id) throw new EvolutionFlowExecutionError('root_run_missing');
      const completedRun = await store.loadRun(root.flow_run_id);
      if (!completedRun || completedRun.status !== 'completed')
        throw new EvolutionFlowExecutionError('root_terminal_mismatch');
      return { status: 'done', flowRunId: root.flow_run_id, transitions: 0 };
    }
    if (root.state !== 'processing' || root.lease_token !== input.leaseToken)
      throw new EvolutionFlowExecutionError('stale_root_lease');

    const flowRunId = await store.startRoot(root.id, input.leaseToken);
    if (!flowRunId) throw new EvolutionFlowExecutionError('root_start_skipped');
    const nodes = await store.loadNodes(root.flow_id);
    const nodesByKey = new Map(nodes.map((node) => [node.node_key, node]));
    let transitions = 0;

    while (transitions < MAX_TRANSITIONS) {
      const run = await store.loadRun(flowRunId);
      if (!run || run.flow_id !== root.flow_id || run.account_id !== root.account_id || run.contact_id !== root.contact_id)
        throw new EvolutionFlowExecutionError('run_lineage_invalid');
      if (TERMINAL_STATUSES.has(run.status)) {
        if (run.status === 'completed') {
          await store.completeRoot(root.id, input.leaseToken, 'done', null);
          return { status: 'done', flowRunId, transitions };
        }
        await store.completeRoot(root.id, input.leaseToken, 'failed', `flow_run_${run.status}`);
        return { status: 'terminal_non_success', flowRunId, runStatus: run.status };
      }
      if (run.status !== 'active' || !run.current_node_key)
        throw new EvolutionFlowExecutionError('run_state_invalid');

      const node = nodesByKey.get(run.current_node_key);
      if (!node || node.flow_id !== root.flow_id)
        throw new EvolutionFlowExecutionError('current_node_missing');
      if (node.node_type !== 'start' && node.node_type !== 'condition' && node.node_type !== 'end') {
        return { status: 'unsupported_node', flowRunId, nodeKey: node.node_key, nodeType: node.node_type };
      }
      if (!isObject(node.config)) throw new EvolutionFlowExecutionError('node_config_invalid');

      let eventType: TransitionInput['eventType'];
      let payload: JsonObject = {};
      let nextNodeKey: string | null;
      let nextStatus: TransitionInput['nextStatus'] = 'active';
      let endReason: string | null = null;

      if (node.node_type === 'start') {
        eventType = 'started';
        nextNodeKey = requiredString(node.config.next_node_key, 'start_target_invalid');
      } else if (node.node_type === 'condition') {
        eventType = 'node_entered';
        const branch = (await store.evaluateCondition(root, run, node.config)) ? 'yes' : 'no';
        payload = { branch };
        nextNodeKey = requiredString(
          branch === 'yes' ? node.config.true_next : node.config.false_next,
          'condition_target_invalid',
        );
      } else {
        eventType = 'completed';
        nextNodeKey = null;
        nextStatus = 'completed';
        endReason = 'end_node';
      }

      if (nextNodeKey !== null && !nodesByKey.has(nextNodeKey))
        throw new EvolutionFlowExecutionError('next_node_missing');

      const claim = await store.claimStep(root.id, input.leaseToken, actionKey(run, node.node_key));
      if (!claim.should_execute) {
        if (claim.state === 'done') {
          const refreshed = await store.loadRun(flowRunId);
          if (!refreshed || refreshed.transition_seq <= run.transition_seq)
            throw new EvolutionFlowExecutionError('checkpoint_inconsistent');
          transitions += 1;
          continue;
        }
        return { status: 'waiting', flowRunId, nodeKey: node.node_key };
      }
      if (claim.state !== 'processing' || !claim.lease_token || !claim.request_id)
        throw new EvolutionFlowExecutionError('step_claim_invalid');

      const transition = await store.completeTransition({
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
      });
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
  return Array.isArray(data) ? data[0] ?? null : data;
}

function throwOnError(error: { code?: string } | null, code: string): void {
  if (error) throw new EvolutionFlowExecutionError(code);
}

function createSupabaseStore(db: Pick<SupabaseClient, 'from' | 'rpc'>): EvolutionFlowStore {
  return {
    async loadRoot(dispatchId) {
      const { data, error } = await db
        .from('evolution_event_dispatches')
        .select('id,engine,state,lease_token,flow_id,flow_run_id,event_id,account_id,contact_id')
        .eq('id', dispatchId)
        .maybeSingle();
      throwOnError(error, 'root_read_failed');
      return (data as DispatchRoot | null) ?? null;
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
        .select('id,flow_id,account_id,contact_id,current_node_key,transition_seq,status,vars')
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
      const subjectKey = requiredString(config.subject_key, 'condition_config_invalid');
      let value: string | undefined;
      if (subject === 'var') {
        if (!isObject(run.vars)) throw new EvolutionFlowExecutionError('run_vars_invalid');
        const raw = run.vars[subjectKey];
        value = raw === undefined || raw === null ? undefined : typeof raw === 'string' ? raw : String(raw);
      } else if (subject === 'tag') {
        if (!root.contact_id) throw new EvolutionFlowExecutionError('condition_contact_missing');
        const { count, error } = await db
          .from('contact_tags')
          .select('contact_id', { count: 'exact', head: true })
          .eq('contact_id', root.contact_id)
          .eq('tag_id', subjectKey);
        throwOnError(error, 'condition_read_failed');
        value = (count ?? 0) > 0 ? subjectKey : undefined;
      } else if (subject === 'contact_field') {
        if (!root.contact_id) throw new EvolutionFlowExecutionError('condition_contact_missing');
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
    async completeTransition(input) {
      const { data, error } = await db.rpc('complete_evolution_flow_transition', {
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
      });
      throwOnError(error, 'transition_failed');
      return parseTransition(data);
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
