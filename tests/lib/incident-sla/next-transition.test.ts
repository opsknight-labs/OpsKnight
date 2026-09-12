import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentSlaProjectionInput } from '@/lib/incident-sla/types';

const { findMany, findFirst, count } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
}));
const scheduler = vi.hoisted(() => ({ mode: 'LEGACY', record: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { incident: { findMany, findFirst, count } },
}));
vi.mock('@/lib/incident-sla/scheduler-control', () => ({
  getSlaSchedulerMode: vi.fn(() => Promise.resolve(scheduler.mode)),
  recordSlaSchedulerShadowObservation: scheduler.record,
}));

import {
  compareSlaTransitionHint,
  deriveNextSlaTransition,
  getNextIncidentSlaTransitionAt,
} from '@/lib/incident-sla/next-transition';

const minute = 60_000;
const createdAt = new Date('2026-09-08T00:00:00.000Z');

function incident(overrides: Partial<IncidentSlaProjectionInput> = {}): IncidentSlaProjectionInput {
  return {
    status: 'OPEN',
    createdAt,
    acknowledgedAt: null,
    resolvedAt: null,
    slaAckTargetMs: 20 * minute,
    slaResolveTargetMs: 120 * minute,
    slaTargetSource: 'SERVICE_DEFAULT',
    slaTargetCapturedAt: createdAt,
    slaPausedMs: BigInt(0),
    slaPauseStartedAt: null,
    slaAckElapsedMs: null,
    slaResolveElapsedMs: null,
    ...overrides,
  };
}

describe('next incident SLA transition', () => {
  beforeEach(() => {
    findMany.mockReset();
    findFirst.mockReset();
    count.mockReset();
    scheduler.mode = 'LEGACY';
    scheduler.record.mockReset();
  });

  it('returns the earliest transition across active incidents', async () => {
    findMany.mockResolvedValue([
      incident(),
      incident({
        createdAt: new Date(createdAt.getTime() + 5 * minute),
        slaTargetCapturedAt: new Date(createdAt.getTime() + 5 * minute),
        slaAckTargetMs: 5 * minute,
      }),
    ]);

    const now = new Date(createdAt.getTime() + 6 * minute);
    const result = await getNextIncidentSlaTransitionAt(now);

    expect(result).toEqual(new Date(createdAt.getTime() + 8.75 * minute));
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('ignores paused, completed, and invalid contracts', async () => {
    findMany.mockResolvedValue([
      incident({ status: 'SNOOZED', slaPauseStartedAt: new Date(createdAt.getTime() + minute) }),
      incident({
        status: 'RESOLVED',
        resolvedAt: new Date(createdAt.getTime() + minute),
      }),
      incident({ slaAckTargetMs: null }),
    ]);

    await expect(
      getNextIncidentSlaTransitionAt(new Date(createdAt.getTime() + 2 * minute))
    ).resolves.toBeNull();
  });

  it('uses the notification-enabled service predicate for scheduler work', async () => {
    findMany.mockResolvedValue([]);
    await getNextIncidentSlaTransitionAt();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ service: { serviceNotifyOnSlaBreach: true } }),
      })
    );
  });

  it('classifies incident-level shadow mismatches by bounded reason', () => {
    const canonical = { at: new Date('2026-09-08T01:00:00Z'), kind: 'ACK_WARNING' as const };
    expect(compareSlaTransitionHint(canonical, null, null)).toBe('missing_hint');
    expect(compareSlaTransitionHint(null, canonical.at, canonical.kind)).toBe('unexpected_hint');
    expect(
      compareSlaTransitionHint(canonical, new Date('2026-09-08T02:00:00Z'), canonical.kind)
    ).toBe('wrong_time');
    expect(compareSlaTransitionHint(canonical, canonical.at, 'ACK_BREACH')).toBe('wrong_kind');
    expect(compareSlaTransitionHint(canonical, canonical.at, canonical.kind)).toBeNull();
  });

  it('certifies the complete shadow population beyond 500 incidents', async () => {
    scheduler.mode = 'SHADOW';
    const now = new Date(createdAt.getTime() + minute);
    const sample = incident({ slaAckTargetMs: 8 * minute });
    const canonicalAt = deriveNextSlaTransition(sample, now)!.at;
    const incidents = Array.from({ length: 501 }, (_, index) => ({
      id: `incident-${index}`,
      ...sample,
      nextSlaTransitionAt: index === 500 ? new Date(canonicalAt.getTime() + minute) : canonicalAt,
      nextSlaTransitionKind: 'ACK_WARNING',
    }));
    findMany.mockResolvedValue(incidents);
    count.mockResolvedValue(0);

    await getNextIncidentSlaTransitionAt(now);

    expect(scheduler.record).toHaveBeenCalledWith({ checkedAt: now, mismatches: 1 });
  });
});
