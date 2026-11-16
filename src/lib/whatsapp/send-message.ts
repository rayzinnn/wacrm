// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity';
import { applyPendingMessageStatuses } from '@/lib/whatsapp/message-status-sync';
import {
  createEvolutionSendAdapter,
  EvolutionSendAdapterError,
} from '@/lib/whatsapp/evolution/send-adapter';
import type { EvolutionTextSendResult } from '@/lib/whatsapp/evolution/send-adapter';
import { loadConnection } from '@/lib/whatsapp/evolution/store';
import type { MessageTemplate } from '@/types';
import {
  resolveTemplateRow,
  templateBodyParams,
  templateContentText,
  templateHeaderMediaUrl,
} from '@/lib/whatsapp/template-body';

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
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  senderId?: string | null;
  /** Stable caller-supplied idempotency key for Evolution text sends. */
  requestId?: string;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
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
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const {
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
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
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    senderId,
    templateParams,
    templateMessageParams,
    interactivePayload,
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
    mediaUrl,
    templateName,
    interactivePayload,
  });

  if (
    messageType === 'text' &&
    (!requestId || !requestId.trim() || requestId.length > 200)
  ) {
    throw new SendMessageError(
      'idempotency_key_required',
      'A stable Idempotency-Key is required for text messages',
      400
    );
  }
  if (messageType === 'text' && replyToMessageId) {
    throw new SendMessageError(
      'reply_not_supported',
      'Reply-to text sending is not supported by the Evolution adapter yet',
      400
    );
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

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

  // A contact is addressable by phone number OR by business-scoped user
  // ID. Meta withholds the phone number for a customer who has adopted
  // a WhatsApp username, so those contacts carry only a BSUID and are
  // reached through Meta's `recipient` field instead of `to` (issue
  // #519). Phone stays preferred when we have one: only it supports the
  // trunk-prefix variant retry below.
  const resolvedTarget = resolveContactSendTarget(contact);
  if (!resolvedTarget) {
    throw new SendMessageError(
      'bad_request',
      contact?.phone
        ? 'Invalid phone number format'
        : 'Contact has no phone number or WhatsApp user ID',
      400
    );
  }
  if (messageType === 'text' && !resolvedTarget.isPhone) {
    throw new SendMessageError(
      'bad_request',
      'Evolution text sending requires a contact phone number',
      400
    );
  }
  const sendTarget = resolvedTarget.target;
  const hasValidPhone = resolvedTarget.isPhone;
  const sanitizedPhone = hasValidPhone ? sendTarget : '';

  let evolutionConnection: Awaited<ReturnType<typeof loadConnection>> = null;
  let config: { phone_number_id: string } | null = null;
  let accessToken = '';
  if (messageType === 'text') {
    if (!senderId) {
      throw new SendMessageError(
        'sender_required',
        'A sender is required for an Evolution text send',
        400
      );
    }
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
  } else {
    // Legacy non-text paths remain in place for the T13 removal/blocking
    // recut. Text never reads or falls back to the historical Meta config.
    const { data, error: configError } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (configError || !data) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400
      );
    }
    const legacyConfig = data;
    config = legacyConfig;
    accessToken = decrypt(legacyConfig.access_token);

    // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
    if (isLegacyFormat(legacyConfig.access_token)) {
      void db
        .from('whatsapp_config')
        .update({ access_token: encrypt(accessToken) })
        .eq('id', legacyConfig.id)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) {
            console.warn(
              '[send-message] access_token GCM upgrade failed:',
              error.message
            );
          }
        });
    }
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row — needed for the send-builder's header + button
  // components AND for the body we persist. The lookup tolerates the
  // en / en_US split so a caller that omits the language still resolves
  // a row (see resolveTemplateRow).
  let templateRow: MessageTemplate | null = null;
  let sendLanguage = templateLanguage || 'en_US';
  if (messageType === 'template' && templateName) {
    const resolved = await resolveTemplateRow(
      db,
      accountId,
      templateName,
      templateLanguage
    );
    if (resolved.malformed) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = resolved.row;
    sendLanguage = resolved.language;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'text') {
      throw new SendMessageError(
        'transport_unavailable',
        'Text messages must use the Evolution send adapter',
        503
      );
    }
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config!.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: sendLanguage,
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config!.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config!.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config!.phone_number_id,
        accessToken,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    throw new SendMessageError(
      'unsupported_message_type',
      'This message type is not supported by the Evolution adapter',
      400
    );
  };

  let waMessageId = '';
  let workingPhone = sendTarget;
  let evolutionSend: EvolutionTextSendResult | null = null;
  if (messageType === 'text') {
    const sendEvolutionText = createEvolutionSendAdapter(supabaseAdmin());
    try {
      evolutionSend = await sendEvolutionText({
        connectionId: evolutionConnection!.id,
        conversationId,
        senderType: 'agent',
        senderId: senderId!,
        requestId: requestId!,
        recipient: `${sanitizedPhone}@s.whatsapp.net`,
        text: contentText!,
        credentials: evolutionConnection!.credentials,
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
      if (evolutionSend.shouldSend)
        await pauseActiveFlow(accountId, contact.id);
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
      const replayMessageId = externalMessageId;
      return {
        messageId: evolutionSend.messageRowId,
        whatsappMessageId: replayMessageId,
      };
    }

    waMessageId = evolutionSend.externalMessageId ?? '';
    if (!waMessageId) {
      await pauseActiveFlow(accountId, contact.id);
      throw new SendMessageError(
        'delivery_unknown',
        `Text delivery is not confirmed. Check request ${requestId} before retrying.`,
        504
      );
    }
  } else {
    // Keep the legacy non-text transport while capability/UI blocking is
    // completed in T13. Text can never enter this path.
    try {
      const variants = hasValidPhone
        ? phoneVariants(sanitizedPhone)
        : [sendTarget];
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) throw err;
          lastError = err;
          console.warn(
            `[send-message] legacy non-text variant rejected: ${message}`
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown provider error';
      console.error('[send-message] legacy non-text send failed:', message);
      throw new SendMessageError(
        'meta_error',
        `Legacy send failed: ${message}`,
        502
      );
    }
  }

  if (hasValidPhone && workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  //
  // Templates persist the *substituted* body. The composer pre-renders
  // and posts it as contentText; every other caller (the public API,
  // most importantly) sends none, and storing null there left the
  // Inbox rendering an empty bubble — issue #483.
  const persistedText =
    messageType === 'interactive'
      ? interactivePayload!.body
      : messageType === 'template'
        ? templateContentText(
            templateRow,
            templateBodyParams(templateParams, templateMessageParams),
            contentText
          )
        : (contentText ?? null);

  let messageRecord: { id: string } | null = null;
  if (evolutionSend) {
    // The reservation RPC already inserted the `sending` row and the
    // completion RPC finalized it. Never fabricate a second local row.
    messageRecord = { id: evolutionSend.messageRowId };
  } else {
    const { data, error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: senderId ?? null,
        content_type: messageType,
        content_text: persistedText,
        media_url:
          messageType === 'template'
            ? templateHeaderMediaUrl(templateRow, templateMessageParams)
            : mediaUrl || null,
        template_name: templateName || null,
        interactive_payload:
          messageType === 'interactive' ? interactivePayload : null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .select()
      .single();

    if (msgError || !data) {
      console.error('[send-message] error inserting sent message:', msgError);
      throw new SendMessageError(
        'db_error',
        `Message sent to Meta but failed to save to DB: ${msgError?.message ?? 'database unavailable'}`,
        500
      );
    }
    messageRecord = data;
    await applyPendingMessageStatuses(supabaseAdmin(), accountId, waMessageId);
  }

  if (!messageRecord) {
    throw new SendMessageError(
      'db_error',
      'Message record is unavailable',
      500
    );
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : persistedText || `[${messageType}]`;

  await refreshConversationSummary(db, conversationId, lastMessageText);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  await pauseActiveFlow(accountId, contact.id);

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
