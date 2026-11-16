import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runEvolutionEventBatch } from '@/lib/whatsapp/evolution/event-worker'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }
const UNAUTHORIZED = { error: 'Unauthorized.', code: 'unauthorized' }
const UNAVAILABLE = {
  error: 'Event processing is unavailable.',
  code: 'event_processing_unavailable',
}

function hasValidBearer(request: Request): boolean {
  const expectedSecret = process.env.EVOLUTION_EVENTS_CRON_SECRET
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([^\s]+)$/i)
  if (!expectedSecret || !match) return false

  const expected = Buffer.from(expectedSecret, 'utf8')
  const supplied = Buffer.from(match[1], 'utf8')
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!hasValidBearer(request)) {
    return NextResponse.json(UNAUTHORIZED, { status: 401, headers: NO_STORE })
  }

  try {
    const counts = await runEvolutionEventBatch()
    return NextResponse.json(
      {
        claimed: counts.claimed,
        done: counts.done,
        retry: counts.retry,
        failed: counts.failed,
        stale: counts.stale,
      },
      { headers: NO_STORE },
    )
  } catch {
    return NextResponse.json(UNAVAILABLE, { status: 503, headers: NO_STORE })
  }
}
