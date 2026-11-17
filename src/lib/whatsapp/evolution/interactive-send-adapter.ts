import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionError } from './client';
import { sendInteractive, validateProviderInteractive, type ProviderInteractive } from './interactive-client';
import type { EvolutionCredentials, ProviderAcceptance } from './types';

type Outcome = 'pending' | 'accepted' | 'rejected' | 'unknown';
type Reservation = { attempt_id: string; message_row_id: string; outcome: Outcome; should_send: boolean };
type Completion = { attempt_id: string; message_row_id: string; outcome: Outcome };

export type EvolutionInteractiveSendInput = {
  connectionId: string;
  conversationId: string;
  senderId: string;
  credentials: EvolutionCredentials;
  message: ProviderInteractive;
};

export type EvolutionInteractiveSendResult = {
  attemptId: string;
  messageRowId: string;
  outcome: Outcome;
  shouldSend: boolean;
  externalMessageId: string | null;
  persistenceUncertain: boolean;
};

export class EvolutionInteractiveSendError extends Error {
  constructor(readonly code: 'invalid_input' | 'reservation_unavailable' | 'reservation_invalid') {
    super('Evolution interactive send could not be reserved.');
    this.name = 'EvolutionInteractiveSendError';
  }
}

function row(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' && !Array.isArray(first)
    ? first as Record<string, unknown> : null;
}

function reservation(value: unknown): Reservation | null {
  const data = row(value);
  return data && typeof data.attempt_id === 'string' &&
    typeof data.message_row_id === 'string' &&
    typeof data.should_send === 'boolean' &&
    ['pending', 'accepted', 'rejected', 'unknown'].includes(String(data.outcome))
    ? data as Reservation : null;
}

function completion(value: unknown): Completion | null {
  const data = row(value);
  return data && typeof data.attempt_id === 'string' &&
    typeof data.message_row_id === 'string' &&
    ['pending', 'accepted', 'rejected', 'unknown'].includes(String(data.outcome))
    ? data as Completion : null;
}

function validate(input: EvolutionInteractiveSendInput): void {
  if (!input || !input.connectionId || !input.conversationId || !input.senderId)
    throw new EvolutionInteractiveSendError('invalid_input');
  try { validateProviderInteractive(input.message); }
  catch { throw new EvolutionInteractiveSendError('invalid_input'); }
}

/** The complete provider payload and recipient are bound to the step request ID. */
export function interactiveRequestHash(message: ProviderInteractive): string {
  return createHash('sha256').update(JSON.stringify(message)).digest('hex');
}

async function reserve(db: Pick<SupabaseClient, 'rpc'>, input: EvolutionInteractiveSendInput): Promise<Reservation> {
  validate(input);
  let result: Awaited<ReturnType<typeof db.rpc>>;
  try {
    result = await db.rpc('reserve_evolution_interactive_send', {
      p_connection_id: input.connectionId,
      p_request_id: input.message.requestId,
      p_request_hash: interactiveRequestHash(input.message),
      p_conversation_id: input.conversationId,
      p_sender_id: input.senderId,
      p_message: {
        content_type: 'interactive',
        content_text: input.message.kind === 'list' ? input.message.description :
          input.message.description ?? input.message.title,
        interactive_payload: input.message,
      },
    });
  } catch { throw new EvolutionInteractiveSendError('reservation_unavailable'); }
  if (result.error) throw new EvolutionInteractiveSendError('reservation_unavailable');
  const parsed = reservation(result.data);
  if (!parsed) throw new EvolutionInteractiveSendError('reservation_invalid');
  return parsed;
}

export function createEvolutionInteractiveReservationAdapter(db: Pick<SupabaseClient, 'rpc'>) {
  return async (input: EvolutionInteractiveSendInput) => {
    const reserved = await reserve(db, input);
    return { attemptId: reserved.attempt_id, messageRowId: reserved.message_row_id,
      outcome: reserved.outcome, shouldSend: reserved.should_send };
  };
}

export function createEvolutionInteractiveSendAdapter(
  db: Pick<SupabaseClient, 'rpc'>,
  transport: (credentials: EvolutionCredentials, message: ProviderInteractive) => Promise<ProviderAcceptance> = sendInteractive,
) {
  return async (input: EvolutionInteractiveSendInput): Promise<EvolutionInteractiveSendResult> => {
    const reserved = await reserve(db, input);
    if (!reserved.should_send) return {
      attemptId: reserved.attempt_id, messageRowId: reserved.message_row_id,
      outcome: reserved.outcome, shouldSend: false, externalMessageId: null,
      persistenceUncertain: reserved.outcome === 'pending' || reserved.outcome === 'unknown',
    };
    if (reserved.outcome !== 'pending') throw new EvolutionInteractiveSendError('reservation_invalid');

    let outcome: Exclude<Outcome, 'pending'> = 'unknown';
    let externalMessageId: string | null = null;
    let errorCode: string | null = 'worker_error';
    try {
      const accepted = await transport(input.credentials, input.message);
      externalMessageId = accepted.externalMessageId;
      outcome = 'accepted';
      errorCode = null;
    } catch (cause) {
      if (cause instanceof EvolutionError) {
        outcome = cause.ambiguous ? 'unknown' : 'rejected';
        errorCode = cause.code;
      }
    }

    let result: Awaited<ReturnType<typeof db.rpc>>;
    try {
      result = await db.rpc('complete_evolution_send', {
        p_attempt_id: reserved.attempt_id,
        p_outcome: outcome,
        p_external_message_id: externalMessageId,
        p_error_code: errorCode,
      });
    } catch {
      return { attemptId: reserved.attempt_id, messageRowId: reserved.message_row_id,
        outcome: 'unknown', shouldSend: true, externalMessageId, persistenceUncertain: true };
    }
    const completed = result.error ? null : completion(result.data);
    if (!completed || completed.attempt_id !== reserved.attempt_id ||
        completed.message_row_id !== reserved.message_row_id || completed.outcome !== outcome)
      return { attemptId: reserved.attempt_id, messageRowId: reserved.message_row_id,
        outcome: 'unknown', shouldSend: true, externalMessageId, persistenceUncertain: true };
    return { attemptId: reserved.attempt_id, messageRowId: reserved.message_row_id,
      outcome, shouldSend: true, externalMessageId: outcome === 'accepted' ? externalMessageId : null,
      persistenceUncertain: outcome === 'unknown' };
  };
}
