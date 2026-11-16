import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({
  supabaseModuleLoads: 0,
  supabaseClientCalls: 0,
  signatureModuleLoads: 0,
  metaApiModuleLoads: 0,
  engineModuleLoads: 0,
  flowModuleLoads: 0,
  aiModuleLoads: 0,
}))

vi.mock('@supabase/supabase-js', () => {
  probes.supabaseModuleLoads++
  return {
    createClient: vi.fn(() => {
      probes.supabaseClientCalls++
      throw new Error('Database client must not be created by a retired route.')
    }),
  }
})
vi.mock('@/lib/whatsapp/webhook-signature', () => {
  probes.signatureModuleLoads++
  return { verifyMetaWebhookSignature: vi.fn(), verifyTokenMatches: vi.fn() }
})
vi.mock('@/lib/whatsapp/meta-api', () => {
  probes.metaApiModuleLoads++
  return { getMediaUrl: vi.fn(), downloadMedia: vi.fn() }
})
vi.mock('@/lib/automations/engine', () => {
  probes.engineModuleLoads++
  return { resumeAwaitingReply: vi.fn(), runAutomationsForTrigger: vi.fn() }
})
vi.mock('@/lib/flows/engine', () => {
  probes.flowModuleLoads++
  return { dispatchInboundToFlows: vi.fn() }
})
vi.mock('@/lib/ai/auto-reply', () => {
  probes.aiModuleLoads++
  return { dispatchInboundToAiReply: vi.fn() }
})

const RETIRED_ERROR = { error: 'legacy_provider_retired' }

describe('retired Meta WhatsApp webhook', () => {
  let route: typeof import('./route')
  let fetchSentinel: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    vi.stubEnv('META_APP_SECRET', undefined)
    vi.stubEnv('META_VERIFY_TOKEN', undefined)
    probes.supabaseModuleLoads = 0
    probes.supabaseClientCalls = 0
    probes.signatureModuleLoads = 0
    probes.metaApiModuleLoads = 0
    probes.engineModuleLoads = 0
    probes.flowModuleLoads = 0
    probes.aiModuleLoads = 0
    route = await import('./route')
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

  async function expectRetired(response: Response) {
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual(RETIRED_ERROR)
  }

  it('loads no Meta/database/engine modules', () => {
    expect(probes).toMatchObject({
      supabaseModuleLoads: 0,
      supabaseClientCalls: 0,
      signatureModuleLoads: 0,
      metaApiModuleLoads: 0,
      engineModuleLoads: 0,
      flowModuleLoads: 0,
      aiModuleLoads: 0,
    })
  })

  it('returns 410 for GET regardless of arbitrary verification token or missing Meta secret', async () => {
    const first = await route.GET(new Request(
      'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=arbitrary&hub.verify_token=wrong-token',
    ))
    await expectRetired(first)

    const second = await route.GET(new Request(
      'http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=other&hub.verify_token=another-token',
    ))
    await expectRetired(second)
  })

  it('returns 410 for POST without inspecting body or arbitrary signature/token headers', async () => {
    let bodyRead = false
    const request = {
      url: 'http://localhost/api/whatsapp/webhook',
      headers: new Headers({
        'x-hub-signature-256': 'arbitrary-signature',
        authorization: 'Bearer arbitrary-token',
      }),
      get body() {
        bodyRead = true
        throw new Error('Request body must not be read')
      },
    } as unknown as Request

    await expectRetired(await route.POST(request))
    expect(bodyRead).toBe(false)
  })

  it('performs no network or database I/O', async () => {
    expect(fetchSentinel).not.toHaveBeenCalled()
    expect(probes.supabaseClientCalls).toBe(0)
  })
})
