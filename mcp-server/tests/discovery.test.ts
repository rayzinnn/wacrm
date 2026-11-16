import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { WacrmClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { registerTools } from '../src/tools/index.js';

type ToolRegistration = {
  name: string;
  config: { title?: string; description?: string };
};

function discoverTools() {
  const registered: ToolRegistration[] = [];
  const server = {
    registerTool: (
      name: string,
      config: ToolRegistration['config'],
      _callback: unknown,
    ) => registered.push({ name, config }),
  } as unknown as McpServer;

  const enabledGroups = registerTools(
    server,
    {} as WacrmClient,
    loadConfig(),
  );

  return { enabledGroups, registered };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MCP tool discovery', () => {
  it('ignores the retired broadcast opt-in and discovers no broadcast tools', () => {
    vi.stubEnv('WACRM_BASE_URL', 'https://crm.example.test');
    vi.stubEnv('WACRM_API_KEY', 'local-test-key');
    vi.stubEnv('WACRM_ENABLE_WRITES', 'false');
    vi.stubEnv('WACRM_ENABLE_BROADCASTS', 'true');

    const config = loadConfig();
    expect(config).not.toHaveProperty('enableBroadcasts');

    const { enabledGroups, registered } = discoverTools();
    expect(enabledGroups).toEqual(['read']);
    expect(registered.map(({ name }) => name)).not.toContain('send_broadcast');
    expect(registered.map(({ name }) => name)).not.toContain('get_broadcast');
    expect(
      registered.some(({ name, config: tool }) =>
        /broadcast/i.test(`${name} ${tool.title ?? ''} ${tool.description ?? ''}`),
      ),
    ).toBe(false);
  });

  it('keeps text and contact-write tools when writes are enabled, without broadcast tools', () => {
    vi.stubEnv('WACRM_BASE_URL', 'https://crm.example.test');
    vi.stubEnv('WACRM_API_KEY', 'local-test-key');
    vi.stubEnv('WACRM_ENABLE_WRITES', 'true');
    vi.stubEnv('WACRM_ENABLE_BROADCASTS', 'true');

    const { enabledGroups, registered } = discoverTools();
    const names = registered.map(({ name }) => name);

    expect(enabledGroups).toEqual(['read', 'write']);
    expect(names).toContain('send_message');
    expect(names).toContain('create_contact');
    expect(names).toContain('update_contact');
    expect(names).not.toContain('send_broadcast');
    expect(names).not.toContain('get_broadcast');
    expect(names.some((name) => /broadcast/i.test(name))).toBe(false);
  });
});
