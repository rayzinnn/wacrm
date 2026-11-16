import 'server-only';
import type {
  AssignConversationStepConfig,
  AutomationStep,
  CreateDealStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
} from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export interface EvolutionAutomationStepRoot {
  id: string;
  lease_token: string;
  account_id: string;
  contact_id: string;
  conversation_id: string;
}

export type EvolutionAutomationStepExecution =
  | {
      executed: false;
      step_id: string;
      state: string;
      request_id: string | null;
      send_attempt_id: string | null;
    }
  | {
      executed: true;
      step_id: string;
      state: string;
      result: unknown;
    };

export class EvolutionAutomationStepError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'EvolutionAutomationStepError';
  }
}

type EffectOperation =
  | 'add_tag'
  | 'remove_tag'
  | 'update_contact_field'
  | 'create_deal'
  | 'assign_conversation'
  | 'wait';

type JsonObject = Record<string, string | number | boolean | null>;

interface StepClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  send_attempt_id: string | null;
  should_execute: boolean;
}

interface AppliedEffect {
  step_id: string;
  state: string;
  result: unknown;
}

interface DispatchStepLedger {
  id: string;
  dispatch_id: string;
  action_key: string;
  state: string;
  lease_token: string | null;
  request_id: string;
  send_attempt_id: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new EvolutionAutomationStepError(
      'invalid_input',
      `${label} must be a UUID`
    );
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new EvolutionAutomationStepError(
      'invalid_step_config',
      `${label} must be a string`
    );
  }
  return value;
}

function requireStaticString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (/\{\{\s*[\w.]+\s*\}\}/.test(text)) {
    throw new EvolutionAutomationStepError(
      'interpolation_context_required',
      `${label} requires runtime interpolation context`
    );
  }
  return text;
}

function requireConfig<T extends Record<string, unknown>>(
  value: unknown,
  label: string
): T {
  if (!isRecord(value)) {
    throw new EvolutionAutomationStepError(
      'invalid_step_config',
      `${label} must be an object`
    );
  }
  return value as T;
}

async function buildEffect(
  root: EvolutionAutomationStepRoot,
  step: AutomationStep
): Promise<{ operation: EffectOperation; payload: JsonObject }> {
  switch (step.step_type) {
    case 'add_tag':
    case 'remove_tag': {
      const config = requireConfig<TagStepConfig & Record<string, unknown>>(
        step.step_config,
        'tag step config'
      );
      return {
        operation: step.step_type,
        payload: {
          contact_id: root.contact_id,
          tag_id: requireUuid(config.tag_id, 'tag_id'),
        },
      };
    }
    case 'update_contact_field': {
      const config = requireConfig<
        UpdateContactFieldStepConfig & Record<string, unknown>
      >(step.step_config, 'contact field step config');
      return {
        operation: step.step_type,
        payload: {
          contact_id: root.contact_id,
          field: requireString(config.field, 'field'),
          value: requireStaticString(config.value, 'value'),
        },
      };
    }
    case 'create_deal': {
      const config = requireConfig<
        CreateDealStepConfig & Record<string, unknown>
      >(step.step_config, 'deal step config');
      const { data, error } = await supabaseAdmin()
        .from('accounts')
        .select('default_currency')
        .eq('id', root.account_id)
        .maybeSingle();
      if (error || !data || typeof data.default_currency !== 'string') {
        throw new EvolutionAutomationStepError(
          'account_currency_unavailable',
          'Could not resolve the dispatch account currency'
        );
      }
      if (!/^[A-Z]{3}$/.test(data.default_currency)) {
        throw new EvolutionAutomationStepError(
          'account_currency_invalid',
          'Dispatch account currency is invalid'
        );
      }
      const value = config.value ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new EvolutionAutomationStepError(
          'invalid_step_config',
          'deal value must be finite'
        );
      }
      return {
        operation: step.step_type,
        payload: {
          contact_id: root.contact_id,
          pipeline_id: requireUuid(config.pipeline_id, 'pipeline_id'),
          stage_id: requireUuid(config.stage_id, 'stage_id'),
          title: requireStaticString(config.title, 'title'),
          value,
          currency: data.default_currency,
          status: 'open',
        },
      };
    }
    case 'assign_conversation': {
      const config = requireConfig<
        AssignConversationStepConfig & Record<string, unknown>
      >(step.step_config, 'assignment step config');
      if (config.mode !== 'specific') {
        throw new EvolutionAutomationStepError(
          'unsupported_assignment_mode',
          'Only specific conversation assignment is supported'
        );
      }
      return {
        operation: step.step_type,
        payload: {
          conversation_id: root.conversation_id,
          assigned_agent_id: requireUuid(config.agent_id, 'agent_id'),
        },
      };
    }
    case 'wait': {
      const config = requireConfig<WaitStepConfig & Record<string, unknown>>(
        step.step_config,
        'wait step config'
      );
      if (
        typeof config.amount !== 'number' ||
        !Number.isFinite(config.amount) ||
        !['minutes', 'hours', 'days'].includes(config.unit)
      ) {
        throw new EvolutionAutomationStepError(
          'invalid_step_config',
          'wait config is invalid'
        );
      }
      // The SQL RPC derives the wait deadline and resume point from the
      // persisted step, dispatch root and inbound event. Its payload is empty.
      return { operation: step.step_type, payload: {} };
    }
    default:
      throw new EvolutionAutomationStepError(
        'unsupported_step_type',
        `Step type ${step.step_type} has no local Evolution effect`
      );
  }
}

