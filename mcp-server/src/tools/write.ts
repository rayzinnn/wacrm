// ============================================================
// Write tools — registered only when WACRM_ENABLE_WRITES is set.
//
// These change data or send a WhatsApp message. They are gated so a
// read-only deployment never exposes them to the model at all. (The
// API key's scopes are still enforced server-side; a call without the
// right scope returns a clean `forbidden` error.)
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

export const sendTextMessageSchema = z
  .object({
    to: z.string().describe('Recipient phone number in E.164 format, e.g. +14155550123.'),
    text: z.string().min(1).describe('Free-form text message body.'),
    idempotency_key: z
      .string()
      .min(1)
      .max(200)
      .refine((key) => key.trim().length > 0, 'Must not be blank.')
      .describe(
        'Stable caller-provided key for this send action. Reuse the exact same value if retrying after an uncertain result; do not create a new key for a retry.',
      ),
  })
  .strict()
  .describe('Text-only WhatsApp send. Template, media, and reply fields are unsupported.');

export function registerWriteTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_message',
    {
      title: 'Send WhatsApp message',
      description:
        'Send a free-form text WhatsApp message to an E.164 phone number. The contact and conversation are found-or-created automatically by the API. Supply an idempotency_key that remains stable for this send action; if the outcome is uncertain, retry only with the same key. Template, media, and reply sends are not available through this tool. This sends a real message to a real person; confirm the recipient and content with the user before calling.',
      inputSchema: sendTextMessageSchema,
      annotations: { title: 'Send WhatsApp message', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ to, text, idempotency_key }) =>
      jsonResult(
        await client.sendMessage({ to, type: 'text', text }, idempotency_key),
      ),
    ),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create contact',
      description:
        'Create a contact by phone number (E.164, required). Find-or-create: if a contact with that phone already exists, its name, email and company are left unchanged and any tags you pass are added to the tags it already has (none are removed). Optional: name, email, company, and tags (tag names, created if missing).',
      inputSchema: {
        phone: z.string().describe('Phone number in E.164 format, e.g. +14155550123.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Tag names; created if they do not exist. Added to an existing contact’s tags, never replacing them.'),
      },
      annotations: { title: 'Create contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.createContact(args))),
  );

  server.registerTool(
    'update_contact',
    {
      title: 'Update contact',
      description:
        'Update an existing contact. Only the fields you pass are changed. Pass tags (an array of tag names) to replace the contact’s tags entirely.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Replaces the contact’s tags.'),
      },
      annotations: { title: 'Update contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateContact(id, body))),
  );
}
