import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { incident: { findMany: mocks.findMany } },
}));

import {
  HISTORY_INCIDENT_PAGE_SIZE,
  loadHistoryIncidentsByService,
} from '@/lib/status-pages/history-query';

const start = new Date('2026-06-01T00:00:00.000Z');
const end = new Date('2026-09-01T00:00:00.000Z');

function incident(id: string, serviceId = 'service-a') {
  return {
    id,
    serviceId,
    createdAt: start,
    resolvedAt: end,
    updatedAt: end,
    urgency: 'LOW',
    status: 'RESOLVED',
  };
}

describe('status-page authoritative history query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exhausts bounded keyset pages before marking history complete', async () => {
    const firstPage = Array.from({ length: HISTORY_INCIDENT_PAGE_SIZE }, (_, index) =>
      incident(`incident-${String(index).padStart(4, '0')}`)
    );
    mocks.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([incident('incident-final', 'service-b')]);

    const result = await loadHistoryIncidentsByService(['service-a', 'service-b'], start, end);

    expect(result.get('service-a')).toHaveLength(HISTORY_INCIDENT_PAGE_SIZE);
    expect(result.get('service-b')?.map(item => item.id)).toEqual(['incident-final']);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: { id: 'asc' },
      take: HISTORY_INCIDENT_PAGE_SIZE,
      select: expect.objectContaining({ updatedAt: true, resolvedAt: true }),
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { resolvedAt: null, status: { not: 'RESOLVED' } },
          { resolvedAt: null, status: 'RESOLVED', updatedAt: { gte: start } },
        ]),
      }),
    });
    expect(mocks.findMany.mock.calls[1]?.[0]).toMatchObject({
      cursor: { id: firstPage.at(-1)?.id },
      skip: 1,
      take: HISTORY_INCIDENT_PAGE_SIZE,
    });
  });

  it('rejects the whole read when a later page fails', async () => {
    mocks.findMany
      .mockResolvedValueOnce(
        Array.from({ length: HISTORY_INCIDENT_PAGE_SIZE }, (_, index) =>
          incident(`incident-${index}`)
        )
      )
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(loadHistoryIncidentsByService(['service-a'], start, end)).rejects.toThrow(
      'database unavailable'
    );
  });
});
