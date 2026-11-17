import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvolutionMediaError, evolutionMediaLimits, resolveMedia } from './media'
import type { EvolutionCredentials } from './types'

vi.mock('server-only', () => ({}))

const credentials: EvolutionCredentials = {
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'local/media',
  token: 'test-token-only',
}

const mediaRef = {
  version: 1 as const,
  key: {
    remoteJid: '5511999999999@s.whatsapp.net',
    id: '3EB0SYNTHETIC123',
    fromMe: false as const,
  },
}

function imageBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
}

function mediaPayload(overrides: Record<string, unknown> = {}) {
  const bytes = imageBytes()
  return {
    mediaType: 'imageMessage',
    fileName: 'photo.jpg',
    mimetype: 'image/jpeg',
    size: { fileLength: bytes.length, height: 1, width: 1 },
    base64: bytes.toString('base64'),
    ...overrides,
  }
}

function jsonResponse(
  body: unknown,
  status = 201,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function mediaError(promise: Promise<unknown>): Promise<EvolutionMediaError> {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof EvolutionMediaError) return error
    throw error
  }
  throw new Error('Expected media resolution to fail.')
}

beforeEach(() => {
  vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('resolveMedia', () => {
  it('builds the fixed download request with the validated message key and apikey header', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mediaPayload()))

    const result = await resolveMedia(credentials, mediaRef)

    expect(result).toMatchObject({
      bytes: imageBytes(),
      mimeType: 'image/jpeg',
      filename: 'photo.jpg',
      contentType: 'image',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8080/chat/getBase64FromMediaMessage/local%2Fmedia')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      apikey: 'test-token-only',
      accept: 'application/json',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      message: { key: mediaRef.key },
      convertToMp4: false,
    })
    expect(String(url)).not.toContain('test-token-only')
    expect(init?.redirect).toBe('manual')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts only a bare allowlisted origin before calling fetch', async () => {
    const error = await mediaError(resolveMedia(
      { ...credentials, baseUrl: 'https://not-allowlisted.example' },
      mediaRef,
    ))

    expect(error.code).toBe('origin_not_allowed')
    expect(error.message).not.toContain('not-allowlisted.example')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an allowlisted external hostname until its connection can be pinned', async () => {
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'https://evolution.example')

    const error = await mediaError(resolveMedia(
      { ...credentials, baseUrl: 'https://evolution.example' },
      mediaRef,
    ))

    expect(error.code).toBe('origin_not_allowed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects credentials with path, query, or fragment before calling fetch', async () => {
    const error = await mediaError(resolveMedia(
      { ...credentials, baseUrl: 'http://127.0.0.1:8080/path?query=1' },
      mediaRef,
    ))

    expect(error.code).toBe('origin_not_allowed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong version', { ...mediaRef, version: 2 }],
    ['group JID', { ...mediaRef, key: { ...mediaRef.key, remoteJid: '12345-678@g.us' } }],
    ['outbound key', { ...mediaRef, key: { ...mediaRef.key, fromMe: true } }],
    ['empty ID', { ...mediaRef, key: { ...mediaRef.key, id: '' } }],
    ['unexpected payload field', { ...mediaRef, base64: 'must-not-be-accepted' }],
  ])('rejects invalid mediaRef (%s) before network access', async (_label, ref) => {
    const error = await mediaError(resolveMedia(credentials, ref as typeof mediaRef))

    expect(error.code).toBe('invalid_media_ref')
    expect(error.message).not.toContain('must-not-be-accepted')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('blocks redirects without reading or exposing the Location header', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://private.example/secret-path' },
    }))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error).toMatchObject({ code: 'redirect_blocked', httpStatus: 302 })
    expect(error.message).not.toContain('private.example')
  })

  it('returns sanitized HTTP errors without reading provider content', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('provider token leaked here', {
      status: 401,
      headers: { 'content-type': 'text/plain' },
    }))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error).toMatchObject({ code: 'http_error', httpStatus: 401 })
    expect(error.message).not.toContain('provider token leaked here')
  })

  it('sanitizes network errors and does not include provider or network details', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('secret-token at private.internal'))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error.code).toBe('network_error')
    expect(error.message).not.toContain('secret-token')
    expect(error.message).not.toContain('private.internal')
  })

  it('enforces the response byte limit from Content-Length before parsing', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'content-length': String(evolutionMediaLimits.maxResponseBytes + 1),
      },
    }))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error.code).toBe('response_too_large')
  })

  it('enforces the decoded-media Base64 size limit', async () => {
    const tooLargeBase64 = 'A'.repeat(Math.ceil(evolutionMediaLimits.maxBytes / 3) * 4 + 4)
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      mediaType: 'imageMessage',
      mimetype: 'image/jpeg',
      base64: tooLargeBase64,
    }))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error.code).toBe('media_too_large')
    expect(error.message).not.toContain('AAAA')
  })

  it('fails on timeout while receiving the provider response', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('private response detail', 'AbortError')))
    }))

    const pending = mediaError(resolveMedia(credentials, mediaRef))
    await vi.advanceTimersByTimeAsync(evolutionMediaLimits.timeoutMs)
    const error = await pending

    expect(error.code).toBe('timeout')
    expect(error.message).not.toContain('private response detail')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed Base64, unsupported kinds, MIME mismatches, and bad signatures', async () => {
    const cases = [
      { payload: mediaPayload({ base64: 'not base64' }), code: 'invalid_response' },
      { payload: mediaPayload({ mediaType: 'stickerMessage' }), code: 'unsupported_media_type' },
      { payload: mediaPayload({ mimetype: 'application/pdf' }), code: 'unsupported_media_type' },
      { payload: mediaPayload({ base64: Buffer.from('not an image').toString('base64') }), code: 'invalid_media_content' },
    ] as const

    for (const { payload, code } of cases) {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(payload))
      const error = await mediaError(resolveMedia(credentials, mediaRef))
      expect(error.code).toBe(code)
      expect(error.message).not.toContain('not base64')
    }
  })

  it.each([
    {
      mediaType: 'documentMessage',
      fileName: 'letter.pdf',
      mimetype: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7\nsynthetic'),
      contentType: 'document',
    },
    {
      mediaType: 'audioMessage',
      fileName: 'voice.ogg',
      mimetype: 'audio/ogg; codecs=opus',
      bytes: Buffer.from('OggS\u0000synthetic-audio'),
      contentType: 'audio',
    },
    {
      mediaType: 'audioMessage',
      fileName: 'voice.oga',
      mimetype: 'audio/ogg; codecs=opus',
      bytes: Buffer.from('OggS\u0000synthetic-audio'),
      contentType: 'audio',
    },
    {
      mediaType: 'videoMessage',
      fileName: 'clip.mp4',
      mimetype: 'video/mp4',
      bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      contentType: 'video',
    },
  ])('accepts synthetic $contentType bytes only when MIME and signature match', async (fixture) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      mediaType: fixture.mediaType,
      fileName: fixture.fileName,
      mimetype: fixture.mimetype,
      size: { fileLength: fixture.bytes.length },
      base64: fixture.bytes.toString('base64'),
    }))

    await expect(resolveMedia(credentials, mediaRef)).resolves.toMatchObject({
      mimeType: fixture.mimetype.split(';')[0],
      filename: fixture.fileName,
      contentType: fixture.contentType,
    })
  })

  it('rejects a filename whose extension disagrees with the validated MIME', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mediaPayload({ fileName: 'invoice.pdf' })))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error.code).toBe('invalid_media_content')
  })

  it('sanitizes provider filenames and uses a safe fallback when omitted', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(mediaPayload({ fileName: '../private/photo.jpg' })))
      .mockResolvedValueOnce(jsonResponse(mediaPayload({ fileName: null })))

    await expect(resolveMedia(credentials, mediaRef)).resolves.toMatchObject({ filename: 'photo.jpg' })
    await expect(resolveMedia(credentials, mediaRef)).resolves.toMatchObject({ filename: 'media-image.jpg' })
  })

  it('rejects a provider-reported size that differs from the decoded bytes', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mediaPayload({ size: { fileLength: 999 } })))

    const error = await mediaError(resolveMedia(credentials, mediaRef))

    expect(error.code).toBe('invalid_media_content')
  })
})
