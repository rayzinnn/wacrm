import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pending: [] as Record<string, unknown>[],
  queryFilters: [] as [string, string, unknown][],
  claimed: [] as string[],
  resumed: [] as string[],
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    const filters: [string, string, unknown][] = []
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push(['eq', column, value])
        return builder
      },
      is: (column: string, value: unknown) => {
        filters.push(['is', column, value])
        return builder
      },
      lte: (column: string, value: unknown) => {
        filters.push(['lte', column, value])
        return builder
      },
      order: () => builder,
      limit: () => {
        h.queryFilters = filters
        return builder
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: h.pending.filter((row) =>
            filters.every(([operator, column, value]) => {
              if (operator === 'is') return (row[column] ?? null) === value
              if (operator === 'eq') return row[column] === value
              if (operator === 'lte') return String(row[column]) <= String(value)
              return true
            }),
          ),
          error: null,
        }).then(resolve, reject),
    }
    return { from: () => builder }
  },
}))

vi.mock('@/lib/automations/engine', () => ({
  claimPendingExecution: async (id: string) => {
    h.claimed.push(id)
    return true
  },
  expireAwaitingReplies: async () => 0,
  requeueStalledExecutions: async () => 0,
  resumePendingExecution: async (row: { id: string }) => {
    h.resumed.push(row.id)
  },
}))

import { GET } from './route'

describe('GET /api/automations/cron', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'cron-secret'
    h.pending = [
      {
        id: 'legacy-due',
        status: 'pending',
        run_at: new Date(Date.now() - 1000).toISOString(),
        evolution_dispatch_step_id: null,
      },
      {
        id: 'evolution-due',
        status: 'pending',
        run_at: new Date(Date.now() - 1000).toISOString(),
        evolution_dispatch_step_id: 'step-1',
      },
    ]
    h.queryFilters = []
    h.claimed = []
    h.resumed = []
  })

  it('selects, claims and resumes only legacy due waits', async () => {
    const response = await GET(
      new Request('http://localhost/api/automations/cron', {
        headers: { 'x-cron-secret': 'cron-secret' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ processed: 1, expired: 0, requeued: 0 })
    expect(h.queryFilters).toContainEqual(['is', 'evolution_dispatch_step_id', null])
    expect(h.claimed).toEqual(['legacy-due'])
    expect(h.resumed).toEqual(['legacy-due'])
  })
})
