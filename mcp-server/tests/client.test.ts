import { afterEach, describe, expect, it, vi } from 'vitest';

import { WacrmClient } from '../src/client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WacrmClient.sendMessage', () => {
  it('posts text once and forwards the caller-provided idempotency key unchanged', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: { message_id: 'message-1' } }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new WacrmClient({
      baseUrl: 'http://127.0.0.1:3000',
      apiKey: 'test-api-key',
    });

    await expect(
      client.sendMessage(
        { to: '+14155550123', type: 'text', text: 'Hello' },
        'stable-action-key-1',
      ),
    ).resolves.toEqual({ data: { message_id: 'message-1' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://127.0.0.1:3000/api/v1/messages',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'stable-action-key-1',
      },
      body: JSON.stringify({ to: '+14155550123', type: 'text', text: 'Hello' }),
    });
  });
});
