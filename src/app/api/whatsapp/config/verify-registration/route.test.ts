import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({
  sessionClientModuleLoads: 0,
  sessionClientCalls: 0,
  metaApiModuleLoads: 0,
  encryptionModuleLoads: 0,
}))

vi.mock('@/lib/supabase/server', () => {
  probes.sessionClientModuleLoads++
  return {
    createClient: vi.fn(async () => {
      probes.sessionClientCalls++
      throw new Error('Session client must not be created by a retired route.')
    }),
  }
})
vi.mock('@/lib/whatsapp/meta-api', () => {
  probes.metaApiModuleLoads++
  return { getSubscribedApps: vi.fn(), verifyPhoneNumber: vi.fn() }
})
vi.mock('@/lib/whatsapp/encryption', () => {
  probes.encryptionModuleLoads++
  return { decrypt: vi.fn() }
})

let getRoute: typeof import('./route')['GET']
let fetchSentinel: ReturnType<typeof vi.fn>

describe('retired Meta registration verification route', () => {
  beforeAll(async () => {
    vi.stubEnv('META_APP_SECRET', undefined)
    vi.stubEnv('META_APP_ID', undefined)
    probes.sessionClientModuleLoads = 0
    probes.sessionClientCalls = 0
    probes.metaApiModuleLoads = 0
    probes.encryptionModuleLoads = 0
    ;({ GET: getRoute } = await import('./route'))
  })

  beforeEach(() => {
    fetchSentinel = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('graph.facebook.com')) throw new Error('Graph sentinel')
      throw new Error('Unexpected network request')
    })
    vi.stubGlobal('fetch', fetchSentinel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(() => vi.unstubAllEnvs())

  it('loads no Meta/session client modules', () => {
    expect(probes).toEqual({
      sessionClientModuleLoads: 0,
      sessionClientCalls: 0,
      metaApiModuleLoads: 0,
      encryptionModuleLoads: 0,
    })
  })

  it('returns generic 410 with no Meta credentials or environment variables', async () => {
    const response = await getRoute()
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'legacy_provider_retired' })
  })

  it('performs no network or database I/O', async () => {
    expect(fetchSentinel).not.toHaveBeenCalled()
    expect(probes.sessionClientCalls).toBe(0)
  })
})
