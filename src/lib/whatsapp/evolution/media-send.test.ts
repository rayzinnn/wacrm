import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvolutionMediaSendError, sendMedia, type ProviderMedia } from './media-send'
import type { EvolutionCredentials } from './types'

vi.mock('server-only', () => ({}))

const credentials: EvolutionCredentials = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'wacrm-local',
  token: 'synthetic-test-token',
}

const image: ProviderMedia = {
  recipient: '5511999999999@s.whatsapp.net',
  requestId: 'synthetic-reservation-1',
  mediaType: 'image',
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
  mimeType: 'image/png',
  fileName: 'sample.png',
  caption: 'Synthetic image',
}

function acceptedResponse() {
  return new Response(JSON.stringify({
    key: { id: 'synthetic-message-id', remoteJid: image.recipient, fromMe: true },
  }), { status: 201, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sendMedia', () => {
  it('posts one bounded image request and returns the provider ID', async () => {
    vi.mocked(fetch).mockResolvedValue(acceptedResponse())

    await expect(sendMedia(credentials, image)).resolves.toEqual({
      externalMessageId: 'synthetic-message-id',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8080/message/sendMedia/wacrm-local')
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        apikey: 'synthetic-test-token',
        accept: 'application/json',
        'content-type': 'application/json',
      },
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      number: '5511999999999',
      mediatype: 'image',
      media: Buffer.from(image.bytes).toString('base64'),
      mimetype: 'image/png',
      fileName: 'sample.png',
      caption: 'Synthetic image',
    })
  })

  it('supports a synthetic PDF without a caption', async () => {
    vi.mocked(fetch).mockResolvedValue(acceptedResponse())
    const document: ProviderMedia = {
      ...image,
      mediaType: 'document',
      bytes: new TextEncoder().encode('%PDF-synthetic'),
      mimeType: 'application/pdf',
      fileName: '../sample.pdf',
      caption: undefined,
    }

    await expect(sendMedia(credentials, document)).resolves.toEqual({
      externalMessageId: 'synthetic-message-id',
    })
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body).toMatchObject({ mediatype: 'document', fileName: 'sample.pdf' })
    expect(body).not.toHaveProperty('caption')
  })

  it('rejects mismatched signatures and blocked origins before network I/O', async () => {
    await expect(sendMedia(credentials, { ...image, bytes: new TextEncoder().encode('not a PNG') }))
      .rejects.toMatchObject({ code: 'invalid_media' })
    await expect(sendMedia({ ...credentials, baseUrl: 'http://localhost:8080' }, image))
      .rejects.toMatchObject({ code: 'origin_not_allowed' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not retry an uncertain provider response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }))

    await expect(sendMedia(credentials, image)).rejects.toMatchObject({
      code: 'http_error',
      httpStatus: 503,
      ambiguous: true,
    } satisfies Partial<EvolutionMediaSendError>)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an accepted response without the matching recipient ID', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      key: { id: 'synthetic-message-id', remoteJid: 'another@s.whatsapp.net', fromMe: true },
    }), { status: 201, headers: { 'content-type': 'application/json' } }))

    await expect(sendMedia(credentials, image)).rejects.toMatchObject({
      code: 'invalid_response',
      ambiguous: true,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
