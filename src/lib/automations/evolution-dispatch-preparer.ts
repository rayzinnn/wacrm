import 'server-only';
import type { AutomationTriggerType } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { isEligibleInboundTextAutomation } from '@/lib/automations/inbound-text-eligibility';

export interface ReservedEvolutionAutomationDispatch {
  dispatch_id: string;
  lease_token: string;
  account_id: string;
  isFirstInbound?: boolean;
}

export interface PreparedEvolutionAutomationContext {
  dispatch: {
    id: string;
    lease_token: string;
    account_id: string;
    automation_id: string;
    user_id: string;
    contact_id: string;
    conversation_id: string;
    automation_log_id: string;
  };
  event: {
    id: string;
    external_message_id: string;
    occurred_at: string;
    text: string;
  };
  automation: {
    id: string;
    account_id: string;
    user_id: string;
    trigger_type: AutomationTriggerType;
    trigger_config: unknown;
  };
}

export type EvolutionDispatchPreparation =
  | {
      state: 'skipped';
      dispatch_id: string;
      reason: 'already_skipped' | 'trigger_not_eligible';
    }
  | { state: 'ready'; context: PreparedEvolutionAutomationContext };

export class EvolutionDispatchPreparationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'EvolutionDispatchPreparationError';
  }
}

interface RootRow {
  id: string;
  event_id: string;
  account_id: string;
  engine: string;
  automation_id: string | null;
  flow_id: string | null;
  ai_config_id: string | null;
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  automation_log_id: string | null;
  state: string;
  lease_until: string | null;
  lease_token: string | null;
}

interface EventRow {
  id: string;
  connection_id: string;
  state: string;
  normalized_event: unknown;
}

interface AutomationRow {
  id: string;
  account_id: string;
  user_id: string;
  trigger_type: AutomationTriggerType;
  trigger_config: unknown;
  is_active: boolean;
}

interface StartedDispatch {
  dispatch_id: string;
  automation_log_id: string | null;
  flow_run_id: string | null;
  state: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new EvolutionDispatchPreparationError(
      'invalid_input',
      `${label} must be a UUID`
    );
  }
  return value;
}

function oneRow<T>(data: unknown, operation: string): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new EvolutionDispatchPreparationError(
      `${operation}_response_invalid`,
      `${operation} returned an invalid response`
    );
  }
  return rows[0] as T;
}

function failForRpc(error: { code?: string } | null, operation: string): never {
  throw new EvolutionDispatchPreparationError(
    error?.code === '55000' || error?.code === '40001'
      ? 'stale_lease'
      : `${operation}_failed`,
    `${operation} failed`
  );
}

function inboundText(value: unknown): {
  externalMessageId: string;
  occurredAt: string;
  text: string;
} {
  if (
    !isRecord(value) ||
    value.kind !== 'message' ||
    value.contentType !== 'text' ||
    value.fromMe !== false ||
    value.sentByApi !== false ||
    typeof value.externalMessageId !== 'string' ||
    value.externalMessageId.trim() === '' ||
    typeof value.occurredAt !== 'string' ||
    typeof value.text !== 'string' ||
    value.text.trim() === ''
  ) {
    throw new EvolutionDispatchPreparationError(
      'invalid_inbound_event',
      'Dispatch event is not a valid inbound text message'
    );
  }
  return {
    externalMessageId: value.externalMessageId,
    occurredAt: value.occurredAt,
    text: value.text,
  };
}

