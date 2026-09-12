import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentSlaProjectionInput } from '@/lib/incident-sla/types';

const { findMany, findFirst, count } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { incident: { findMany, findFirst, count } },
}));

import { getNextIncidentSlaTransitionAt } from '@/lib/incident-sla/next-transition';

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
  beforeEach(() => findMany.mockReset());

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
});
