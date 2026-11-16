import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canQueueInboxTextSend,
  canSubmitInboxTextMessage,
  createInboxTextSendOperation,
  getInboxTextOperationStatus,
  loadInboxTextSendOperations,
  postInboxTextOnce,
  saveInboxTextSendOperation,
} from './text-send-operation';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('Inbox text send operation', () => {
  it('keeps text sending disabled until its capability is enabled and no result is unresolved', () => {
    expect(canQueueInboxTextSend(false, false)).toBe(false);
    expect(canQueueInboxTextSend(true, true)).toBe(false);
    expect(canQueueInboxTextSend(true, false)).toBe(true);
    expect(canQueueInboxTextSend(true, false, true)).toBe(false);
  });

  it('allows eligible nonempty text independently of the expired Meta window', () => {
    expect(canSubmitInboxTextMessage(' hello ', false, true, false)).toBe(true);
    expect(canSubmitInboxTextMessage('   ', false, true, false)).toBe(false);
    expect(canSubmitInboxTextMessage('hello', true, true, false)).toBe(false);
    expect(canSubmitInboxTextMessage('hello', false, false, false)).toBe(false);
    expect(canSubmitInboxTextMessage('hello', false, true, true)).toBe(false);
  });

  it('creates one key per action and restores the same pending key after reload', () => {
    const storage = new MemoryStorage();
    const operation = createInboxTextSendOperation(
      'conversation-1',
      'Hello',
      'temp-1',
      'request-stable-1',
      '2026-11-16T12:00:00.000Z'
    );

    expect(saveInboxTextSendOperation(operation, storage)).toBe(true);
    const afterReload = loadInboxTextSendOperations(storage);
    expect(afterReload).toEqual([operation]);
    expect(afterReload[0].requestId).toBe('request-stable-1');
  });

  it('uses the same key for one POST and GET reconciliation after an ambiguous result', async () => {
    const storage = new MemoryStorage();
    const operation = createInboxTextSendOperation(
      'conversation-1',
      'Hello',
      'temp-1',
      'request-stable-1'
    );
    expect(saveInboxTextSendOperation(operation, storage)).toBe(true);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: 'delivery_unknown' }, { status: 504 })
      )
      .mockResolvedValueOnce(
        Response.json({
          requestId: 'request-stable-1',
          state: 'unknown',
          messageRowId: 'message-row-1',
        })
      );

    await expect(postInboxTextOnce(operation, fetcher)).resolves.toEqual({
      kind: 'unknown',
    });
    saveInboxTextSendOperation({ ...operation, state: 'unknown' }, storage);
    const afterReload = loadInboxTextSendOperations(storage)[0];
    expect(afterReload.requestId).toBe('request-stable-1');
    await expect(
      getInboxTextOperationStatus(afterReload.requestId, fetcher)
    ).resolves.toEqual({ state: 'unknown' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('/api/whatsapp/send');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'request-stable-1' },
    });
    expect(fetcher.mock.calls[1][0]).toBe(
      '/api/whatsapp/operations/request-stable-1'
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('restores accepted state with the existing message row id without a POST', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ state: 'accepted', messageRowId: 'message-row-1' })
      );

    await expect(
      getInboxTextOperationStatus('request-stable-1', fetcher)
    ).resolves.toEqual({ state: 'accepted', messageRowId: 'message-row-1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('never retries the POST after a network timeout', async () => {
    const operation = createInboxTextSendOperation(
      'conversation-1',
      'Hello',
      'temp-1',
      'request-stable-1'
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('timeout'));

    await expect(postInboxTextOnce(operation, fetcher)).resolves.toEqual({
      kind: 'unknown',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('forwards reply context so unsupported replies are explicitly rejected', async () => {
    const operation = createInboxTextSendOperation(
      'conversation-1',
      'Reply',
      'temp-1',
      'request-reply-1',
      '2026-11-16T12:00:00.000Z',
      'parent-message-1'
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error:
            'Reply-to text sending is not supported by the Evolution adapter yet',
        },
        { status: 400 }
      )
    );

    await expect(postInboxTextOnce(operation, fetcher)).resolves.toEqual({
      kind: 'rejected',
      reason:
        'Reply-to text sending is not supported by the Evolution adapter yet',
    });
    const requestBody = JSON.parse(
      String(fetcher.mock.calls[0][1]?.body)
    ) as Record<string, unknown>;
    expect(requestBody.reply_to_message_id).toBe('parent-message-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('has localized operation and capability copy in all four product languages', () => {
    for (const locale of ['en', 'pt', 'es', 'ko']) {
      const messages = JSON.parse(
        readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf8')
      ) as {
        Inbox: {
          messageThread: Record<string, string>;
          composer: Record<string, string>;
        };
      };
      expect(messages.Inbox.messageThread.sendStorageUnavailable).toBeTruthy();
      expect(messages.Inbox.messageThread.operationStatus).toContain(
        '{status}'
      );
      expect(messages.Inbox.messageThread.replySendUnsupported).toBeTruthy();
      expect(messages.Inbox.composer.textSendingUnavailable).toBeTruthy();
    }

    const en = JSON.parse(
      readFileSync(resolve(process.cwd(), 'messages/en.json'), 'utf8')
    ) as { Inbox: { composer: Record<string, string> } };
    expect(en.Inbox.composer.textSendingUnavailable).not.toMatch(
      /QA|inbound|verification|implementation/i
    );
  });
});