/** Starts one reserved automation root and prepares its text-trigger context. */
export async function prepareEvolutionAutomationDispatch(
  input: ReservedEvolutionAutomationDispatch
): Promise<EvolutionDispatchPreparation> {
  const dispatchId = requireUuid(input.dispatch_id, 'dispatch_id');
  const leaseToken = requireUuid(input.lease_token, 'lease_token');
  const accountId = requireUuid(input.account_id, 'account_id');

  const db = supabaseAdmin();
  const { data: rootData, error: rootError } = await db
    .from('evolution_event_dispatches')
    .select(
      'id,event_id,account_id,engine,automation_id,flow_id,ai_config_id,user_id,contact_id,conversation_id,automation_log_id,state,lease_until,lease_token'
    )
    .eq('id', dispatchId)
    .maybeSingle();
  if (rootError) {
    throw new EvolutionDispatchPreparationError(
      'root_load_failed',
      'Could not load dispatch root'
    );
  }
  if (!rootData) {
    throw new EvolutionDispatchPreparationError(
      'root_not_found',
      'Dispatch root was not found'
    );
  }

  const root = rootData as RootRow;
  if (
    root.id !== dispatchId ||
    root.account_id !== accountId ||
    root.engine !== 'automation' ||
    !root.automation_id ||
    root.flow_id !== null ||
    root.ai_config_id !== null ||
    root.state !== 'processing' ||
    root.lease_token !== leaseToken ||
    !root.lease_until ||
    !Number.isFinite(Date.parse(root.lease_until)) ||
    Date.parse(root.lease_until) <= Date.now() ||
    !root.contact_id ||
    !root.conversation_id
  ) {
    throw new EvolutionDispatchPreparationError(
      'root_lineage_invalid',
      'Dispatch root is not a reserved automation root with a live lease'
    );
  }
  requireUuid(root.event_id, 'root.event_id');
  requireUuid(root.automation_id, 'root.automation_id');
  requireUuid(root.user_id, 'root.user_id');
  requireUuid(root.contact_id, 'root.contact_id');
  requireUuid(root.conversation_id, 'root.conversation_id');

  const { data: eventData, error: eventError } = await db
    .from('evolution_events')
    .select('id,connection_id,state,normalized_event')
    .eq('id', root.event_id)
    .maybeSingle();
  if (eventError || !eventData) {
    throw new EvolutionDispatchPreparationError(
      'event_load_failed',
      'Could not load dispatch event'
    );
  }
  const event = eventData as EventRow;
  if (event.id !== root.event_id || event.state !== 'done') {
    throw new EvolutionDispatchPreparationError(
      'event_lineage_invalid',
      'Dispatch event is not applied'
    );
  }
  requireUuid(event.connection_id, 'event.connection_id');

  const { data: connectionData, error: connectionError } = await db
    .from('whatsapp_connections')
    .select('id,account_id,provider')
    .eq('id', event.connection_id)
    .maybeSingle();
  if (connectionError || !connectionData) {
    throw new EvolutionDispatchPreparationError(
      'connection_load_failed',
      'Could not load dispatch connection'
    );
  }
  if (
    connectionData.id !== event.connection_id ||
    connectionData.provider !== 'evolution' ||
    connectionData.account_id !== root.account_id
  ) {
    throw new EvolutionDispatchPreparationError(
      'connection_lineage_invalid',
      'Dispatch event connection does not belong to the root account'
    );
  }

  const { data: automationData, error: automationError } = await db
    .from('automations')
    .select('id,account_id,user_id,trigger_type,trigger_config,is_active')
    .eq('id', root.automation_id)
    .eq('account_id', root.account_id)
    .maybeSingle();
  if (automationError || !automationData) {
    throw new EvolutionDispatchPreparationError(
      'automation_load_failed',
      'Could not load dispatch automation'
    );
  }
  const automation = automationData as AutomationRow;
  if (
    automation.id !== root.automation_id ||
    automation.account_id !== root.account_id ||
    automation.user_id !== root.user_id
  ) {
    throw new EvolutionDispatchPreparationError(
      'automation_lineage_invalid',
      'Dispatch automation does not match the root account and user'
    );
  }
  const resumingStartedRoot = root.automation_log_id !== null;
  const message = inboundText(event.normalized_event);
  if (!resumingStartedRoot) {
    if (!automation.is_active) {
      return completeSkipped(db, dispatchId, leaseToken);
    }
    const eligible = isEligibleInboundTextAutomation({
      trigger_type: automation.trigger_type,
      trigger_config: automation.trigger_config,
      text: message.text,
      isFirstInbound: input.isFirstInbound === true,
    });
    if (!eligible) return completeSkipped(db, dispatchId, leaseToken);
  }

  const { data: startData, error: startError } = await db.rpc(
    'start_evolution_event_dispatch',
    { p_dispatch_id: dispatchId, p_lease_token: leaseToken }
  );
  if (startError) failForRpc(startError, 'start');
  const started = oneRow<StartedDispatch>(startData, 'start');
  if (started.dispatch_id !== dispatchId) {
    throw new EvolutionDispatchPreparationError(
      'start_response_invalid',
      'Start response does not match the requested dispatch'
    );
  }
  if (started.state === 'skipped') {
    return {
      state: 'skipped',
      dispatch_id: dispatchId,
      reason: 'already_skipped',
    };
  }
  if (
    started.state !== 'processing' ||
    !started.automation_log_id ||
    !UUID_PATTERN.test(started.automation_log_id) ||
    (resumingStartedRoot &&
      started.automation_log_id !== root.automation_log_id) ||
    started.flow_run_id !== null
  ) {
    throw new EvolutionDispatchPreparationError(
      'start_response_invalid',
      'Start did not return an active automation log context'
    );
  }

  return {
    state: 'ready',
    context: {
      dispatch: {
        id: dispatchId,
        lease_token: leaseToken,
        account_id: root.account_id,
        automation_id: root.automation_id,
        user_id: root.user_id,
        contact_id: root.contact_id,
        conversation_id: root.conversation_id,
        automation_log_id: started.automation_log_id,
      },
      event: {
        id: event.id,
        external_message_id: message.externalMessageId,
        occurred_at: message.occurredAt,
        text: message.text,
      },
      automation: {
        id: automation.id,
        account_id: automation.account_id,
        user_id: automation.user_id,
        trigger_type: automation.trigger_type,
        trigger_config: automation.trigger_config,
      },
    },
  };
}

async function completeSkipped(
  db: ReturnType<typeof supabaseAdmin>,
  dispatchId: string,
  leaseToken: string
): Promise<EvolutionDispatchPreparation> {
  const { data, error } = await db.rpc('complete_evolution_dispatch', {
    p_dispatch_id: dispatchId,
    p_lease_token: leaseToken,
    p_state: 'skipped',
    p_result: null,
    p_error_code: null,
  });
  if (error) failForRpc(error, 'complete');
  const completed = oneRow<{ id: string; state: string }>(data, 'complete');
  if (completed.id !== dispatchId || completed.state !== 'skipped') {
    throw new EvolutionDispatchPreparationError(
      'complete_response_invalid',
      'Dispatch skip did not complete with the expected state'
    );
  }
  return {
    state: 'skipped',
    dispatch_id: dispatchId,
    reason: 'trigger_not_eligible',
  };
}
