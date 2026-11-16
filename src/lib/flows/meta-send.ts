import type {
  InteractiveButton,
  InteractiveListSection,
} from '@/lib/whatsapp/interactive-contract';

export const FLOW_SEND_CAPABILITY_ERROR = 'flow_send_capability_unavailable';

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
