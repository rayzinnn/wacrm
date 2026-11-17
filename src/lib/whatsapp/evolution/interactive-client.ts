import { EvolutionError, assertAllowedEvolutionOrigin } from './client';
import type { EvolutionCredentials, ProviderAcceptance } from './types';

type Common = { recipient: string; requestId: string };

export type ProviderButtons = Common & {
  kind: 'buttons';
  title: string;
  description?: string;
  footer?: string;
  buttons: Array<{ id: string; displayText: string }>;
};

export type ProviderList = Common & {
  kind: 'list';
  title: string;
  description: string;
  footerText: string;
  buttonText: string;
  sections: Array<{
    title: string;
    rows: Array<{ rowId: string; title: string; description?: string }>;
  }>;
};

export type ProviderInteractive = ProviderButtons | ProviderList;

function validString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value === value.trim() && value.length <= max &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value);
}

function validId(value: unknown, max: number): value is string {
  return validString(value, max) && !value.includes('\n');
}

function validate(input: ProviderInteractive): void {
  if (!input || !/^\d{8,15}@s\.whatsapp\.net$/.test(input.recipient) ||
      !validId(input.requestId, 200) || !validString(input.title, 1024)) {
    throw new EvolutionError('invalid_credentials', 'Evolution interactive send input is invalid.');
  }
  if (input.kind === 'buttons') {
    if (input.description !== undefined && !validString(input.description, 4096))
      throw new EvolutionError('invalid_credentials', 'Evolution button description is invalid.');
    if (input.footer !== undefined && !validString(input.footer, 1024))
      throw new EvolutionError('invalid_credentials', 'Evolution button footer is invalid.');
    if (!Array.isArray(input.buttons) || input.buttons.length < 1 || input.buttons.length > 3 ||
        input.buttons.some(b => !validId(b.id, 200) || !validString(b.displayText, 20)) ||
        new Set(input.buttons.map(b => b.id)).size !== input.buttons.length)
      throw new EvolutionError('invalid_credentials', 'Evolution reply buttons are invalid.');
  } else if (input.kind === 'list') {
    if (!validString(input.description, 4096) || !validString(input.footerText, 1024) ||
        !validString(input.buttonText, 20) || !Array.isArray(input.sections) ||
        input.sections.length < 1 || input.sections.length > 10 ||
        input.sections.some(s => !validString(s.title, 100) || !Array.isArray(s.rows) ||
          s.rows.length < 1 || s.rows.some(r => !validId(r.rowId, 200) ||
            !validString(r.title, 24) ||
            (r.description !== undefined && !validString(r.description, 72)))))
      throw new EvolutionError('invalid_credentials', 'Evolution list is invalid.');
    const rows = input.sections.flatMap(s => s.rows);
    if (rows.length > 10 || new Set(rows.map(r => r.rowId)).size !== rows.length)
      throw new EvolutionError('invalid_credentials', 'Evolution list rows are invalid.');
  } else {
    throw new EvolutionError('invalid_credentials', 'Evolution interactive kind is invalid.');
  }
}

/** One provider POST. Call only after a durable, fresh reservation. */
export async function sendInteractive(
  credentials: EvolutionCredentials,
  input: ProviderInteractive,
): Promise<ProviderAcceptance> {
  validate(input);
  if (!credentials || !validId(credentials.token, 4096) ||
      !validId(credentials.instanceId, 200))
    throw new EvolutionError('invalid_credentials', 'Evolution credentials are invalid.');
  const origin = assertAllowedEvolutionOrigin(credentials.baseUrl);
  const number = input.recipient.slice(0, input.recipient.indexOf('@'));
  const route = input.kind === 'buttons' ? 'sendButtons' : 'sendList';
  const payload = input.kind === 'buttons'
    ? { number, title: input.title, description: input.description,
        footer: input.footer, buttons: input.buttons.map(b => ({
          type: 'reply', id: b.id, displayText: b.displayText,
        })) }
    : { number, title: input.title, description: input.description,
        footerText: input.footerText, buttonText: input.buttonText,
        sections: input.sections };
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(`${origin}/message/${route}/${encodeURIComponent(credentials.instanceId)}`, {
      method: 'POST',
      headers: { apikey: credentials.token, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'manual',
    });
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400)
      throw new EvolutionError('redirect_blocked', 'Evolution redirect was blocked.', {
        httpStatus: response.status, ambiguous: true,
      });
    if (!response.ok)
      throw new EvolutionError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'http_error',
        'Evolution interactive send was rejected.', {
          httpStatus: response.status,
          ambiguous: ![401, 403, 404, 422].includes(response.status),
        });
    let body: unknown;
    try { body = await response.json(); }
    catch {
      throw new EvolutionError('invalid_response', 'Evolution interactive response is invalid.', {
        httpStatus: response.status, ambiguous: true,
      });
    }
    const key = body && typeof body === 'object' && 'key' in body
      ? (body as { key: unknown }).key : null;
    if (!key || typeof key !== 'object' ||
        !('id' in key) || !validString(key.id, 200) ||
        !('fromMe' in key) || key.fromMe !== true ||
        !('remoteJid' in key) || key.remoteJid !== input.recipient)
      throw new EvolutionError('invalid_response', 'Evolution interactive response is invalid.', {
        httpStatus: response.status, ambiguous: true,
      });
    return { externalMessageId: key.id };
  } catch (cause) {
    if (cause instanceof EvolutionError) throw cause;
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new EvolutionError(timedOut || aborted ? 'timeout' : 'network_error',
      'Evolution interactive send failed.', { ambiguous: true });
  } finally {
    clearTimeout(timeout);
  }
}
