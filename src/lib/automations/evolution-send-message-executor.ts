import 'server-only';

import type { AutomationStep } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  EvolutionSendAdapterError,
  createEvolutionSendAdapter,
  createEvolutionSendReservationAdapter,
} from '@/lib/whatsapp/evolution/send-adapter';
import { assertAllowedEvolutionOrigin } from '@/lib/whatsapp/evolution/client';
import type { EvolutionCredentials } from '@/lib/whatsapp/evolution/types';

export interface EvolutionSendMessageRoot {
  id: string;
  lease_token: string;
  account_id: string;
}

export interface EvolutionSendMessageExecution {
  executed: boolean;
  step_id: string;
  action_key: string;
  state: string;
  request_id: string;
  send_attempt_id: string | null;
  outcome?: 'pending' | 'accepted' | 'rejected' | 'unknown';
  message_row_id?: string;
  error_code?: string;
}

export class EvolutionSendMessageExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'EvolutionSendMessageExecutionError';
  }
}

const TERMINAL_CONTEXT_ERRORS = new Set([
  'root_lineage_invalid',
  'invalid_step_config',
  'interpolation_context_required',
  'step_lineage_invalid',
  'event_context_invalid',
  'conversation_lineage_invalid',
  'contact_lineage_invalid',
  'connection_lineage_invalid',
  'credentials_unavailable',
]);

interface RootRow {
  id: string;
  event_id: string;
  account_id: string;
  engine: string;
  automation_id: string | null;
  user_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  state: string;
  lease_until: string | null;
  lease_token: string | null;
}

interface StepClaim {
  step_id: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  send_attempt_id: string | null;
  should_execute: boolean;
  lease_acquired: boolean;
}

interface StepLedger {
  id: string;
  dispatch_id: string;
  action_key: string;
  state: string;
  lease_token: string | null;
  request_id: string | null;
  send_attempt_id: string | null;
}

interface EventRow {
  id: string;
  connection_id: string;
  state: string;
  normalized_event: unknown;
}

interface ConnectionRow {
  id: string;
  account_id: string;
  provider: string;
  base_url: string;
  instance_name: string;
  token_encrypted: string;
}

interface ConversationRow {
  id: string;
  account_id: string;
  contact_id: string;
}

interface ContactRow {
  id: string;
  account_id: string;
  phone_normalized: string;
}

interface PersistedStep {
  id: string;
  automation_id: string;
  step_type: string;
  step_config: unknown;
}

interface CompletionRow {
  id: string;
  state: string;
  send_attempt_id: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new EvolutionSendMessageExecutionError(
      'invalid_input',
      `${label} must be a UUID`
    );
  }
  return value;
}

function oneRow<T>(data: unknown, label: string): T {
  const rows = Array.isArray(data) ? data : data === null ? [] : [data];
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new EvolutionSendMessageExecutionError(
      `${label}_response_invalid`,
      `${label} returned an invalid response`
    );
  }
  return rows[0] as T;
}

function persistedText(value: unknown): string {
  if (
    !isRecord(value) ||
    typeof value.text !== 'string' ||
    !value.text.trim()
  ) {
    throw new EvolutionSendMessageExecutionError(
      'invalid_step_config',
      'Persisted send_message text is invalid'
    );
  }
  if (/\{\{[\s\S]*?\}\}/.test(value.text)) {
    throw new EvolutionSendMessageExecutionError(
      'interpolation_context_required',
      'Send message text requires validated runtime context'
    );
  }
  return value.text;
}

