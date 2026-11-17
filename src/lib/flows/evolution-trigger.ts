/** Entry eligibility for a new Evolution Flow run. Existing runs resume separately. */
export function matchesEvolutionFlowTrigger(
  triggerType: string,
  triggerConfig: unknown,
  text: string,
  isFirstInbound: boolean
): boolean {
  if (triggerType === 'first_inbound_message') return isFirstInbound;
  if (triggerType !== 'keyword' || !text || !isRecord(triggerConfig))
    return false;

  const {
    keywords,
    match_type: matchType,
    case_sensitive: caseSensitive,
  } = triggerConfig;
  if (!Array.isArray(keywords)) return false;
  if (
    matchType !== undefined &&
    matchType !== 'exact' &&
    matchType !== 'contains'
  )
    return false;
  if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean')
    return false;
  const haystack = caseSensitive ? text : text.toLowerCase();
  return keywords.some((raw) => {
    if (typeof raw !== 'string' || !raw) return false;
    const needle = caseSensitive ? raw : raw.toLowerCase();
    return matchType === 'exact'
      ? haystack === needle
      : haystack.includes(needle);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
