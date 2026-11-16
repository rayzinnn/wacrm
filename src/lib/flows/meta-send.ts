import { decrypt } from '@/lib/whatsapp/encryption';
import type {
  InteractiveButton,
  InteractiveListSection,
} from '@/lib/whatsapp/interactive-contract';
import { getT } from '@/lib/i18n/translate';
import { supabaseAdmin } from './admin-client';

export const FLOW_SEND_CAPABILITY_ERROR = 'flow_send_capability_unavailable';

const t = getT('LibErrors');

/**
 * Resolve Meta credentials for the AI auto-reply typing indicator.
 * Flow message senders below do not call this helper.
 */
export async function loadAccountMetaCredentials(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string
): Promise<{ phoneNumberId: string; accessToken: string }> {
  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .single();
  if (configErr || !config) {
    throw new Error(t('send.notConfigured'));
  }
  return {
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  };
}

type MediaKind = 'image' | 'video' | 'document' | 'audio';

interface SendTextEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
  aiGenerated?: boolean;
}

interface SendMediaEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  kind: MediaKind;
  link: string;
  caption?: string;
  filename?: string;
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttons: InteractiveButton[];
  headerText?: string;
  footerText?: string;
}

interface SendInteractiveListEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttonLabel: string;
  sections: InteractiveListSection[];
  headerText?: string;
  footerText?: string;
}

function failClosed(): never {
  const error = new Error(FLOW_SEND_CAPABILITY_ERROR);
  error.name = 'FlowSendCapabilityError';
  throw error;
}

/** Flow sends remain unavailable until the Evolution integration lands. */
export async function engineSendText(
  _args: SendTextEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}

export async function engineSendMedia(
  _args: SendMediaEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}

export async function engineSendInteractiveButtons(
  _args: SendInteractiveButtonsEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}

export async function engineSendInteractiveList(
  _args: SendInteractiveListEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}