async function loadExecutionContext(
  db: ReturnType<typeof supabaseAdmin>,
  root: RootRow,
  actionKey: string
): Promise<{
  connectionId: string;
  conversationId: string;
  recipient: string;
  text: string;
  credentials: EvolutionCredentials;
}> {
  if (
    !root.event_id ||
    !root.automation_id ||
    !root.conversation_id ||
    !root.contact_id
  ) {
    throw new EvolutionSendMessageExecutionError(
      'root_lineage_invalid',
      'Send message root is missing event, automation, contact, or conversation lineage'
    );
  }
  requireUuid(root.event_id, 'root.event_id');
  requireUuid(root.automation_id, 'root.automation_id');
  requireUuid(root.conversation_id, 'root.conversation_id');
  requireUuid(root.contact_id, 'root.contact_id');
  requireUuid(root.user_id, 'root.user_id');

  const [stepResult, eventResult, conversationResult] = await Promise.all([
    db
      .from('automation_steps')
      .select('id,automation_id,step_type,step_config')
      .eq('id', actionKey)
      .eq('automation_id', root.automation_id)
      .maybeSingle(),
    db
      .from('evolution_events')
      .select('id,connection_id,state,normalized_event')
      .eq('id', root.event_id)
      .maybeSingle(),
    db
      .from('conversations')
      .select('id,account_id,contact_id')
      .eq('id', root.conversation_id)
      .eq('account_id', root.account_id)
      .maybeSingle(),
  ]);
  if (stepResult.error) {
    throw new EvolutionSendMessageExecutionError(
      'context_unavailable',
      'Could not read persisted send_message step'
    );
  }
  if (!stepResult.data) {
    throw new EvolutionSendMessageExecutionError(
      'step_lineage_invalid',
      'Persisted send_message step is unavailable'
    );
  }
  if (eventResult.error) {
    throw new EvolutionSendMessageExecutionError(
      'context_unavailable',
      'Could not read persisted inbound event'
    );
  }
  if (!eventResult.data) {
    throw new EvolutionSendMessageExecutionError(
      'event_context_invalid',
      'Persisted inbound event is unavailable'
    );
  }
  if (conversationResult.error) {
    throw new EvolutionSendMessageExecutionError(
      'context_unavailable',
      'Could not read dispatch conversation'
    );
  }
  if (!conversationResult.data) {
    throw new EvolutionSendMessageExecutionError(
      'conversation_lineage_invalid',
      'Could not resolve the dispatch conversation in its account'
    );
  }

  const step = stepResult.data as PersistedStep;
  if (
    step.id !== actionKey ||
    step.automation_id !== root.automation_id ||
    step.step_type !== 'send_message'
  ) {
    throw new EvolutionSendMessageExecutionError(
      'step_lineage_invalid',
      'Persisted step is not this automation send_message action'
    );
  }
  const text = persistedText(step.step_config);

  const event = eventResult.data as EventRow;
  const normalized = isRecord(event.normalized_event)
    ? event.normalized_event
    : null;
  if (
    event.id !== root.event_id ||
    event.state !== 'done' ||
    !normalized ||
    normalized.kind !== 'message' ||
    normalized.contentType !== 'text' ||
    normalized.fromMe !== false ||
    normalized.sentByApi !== false ||
    typeof normalized.peer !== 'string' ||
    !/^\d{8,15}@s\.whatsapp\.net$/.test(normalized.peer)
  ) {
    throw new EvolutionSendMessageExecutionError(
      'event_context_invalid',
      'Dispatch event is not a persisted inbound Evolution text message'
    );
  }

  const conversation = conversationResult.data as ConversationRow;
  if (
    conversation.id !== root.conversation_id ||
    conversation.account_id !== root.account_id ||
    conversation.contact_id !== root.contact_id
  ) {
    throw new EvolutionSendMessageExecutionError(
      'conversation_lineage_invalid',
      'Dispatch conversation does not match root tenant lineage'
    );
  }

  const { data: contactData, error: contactError } = await db
    .from('contacts')
    .select('id,account_id,phone_normalized')
    .eq('id', root.contact_id)
    .eq('account_id', root.account_id)
    .maybeSingle();
  if (contactError) {
    throw new EvolutionSendMessageExecutionError(
      'context_unavailable',
      'Could not read dispatch contact'
    );
  }
  if (!contactData) {
    throw new EvolutionSendMessageExecutionError(
      'contact_lineage_invalid',
      'Dispatch contact does not belong to root account'
    );
  }
  const contact = contactData as ContactRow;
  const eventDigits = normalized.peer.slice(0, normalized.peer.indexOf('@'));
  if (
    contact.id !== root.contact_id ||
    contact.account_id !== root.account_id ||
    contact.phone_normalized !== eventDigits
  ) {
    throw new EvolutionSendMessageExecutionError(
      'contact_lineage_invalid',
      'Inbound event peer does not match the root contact'
    );
  }

  const { data: connectionData, error: connectionError } = await db
    .from('whatsapp_connections')
    .select('id,account_id,provider,base_url,instance_name,token_encrypted')
    .eq('id', event.connection_id)
    .eq('account_id', root.account_id)
    .maybeSingle();
  if (connectionError) {
    throw new EvolutionSendMessageExecutionError(
      'context_unavailable',
      'Could not read Evolution connection'
    );
  }
  if (!connectionData) {
    throw new EvolutionSendMessageExecutionError(
      'connection_lineage_invalid',
      'Inbound event connection does not belong to root account'
    );
  }
  const connection = connectionData as ConnectionRow;
  if (
    connection.id !== event.connection_id ||
    connection.account_id !== root.account_id ||
    connection.provider !== 'evolution' ||
    typeof connection.instance_name !== 'string' ||
    !connection.instance_name.trim() ||
    typeof connection.token_encrypted !== 'string' ||
    !connection.token_encrypted
  ) {
    throw new EvolutionSendMessageExecutionError(
      'connection_lineage_invalid',
      'Persisted Evolution connection is invalid'
    );
  }
  let credentials: EvolutionCredentials;
  try {
    credentials = {
      baseUrl: assertAllowedEvolutionOrigin(connection.base_url),
      instanceId: connection.instance_name,
      token: decrypt(connection.token_encrypted),
    };
  } catch {
    throw new EvolutionSendMessageExecutionError(
      'credentials_unavailable',
      'Persisted Evolution connection credentials are unavailable'
    );
  }
  if (!credentials.token) {
    throw new EvolutionSendMessageExecutionError(
      'credentials_unavailable',
      'Persisted Evolution connection credentials are unavailable'
    );
  }

  return {
    connectionId: connection.id,
    conversationId: conversation.id,
    recipient: normalized.peer,
    text,
    credentials,
  };
}