function oneRow<T>(data: unknown, operation: 'claim' | 'effect'): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new EvolutionAutomationStepError(
      `${operation}_response_invalid`,
      `Evolution step ${operation} returned an invalid response`
    );
  }
  return rows[0] as T;
}

function rpcErrorCode(error: { code?: string } | null): string {
  return error?.code === '55000' ? 'stale_lease' : 'rpc_failed';
}

/** Claims and applies one persisted automation step through fenced SQL RPCs. */
export async function executeEvolutionAutomationStep(input: {
  root: EvolutionAutomationStepRoot;
  step: AutomationStep;
}): Promise<EvolutionAutomationStepExecution> {
  const root = input.root;
  requireUuid(root.id, 'root.id');
  requireUuid(root.lease_token, 'root.lease_token');
  requireUuid(root.account_id, 'root.account_id');
  requireUuid(root.contact_id, 'root.contact_id');
  requireUuid(root.conversation_id, 'root.conversation_id');
  const stepId = requireUuid(input.step.id, 'step.id');
  const { operation, payload } = await buildEffect(root, input.step);

  const db = supabaseAdmin();
  const { data: claimData, error: claimError } = await db.rpc(
    'claim_evolution_dispatch_step',
    {
      p_dispatch_id: root.id,
      p_dispatch_lease_token: root.lease_token,
      p_action_key: stepId,
    }
  );
  if (claimError) {
    throw new EvolutionAutomationStepError(
      rpcErrorCode(claimError),
      'Could not claim the Evolution automation step'
    );
  }

  const claim = oneRow<StepClaim>(claimData, 'claim');
  if (
    typeof claim.step_id !== 'string' ||
    !UUID_PATTERN.test(claim.step_id) ||
    typeof claim.should_execute !== 'boolean' ||
    !['pending', 'processing', 'done', 'skipped', 'failed', 'unknown'].includes(
      claim.state
    )
  ) {
    throw new EvolutionAutomationStepError(
      'claim_response_invalid',
      'Claim did not match the step'
    );
  }

  const { data: ledgerData, error: ledgerError } = await db
    .from('evolution_dispatch_steps')
    .select(
      'id,dispatch_id,action_key,state,lease_token,request_id,send_attempt_id'
    )
    .eq('id', claim.step_id)
    .eq('dispatch_id', root.id)
    .eq('action_key', stepId)
    .maybeSingle();
  if (ledgerError || !ledgerData) {
    throw new EvolutionAutomationStepError(
      'claim_lineage_invalid',
      'Claim does not belong to the requested dispatch action'
    );
  }
  const ledger = ledgerData as DispatchStepLedger;
  if (
    ledger.id !== claim.step_id ||
    ledger.dispatch_id !== root.id ||
    ledger.action_key !== stepId ||
    ledger.state !== claim.state ||
    ledger.lease_token !== claim.lease_token ||
    ledger.request_id !== `evolution-step:${ledger.id}` ||
    ledger.request_id !== claim.request_id ||
    ledger.send_attempt_id !== claim.send_attempt_id
  ) {
    throw new EvolutionAutomationStepError(
      'claim_lineage_invalid',
      'Claim does not match its persisted dispatch step'
    );
  }

  if (!claim.should_execute) {
    return {
      executed: false,
      step_id: ledger.id,
      state: claim.state,
      request_id: claim.request_id,
      send_attempt_id: claim.send_attempt_id,
    };
  }
  if (
    claim.state !== 'processing' ||
    !claim.lease_token ||
    !UUID_PATTERN.test(claim.lease_token)
  ) {
    throw new EvolutionAutomationStepError(
      'claim_response_invalid',
      'Executable claim did not contain a valid processing lease'
    );
  }

  const { data: effectData, error: effectError } = await db.rpc(
    'apply_evolution_automation_effect',
    {
      p_dispatch_id: root.id,
      p_dispatch_lease_token: root.lease_token,
      p_step_id: ledger.id,
      p_step_lease_token: claim.lease_token,
      p_operation: operation,
      p_payload: payload,
    }
  );
  if (effectError) {
    throw new EvolutionAutomationStepError(
      rpcErrorCode(effectError),
      'Could not apply the Evolution automation effect'
    );
  }

  const effect = oneRow<AppliedEffect>(effectData, 'effect');
  if (effect.step_id !== ledger.id || effect.state !== 'done') {
    throw new EvolutionAutomationStepError(
      'effect_response_invalid',
      'Evolution automation effect did not complete the claimed step'
    );
  }
  return {
    executed: true,
    step_id: effect.step_id,
    state: effect.state,
    result: effect.result,
  };
}
