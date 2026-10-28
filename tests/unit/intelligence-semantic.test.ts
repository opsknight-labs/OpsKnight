import { describe, expect, it } from 'vitest';
import { dot, normalizeVector } from '@/lib/intelligence/semantic/vector';
import { scoreSimilarity, semanticContent, SEMANTIC_FLOOR } from '@/lib/intelligence/similarity/scoring';
import { describeReasons } from '@/lib/intelligence/similarity/view';

const fingerprint = (template: string, overrides: Partial<Parameters<typeof scoreSimilarity>[0]> = {}) => ({
  template,
  tokens: template.toLowerCase().match(/[a-z]{2,32}/g) ?? [],
  labels: {},
  serviceId: 's1',
  incidentCreatedAt: new Date('2026-01-01T00:00:00Z'),
  resolvedAt: null,
  ...overrides,
});
const now = new Date('2026-01-02T00:00:00Z');

describe('vector helpers', () => {
  it('normalises to unit length and rejects unusable vectors', () => {
    const unit = normalizeVector([3, 4, 0, 0, 0, 0, 0, 0])!;
    expect(dot(unit, unit)).toBeCloseTo(1, 10);
    expect(unit[0]).toBeCloseTo(0.6);
    expect(normalizeVector([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(normalizeVector([1, 2])).toBeNull();
    expect(normalizeVector([1, Number.NaN, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(normalizeVector(new Array(5000).fill(1))).toBeNull();
  });

  it('never matches vectors of different shapes', () => {
    expect(dot([1, 0], [1, 0, 0])).toBe(0);
    expect(dot([], [])).toBe(0);
  });
});

describe('semantic similarity component', () => {
  it('ignores weak cosine and rescales strong cosine', () => {
    expect(semanticContent(undefined)).toBe(0);
    expect(semanticContent(SEMANTIC_FLOOR)).toBe(0);
    expect(semanticContent(0.4)).toBe(0);
    expect(semanticContent(1)).toBe(1);
    expect(semanticContent(0.85)).toBeCloseTo(0.5);
    expect(semanticContent(Number.NaN)).toBe(0);
  });

  it('lets meaning create a match that wording alone misses, but never lowers a lexical match', () => {
    const query = fingerprint('checkout payments failing', { serviceId: 'a' });
    const paraphrase = fingerprint('purchase transactions declined', { serviceId: 'b' });
    expect(scoreSimilarity(query, paraphrase, now).score).toBe(0);
    const withMeaning = scoreSimilarity(query, paraphrase, now, 0.97);
    expect(withMeaning.score).toBeGreaterThan(0.4);
    expect(withMeaning.components.semantic).toBe(0.97);

    const duplicate = fingerprint('checkout payments failing', { serviceId: 'a' });
    const lexical = scoreSimilarity(query, duplicate, now).score;
    expect(scoreSimilarity(query, duplicate, now, 0.1).score).toBe(lexical);
  });

  it('omits the component when there is no semantic signal, so stored evidence keeps its old shape', () => {
    const result = scoreSimilarity(fingerprint('a b c'), fingerprint('a b c'), now);
    expect('semantic' in result.components).toBe(false);
  });

  it('explains a meaning-only match as "Similar meaning"', () => {
    const base = { tokens: 0, template: 0.1, labels: 0, sameService: 0, recency: 1, resolved: 0 };
    expect(describeReasons({ ...base, semantic: 0.95 })[0]).toBe('Similar meaning');
    expect(describeReasons({ ...base, template: 0.9, semantic: 0.95 })[0]).toBe('Very similar wording');
    expect(describeReasons(base)[0]).toBe('Similar wording');
  });
});
