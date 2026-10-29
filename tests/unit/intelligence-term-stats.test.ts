import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

const { COMMON_TERM_FREQUENCY, MAX_QUERY_TERMS, inverseDocumentFrequency, selectQueryTerms } =
  await import('@/lib/intelligence/similarity/term-stats');

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

  it('bounds the query and ignores duplicates', () => {
    const tokens = Array.from({ length: 20 }, (_, i) => `term${String.fromCharCode(97 + i)}`);
    expect(selectQueryTerms([...tokens, ...tokens], new Map())).toHaveLength(MAX_QUERY_TERMS);
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
