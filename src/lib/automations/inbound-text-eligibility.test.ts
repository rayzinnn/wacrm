import { describe, expect, it } from 'vitest'
import { isEligibleInboundTextAutomation } from './inbound-text-eligibility'

describe('isEligibleInboundTextAutomation', () => {
  it('accepts new inbound messages', () => {
    expect(isEligibleInboundTextAutomation({ trigger_type: 'new_message_received', text: '' })).toBe(
      true,
    )
  })

  it('accepts first inbound only when explicitly flagged', () => {
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'first_inbound_message',
        text: 'hello',
        isFirstInbound: true,
      }),
    ).toBe(true)
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'first_inbound_message',
        text: 'hello',
        isFirstInbound: false,
      }),
    ).toBe(false)
    expect(
      isEligibleInboundTextAutomation({ trigger_type: 'first_inbound_message', text: 'hello' }),
    ).toBe(false)
  })

  it.each([
    'new_contact_created',
    'conversation_assigned',
    'tag_added',
    'time_based',
    'interactive_reply',
  ] as const)('rejects the %s trigger in this recut', (trigger_type) => {
    expect(isEligibleInboundTextAutomation({ trigger_type, text: 'hello' })).toBe(false)
  })

  it('matches exact and contains with legacy case handling', () => {
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['HELLO'], match_type: 'exact' },
        text: 'hello',
      }),
    ).toBe(true)
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['hello'], match_type: 'exact' },
        text: 'hello there',
      }),
    ).toBe(false)
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['CAT'], match_type: 'contains' },
        text: 'category',
      }),
    ).toBe(true)
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['HELLO'], match_type: 'contains', case_sensitive: true },
        text: 'hello',
      }),
    ).toBe(false)
  })

  it('defaults keyword matching to contains and preserves Unicode lowercasing', () => {
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['café'] },
        text: 'CAFÉ da manhã',
      }),
    ).toBe(true)
  })

  it('matches word boundaries using escaped Unicode-aware legacy semantics', () => {
    const matchesWord = (keyword: string, text: string, case_sensitive = false) =>
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: [keyword], match_type: 'word', case_sensitive },
        text,
      })

    expect(matchesWord('hi!', 'say hi!')).toBe(true)
    expect(matchesWord('c++ (beginner)', 'I want c++ (beginner)')).toBe(true)
    expect(matchesWord('안녕', '저기 안녕 하세요')).toBe(true)
    expect(matchesWord('안녕', '안녕하세요')).toBe(false)
    expect(matchesWord('k', 'thanks')).toBe(false)
    expect(matchesWord('Hi', 'hi', true)).toBe(false)
  })

  it('rejects missing, empty, or malformed keyword configuration', () => {
    for (const trigger_config of [undefined, null, {}, { keywords: [] }, { keywords: [42] }]) {
      expect(
        isEligibleInboundTextAutomation({
          trigger_type: 'keyword_match',
          trigger_config,
          text: 'hello',
        }),
      ).toBe(false)
    }
    expect(
      isEligibleInboundTextAutomation({
        trigger_type: 'keyword_match',
        trigger_config: { keywords: ['hello'] },
        text: '',
      }),
    ).toBe(false)
  })
})
