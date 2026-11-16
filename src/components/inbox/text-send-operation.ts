import type { Message } from '@/types';

const STORAGE_KEY = 'wacrm.inbox.text-send-operations.v1';
const POST_TIMEOUT_MS = 30_000;

export type TextSendOperationState = 'pending' | 'unknown';

export interface InboxTextSendOperation {
  requestId: string;
  conversationId: string;
  tempMessageId: string;
  contentText: string;
  replyToId?: string;
  createdAt: string;
  state: TextSendOperationState;
}

export type OperationStatus =
  | { state: 'pending' | 'unknown' }
  | { state: 'accepted'; messageRowId: string }
  | { state: 'rejected' };

export function canQueueInboxTextSend(
  textCapabilityEnabled: boolean,
  hasUnresolvedOperation: boolean,
  hasUnsupportedReplyContext = false
): boolean {
  return (
    textCapabilityEnabled &&
    !hasUnresolvedOperation &&
    !hasUnsupportedReplyContext
  );
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type FetchLike = typeof fetch;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parseOperations(raw: string | null): InboxTextSendOperation[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is InboxTextSendOperation =>
        value &&
        typeof value === 'object' &&
        typeof value.requestId === 'string' &&
        typeof value.conversationId === 'string' &&
        typeof value.tempMessageId === 'string' &&
        typeof value.contentText === 'string' &&
        (value.replyToId === undefined ||
          typeof value.replyToId === 'string') &&
        typeof value.createdAt === 'string' &&
        (value.state === 'pending' || value.state === 'unknown')
    );
  } catch {
    return [];
  }
}

export function createInboxTextSendOperation(
  conversationId: string,
  contentText: string,
  tempMessageId: string,
  requestId = globalThis.crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  replyToId?: string
): InboxTextSendOperation {
  return {
    requestId,
    conversationId,
    tempMessageId,
    contentText,
    replyToId,
    createdAt,
    state: 'pending',
  };
}

export function loadInboxTextSendOperations(
  storage: StorageLike | null = browserStorage()
): InboxTextSendOperation[] {
  if (!storage) return [];
  try {
    return parseOperations(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveInboxTextSendOperation(
  operation: InboxTextSendOperation,
  storage: StorageLike | null = browserStorage()
): boolean {
  if (!storage) return false;
  try {
    const operations = loadInboxTextSendOperations(storage).filter(
      (item) => item.requestId !== operation.requestId
    );
    storage.setItem(STORAGE_KEY, JSON.stringify([...operations, operation]));
    return true;
  } catch {
    return false;
  }
}

export function removeInboxTextSendOperation(
  requestId: string,
  storage: StorageLike | null = browserStorage()
): void {
  if (!storage) return;
  try {
    const operations = loadInboxTextSendOperations(storage).filter(
      (item) => item.requestId !== requestId
    );
    storage.setItem(STORAGE_KEY, JSON.stringify(operations));
  } catch {
    // Keep UI reconciliation best-effort if browser storage is unavailable.
  }
}

export function toOptimisticTextMessage(
  operation: InboxTextSendOperation
): Message {
  return {
    id: operation.tempMessageId,
    conversation_id: operation.conversationId,
    sender_type: 'agent',
    content_type: 'text',
    content_text: operation.contentText,
    reply_to_message_id: operation.replyToId,
    status: 'sending',
    created_at: operation.createdAt,
  };
}

export type PostTextResult =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unknown' };

/** Performs one POST only. Ambiguous outcomes must be reconciled with GET. */
export async function postInboxTextOnce(
  operation: InboxTextSendOperation,
  fetcher: FetchLike = fetch
): Promise<PostTextResult> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    response = await fetcher('/api/whatsapp/send', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operation.requestId,
      },
      body: JSON.stringify({
        conversation_id: operation.conversationId,
        message_type: 'text',
        content_text: operation.contentText,
        ...(operation.replyToId
          ? { reply_to_message_id: operation.replyToId }
          : {}),
      }),
    });
  } catch {
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as {
    message_id?: unknown;
    error?: unknown;
  } | null;
  if (response.ok) {
    return typeof body?.message_id === 'string' && body.message_id
      ? { kind: 'accepted', messageId: body.message_id }
      : { kind: 'unknown' };
  }
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 425
  ) {
    return {
      kind: 'rejected',
      reason:
        typeof body?.error === 'string'
          ? body.error
          : `HTTP ${response.status}`,
    };
  }
  return { kind: 'unknown' };
}

export async function getInboxTextOperationStatus(
  requestId: string,
  fetcher: FetchLike = fetch
): Promise<OperationStatus> {
  const response = await fetcher(
    `/api/whatsapp/operations/${encodeURIComponent(requestId)}`,
    { method: 'GET', cache: 'no-store' }
  );
  if (!response.ok) throw new Error('Operation status is unavailable');
  const body = (await response.json()) as {
    state?: unknown;
    messageRowId?: unknown;
  };
  if (body.state === 'accepted' && typeof body.messageRowId === 'string') {
    return { state: 'accepted', messageRowId: body.messageRowId };
  }
  if (body.state === 'rejected') return { state: 'rejected' };
  if (body.state === 'pending' || body.state === 'unknown') {
    return { state: body.state };
  }
  throw new Error('Operation status is invalid');
}
