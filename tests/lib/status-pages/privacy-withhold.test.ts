/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';

const store = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock('@/lib/status-pages/serving-store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/status-pages/serving-store')>()),
  getStatusPageServingStore: () => store,
}));

import { withholdStatusPagesForService } from '@/lib/status-pages/snapshot';

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.statusPageService = { findMany: vi.fn() };
  // No snapshot row to build: publishing reports a failure rather than throwing.
  db.$queryRaw.mockResolvedValue([]);
  db.statusPageSnapshot = { findUnique: vi.fn().mockResolvedValue(null) };
});

describe('withholdStatusPagesForService', () => {
  it('revokes every page that publishes the service, before trying to rebuild it', async () => {
    db.statusPageService.findMany.mockResolvedValue([
      { statusPageId: 'page-1' },
      { statusPageId: 'page-2' },
    ]);
    await withholdStatusPagesForService('svc-1');

    expect(db.statusPageService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: 'svc-1' } })
    );
    expect(store.revoke.mock.calls).toEqual([
      ['page-1', 'PRIVACY'],
      ['page-2', 'PRIVACY'],
    ]);
  });

  it('does nothing for a service no page publishes', async () => {
    db.statusPageService.findMany.mockResolvedValue([]);
    await withholdStatusPagesForService('svc-2');
    expect(store.revoke).not.toHaveBeenCalled();
  });
});
