import { describe, expect, it } from 'vitest';
import { resolveFrozenSlaTarget, resolveLegacySlaTarget } from '@/lib/metrics/domain/sla-target';

describe('immutable incident SLA targets', () => {
  it('prefers the incident target over later definition, priority, and service changes', () => {
    expect(
      resolveLegacySlaTarget({
        incidentTargets: {
          ackTargetMs: 600_000,
          resolveTargetMs: 5_400_000,
          source: 'POLICY',
          capturedAt: new Date('2026-01-01T00:00:00Z'),
        },
        definitionOverride: { ackMinutes: 1, resolveMinutes: 2 },
        priority: 'P1',
        serviceTargets: { ackMinutes: 3, resolveMinutes: 4 },
      })
    ).toEqual({
      ackTargetMs: 600_000,
      resolveTargetMs: 5_400_000,
      source: 'incident',
    });
  });

  it('treats an incomplete frozen contract as unknown for canonical analytics', () => {
    expect(resolveFrozenSlaTarget({ ackTargetMs: 600_000, resolveTargetMs: null })).toBeNull();
    expect(resolveFrozenSlaTarget({ ackTargetMs: 0, resolveTargetMs: 1 })).toBeNull();
  });

  it('requires captured provenance even when both target values are valid', () => {
    const targets = { ackTargetMs: 600_000, resolveTargetMs: 5_400_000 };
    expect(resolveFrozenSlaTarget({ ...targets, capturedAt: new Date(), source: null })).toBeNull();
    expect(resolveFrozenSlaTarget({ ...targets, source: 'POLICY', capturedAt: null })).toBeNull();
  });
});
