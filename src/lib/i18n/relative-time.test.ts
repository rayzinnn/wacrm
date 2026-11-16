import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './relative-time'

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers())

  it('shows the app language for relative times', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T21:00:00Z'))
    const oneMinuteEarlier = new Date('2026-11-16T20:59:00Z')

    expect(formatRelativeTime(oneMinuteEarlier, 'pt')).toContain('minuto')
    expect(formatRelativeTime(oneMinuteEarlier, 'es', true)).toContain('hace')
    expect(formatRelativeTime(oneMinuteEarlier, 'ko')).toContain('분')
    expect(formatRelativeTime(oneMinuteEarlier, 'en')).toContain('minute')
  })
})
