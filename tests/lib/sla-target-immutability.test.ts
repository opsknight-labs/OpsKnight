import { describe, expect, it } from 'vitest';
import { resolveFrozenSlaTarget, resolveLegacySlaTarget } from '@/lib/metrics/domain/sla-target';

describe('immutable incident SLA targets', () => {
  it('prefers the incident target over later definition, priority, and service changes', () => {
    expect(
      resolveLegacySlaTarget({
        incidentTargets: { ackTargetMs: 600_000, resolveTargetMs: 5_400_000 },
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
});
