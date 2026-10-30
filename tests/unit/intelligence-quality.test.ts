import { describe, expect, it } from 'vitest';
import { topologyScope } from '@/lib/intelligence/dependencies/graph';
import { detectSeasonalAnomaly, detectFlapping } from '@/lib/intelligence/insights/anomaly';
import { combinedContent } from '@/lib/intelligence/similarity/scoring';
import { fitScoringWeights } from '@/lib/intelligence/learning/weights';

describe('topology scope', () => {
  const edges = [
    { upstreamServiceId: 'db', downstreamServiceId: 'api' },
    { upstreamServiceId: 'api', downstreamServiceId: 'web' },
  ];
  it('has the same bounded identity regardless of processing order', () => {
    expect(topologyScope(edges, 'db')).toEqual(['api', 'db', 'web']);
    expect(topologyScope([...edges].reverse(), 'web')).toEqual(['api', 'db', 'web']);
    expect(topologyScope(edges, 'isolated')).toBeNull();
  });
  it('handles cycles and refuses oversized scopes', () => {
    expect(
      topologyScope([...edges, { upstreamServiceId: 'web', downstreamServiceId: 'db' }], 'api')
    ).toHaveLength(3);
    expect(topologyScope(edges, 'db', 2)).toBeNull();
  });
});

describe('weighted content', () => {
  it('requires agreement across lexical signals and ignores weak embeddings', () => {
    expect(combinedContent({ tokens: 1, template: 0 })).toBeCloseTo(0.65);
    expect(combinedContent({ tokens: 0, template: 1 })).toBeCloseTo(0.35);
    expect(combinedContent({ tokens: 1, template: 1, semantic: 0.5 })).toBe(1);
    expect(combinedContent({ tokens: 0, template: 0, semantic: 1 })).toBeGreaterThan(0.25);
  });
});

describe('seasonality and flapping', () => {
  it('does not flag a regular Monday spike but flags a larger one', () => {
    expect(detectSeasonalAnomaly(20, [18, 20, 19, 21, 20, 22, 19, 20])).toBeNull();
    expect(detectSeasonalAnomaly(50, [18, 20, 19, 21, 20, 22, 19, 20])).not.toBeNull();
  });
  it('fails closed without a seasonal baseline and tolerates zero variance', () => {
    expect(detectSeasonalAnomaly(100, [0, 0])).toBeNull();
    expect(detectSeasonalAnomaly(10, [0, 0, 0, 0])).not.toBeNull();
    expect(detectSeasonalAnomaly(3, [0, 0, 0, 0])).toBeNull();
  });
  it('requires actual short-lived reopenings of one dedup key', () => {
    const at = new Date('2026-10-26T00:00:00Z');
    const episodes = Array.from({ length: 5 }, (_, i) => ({
      createdAt: new Date(+at + i * 5 * 60_000),
      resolvedAt: new Date(+at + (i * 5 + 1) * 60_000),
    }));
    expect(detectFlapping(episodes)).toMatchObject({ episodes: 5 });
    expect(detectFlapping(episodes.slice(0, 2))).toBeNull();
    expect(detectFlapping(episodes.map(e => ({ ...e, resolvedAt: null })))).toBeNull();
  });
});

describe('offline scoring proposals', () => {
  it('does not invent a policy from too little or one-sided feedback', () => {
    expect(fitScoringWeights([])).toBeNull();
    expect(
      fitScoringWeights(
        Array.from({ length: 100 }, () => ({
          content: 1,
          labels: 1,
          sameService: 1,
          recency: 1,
          resolved: 1,
          helpful: true,
        }))
      )
    ).toBeNull();
  });
  it('learns a bounded, deterministic proposal from labelled numeric evidence', () => {
    const data = Array.from({ length: 200 }, (_, i) => ({
      content: i % 2 ? 0.9 : 0.3,
      labels: i % 2 ? 1 : 0,
      sameService: 1,
      recency: 1,
      resolved: 1,
      helpful: i % 2 === 1,
    }));
    const result = fitScoringWeights(data);
    expect(result).not.toBeNull();
    expect(result).toEqual(fitScoringWeights(data));
    expect(Object.values(result!.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(result!.weights.content).toBeGreaterThanOrEqual(0.4);
    expect(result!.heldOutLoss).toBeLessThan(result!.baselineLoss);
  });
});
