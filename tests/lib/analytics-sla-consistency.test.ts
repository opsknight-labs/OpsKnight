import { describe, expect, it } from 'vitest';
import { buildServiceSlaTable } from '@/lib/analytics-metrics';

describe('service SLA table canonical semantics', () => {
  it('uses frozen targets and the pause-aware SLA clock', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const table = buildServiceSlaTable(
      [
        {
          id: 'i1',
          serviceId: 's1',
          status: 'ACKNOWLEDGED',
          createdAt,
          resolvedAt: null,
          updatedAt: null,
          slaAckTargetMs: 15 * 60_000,
          slaResolveTargetMs: 120 * 60_000,
          slaPauses: [
            {
              startedAt: new Date('2026-01-01T00:05:00Z'),
              endedAt: new Date('2026-01-01T00:15:00Z'),
            },
          ],
        },
      ],
      new Map([['i1', new Date('2026-01-01T00:20:00Z')]]),
      new Map([['s1', { ackMinutes: 1, resolveMinutes: 1 }]]),
      new Map([['s1', 'Service One']]),
      15,
      120,
      8,
      new Date('2026-01-01T00:20:00Z')
    );

    expect(table[0].ackRate).toBe(100);
  });

  it('counts resolved-without-ACK and overdue active resolve as breaches', () => {
    const table = buildServiceSlaTable(
      [
        {
          id: 'resolved-no-ack',
          serviceId: 's1',
          status: 'RESOLVED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: new Date('2026-01-01T00:05:00Z'),
          updatedAt: new Date('2026-01-01T00:05:00Z'),
          slaAckTargetMs: 10 * 60_000,
          slaResolveTargetMs: 60 * 60_000,
        },
        {
          id: 'active-overdue',
          serviceId: 's1',
          status: 'OPEN',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          resolvedAt: null,
          updatedAt: null,
          slaAckTargetMs: 10 * 60_000,
          slaResolveTargetMs: 30 * 60_000,
        },
      ],
      new Map(),
      new Map([['s1', { ackMinutes: 999, resolveMinutes: 999 }]]),
      new Map([['s1', 'Service One']]),
      15,
      120,
      8,
      new Date('2026-01-01T02:00:00Z')
    );

    expect(table[0].ackRate).toBe(0);
    expect(table[0].resolveRate).toBe(50);
    expect(table[0].total).toBe(2);
  });
});
