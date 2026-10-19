import { describe, expect, it } from 'vitest';
import { objectiveIsCompliant, objectiveWindowDays } from '@/lib/slo/evaluator';
import { serviceObjectiveCreateSchema } from '@/lib/slo/schemas';

describe('service objective evaluator semantics', () => {
  it('uses explicit comparison direction and treats equality as compliant', () => {
    expect(objectiveIsCompliant(99.9, 99.9, 'GREATER_THAN_OR_EQUAL')).toBe(true);
    expect(objectiveIsCompliant(99.8, 99.9, 'GREATER_THAN_OR_EQUAL')).toBe(false);
    expect(objectiveIsCompliant(30, 30, 'LESS_THAN_OR_EQUAL')).toBe(true);
    expect(objectiveIsCompliant(31, 30, 'LESS_THAN_OR_EQUAL')).toBe(false);
    expect(objectiveIsCompliant(null, 30, 'LESS_THAN_OR_EQUAL')).toBeNull();
  });

  it('maps named and rolling windows deterministically', () => {
    expect(objectiveWindowDays('SEVEN_DAYS', null)).toBe(7);
    expect(objectiveWindowDays('QUARTERLY', null)).toBe(90);
    expect(objectiveWindowDays('ROLLING_DAYS', 42)).toBe(42);
  });

  it('rejects unsupported telemetry metrics and invalid cross-field combinations', () => {
    const base = {
      serviceId: 'service-1',
      name: 'Availability',
      metricType: 'AVAILABILITY' as const,
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL' as const,
      windowType: 'THIRTY_DAYS' as const,
    };
    expect(serviceObjectiveCreateSchema.safeParse({ ...base, target: 101 }).success).toBe(false);
    expect(
      serviceObjectiveCreateSchema.safeParse({
        ...base,
        windowType: 'ROLLING_DAYS',
        windowValue: null,
      }).success
    ).toBe(false);
    expect(
      serviceObjectiveCreateSchema.safeParse({ ...base, metricType: 'LATENCY_P99' }).success
    ).toBe(false);
    expect(
      serviceObjectiveCreateSchema.safeParse({ ...base, serviceId: null, metricType: 'UPTIME' })
        .success
    ).toBe(false);
    expect(
      serviceObjectiveCreateSchema.safeParse({
        ...base,
        serviceId: null,
        metricType: 'MTTR',
        target: 30,
        comparator: 'LESS_THAN_OR_EQUAL',
      }).success
    ).toBe(true);
  });
});

it('compares exact elapsed-time ratios before UI rounding or unsafe integer conversion', async () => {
  const { objectiveElapsedIsCompliant: compare } = await import('@/lib/slo/evaluator');
  expect(compare(BigInt(1800001), BigInt(1), 30, 'LESS_THAN_OR_EQUAL')).toBe(false);
  expect(compare(BigInt(1800000), BigInt(1), 30, 'LESS_THAN_OR_EQUAL')).toBe(true);
  expect(compare(BigInt(1), BigInt(3), 0.000005555555555555555, 'LESS_THAN_OR_EQUAL')).toBe(false);
  expect(compare(BigInt(0), BigInt(0), 30, 'LESS_THAN_OR_EQUAL')).toBeNull();
  const count = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
  expect(compare(count * BigInt(60000) + BigInt(1), count, 1, 'LESS_THAN_OR_EQUAL')).toBe(false);
  expect(compare(BigInt(0), BigInt(1), 5e-324, 'LESS_THAN_OR_EQUAL')).toBe(true);
});
