import { describe, expect, it } from 'vitest';
import { matchesEvolutionFlowTrigger } from './evolution-trigger';

describe('Evolution Flow entry trigger', () => {
  it('matches configured keywords with the legacy case and match rules', () => {
    expect(
      matchesEvolutionFlowTrigger(
        'keyword',
        { keywords: ['ajuda'] },
        'Preciso de AJUDA',
        false
      )
    ).toBe(true);
    expect(
      matchesEvolutionFlowTrigger(
        'keyword',
        { keywords: ['ajuda'], match_type: 'exact' },
        'Preciso de ajuda',
        false
      )
    ).toBe(false);
    expect(
      matchesEvolutionFlowTrigger(
        'keyword',
        { keywords: ['Ajuda'], case_sensitive: true },
        'ajuda',
        false
      )
    ).toBe(false);
  });

  it('only starts a first-inbound trigger for the first inbound message', () => {
    expect(
      matchesEvolutionFlowTrigger('first_inbound_message', {}, 'oi', true)
    ).toBe(true);
    expect(
      matchesEvolutionFlowTrigger('first_inbound_message', {}, 'oi', false)
    ).toBe(false);
  });

  it('does not start manual or malformed triggers', () => {
    expect(matchesEvolutionFlowTrigger('manual', {}, 'oi', true)).toBe(false);
    expect(
      matchesEvolutionFlowTrigger('keyword', { keywords: [] }, 'oi', true)
    ).toBe(false);
    expect(
      matchesEvolutionFlowTrigger(
        'keyword',
        { keywords: ['oi'], match_type: 'other' },
        'oi',
        true
      )
    ).toBe(false);
  });
});
