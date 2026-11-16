import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionError, sendText } from './client';
import type {
  EvolutionCredentials,
  ProviderAcceptance,
  ProviderText,
} from './types';

type SendOutcome = 'pending' | 'accepted' | 'rejected' | 'unknown';
type SendableOutcome = Exclude<SendOutcome, 'pending'>;

type ReservationRow = {
  attempt_id: string;
  message_row_id: string;
  outcome: SendOutcome;
  should_send: boolean;
};

type CompletionRow = {
  attempt_id: string;
  outcome: SendOutcome;
  message_row_id: string;
};

export interface EvolutionTextSendInput {
  connectionId: string;
  conversationId: string;
  senderType: 'agent' | 'bot';
  senderId: string;
  requestId: string;
  recipient: string;
  text: string;
  credentials: EvolutionCredentials;
}

export interface EvolutionTextSendResult {
  attemptId: string;
  messageRowId: string;
  outcome: SendOutcome;
  shouldSend: boolean;
  externalMessageId: string | null;
  persistenceUncertain: boolean;
}

export interface EvolutionTextReservationResult {
  attemptId: string;
  messageRowId: string;
  outcome: SendOutcome;
  shouldSend: boolean;
}

export class EvolutionSendAdapterError extends Error {
  constructor(
    readonly code:
      'invalid_input' | 'reservation_unavailable' | 'reservation_invalid'
  ) {
    super('Evolution text send could not be reserved.');
    this.name = 'EvolutionSendAdapterError';
  }
}

type TextTransport = (
  credentials: EvolutionCredentials,
  input: ProviderText
) => Promise<ProviderAcceptance>;

const OUTCOMES = new Set<SendOutcome>([
  'pending',
  'accepted',
  'rejected',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstRow<T extends Record<string, unknown>>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isRecord(row) ? (row as T) : null;
}

function readReservation(data: unknown): ReservationRow | null {
  const row = firstRow<Record<string, unknown>>(data);
  if (
    !row ||
    typeof row.attempt_id !== 'string' ||
    typeof row.message_row_id !== 'string' ||
    typeof row.should_send !== 'boolean' ||
    typeof row.outcome !== 'string' ||
    !OUTCOMES.has(row.outcome as SendOutcome)
  )
    return null;

  return row as ReservationRow;
}

function readCompletion(data: unknown): CompletionRow | null {
  const row = firstRow<Record<string, unknown>>(data);
  if (
    !row ||
    typeof row.attempt_id !== 'string' ||
    typeof row.message_row_id !== 'string' ||
    typeof row.outcome !== 'string' ||
    !OUTCOMES.has(row.outcome as SendOutcome)
  )
    return null;

  return row as CompletionRow;
}

function validateInput(input: EvolutionTextSendInput): void {
  if (
    !input ||
    typeof input.connectionId !== 'string' ||
    input.connectionId.length === 0 ||
    typeof input.conversationId !== 'string' ||
    input.conversationId.length === 0 ||
    (input.senderType !== 'agent' && input.senderType !== 'bot') ||
    typeof input.senderId !== 'string' ||
    input.senderId.length === 0 ||
    typeof input.requestId !== 'string' ||
    input.requestId.trim().length === 0 ||
    input.requestId.length > 200 ||
    typeof input.recipient !== 'string' ||
    !/^\d{8,15}@s\.whatsapp\.net$/.test(input.recipient) ||
    typeof input.text !== 'string' ||
    input.text.trim().length === 0
  )
    throw new EvolutionSendAdapterError('invalid_input');
}

function requestHash(
  input: Pick<EvolutionTextSendInput, 'recipient' | 'text'>
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        content_type: 'text',
        recipient: input.recipient,
        content_text: input.text,
      })
    )
    .digest('hex');
}

function providerFailure(cause: unknown): {
  outcome: SendableOutcome;
  errorCode: string;
} {
  if (cause instanceof EvolutionError) {
    return {
      outcome: cause.ambiguous ? 'unknown' : 'rejected',
      errorCode: cause.code,
    };
  }
  return { outcome: 'unknown', errorCode: 'worker_error' };
}

