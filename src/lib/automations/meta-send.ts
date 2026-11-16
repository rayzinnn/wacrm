import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export const AUTOMATION_SEND_CAPABILITY_ERROR =
  'automation_send_capability_unavailable';

interface SendTextArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
}

interface SendTemplateArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  templateName: string;
  language?: string;
  params?: string[];
}

interface SendInteractiveArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  payload: InteractiveMessagePayload;
}

function failClosed(): never {
  const error = new Error(AUTOMATION_SEND_CAPABILITY_ERROR);
  error.name = 'AutomationSendCapabilityError';
  throw error;
}

export async function engineSendText(
  _args: SendTextArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}

export async function engineSendTemplate(
  _args: SendTemplateArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}

export async function engineSendInteractive(
  _args: SendInteractiveArgs
): Promise<{ whatsapp_message_id: string }> {
  void _args;
  return failClosed();
}
