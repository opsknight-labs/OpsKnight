import { describe, expect, it } from 'vitest';
import { computeUptime, type OutageIncident } from '@/lib/uptime';

const HOUR = 3_600_000;
const periodStart = new Date('2026-03-01T00:00:00.000Z');
const periodEnd = new Date('2026-03-02T00:00:00.000Z'); // 24h
const at = (hours: number) => new Date(periodStart.getTime() + hours * HOUR);

function incident(overrides: Partial<OutageIncident> & Pick<OutageIncident, 'createdAt'>) {
  return { resolvedAt: null, updatedAt: null, status: 'OPEN', ...overrides } as OutageIncident;
}

describe('computeUptime', () => {
  it('is 100% with no incidents', () => {
    expect(computeUptime({ periodStart, periodEnd, incidents: [] })).toEqual({
      uptimePercent: 100,
      downtimeMs: 0,
      periodMs: 24 * HOUR,
    });
  });

  it('counts a resolved incident from creation to resolution', () => {
    const result = computeUptime({
      periodStart,
      periodEnd,
      incidents: [incident({ createdAt: at(2), resolvedAt: at(5), status: 'RESOLVED' })],
    });
    expect(result.downtimeMs).toBe(3 * HOUR);
    expect(result.uptimePercent).toBeCloseTo(87.5, 6);
  });

  it.each(['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'])(
    'counts an unresolved %s incident as downtime until the period end',
    status => {
      const result = computeUptime({
        periodStart,
        periodEnd,
        incidents: [incident({ createdAt: at(12), status })],
      });
      expect(result.downtimeMs).toBe(12 * HOUR);
      expect(result.uptimePercent).toBeCloseTo(50, 6);
    }
  );

  it('gives the same answer for a snoozed incident as for the same incident when it was open', () => {
    const base = { createdAt: at(1), resolvedAt: at(4) };
    const open = computeUptime({
      periodStart,
      periodEnd,
      incidents: [incident({ ...base, status: 'OPEN' })],
    });
    const snoozed = computeUptime({
      periodStart,
      periodEnd,
      incidents: [incident({ ...base, status: 'SNOOZED' })],
    });
    expect(snoozed).toEqual(open);
  });

  it('counts overlapping incidents once', () => {
    const result = computeUptime({
      periodStart,
      periodEnd,
      incidents: [
        incident({ createdAt: at(1), resolvedAt: at(5), status: 'RESOLVED' }),
        incident({ createdAt: at(3), resolvedAt: at(8), status: 'RESOLVED' }),
        incident({ createdAt: at(4), resolvedAt: at(6), status: 'RESOLVED' }),
      ],
    });
    expect(result.downtimeMs).toBe(7 * HOUR);
  });

  it('clips incidents that started before or end after the period', () => {
    const result = computeUptime({
      periodStart,
      periodEnd,
      incidents: [
        incident({ createdAt: at(-10), resolvedAt: at(2), status: 'RESOLVED' }),
        incident({ createdAt: at(22), resolvedAt: at(40), status: 'RESOLVED' }),
      ],
    });
    expect(result.downtimeMs).toBe(4 * HOUR);
  });

  it('measures a new service only from its creation', () => {
    const result = computeUptime({
      periodStart,
      periodEnd,
      createdAt: at(12),
      incidents: [incident({ createdAt: at(18), resolvedAt: at(21), status: 'RESOLVED' })],
    });
    expect(result.periodMs).toBe(12 * HOUR);
    expect(result.downtimeMs).toBe(3 * HOUR);
    expect(result.uptimePercent).toBeCloseTo(75, 6);
  });

  it('ignores a service creation date earlier than the period', () => {
    const result = computeUptime({ periodStart, periodEnd, createdAt: at(-100), incidents: [] });
    expect(result.periodMs).toBe(24 * HOUR);
  });

  it('reports nothing measured, not a failure, for a service created after the period', () => {
    expect(computeUptime({ periodStart, periodEnd, createdAt: at(30), incidents: [] })).toEqual({
      uptimePercent: 100,
      downtimeMs: 0,
      periodMs: 0,
    });
  });

  it('closes a legacy resolved row without resolvedAt at updatedAt', () => {
    const result = computeUptime({
      periodStart,
      periodEnd,
      incidents: [incident({ createdAt: at(1), updatedAt: at(3), status: 'RESOLVED' })],
    });
    expect(result.downtimeMs).toBe(2 * HOUR);
  });
});