function completionForOutcome(
  outcome: 'pending' | 'accepted' | 'rejected' | 'unknown'
) {
  switch (outcome) {
    case 'accepted':
      return { state: 'done' as const, errorCode: null };
    case 'rejected':
      return { state: 'failed' as const, errorCode: 'provider_rejected' };
    case 'pending':
    case 'unknown':
      return { state: 'unknown' as const, errorCode: 'delivery_unknown' };
  }
}

async function completeStep(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    stepId: string;
    dispatchLeaseToken: string;
    stepLeaseToken: string;
    requestId: string;
    attemptId: string | null;
    state: 'done' | 'failed' | 'unknown';
    errorCode: string | null;
  }
): Promise<CompletionRow> {
  const { data, error } = await db.rpc('complete_evolution_dispatch_step', {
    p_step_id: args.stepId,
    p_dispatch_lease_token: args.dispatchLeaseToken,
    p_lease_token: args.stepLeaseToken,
    p_state: args.state,
    p_request_id: args.requestId,
    p_send_attempt_id: args.attemptId,
    p_result: null,
    p_error_code: args.errorCode,
  });
  if (error) {
    throw new EvolutionSendMessageExecutionError(
      error.code === '55000' ? 'stale_lease' : 'step_completion_failed',
      'Could not complete the fenced send_message step'
    );
  }
  const row = oneRow<CompletionRow>(data, 'step_completion');
  if (
    row.id !== args.stepId ||
    row.state !== args.state ||
    (args.attemptId !== null && row.send_attempt_id !== args.attemptId)
  ) {
    throw new EvolutionSendMessageExecutionError(
      'step_completion_invalid',
      'Fenced send_message completion did not match its attempt'
    );
  }
  return row;
}

