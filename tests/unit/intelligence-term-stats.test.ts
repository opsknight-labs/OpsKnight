import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

const {
  COMMON_TERM_FREQUENCY,
  MAX_FULLTEXT_TERMS,
  MAX_QUERY_TERMS,
  fullTextQueryText,
  inverseDocumentFrequency,
  planFullTextQuery,
  selectQueryTerms,
} = await import('@/lib/intelligence/similarity/term-stats');

describe('query term selection', () => {
  const frequencies = new Map([
    ['error', 0.9],
    ['service', 0.4],
    ['checkout', 0.03],
    ['postgres', 0.01],
  ]);

  it('drops very common words and puts the rarest first', () => {
    expect(
      selectQueryTerms(['error', 'checkout', 'service', 'postgres', 'replica'], frequencies)
    ).toEqual(['replica', 'postgres', 'checkout']);
  });

  it('keeps the rarest few when every word is common, so the search still runs', () => {
    expect(selectQueryTerms(['error', 'service'], frequencies)).toEqual(['service', 'error']);
  });

  it('keeps one contextual word when there is only one rare term', () => {
    expect(selectQueryTerms(['error', 'checkout', 'service'], frequencies)).toEqual([
      'checkout',
      'service',
    ]);
  });

  it('bounds the query and ignores duplicates', () => {
    const tokens = Array.from({ length: 20 }, (_, i) => `term${String.fromCharCode(97 + i)}`);
    expect(selectQueryTerms([...tokens, ...tokens], new Map())).toHaveLength(MAX_QUERY_TERMS);
  });

  it('searches up to three rare words with OR, so a candidate sharing any of them is found', () => {
    const plan = planFullTextQuery(
      ['error', 'checkout', 'service', 'postgres', 'replica', 'kafka'],
      frequencies
    );
    expect(plan).toEqual({
      terms: ['replica', 'kafka', 'postgres'],
      mode: 'any',
      distinctive: true,
    });
    expect(plan.terms).toHaveLength(MAX_FULLTEXT_TERMS);
    expect(fullTextQueryText(plan)).toBe('replica or kafka or postgres');
  });

  it('requires a lone rare word together with its next-rarest context word', () => {
    const plan = planFullTextQuery(['error', 'checkout', 'service'], frequencies);
    expect(plan).toEqual({ terms: ['checkout', 'service'], mode: 'all', distinctive: true });
    expect(fullTextQueryText(plan)).toBe('checkout service');
  });

  it('flags a title made only of common words so the text search can yield to trigram matching', () => {
    const plan = planFullTextQuery(['error', 'service'], frequencies);
    expect(plan).toEqual({ terms: ['service', 'error'], mode: 'all', distinctive: false });
    expect(planFullTextQuery([], frequencies)).toEqual({
      terms: [],
      mode: 'all',
      distinctive: false,
    });
  });

  it('weights rare words above common ones', () => {
    expect(inverseDocumentFrequency('postgres', frequencies)).toBeGreaterThan(
      inverseDocumentFrequency('error', frequencies)
    );
    expect(inverseDocumentFrequency('unknown', frequencies)).toBeGreaterThan(
      inverseDocumentFrequency('postgres', frequencies)
    );
    expect(COMMON_TERM_FREQUENCY).toBeLessThan(0.1);
  });
});
