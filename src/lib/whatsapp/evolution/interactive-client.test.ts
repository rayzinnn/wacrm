import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendInteractive, type ProviderInteractive } from './interactive-client';

const credentials = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'local/name',
  token: 'test-token',
};
const buttons: ProviderInteractive = {
  kind: 'buttons', recipient: '15551234567@s.whatsapp.net', requestId: 'step-1',
  title: 'Choose', buttons: [{ id: 'go', displayText: 'Go' }],
};
const list: ProviderInteractive = {
  kind: 'list', recipient: '15551234567@s.whatsapp.net', requestId: 'step-2',
  title: 'Options', description: 'Choose\none', footerText: 'Select one', buttonText: 'Open',
  sections: [{ title: 'Main', rows: [{ rowId: 'go', title: 'Go' }] }],
};

beforeEach(() => {
  vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    key: { id: 'provider-id', fromMe: true, remoteJid: '15551234567@s.whatsapp.net' },
  }, { status: 201 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('local Evolution interactive transport', () => {
  it.each([
    [buttons, 'sendButtons', { buttons: [{ type: 'reply', id: 'go', displayText: 'Go' }] }],
    [list, 'sendList', { sections: [{ title: 'Main', rows: [{ rowId: 'go', title: 'Go' }] }] }],
  ] as const)('maps a %s payload to one POST', async (input, route, expected) => {
    await expect(sendInteractive(credentials, input)).resolves.toEqual({ externalMessageId: 'provider-id' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:8080/message/${route}/local%2Fname`);
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(String(init?.body))).toMatchObject({ number: '15551234567', ...expected });
  });

  it('rejects invalid or duplicate selection IDs before network I/O', async () => {
    await expect(sendInteractive(credentials, {
      ...buttons, buttons: [{ id: 'go', displayText: 'Go' }, { id: 'go', displayText: 'Again' }],
    })).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(sendInteractive(credentials, {
      ...list, sections: [{ title: 'Main', rows: [{ rowId: ' go', title: 'Go' }] }],
    })).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks a malformed accepted response ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ key: { id: 'x', fromMe: true,
      remoteJid: 'other@s.whatsapp.net' } }, { status: 201 })));
    await expect(sendInteractive(credentials, buttons)).rejects.toMatchObject({
      code: 'invalid_response', ambiguous: true,
    });
  });

  it('marks a server failure ambiguous and an explicit validation rejection final', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
    await expect(sendInteractive(credentials, buttons)).rejects.toMatchObject({
      code: 'http_error', ambiguous: true,
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 422 })));
    await expect(sendInteractive(credentials, list)).rejects.toMatchObject({
      code: 'http_error', ambiguous: false,
    });
  });
});
