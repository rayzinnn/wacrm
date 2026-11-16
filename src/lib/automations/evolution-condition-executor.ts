import 'server-only';
import type { AutomationStep, ConditionStepConfig } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  isValidTimeZone,
  isWithinTimeWindow,
} from '@/lib/automations/time-of-day';

export interface EvolutionConditionRoot {
  id: string;
  lease_token: string;
  account_id: string;
}

export type EvolutionConditionExecution =
  | {
      executed: false;
      step_id: string;
      action_key: string;
      state: string;
      branch?: 'yes' | 'no';
      error_code?: string;
    }
  | {
      executed: true;
      step_id: string;
      action_key: string;
      state: 'done';
      branch: 'yes' | 'no';
      result: { branch: 'yes' | 'no' };
    };

export class EvolutionConditionExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'EvolutionConditionExecutionError';
  }
}

interface RootRow {
  id: string;
  event_id: string;
  account_id: string;
  engine: string;
  automation_id: string | null;
  contact_id: string | null;
  state: string;
  lease_until: string | null;
  lease_token: string | null;
}

interface PersistedConditionStep {
  id: string;
  automation_id: string;
  step_type: string;
  step_config: unknown;
}

interface StepClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  send_attempt_id: string | null;
  should_execute: boolean;
}

interface StepRow {
  id: string;
  dispatch_id: string;
  action_key: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  send_attempt_id: string | null;
  result: unknown;
}

interface CompletedStep {
  id: string;
  state: string;
  result: unknown;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_STATES = [
  'pending',
  'processing',
  'done',
  'skipped',
  'failed',
  'unknown',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new EvolutionConditionExecutionError(
      'invalid_input',
      `${field} must be a UUID`
    );
  }
  return value;
}

function oneRow<T>(data: unknown, label: string): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new EvolutionConditionExecutionError(
      `${label}_response_invalid`,
      `${label} returned an invalid response`
    );
  }
  return rows[0] as T;
}

function rpcFailure(error: { code?: string } | null, operation: string): never {
  throw new EvolutionConditionExecutionError(
    error?.code === '55000' || error?.code === '40001'
      ? 'stale_lease'
      : `${operation}_failed`,
    `${operation} failed`
  );
}

function branchFromResult(value: unknown): 'yes' | 'no' {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    (value.branch !== 'yes' && value.branch !== 'no')
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_result_invalid',
      'Completed condition step has no valid persisted branch'
    );
  }
  return value.branch;
}

function parseConditionConfig(value: unknown): ConditionStepConfig {
  if (!isRecord(value)) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Condition configuration must be an object'
    );
  }
  const subject = value.subject;
  if (
    subject !== 'tag_presence' &&
    subject !== 'contact_field' &&
    subject !== 'message_content' &&
    subject !== 'time_of_day'
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Condition subject is unsupported'
    );
  }

  if (
    subject !== 'message_content' &&
    (typeof value.operand !== 'string' || !value.operand.trim())
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Condition operand is required'
    );
  }
  if (
    (subject === 'contact_field' || subject === 'message_content') &&
    (typeof value.value !== 'string' || !value.value.trim())
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Condition comparison value is required'
    );
  }
  if (
    subject === 'tag_presence' &&
    !UUID_PATTERN.test(value.operand as string)
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Tag condition operand must be a UUID'
    );
  }
  if (
    subject === 'contact_field' &&
    !/^[a-z_][a-z0-9_]*$/i.test(value.operand as string)
  ) {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Contact field condition operand is invalid'
    );
  }
  if (value.timezone !== undefined && typeof value.timezone !== 'string') {
    throw new EvolutionConditionExecutionError(
      'condition_config_invalid',
      'Condition timezone must be a string'
    );
  }

  return value as unknown as ConditionStepConfig;
}

