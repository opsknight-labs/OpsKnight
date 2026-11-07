import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATIONAL_METRICS } from '@/lib/metrics/operational/registry';
const mocks = vi.hoisted(() => ({
  budget: vi.fn(),
  settings: vi.fn(),
  index: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/intelligence/jobs/db-budget', () => ({ withDbBudget: mocks.budget }));
vi.mock('@/lib/intelligence/ai/settings', () => ({ getAiSettings: mocks.settings }));
vi.mock('@/lib/intelligence/semantic/embedder', () => ({ getSemanticBacklogStatus: mocks.index }));
vi.mock('@/lib/logger', () => ({ logger: { debug: mocks.debug } }));
import { collectFeatureMetrics } from '@/lib/intelligence/feature-metrics';

const rows = () => [
  [{ used: 50, held: BigInt(100) }],
  [{ failed: BigInt(2), oldest: 4000, sampled: BigInt(2) }],
  [
    {
      confirmed: BigInt(6),
      succeeded: BigInt(1),
      failed: BigInt(1),
      uncertain: BigInt(3),
      sampled: BigInt(6),
    },
  ],
  [{ accepted: BigInt(1), reviewed: BigInt(4), sampled: BigInt(4) }],
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({
    dailyTokenBudget: 1000,
    backgroundEmbeddingBudgetPercent: 20,
  });
  mocks.index.mockResolvedValue({ model: 'configured-space', pending: 12 });
});

describe('bounded feature telemetry', () => {
  it('registers every sample as a label-free cluster gauge and budgets every SQL probe', async () => {
    for (const row of rows()) mocks.budget.mockResolvedValueOnce(row);
    const samples = await collectFeatureMetrics(new Date('2026-11-05T12:00:00Z'));
    expect(samples).toHaveLength(15);
    expect(new Set(samples.map(sample => sample.name)).size).toBe(15);
    for (const sample of samples) {
      expect(Number.isFinite(sample.value)).toBe(true);
      expect(sample.value).toBeGreaterThanOrEqual(0);
      expect(OPERATIONAL_METRICS.find(definition => definition.name === sample.name)).toMatchObject(
        { kind: 'gauge', scope: 'cluster_snapshot', labels: [], estimatedMaxSeries: 1 }
      );
    }
    expect(mocks.budget).toHaveBeenCalledTimes(4);
    for (const call of mocks.budget.mock.calls) expect(call[0]).toEqual({ maxDbMs: 750 });
  });
  it.each([
    [0, 'opsknight_intelligence_embedding_'],
    [1, 'opsknight_intelligence_digest_'],
    [2, 'opsknight_intelligence_squire_actions_'],
    [3, 'opsknight_intelligence_suggestions_'],
  ])(
    'omits an unavailable probe %i without dropping other feature samples or retaining exception text',
    async (failed, prefix) => {
      rows().forEach((row, index) => {
        if (index === failed)
          mocks.budget.mockRejectedValueOnce(new Error('private-provider-canary'));
        else mocks.budget.mockResolvedValueOnce(row);
      });
      const samples = await collectFeatureMetrics();
      expect(samples.filter(sample => sample.name.startsWith(prefix))).toEqual([]);
      expect(
        samples.find(sample => sample.name === 'opsknight_intelligence_feature_probe_failed')?.value
      ).toBe(1);
      expect(samples.length).toBeGreaterThan(1);
      expect(JSON.stringify(mocks.debug.mock.calls)).not.toContain('private-provider-canary');
    }
  );
  it('never reports negative remaining quota after actual usage exceeds its estimate', async () => {
    mocks.budget.mockResolvedValueOnce([{ used: 300, held: BigInt(10) }]);
    for (const row of rows().slice(1)) mocks.budget.mockResolvedValueOnce(row);
    const samples = await collectFeatureMetrics();
    expect(
      samples.find(
        sample => sample.name === 'opsknight_intelligence_embedding_budget_remaining_tokens'
      )?.value
    ).toBe(0);
  });
  it('reports sampled acceptance and omits an unknown ratio when there are no reviews', async () => {
    for (const row of rows()) mocks.budget.mockResolvedValueOnce(row);
    expect(
      (await collectFeatureMetrics()).find(
        s => s.name === 'opsknight_intelligence_suggestion_acceptance_ratio_last_24h'
      )?.value
    ).toBe(0.25);
    for (const row of rows().slice(0, 3)) mocks.budget.mockResolvedValueOnce(row);
    mocks.budget.mockResolvedValueOnce([
      { accepted: BigInt(0), reviewed: BigInt(0), sampled: BigInt(0) },
    ]);
    const empty = await collectFeatureMetrics();
    expect(
      empty.find(s => s.name === 'opsknight_intelligence_suggestion_acceptance_ratio_last_24h')
    ).toBeUndefined();
    expect(
      empty.find(s => s.name === 'opsknight_intelligence_suggestions_reviewed_last_24h')?.value
    ).toBe(0);
  });
});
