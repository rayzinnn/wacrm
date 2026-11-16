export const AI_REPLY_CAPABILITY_ERROR = 'ai_reply_capability_unavailable';

interface DispatchArgs {
  /** Tenancy key — retained for compatibility with existing callers. */
  accountId: string;
  conversationId: string;
  contactId: string;
  /** Retained for compatibility with the previous outbound send contract. */
  configOwnerUserId: string;
  /** Previously used for Meta's typing indicator. */
  inboundMessageId?: string;
}

/**
 * Legacy Meta auto-reply transport is disabled until it is connected to the
 * Evolution capability path. Reject before configuration reads, LLM usage,
 * persistence, or network activity.
 */
export async function dispatchInboundToAiReply(
  _args: DispatchArgs
): Promise<void> {
  void _args;
  const error = new Error(AI_REPLY_CAPABILITY_ERROR);
  error.name = 'AiReplyCapabilityError';
  throw error;
}
