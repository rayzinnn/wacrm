// ============================================================
// Tool registration — reads are always on and writes are opt-in
// (see config.ts). Broadcast endpoints are unsupported and have no
// MCP tools.
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import type { Config } from '../config.js';
import { registerReadTools } from './read.js';
import { registerWriteTools } from './write.js';

export function registerTools(server: McpServer, client: WacrmClient, config: Config): string[] {
  const enabled: string[] = ['read'];
  registerReadTools(server, client);

  if (config.enableWrites) {
    registerWriteTools(server, client);
    enabled.push('write');
  }

  return enabled;
}