async function reserveEvolutionText(
  db: Pick<SupabaseClient, 'rpc'>,
  input: EvolutionTextSendInput
): Promise<ReservationRow> {
  validateInput(input);
  let result: Awaited<ReturnType<typeof db.rpc>>;
  try {
    result = await db.rpc('reserve_evolution_send', {
      p_connection_id: input.connectionId,
      p_request_id: input.requestId,
      p_request_hash: requestHash(input),
      p_conversation_id: input.conversationId,
      p_sender_type: input.senderType,
      p_sender_id: input.senderId,
      p_message: { content_type: 'text', content_text: input.text },
    });
  } catch {
    throw new EvolutionSendAdapterError('reservation_unavailable');
  }
  if (result.error)
    throw new EvolutionSendAdapterError('reservation_unavailable');
  const reservation = readReservation(result.data);
  if (!reservation) throw new EvolutionSendAdapterError('reservation_invalid');
  return reservation;
}

/** Replays an idempotent reservation without ever calling the provider transport. */
export function createEvolutionSendReservationAdapter(
  db: Pick<SupabaseClient, 'rpc'>
) {
  return async function reserveEvolutionTextOnly(
    input: EvolutionTextSendInput
  ): Promise<EvolutionTextReservationResult> {
    const reservation = await reserveEvolutionText(db, input);
    return {
      attemptId: reservation.attempt_id,
      messageRowId: reservation.message_row_id,
      outcome: reservation.outcome,
      shouldSend: reservation.should_send,
    };
  };
}

export function createEvolutionSendAdapter(
  db: Pick<SupabaseClient, 'rpc'>,
  transport: TextTransport = sendText
) {
  return async function sendEvolutionText(
    input: EvolutionTextSendInput
  ): Promise<EvolutionTextSendResult> {
    const reservation = await reserveEvolutionText(db, input);

    if (!reservation.should_send) {
      return {
        attemptId: reservation.attempt_id,
        messageRowId: reservation.message_row_id,
        outcome: reservation.outcome,
        shouldSend: false,
        externalMessageId: null,
        persistenceUncertain:
          reservation.outcome === 'pending' ||
          reservation.outcome === 'unknown',
      };
    }

    // Only a freshly inserted pending reservation may authorize the one transport call.
    if (reservation.outcome !== 'pending')
      throw new EvolutionSendAdapterError('reservation_invalid');

    let proposedOutcome: SendableOutcome = 'unknown';
    let externalMessageId: string | null = null;
    let errorCode = 'worker_error';

    try {
      const accepted = await transport(input.credentials, {
        recipient: input.recipient,
        text: input.text,
        requestId: input.requestId,
      });
      proposedOutcome = 'accepted';
      externalMessageId = accepted.externalMessageId;
      errorCode = '';
    } catch (cause) {
      const failure = providerFailure(cause);
      proposedOutcome = failure.outcome;
      errorCode = failure.errorCode;
    }

    let completionResult: Awaited<ReturnType<typeof db.rpc>>;
    try {
      completionResult = await db.rpc('complete_evolution_send', {
        p_attempt_id: reservation.attempt_id,
        p_outcome: proposedOutcome,
        p_external_message_id: externalMessageId,
        p_error_code: errorCode || null,
      });
    } catch {
      return {
        attemptId: reservation.attempt_id,
        messageRowId: reservation.message_row_id,
        outcome: 'unknown',
        shouldSend: true,
        externalMessageId,
        persistenceUncertain: true,
      };
    }

    const completion = completionResult.error
      ? null
      : readCompletion(completionResult.data);
    if (
      !completion ||
      completion.attempt_id !== reservation.attempt_id ||
      completion.message_row_id !== reservation.message_row_id ||
      completion.outcome !== proposedOutcome
    ) {
      return {
        attemptId: reservation.attempt_id,
        messageRowId: reservation.message_row_id,
        outcome: 'unknown',
        shouldSend: true,
        externalMessageId,
        persistenceUncertain: true,
      };
    }

    return {
      attemptId: reservation.attempt_id,
      messageRowId: reservation.message_row_id,
      outcome: completion.outcome,
      shouldSend: true,
      externalMessageId:
        completion.outcome === 'accepted' ? externalMessageId : null,
      persistenceUncertain: completion.outcome === 'unknown',
    };
  };
}
