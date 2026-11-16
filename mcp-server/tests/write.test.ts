import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { WacrmClient } from '../src/client.js';
import {
  registerWriteTools,
  sendTextMessageSchema,
} from '../src/tools/write.js';

type RegisteredTool = {
  name: string;
  config: { inputSchema?: unknown };
  callback: (args: unknown) => Promise<unknown>;
};

describe('MCP send_message write tool', () => {
  it('requires an explicit stable key and rejects template, media, and reply fields', () => {
    const valid = {
      to: '+14155550123',
      text: 'Hello',
      idempotency_key: 'stable-action-key-1',
    };

    expect(sendTextMessageSchema.safeParse(valid).success).toBe(true);
    expect(
      sendTextMessageSchema.safeParse({ ...valid, idempotency_key: '' }).success,
    ).toBe(false);
    expect(
      sendTextMessageSchema.safeParse({ ...valid, template: { name: 'promo' } })
        .success,
    ).toBe(false);
    expect(
      sendTextMessageSchema.safeParse({ ...valid, media_url: 'https://example.test/x' })
        .success,
    ).toBe(false);
    expect(
      sendTextMessageSchema.safeParse({ ...valid, reply_to_message_id: 'parent-1' })
        .success,
    ).toBe(false);
  });

  it('routes one text action with the explicit key and keeps the other write tools registered', async () => {
    const registered: RegisteredTool[] = [];
    const server = {
      registerTool: (
        name: string,
        config: RegisteredTool['config'],
        callback: RegisteredTool['callback'],
      ) => {
        registered.push({ name, config, callback });
      },
    } as unknown as McpServer;
    const sendMessage = vi.fn().mockResolvedValue({ data: { message_id: 'message-1' } });
    const client = { sendMessage } as unknown as WacrmClient;

    registerWriteTools(server, client);

    const tool = registered.find(({ name }) => name === 'send_message');
    expect(tool).toBeDefined();
    expect(tool?.config.inputSchema).toBe(sendTextMessageSchema);
    await tool?.callback({
      to: '+14155550123',
      text: 'Hello',
      idempotency_key: 'stable-action-key-1',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      { to: '+14155550123', type: 'text', text: 'Hello' },
      'stable-action-key-1',
    );
    expect(registered.map(({ name }) => name)).toEqual([
      'send_message',
      'create_contact',
      'update_contact',
    ]);
  });
});
