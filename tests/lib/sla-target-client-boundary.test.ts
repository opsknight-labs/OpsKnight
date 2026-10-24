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

it('projects browser SLA clocks without loading database policy resolvers', async () => {
  const { projectIncidentSlaState } = await import('@/lib/incident-sla/state');
  const now = new Date('2026-10-24T00:00:00Z');
  const state = projectIncidentSlaState(
    {
      status: 'OPEN',
      createdAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      slaAckTargetMs: 1000,
      slaResolveTargetMs: 2000,
      slaTargetSource: 'WORKSPACE_DEFAULT',
      slaTargetCapturedAt: now,
      slaPausedMs: BigInt(0),
      slaPauseStartedAt: null,
      slaAckElapsedMs: null,
      slaResolveElapsedMs: null,
    },
    { now }
  );
  expect(state.valid).toBe(true);
  if (!state.valid) throw new Error(state.reason);
  expect(state.ack.targetMs).toBe(1000);
});
