import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { NormalizedEvent } from './events'

export class EventQueueError extends Error {
  readonly code = 'event_queue_unavailable'
  readonly status = 503

  constructor() {
    super('Evolution event queue is unavailable.')
    this.name = 'EventQueueError'
  }
}

export async function enqueueEvents(
  connectionId: string,
  events: NormalizedEvent[],
): Promise<{ inserted: number; duplicates: number }> {
  if (events.length === 0) return { inserted: 0, duplicates: 0 }

  const uniqueEvents = new Map<string, NormalizedEvent>()
  for (const event of events) {
    if (!uniqueEvents.has(event.eventKey)) uniqueEvents.set(event.eventKey, event)
  }

  const rows = [...uniqueEvents.values()].map((event) => ({
    connection_id: connectionId,
    event_key: event.eventKey,
    normalized_event: {
      kind: event.kind,
      eventKey: event.eventKey,
      occurredAt: event.occurredAt,
    },
  }))

  try {
    const { data, error } = await supabaseAdmin()
      .from('evolution_events')
      .upsert(rows, { onConflict: 'connection_id,event_key', ignoreDuplicates: true })
      .select('id')

    if (error || !Array.isArray(data)) throw new EventQueueError()

    const inserted = data.length
    return { inserted, duplicates: events.length - inserted }
  } catch {
    throw new EventQueueError()
  }
}
