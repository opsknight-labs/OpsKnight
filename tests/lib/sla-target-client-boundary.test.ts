import { expect, it, vi } from 'vitest';

vi.mock('@prisma/client', () => {
  throw new Error('Prisma runtime is unavailable in browser components');
});

it('loads SLA metrics helpers without database runtime and validates frozen targets', async () => {
  const { resolveFrozenSlaTarget, resolveLegacySlaTarget } =
    await import('@/lib/metrics/domain/sla-target');
  const capturedAt = new Date('2026-10-24T00:00:00Z');
  expect(
    resolveFrozenSlaTarget({
      ackTargetMs: 1000,
      resolveTargetMs: 2000,
      source: 'WORKSPACE_DEFAULT',
      capturedAt,
    })
  ).toEqual({ ackTargetMs: 1000, resolveTargetMs: 2000, source: 'incident' });
  expect(
    resolveFrozenSlaTarget({ ackTargetMs: 1000, resolveTargetMs: 2000, source: '', capturedAt })
  ).toBeNull();
  expect(resolveLegacySlaTarget({ priority: 'P1' }).source).toBe('priority');
});