/** Claims and sends one persisted Evolution automation text step at most once. */
export async function executeEvolutionAutomationSendMessage(input: {
  root: EvolutionSendMessageRoot;
  step: Pick<AutomationStep, 'id'>;
}): Promise<EvolutionSendMessageExecution> {
  const dispatchId = requireUuid(input.root.id, 'root.id');
  const dispatchLeaseToken = requireUuid(
    input.root.lease_token,
    'root.lease_token'
  );
  const accountId = requireUuid(input.root.account_id, 'root.account_id');
  const actionKey = requireUuid(input.step.id, 'step.id');
  const db = supabaseAdmin();

  const { data: rootData, error: rootError } = await db
    .from('evolution_event_dispatches')
    .select(
      'id,event_id,account_id,engine,automation_id,user_id,contact_id,conversation_id,state,lease_until,lease_token'
    )
    .eq('id', dispatchId)
    .maybeSingle();
  if (rootError || !rootData) {
    throw new EvolutionSendMessageExecutionError(
      'root_load_failed',
      'Could not load persisted send_message root'
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
    throw new EvolutionSendMessageExecutionError(
      'root_lineage_invalid',
      'Root is not a reserved automation dispatch with a live lease'
    );
  }

  const { data: claimData, error: claimError } = await db.rpc(
    'claim_evolution_dispatch_send_step',
    {
      p_dispatch_id: dispatchId,
      p_dispatch_lease_token: dispatchLeaseToken,
      p_action_key: actionKey,
    }
  );
  if (claimError) {
    throw new EvolutionSendMessageExecutionError(
      claimError.code === '55000' ? 'stale_lease' : 'step_claim_failed',
      'Could not claim the Evolution send_message step'
    );
  }
  const claim = oneRow<StepClaim>(claimData, 'step_claim');
  if (
    typeof claim.step_id !== 'string' ||
    !UUID_PATTERN.test(claim.step_id) ||
    typeof claim.should_execute !== 'boolean' ||
    typeof claim.lease_acquired !== 'boolean' ||
    typeof claim.request_id !== 'string' ||
    claim.request_id !== `evolution-step:${claim.step_id}` ||
    (claim.send_attempt_id !== null &&
      (typeof claim.send_attempt_id !== 'string' ||
        !UUID_PATTERN.test(claim.send_attempt_id))) ||
    !['pending', 'processing', 'done', 'skipped', 'failed', 'unknown'].includes(
      claim.state
    )
  ) {
    throw new EvolutionSendMessageExecutionError(
      'step_claim_invalid',
      'Evolution send_message claim is invalid'
    );
  }

  if (!claim.lease_acquired) {
    if (claim.should_execute) {
      throw new EvolutionSendMessageExecutionError(
        'step_claim_invalid',
        'A send_message claim cannot execute without acquiring its lease'
      );
    }
    return {
      executed: false,
      step_id: claim.step_id,
      action_key: actionKey,
      state: claim.state,
      request_id: claim.request_id,
      send_attempt_id: claim.send_attempt_id,
    };
  }

  const { data: ledgerData, error: ledgerError } = await db
    .from('evolution_dispatch_steps')
    .select(
      'id,dispatch_id,action_key,state,lease_token,request_id,send_attempt_id'
    )
    .eq('id', claim.step_id)
    .eq('dispatch_id', dispatchId)
    .eq('action_key', actionKey)
    .maybeSingle();
  if (ledgerError || !ledgerData) {
    throw new EvolutionSendMessageExecutionError(
      'step_lineage_invalid',
      'Claim does not match a persisted dispatch step'
    );
  }
  const ledger = ledgerData as StepLedger;
  if (
    ledger.id !== claim.step_id ||
    ledger.dispatch_id !== dispatchId ||
    ledger.action_key !== actionKey ||
    ledger.state !== claim.state ||
    ledger.lease_token !== claim.lease_token ||
    ledger.request_id !== claim.request_id ||
    ledger.request_id !== `evolution-step:${ledger.id}` ||
    ledger.send_attempt_id !== claim.send_attempt_id
  ) {
    throw new EvolutionSendMessageExecutionError(
      'step_lineage_invalid',
      'Claim does not match its persisted dispatch step'
    );
  }

  if (
    claim.state !== 'processing' ||
    !claim.lease_token ||
    !UUID_PATTERN.test(claim.lease_token)
  ) {
    throw new EvolutionSendMessageExecutionError(
      'step_claim_invalid',
      'Executable send_message claim has no valid step lease'
    );
  }
  if (claim.should_execute && ledger.send_attempt_id !== null) {
    throw new EvolutionSendMessageExecutionError(
      'unsafe_reservation_state',
      'A send attempt exists without a non-executable claim'
    );
  }
  if (!claim.should_execute && ledger.send_attempt_id === null) {
    throw new EvolutionSendMessageExecutionError(
      'unsafe_reservation_state',
      'A recovery claim has no linked send attempt'
    );
  }

  let context: Awaited<ReturnType<typeof loadExecutionContext>>;
  try {
    context = await loadExecutionContext(db, root, actionKey);
  } catch (error) {
    if (!claim.should_execute) {
      if (
        !(error instanceof EvolutionSendMessageExecutionError) ||
        !TERMINAL_CONTEXT_ERRORS.has(error.code)
      ) {
        return {
          executed: false,
          step_id: ledger.id,
          action_key: actionKey,
          state: 'processing',
          request_id: ledger.request_id!,
          send_attempt_id: ledger.send_attempt_id,
          outcome: 'unknown',
          error_code: 'recovery_context_unavailable',
        };
      }
      // A linked reservation may already have been accepted. Changed lineage or
      // configuration cannot turn that uncertain delivery into a safe failure.
      const completed = await completeStep(db, {
        stepId: ledger.id,
        dispatchLeaseToken,
        stepLeaseToken: claim.lease_token,
        requestId: ledger.request_id!,
        attemptId: ledger.send_attempt_id,
        state: 'unknown',
        errorCode: 'recovery_context_unavailable',
      });
      return {
        executed: false,
        step_id: completed.id,
        action_key: actionKey,
        state: completed.state,
        request_id: ledger.request_id!,
        send_attempt_id: completed.send_attempt_id,
        outcome: 'unknown',
        error_code: 'recovery_context_unavailable',
      };
    }
    if (
      !(error instanceof EvolutionSendMessageExecutionError) ||
      !TERMINAL_CONTEXT_ERRORS.has(error.code)
    ) {
      throw error;
    }
    const completed = await completeStep(db, {
      stepId: ledger.id,
      dispatchLeaseToken,
      stepLeaseToken: claim.lease_token,
      requestId: ledger.request_id!,
      attemptId: ledger.send_attempt_id,
      state: 'failed',
      errorCode: error.code,
    });
    return {
      executed: true,
      step_id: completed.id,
      action_key: actionKey,
      state: completed.state,
      request_id: ledger.request_id!,
      send_attempt_id: completed.send_attempt_id,
      error_code: error.code,
    };
  }
  if (!claim.should_execute) {
    const reconcile = createEvolutionSendReservationAdapter(db);
    let reservation;
    try {
      reservation = await reconcile({
        ...context,
        senderType: 'bot',
        senderId: root.user_id,
        requestId: ledger.request_id!,
      });
    } catch {
      // Reservation lookup failure says nothing about whether the provider
      // accepted the earlier POST. Leave the fenced step recoverable, but never
      // authorize transport from this branch.
      return {
        executed: false,
        step_id: ledger.id,
        action_key: actionKey,
        state: 'processing',
        request_id: ledger.request_id!,
        send_attempt_id: ledger.send_attempt_id,
        outcome: 'unknown',
        error_code: 'reservation_reconciliation_unavailable',
      };
    }
    if (
      reservation.attemptId !== ledger.send_attempt_id ||
      reservation.shouldSend
    ) {
      throw new EvolutionSendMessageExecutionError(
        'unsafe_reservation_replay',
        'Existing send attempt did not replay as a non-sendable reservation'
      );
    }
    if (reservation.outcome === 'pending') {
      return {
        executed: false,
        step_id: ledger.id,
        action_key: actionKey,
        state: 'processing',
        request_id: ledger.request_id!,
        send_attempt_id: reservation.attemptId,
        outcome: 'pending',
      };
    }

    const completion = completionForOutcome(reservation.outcome);
    const completed = await completeStep(db, {
      stepId: ledger.id,
      dispatchLeaseToken,
      stepLeaseToken: claim.lease_token,
      requestId: ledger.request_id!,
      attemptId: reservation.attemptId,
      state: completion.state,
      errorCode: completion.errorCode,
    });
    return {
      executed: false,
      step_id: completed.id,
      action_key: actionKey,
      state: completed.state,
      request_id: ledger.request_id!,
      send_attempt_id: completed.send_attempt_id,
      outcome: reservation.outcome,
      message_row_id: reservation.messageRowId,
      ...(completion.errorCode ? { error_code: completion.errorCode } : {}),
    };
  }

  const send = createEvolutionSendAdapter(db);
  let sendResult;
  try {
    sendResult = await send({
      ...context,
      senderType: 'bot',
      senderId: root.user_id,
      requestId: ledger.request_id!,
    });
  } catch (error) {
    if (error instanceof EvolutionSendAdapterError) {
      // Adapter errors occur before transport. Keep the step retryable instead
      // of recording a delivery uncertainty for a POST that never ran.
      return {
        executed: false,
        step_id: ledger.id,
        action_key: actionKey,
        state: 'processing',
        request_id: ledger.request_id!,
        send_attempt_id: null,
        outcome: 'pending',
        error_code: 'send_reservation_unavailable',
      };
    }
    const completed = await completeStep(db, {
      stepId: ledger.id,
      dispatchLeaseToken,
      stepLeaseToken: claim.lease_token,
      requestId: ledger.request_id!,
      attemptId: ledger.send_attempt_id,
      state: 'unknown',
      errorCode: 'send_result_unknown',
    });
    return {
      executed: true,
      step_id: completed.id,
      action_key: actionKey,
      state: completed.state,
      request_id: ledger.request_id!,
      send_attempt_id: completed.send_attempt_id,
      outcome: 'unknown',
      error_code: 'send_result_unknown',
    };
  }

  if (sendResult.outcome === 'pending') {
    return {
      executed: false,
      step_id: ledger.id,
      action_key: actionKey,
      state: 'processing',
      request_id: ledger.request_id!,
      send_attempt_id: sendResult.attemptId,
      outcome: 'pending',
    };
  }

  const completion = completionForOutcome(sendResult.outcome);
  const completed = await completeStep(db, {
    stepId: ledger.id,
    dispatchLeaseToken,
    stepLeaseToken: claim.lease_token,
    requestId: ledger.request_id!,
    attemptId: sendResult.attemptId,
    state: completion.state,
    errorCode: completion.errorCode,
  });
  return {
    executed: true,
    step_id: completed.id,
    action_key: actionKey,
    state: completed.state,
    request_id: ledger.request_id!,
    send_attempt_id: completed.send_attempt_id,
    outcome: sendResult.outcome,
    message_row_id: sendResult.messageRowId,
    ...(completion.errorCode ? { error_code: completion.errorCode } : {}),
  };
}
