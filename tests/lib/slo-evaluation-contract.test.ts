import { beforeEach, expect, it, vi } from 'vitest';
import { METRIC_ACCUMULATOR } from '@/lib/metrics/domain/accumulator';
import { evaluateServiceObjective } from '@/lib/slo/evaluator';
const mocks = vi.hoisted(() => ({ sla: vi.fn(), uptime: vi.fn(), bounds: vi.fn() }));
vi.mock('@/lib/actor-metrics', () => ({
  calculateActorSLAMetrics: mocks.sla,
  calculateActorMultiServiceUptime: mocks.uptime,
}));
vi.mock('@/lib/retention-policy', () => ({ getQueryDateBounds: mocks.bounds }));
const actor = { id: 'reader', role: 'ADMIN' as const, status: 'ACTIVE' as const, teamIds: [] };
const start = new Date('2026-10-10T00:00:00Z'),
  end = new Date('2026-10-17T00:00:00Z');
const objective = {
  id: 'version',
  lineageId: 'lineage',
  serviceId: 'service',
  metricType: 'MTTA' as const,
  target: 30,
  comparator: 'LESS_THAN_OR_EQUAL' as const,
  windowType: 'SEVEN_DAYS' as const,
  windowValue: null,
  version: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.bounds.mockResolvedValue({ start, end, isClipped: false });
});
it('counts actual measurement samples and compares exact sums before display rounding', async () => {
  mocks.sla.mockResolvedValue({
    effectiveStart: start,
    effectiveEnd: end,
    isClipped: false,
    totalIncidents: 100,
    mttd: 30,
    [METRIC_ACCUMULATOR]: { mttaSumMs: BigInt(1800001), mttaCount: BigInt(1) },
  });
  const result = await evaluateServiceObjective({ actor, objective, start, end });
  expect(result).toMatchObject({
    sampleCount: 1,
    sampleCountExact: '1',
    elapsedSumMs: '1800001',
    compliant: false,
    dataState: 'AVAILABLE',
    coverage: { complete: true },
  });
  expect(result.value).toBeGreaterThan(30);
});
it('does not interpret retention-clipped uptime as full-window compliance', async () => {
  mocks.bounds.mockResolvedValue({ start: new Date('2026-10-12T00:00:00Z'), end, isClipped: true });
  const result = await evaluateServiceObjective({
    actor,
    objective: { ...objective, metricType: 'UPTIME' },
    start,
    end,
  });
  expect(result).toMatchObject({
    value: null,
    compliant: null,
    breached: null,
    dataState: 'UNAVAILABLE',
    coverage: { complete: false },
  });
  expect(mocks.uptime).not.toHaveBeenCalled();
});
it('does not invent a sample denominator when the metrics source lacks additive state', async () => {
  mocks.sla.mockResolvedValue({
    effectiveStart: start,
    effectiveEnd: end,
    isClipped: false,
    totalIncidents: 100,
    mttd: 20,
  });
  expect(await evaluateServiceObjective({ actor, objective, start, end })).toMatchObject({
    value: null,
    sampleCount: null,
    compliant: null,
    dataState: 'UNAVAILABLE',
  });
});
it('reports an empty measured cohort as no data and not compliance', async () => {
  mocks.sla.mockResolvedValue({
    effectiveStart: start,
    effectiveEnd: end,
    isClipped: false,
    totalIncidents: 100,
    [METRIC_ACCUMULATOR]: { mttaSumMs: BigInt(0), mttaCount: BigInt(0) },
  });
  expect(await evaluateServiceObjective({ actor, objective, start, end })).toMatchObject({
    value: null,
    sampleCount: 0,
    sampleCountExact: '0',
    compliant: null,
    dataState: 'NO_DATA',
  });
});
it('leaves unsupported legacy telemetry unavailable instead of inferring it from incidents', async () => {
  expect(
    await evaluateServiceObjective({
      actor,
      objective: { ...objective, metricType: 'ERROR_RATE' },
      start,
      end,
    })
  ).toMatchObject({ value: null, compliant: null, dataState: 'UNAVAILABLE' });
  expect(mocks.sla).not.toHaveBeenCalled();
});
it('rejects invalid periods and unauthorized aggregate credentials before analytics', async () => {
  await expect(
    evaluateServiceObjective({ actor, objective, start: end, end: start })
  ).rejects.toThrow();
  await expect(
    evaluateServiceObjective({
      actor: { ...actor, apiKey: { id: 'key', scopes: ['incidents:read'] } },
      objective,
      start,
      end,
    })
  ).rejects.toThrow();
  expect(mocks.sla).not.toHaveBeenCalled();
});
