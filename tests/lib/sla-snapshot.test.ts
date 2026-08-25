import { beforeEach, describe, expect, it, vi } from 'vitest';

const { definitionFindMock, incidentFindManyMock, snapshotUpsertMock } = vi.hoisted(() => ({
  definitionFindMock: vi.fn(),
  incidentFindManyMock: vi.fn(),
  snapshotUpsertMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    sLADefinition: { findUnique: definitionFindMock },
    incident: { findMany: incidentFindManyMock },
    sLASnapshot: { upsert: snapshotUpsertMock },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateDailySnapshot } from '@/lib/sla-server';

describe('generateDailySnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    definitionFindMock.mockResolvedValue({
      id: 'sla-1',
      serviceId: null,
      targetAckTime: 15,
      targetResolveTime: 120,
    });
  });

  it('counts a resolved but never acknowledged incident as an ACK breach', async () => {
    incidentFindManyMock.mockResolvedValue([
      {
        id: 'incident-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: new Date('2026-08-01T01:00:00.000Z'),
        updatedAt: new Date('2026-08-01T01:00:00.000Z'),
        status: 'RESOLVED',
      },
    ]);

    await generateDailySnapshot('sla-1', new Date('2026-08-01T12:00:00.000Z'));

    expect(snapshotUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ complianceScore: 50 }),
        update: expect.objectContaining({ complianceScore: 50 }),
      })
    );
  });

  it('uses updatedAt as the resolution time for legacy resolved rows', async () => {
    incidentFindManyMock.mockResolvedValue([
      {
        id: 'incident-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        acknowledgedAt: new Date('2026-08-01T00:05:00.000Z'),
        resolvedAt: null,
        updatedAt: new Date('2026-08-01T01:00:00.000Z'),
        status: 'RESOLVED',
      },
    ]);

    await generateDailySnapshot('sla-1', new Date('2026-08-01T12:00:00.000Z'));

    expect(snapshotUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metAckTime: 1, metResolveTime: 1, complianceScore: 100 }),
      })
    );
  });
});
