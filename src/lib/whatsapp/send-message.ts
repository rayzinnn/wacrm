// ============================================================
// Evolution text send core shared by the dashboard and public v1 routes.
// The caller supplies a stable idempotency key; the adapter reserves the
// send, performs at most one provider POST, and persists the message result.
// Callers retain ownership of auth, rate limiting, body parsing and response
// mapping. Unsupported non-text capabilities fail before database/provider I/O.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity';
import {
  createEvolutionSendAdapter,
  EvolutionSendAdapterError,
} from '@/lib/whatsapp/evolution/send-adapter';
import type { EvolutionTextSendResult } from '@/lib/whatsapp/evolution/send-adapter';
import { loadConnection } from '@/lib/whatsapp/evolution/store';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  /** Legacy non-text fields remain for caller compatibility; core blocks them. */
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy template values retained for existing route call sites. */
  templateParams?: string[];
  /** Structured template values retained for existing route call sites. */
  templateMessageParams?: unknown;
  /** Interactive payload retained for existing route call sites. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  senderId?: string | null;
  /** Stable caller-supplied idempotency key for Evolution text sends. */
  requestId?: string;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Provider message ID returned for the accepted text message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate text shape independently of DB state. Disabled known message
 * types return the stable capability error before callers resolve a
 * contact/conversation or the core performs any I/O.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType !== 'text') {
    throw new SendMessageError(
      'unsupported_capability',
      'This message type is not currently enabled for Evolution',
      422
    );
  }

  if (!contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }
}

async function pauseActiveFlow(
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (error)
      console.error('[flows] pause-on-agent-send failed:', error.message);
  } catch (cause) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      cause instanceof Error ? cause.message : cause
    );
  }
}

async function refreshConversationSummary(
  db: SupabaseClient,
  conversationId: string,
  lastMessageText: string,
  messageCreatedAt?: string
): Promise<void> {
  const timestamp = messageCreatedAt ?? new Date().toISOString();
  let update = db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: timestamp,
      updated_at: timestamp,
    })
    .eq('id', conversationId);
  if (messageCreatedAt) {
    update = update.or(
      `last_message_at.is.null,last_message_at.lte.${messageCreatedAt}`
    );
  }
  await update;
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    senderId,
    replyToMessageId,
    requestId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
  });

  if (
    !requestId ||
    !requestId.trim() ||
    requestId.length > 200
  ) {
    throw new SendMessageError(
      'idempotency_key_required',
      'A stable Idempotency-Key is required for text messages',
      400
    );
  }
  if (replyToMessageId) {
    throw new SendMessageError(
      'reply_not_supported',
      'Reply-to text sending is not supported by the Evolution adapter yet',
      400
    );
  }

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;

  // Evolution text sends require a contact phone number.
  const resolvedTarget = resolveContactSendTarget(contact);
  if (!resolvedTarget) {
    throw new SendMessageError(
      'bad_request',
      contact?.phone
        ? 'Invalid phone number format'
        : 'Contact has no phone number',
      400
    );
  }
  if (!resolvedTarget.isPhone) {
    throw new SendMessageError(
      'bad_request',
      'Evolution text sending requires a contact phone number',
      400
    );
  }
  const sanitizedPhone = resolvedTarget.target;

  if (!senderId) {
    throw new SendMessageError(
      'sender_required',
      'A sender is required for an Evolution text send',
      400
    );
  }

  let evolutionConnection: Awaited<ReturnType<typeof loadConnection>>;
  try {
    evolutionConnection = await loadConnection(accountId);
  } catch {
    throw new SendMessageError(
      'whatsapp_unavailable',
      'Evolution connection is unavailable',
      503
    );
  }
  if (!evolutionConnection) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'Evolution is not configured for this account',
      400
    );
  }

  const sendEvolutionText = createEvolutionSendAdapter(supabaseAdmin());
  let evolutionSend: EvolutionTextSendResult;
  try {
    evolutionSend = await sendEvolutionText({
      connectionId: evolutionConnection.id,
      conversationId,
      senderType: 'agent',
      senderId,
      requestId,
      recipient: `${sanitizedPhone}@s.whatsapp.net`,
      text: contentText!,
      credentials: evolutionConnection.credentials,
    });
  } catch (cause) {
    if (cause instanceof EvolutionSendAdapterError) {
      throw new SendMessageError(
        'evolution_send_unavailable',
        'Evolution send reservation is unavailable',
        cause.code === 'invalid_input' ? 400 : 503
      );
    }
    throw cause;
  }

  if (
    evolutionSend.outcome === 'unknown' ||
    evolutionSend.outcome === 'pending'
  ) {
    if (evolutionSend.shouldSend) await pauseActiveFlow(accountId, contact.id);
    throw new SendMessageError(
      'delivery_unknown',
      `Text delivery is not confirmed. Check request ${requestId} before retrying.`,
      504
    );
  }
  if (evolutionSend.outcome === 'rejected') {
    throw new SendMessageError(
      'evolution_rejected',
      'Evolution rejected the text message',
      502
    );
  }

  if (!evolutionSend.shouldSend) {
    const { data: previous, error: previousError } = await db
      .from('messages')
      .select('message_id, content_text, created_at')
      .eq('id', evolutionSend.messageRowId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (previousError || !previous?.created_at) {
      throw new SendMessageError(
        'evolution_result_unavailable',
        'The accepted Evolution message result is unavailable',
        503
      );
    }
    const externalMessageId =
      evolutionSend.externalMessageId ?? previous.message_id;
    if (!externalMessageId) {
      throw new SendMessageError(
        'evolution_result_unavailable',
        'The accepted Evolution message result is unavailable',
        503
      );
    }
    try {
      await refreshConversationSummary(
        db,
        conversationId,
        previous.content_text || contentText || '[text]',
        previous.created_at
      );
    } finally {
      await pauseActiveFlow(accountId, contact.id);
    }
    return {
      messageId: evolutionSend.messageRowId,
      whatsappMessageId: externalMessageId,
    };
  }

  const whatsappMessageId = evolutionSend.externalMessageId;
  if (!whatsappMessageId) {
    await pauseActiveFlow(accountId, contact.id);
    throw new SendMessageError(
      'delivery_unknown',
      `Text delivery is not confirmed. Check request ${requestId} before retrying.`,
      504
    );
  }

  // The reservation RPC inserted and completed the message row. The core
  // only updates the conversation preview and handoff state here.
  await refreshConversationSummary(db, conversationId, contentText!);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  await pauseActiveFlow(accountId, contact.id);

  return {
    messageId: evolutionSend.messageRowId,
    whatsappMessageId,
  };
}
