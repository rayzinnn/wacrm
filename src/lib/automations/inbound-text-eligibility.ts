import type { AutomationTriggerType } from '@/types'

export interface InboundTextEligibilityInput {
  trigger_type: AutomationTriggerType
  trigger_config?: unknown
  text: string
  isFirstInbound?: boolean
}

const WORD_CHAR = '[\\p{L}\\p{N}_]'

function matchesWholeWord(text: string, keyword: string, caseSensitive = false): boolean {
  if (!keyword) return false

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu',
  )
  return pattern.test(text)
}

function isKeywordMatch(triggerConfig: unknown, text: string): boolean {
  if (typeof triggerConfig !== 'object' || triggerConfig === null) return false
  const config = triggerConfig as {
    keywords?: unknown
    match_type?: unknown
    case_sensitive?: unknown
  }
  if (!Array.isArray(config.keywords) || config.keywords.length === 0 || !text) return false

  const keywords = config.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
  if (keywords.length === 0) return false

  const caseSensitive = config.case_sensitive === true
  if (config.match_type === 'word') {
    return keywords.some((keyword) => matchesWholeWord(text, keyword, caseSensitive))
  }

  const haystack = caseSensitive ? text : text.toLowerCase()
  return keywords.some((raw) => {
    const keyword = caseSensitive ? raw : raw.toLowerCase()
    return config.match_type === 'exact' ? haystack === keyword : haystack.includes(keyword)
  })
}

/** Evaluates only the inbound-text trigger families supported by T12. */
export function isEligibleInboundTextAutomation(
  input: InboundTextEligibilityInput,
): boolean {
  switch (input.trigger_type) {
    case 'new_message_received':
      return true
    case 'first_inbound_message':
      return input.isFirstInbound === true
    case 'keyword_match':
      return isKeywordMatch(input.trigger_config, input.text)
    default:
      return false
  }
}