async function evaluateCondition(
  config: ConditionStepConfig,
  root: RootRow,
  db: ReturnType<typeof supabaseAdmin>
): Promise<boolean> {
  switch (config.subject) {
    case 'tag_presence': {
      if (!root.contact_id || !config.operand) {
        throw new EvolutionConditionExecutionError(
          'condition_contact_lineage_invalid',
          'Condition root has no contact lineage'
        );
      }
      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('id')
        .eq('id', root.contact_id)
        .eq('account_id', root.account_id)
        .maybeSingle();
      if (contactError) {
        throw new EvolutionConditionExecutionError(
          'condition_read_failed',
          'Could not validate contact account lineage'
        );
      }
      if (!contact || (contact as { id?: string }).id !== root.contact_id) {
        throw new EvolutionConditionExecutionError(
          'condition_contact_lineage_invalid',
          'Condition contact does not belong to the root account'
        );
      }
      const { count, error } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', root.contact_id)
        .eq('tag_id', config.operand);
      if (error) {
        throw new EvolutionConditionExecutionError(
          'condition_read_failed',
          'Could not read contact tag condition'
        );
      }
      return (count ?? 0) > 0;
    }
    case 'contact_field': {
      if (!root.contact_id || !config.operand || !(config.value ?? '').trim())
        return false;
      const { data, error } = await db
        .from('contacts')
        .select(config.operand)
        .eq('id', root.contact_id)
        .eq('account_id', root.account_id)
        .maybeSingle();
      if (error) {
        throw new EvolutionConditionExecutionError(
          'condition_read_failed',
          'Could not read contact field condition'
        );
      }
      const actual = (data as Record<string, unknown> | null)?.[config.operand];
      return actual != null && String(actual) === String(config.value);
    }
    case 'message_content': {
      const { data: eventData, error: eventError } = await db
        .from('evolution_events')
        .select('id,state,normalized_event')
        .eq('id', root.event_id)
        .maybeSingle();
      if (eventError) {
        throw new EvolutionConditionExecutionError(
          'condition_read_failed',
          'Could not read the root inbound event'
        );
      }
      const normalized = isRecord(
        (eventData as { normalized_event?: unknown } | null)?.normalized_event
      )
        ? (eventData as { normalized_event: Record<string, unknown> })
            .normalized_event
        : null;
      if (
        !eventData ||
        (eventData as { id?: string }).id !== root.event_id ||
        (eventData as { state?: string }).state !== 'done' ||
        !normalized ||
        normalized.kind !== 'message' ||
        normalized.contentType !== 'text' ||
        normalized.fromMe !== false ||
        normalized.sentByApi !== false ||
        typeof normalized.text !== 'string'
      ) {
        throw new EvolutionConditionExecutionError(
          'condition_context_invalid',
          'Root event is not a persisted inbound Evolution text message'
        );
      }
      const needle = (config.value ?? '').trim().toLowerCase();
      if (!needle) return false;
      return normalized.text.toLowerCase().includes(needle);
    }
    case 'time_of_day':
      if (config.timezone && !isValidTimeZone(config.timezone)) return false;
      return isWithinTimeWindow(config.operand, new Date(), config.timezone);
  }
}

async function completeStep(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    dispatchId: string;
    dispatchLeaseToken: string;
    stepId: string;
    stepLeaseToken: string;
    requestId: string;
    state: 'done' | 'failed';
    result: { branch: 'yes' | 'no' } | null;
    errorCode: string | null;
  }
): Promise<CompletedStep> {
  const { data, error } = await db.rpc('complete_evolution_dispatch_step', {
    p_step_id: args.stepId,
    p_dispatch_lease_token: args.dispatchLeaseToken,
    p_lease_token: args.stepLeaseToken,
    p_state: args.state,
    p_request_id: args.requestId,
    p_send_attempt_id: null,
    p_result: args.result,
    p_error_code: args.errorCode,
  });
  if (error) rpcFailure(error, 'complete');
  const completed = oneRow<CompletedStep>(data, 'complete');
  if (completed.id !== args.stepId || completed.state !== args.state) {
    throw new EvolutionConditionExecutionError(
      'complete_response_invalid',
      'Step completion response does not match the requested state'
    );
  }
  return completed;
}

