// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MIN_CONTENT_SIMILARITY,
  RECENCY_HALF_LIFE_DAYS,
  SIMILARITY_WEIGHTS,
  recencyFactor,
  scoreSimilarity,
  trigramSimilarity,
  type SimilarityFingerprint,
} from '@/lib/intelligence/similarity/scoring';

const now = new Date('2026-10-27T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const base: SimilarityFingerprint = {
  template: 'database connection errors on db-primary-<num>',
  tokens: ['connection', 'database', 'db', 'errors', 'primary'],
  labels: { env: 'prod', region: 'eu-west-1' },
  serviceId: 'svc-a',
  incidentCreatedAt: daysAgo(0),
  resolvedAt: null,
};

describe('trigramSimilarity', () => {
  it('is 1 for identical text, 0 for disjoint text, and symmetric', () => {
    expect(trigramSimilarity('connection reset', 'connection reset')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
    expect(trigramSimilarity('database error', 'error database')).toBe(
      trigramSimilarity('error database', 'database error')
    );
  });

  it('ranks near matches above unrelated text', () => {
    const near = trigramSimilarity('database connection errors', 'database connection error');
    const far = trigramSimilarity('database connection errors', 'disk space low');
    expect(near).toBeGreaterThan(0.6);
    expect(far).toBeLessThan(0.2);
  });
});

describe('recencyFactor', () => {
  it('halves every half-life and never exceeds 1', () => {
    expect(recencyFactor(now, now)).toBe(1);
    expect(recencyFactor(daysAgo(RECENCY_HALF_LIFE_DAYS), now)).toBeCloseTo(0.5, 5);
    expect(recencyFactor(daysAgo(2 * RECENCY_HALF_LIFE_DAYS), now)).toBeCloseTo(0.25, 5);
    expect(recencyFactor(new Date(now.getTime() + 86_400_000), now)).toBe(1);
  });
});

describe('scoreSimilarity', () => {
  it('scores a near-duplicate from the same service highly', () => {
    const candidate: SimilarityFingerprint = {
      ...base,
      template: 'database connection errors on db-primary-<num>',
      incidentCreatedAt: daysAgo(2),
      resolvedAt: daysAgo(1),
    };
    const result = scoreSimilarity(base, candidate, now);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.components).toMatchObject({
      tokens: 1,
      template: 1,
      labels: 1,
      sameService: 1,
      resolved: 1,
    });
    expect(result.matchedTokenCount).toBe(5);
  });

  it('never manufactures a match from service, recency or outcome alone', () => {
    const unrelated: SimilarityFingerprint = {
      ...base,
      template: 'zzz',
      tokens: ['zzz'],
      labels: base.labels,
      resolvedAt: daysAgo(0),
    };
    const result = scoreSimilarity(base, unrelated, now);
    expect(result.components.tokens).toBe(0);
    expect(result.components.template).toBe(0);
    expect(result.score).toBe(0);
  });

  it('prefers the same service and a known outcome when content is equal', () => {
    const otherService = scoreSimilarity(base, { ...base, serviceId: 'svc-b' }, now).score;
    const sameService = scoreSimilarity(base, base, now).score;
    const resolved = scoreSimilarity(base, { ...base, resolvedAt: now }, now).score;
    expect(sameService).toBeGreaterThan(otherService);
    expect(resolved).toBeGreaterThan(sameService);
  });

  it('prefers newer incidents when everything else is equal', () => {
    const fresh = scoreSimilarity(base, { ...base, incidentCreatedAt: daysAgo(1) }, now).score;
    const old = scoreSimilarity(base, { ...base, incidentCreatedAt: daysAgo(300) }, now).score;
    expect(fresh).toBeGreaterThan(old);
  });

  it('lets a perfect duplicate reach 1 even when neither incident has labels', () => {
    const noLabels: SimilarityFingerprint = { ...base, labels: {}, resolvedAt: now };
    expect(scoreSimilarity(noLabels, noLabels, now).score).toBeGreaterThan(0.99);
    // Label-less and labelled sources therefore score on the same scale.
    const labelled = { ...base, resolvedAt: now };
    expect(
      Math.abs(
        scoreSimilarity(labelled, labelled, now).score -
          scoreSimilarity(noLabels, noLabels, now).score
      )
    ).toBeLessThan(0.01);
  });

  it('counts a label mismatch against an incident when only one side has labels', () => {
    const withLabels = scoreSimilarity(base, { ...base, labels: { env: 'staging' } }, now).score;
    const identical = scoreSimilarity(base, base, now).score;
    expect(withLabels).toBeLessThan(identical);
  });

  it('treats boilerplate-only overlap as no match, even in the same service', () => {
    const disk: SimilarityFingerprint = {
      ...base,
      template: 'disk space low on node-<num>',
      tokens: ['disk', 'low', 'node', 'space'],
    };
    const result = scoreSimilarity(base, disk, now);
    expect(Math.max(result.components.tokens, result.components.template)).toBeLessThan(
      MIN_CONTENT_SIMILARITY
    );
    expect(result.score).toBe(0);
  });

  it('keeps scores within [0, 1] and weights summing to 1', () => {
    expect(Object.values(SIMILARITY_WEIGHTS).reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 10);
    const best = scoreSimilarity(base, { ...base, resolvedAt: now }, now);
    expect(best.score).toBeLessThanOrEqual(1);
    expect(best.score).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic and handles empty fingerprints', () => {
    const empty: SimilarityFingerprint = { ...base, template: '', tokens: [], labels: {} };
    expect(scoreSimilarity(empty, empty, now)).toEqual(scoreSimilarity(empty, empty, now));
    expect(scoreSimilarity(empty, empty, now).score).toBe(0);
  });

  it('exposes only numeric components, never candidate text', () => {
    const result = scoreSimilarity(base, { ...base, template: 'secret customer name acme' }, now);
    expect(JSON.stringify(result)).not.toContain('acme');
    expect(Object.values(result.components).every(value => typeof value === 'number')).toBe(true);
  });
});

describe('rare words', () => {
  it('count for more than common ones when word frequencies are known', () => {
    const query = {
      ...base,
      template: 'error postgres replica lag',
      tokens: ['error', 'postgres', 'replica', 'lag'],
    };
    const sharesRare = {
      ...base,
      template: 'postgres replica down',
      tokens: ['postgres', 'replica', 'down'],
    };
    const sharesCommon = {
      ...base,
      template: 'error high service',
      tokens: ['error', 'high', 'service'],
    };
    const idf = (token: string) => (['error', 'high', 'service'].includes(token) ? 0.2 : 4);
    const rare = scoreSimilarity(query, sharesRare, now, undefined, idf).components.tokens;
    const common = scoreSimilarity(query, sharesCommon, now, undefined, idf).components.tokens;
    expect(rare).toBeGreaterThan(0.45);
    expect(common).toBeLessThan(0.05);
    // Without frequencies every word weighs the same: plain Jaccard.
    expect(scoreSimilarity(query, sharesRare, now).components.tokens).toBeCloseTo(2 / 5, 3);
  });
});
