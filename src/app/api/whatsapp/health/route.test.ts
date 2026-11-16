import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: 'viewer',
  accountId: 'account-viewer',
  requireRole: vi.fn(async () => ({
    accountId: mocks.accountId,
    role: mocks.role,
    userId: 'user-a',
  })),
  loadConnectionSummary: vi.fn(),
  decrypt: vi.fn(),
  getSession: vi.fn(),
  getPhoneNumberHealth: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})
vi.mock('@/lib/auth/roles', () => ({
  canEditSettings: (role: string) => role === 'owner' || role === 'admin',
}))
vi.mock('@/lib/whatsapp/evolution/store', () => ({
  loadConnectionSummary: mocks.loadConnectionSummary,
  saveConnection: vi.fn(),
  saveSessionState: vi.fn(),
}))
vi.mock('@/lib/whatsapp/evolution/client', () => ({
  assertAllowedEvolutionOrigin: vi.fn(),
  getSession: mocks.getSession,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ getPhoneNumberHealth: mocks.getPhoneNumberHealth }))

import { GET } from './route'

const SAFE_SUMMARY = {
  id: 'connection-id-must-not-leak',
  provider: 'evolution',
  baseUrl: 'http://127.0.0.1:8080',
  instanceId: 'local-instance',
  state: 'connected',
  checkedAt: '2026-11-16T12:00:00.000Z',
  token: 'raw-token-must-not-leak',
  token_encrypted: 'ciphertext-must-not-leak',
  webhook_secret_encrypted: 'webhook-secret-must-not-leak',
}

beforeEach(() => {
  mocks.role = 'viewer'
  mocks.accountId = 'account-viewer'
  mocks.requireRole.mockClear()
  mocks.loadConnectionSummary.mockReset().mockResolvedValue(SAFE_SUMMARY)
  mocks.decrypt.mockReset()
  mocks.getSession.mockReset()
  mocks.getPhoneNumberHealth.mockReset()
})

describe('GET /api/whatsapp/health legacy alias', () => {
  it('delegates to the viewer-authorized Evolution config DTO without secrets or provider calls', async () => {
    const response = await GET()
    const body = await response.json()

    expect(mocks.requireRole).toHaveBeenCalledWith('viewer')
    expect(mocks.loadConnectionSummary).toHaveBeenCalledWith('account-viewer')
    expect(body).toMatchObject({
      configured: true,
      provider: 'evolution',
      state: 'connected',
      checkedAt: SAFE_SUMMARY.checkedAt,
    })
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('baseUrl')
    expect(body).not.toHaveProperty('instanceId')
    for (const secret of [SAFE_SUMMARY.token, SAFE_SUMMARY.token_encrypted, SAFE_SUMMARY.webhook_secret_encrypted]) {
      expect(JSON.stringify(body)).not.toContain(secret)
    }
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getPhoneNumberHealth).not.toHaveBeenCalled()
  })

  it('keeps the config route owner DTO and its account scope', async () => {
    mocks.role = 'owner'
    mocks.accountId = 'account-owner'

    const response = await GET()
    const body = await response.json()

    expect(mocks.requireRole).toHaveBeenCalledWith('viewer')
    expect(mocks.loadConnectionSummary).toHaveBeenCalledWith('account-owner')
    expect(body).toMatchObject({
      configured: true,
      provider: 'evolution',
      state: 'connected',
      baseUrl: SAFE_SUMMARY.baseUrl,
      instanceId: SAFE_SUMMARY.instanceId,
    })
    expect(body).not.toHaveProperty('id')
    expect(JSON.stringify(body)).not.toContain(SAFE_SUMMARY.token)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getPhoneNumberHealth).not.toHaveBeenCalled()
  })

  it('returns the standard safe DTO when the account has no Evolution connection', async () => {
    mocks.loadConnectionSummary.mockResolvedValue(null)

    const response = await GET()
    const body = await response.json()

    expect(body).toMatchObject({
      configured: false,
      provider: 'evolution',
      state: 'disconnected',
      checkedAt: null,
    })
    expect(body).not.toHaveProperty('baseUrl')
    expect(body).not.toHaveProperty('instanceId')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.getPhoneNumberHealth).not.toHaveBeenCalled()
  })
})