/** Evaluates and checkpoints one persisted Evolution automation condition. */
export async function executeEvolutionAutomationCondition(input: {
  root: EvolutionConditionRoot;
  step: Pick<AutomationStep, 'id'>;
}): Promise<EvolutionConditionExecution> {
  const dispatchId = uuid(input.root.id, 'root.id');
  const dispatchLeaseToken = uuid(input.root.lease_token, 'root.lease_token');
  const accountId = uuid(input.root.account_id, 'root.account_id');
  const stepId = uuid(input.step.id, 'step.id');
  const db = supabaseAdmin();

  const { data: rootData, error: rootError } = await db
    .from('evolution_event_dispatches')
    .select(
      'id,event_id,account_id,engine,automation_id,contact_id,state,lease_until,lease_token'
    )
    .eq('id', dispatchId)
    .maybeSingle();
  if (rootError || !rootData) {
    throw new EvolutionConditionExecutionError(
      'root_load_failed',
      'Could not load condition dispatch root'
    );
  }
  const root = rootData as RootRow;
  if (
    root.id !== dispatchId ||
    root.account_id !== accountId ||
    root.engine !== 'automation' ||
    !root.automation_id ||
    root.state !== 'processing' ||
    root.lease_token !== dispatchLeaseToken ||
    !root.lease_until ||
    !Number.isFinite(Date.parse(root.lease_until)) ||
    Date.parse(root.lease_until) <= Date.now()
  ) {
    throw new EvolutionConditionExecutionError(
      'root_lineage_invalid',
      'Root is not a reserved automation dispatch with a live lease'
    );
  }
  uuid(root.automation_id, 'root.automation_id');
  uuid(root.event_id, 'root.event_id');
  if (root.contact_id) uuid(root.contact_id, 'root.contact_id');

  const { data: claimData, error: claimError } = await db.rpc(
    'claim_evolution_dispatch_step',
    {
      p_dispatch_id: dispatchId,
      p_dispatch_lease_token: dispatchLeaseToken,
      p_action_key: stepId,
    }
  );
  if (claimError) rpcFailure(claimError, 'claim');
  const claim = oneRow<StepClaim>(claimData, 'claim');
  if (
    !UUID_PATTERN.test(claim.step_id) ||
    typeof claim.should_execute !== 'boolean' ||
    !CLAIM_STATES.includes(claim.state)
  ) {
    throw new EvolutionConditionExecutionError(
      'claim_response_invalid',
      'Step claim response is invalid'
    );
  }
  const { data: ledgerData, error: ledgerError } = await db
    .from('evolution_dispatch_steps')
    .select(
      'id,dispatch_id,action_key,state,lease_token,request_id,send_attempt_id,result'
    )
    .eq('id', claim.step_id)
    .eq('dispatch_id', dispatchId)
    .eq('action_key', stepId)
    .maybeSingle();
  if (ledgerError || !ledgerData) {
    throw new EvolutionConditionExecutionError(
      'claim_lineage_invalid',
      'Claim does not match its persisted dispatch step'
    );
  }
  const ledger = ledgerData as StepRow;
  if (
    ledger.id !== claim.step_id ||
    ledger.dispatch_id !== dispatchId ||
    ledger.action_key !== stepId ||
    ledger.state !== claim.state ||
    ledger.lease_token !== claim.lease_token ||
    ledger.request_id !== claim.request_id ||
    ledger.request_id !== `evolution-step:${ledger.id}` ||
    ledger.send_attempt_id !== claim.send_attempt_id
  ) {
    throw new EvolutionConditionExecutionError(
      'claim_lineage_invalid',
      'Claim does not match its persisted dispatch step'
    );
  }
  if (!claim.should_execute) {
    if (claim.state !== 'done') {
      return {
        executed: false,
        step_id: claim.step_id,
        action_key: stepId,
        state: claim.state,
      };
    }
    const branch = branchFromResult(ledger.result);
    return {
      executed: false,
      step_id: ledger.id,
      action_key: stepId,
      state: 'done',
      branch,
    };
  }

  if (
    claim.state !== 'processing' ||
    !claim.lease_token ||
    !UUID_PATTERN.test(claim.lease_token) ||
    claim.send_attempt_id !== null ||
    claim.request_id !== `evolution-step:${claim.step_id}`
  ) {
    throw new EvolutionConditionExecutionError(
      'claim_response_invalid',
      'Executable condition claim is missing a valid fenced lease'
    );
  }

  const { data: stepConfigData, error: stepConfigError } = await db
    .from('automation_steps')
    .select('id,automation_id,step_type,step_config')
    .eq('id', stepId)
    .eq('automation_id', root.automation_id)
    .maybeSingle();
  if (stepConfigError || !stepConfigData) {
    const completed = await completeStep(db, {
      dispatchId,
      dispatchLeaseToken,
      stepId: claim.step_id,
      stepLeaseToken: claim.lease_token,
      requestId: claim.request_id,
      state: 'failed',
      result: null,
      errorCode: 'condition_step_invalid',
    });
    return {
      executed: false,
      step_id: completed.id,
      action_key: stepId,
      state: 'failed',
      error_code: 'condition_step_invalid',
    };
  }

  const persisted = stepConfigData as PersistedConditionStep;
  if (
    persisted.id !== stepId ||
    persisted.automation_id !== root.automation_id ||
    persisted.step_type !== 'condition'
  ) {
    const completed = await completeStep(db, {
      dispatchId,
      dispatchLeaseToken,
      stepId: claim.step_id,
      stepLeaseToken: claim.lease_token,
      requestId: claim.request_id,
      state: 'failed',
      result: null,
      errorCode: 'condition_step_invalid',
    });
    return {
      executed: false,
      step_id: completed.id,
      action_key: stepId,
      state: 'failed',
      error_code: 'condition_step_invalid',
    };
  }

  let config: ConditionStepConfig;
  try {
    config = parseConditionConfig(persisted.step_config);
  } catch (error) {
    if (!(error instanceof EvolutionConditionExecutionError)) throw error;
    const completed = await completeStep(db, {
      dispatchId,
      dispatchLeaseToken,
      stepId: claim.step_id,
      stepLeaseToken: claim.lease_token,
      requestId: claim.request_id,
      state: 'failed',
      result: null,
      errorCode: 'condition_config_invalid',
    });
    return {
      executed: false,
      step_id: completed.id,
      action_key: stepId,
      state: 'failed',
      error_code: 'condition_config_invalid',
    };
  }

  let matches: boolean;
  try {
    matches = await evaluateCondition(config, root, db);
  } catch (error) {
    if (
      !(error instanceof EvolutionConditionExecutionError) ||
      (error.code !== 'condition_contact_lineage_invalid' &&
        error.code !== 'condition_context_invalid')
    ) {
      throw error;
    }
    const completed = await completeStep(db, {
      dispatchId,
      dispatchLeaseToken,
      stepId: claim.step_id,
      stepLeaseToken: claim.lease_token,
      requestId: claim.request_id,
      state: 'failed',
      result: null,
      errorCode: error.code,
    });
    return {
      executed: false,
      step_id: completed.id,
      action_key: stepId,
      state: 'failed',
      error_code: error.code,
    };
  }
  const result = { branch: matches ? 'yes' : 'no' } as const;
  const completed = await completeStep(db, {
    dispatchId,
    dispatchLeaseToken,
    stepId: claim.step_id,
    stepLeaseToken: claim.lease_token,
    requestId: claim.request_id,
    state: 'done',
    result,
    errorCode: null,
  });
  const branch = branchFromResult(completed.result);
  return {
    executed: true,
    step_id: completed.id,
    action_key: stepId,
    state: 'done',
    branch,
    result: { branch },
  };
}
