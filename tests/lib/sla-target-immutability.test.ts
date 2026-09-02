import { describe, expect, it } from 'vitest';
import { resolveSlaTarget } from '@/lib/metrics/domain/sla-target';

describe('immutable incident SLA targets', () => {
  it('prefers the incident target over later definition, priority, and service changes', () => {
    expect(
      resolveSlaTarget({
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

  it('rejects an incomplete frozen contract and falls back to canonical resolution', () => {
    const target = resolveSlaTarget({
      incidentTargets: { ackTargetMs: 600_000, resolveTargetMs: null },
      priority: 'P2',
      serviceTargets: { ackMinutes: 99, resolveMinutes: 999 },
    });
    expect(target.source).toBe('priority');
    expect(target.ackTargetMs).toBe(15 * 60_000);
    expect(target.resolveTargetMs).toBe(240 * 60_000);
  });
});
