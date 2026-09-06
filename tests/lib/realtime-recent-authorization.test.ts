import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('@/lib/prisma', () => ({ default: { incident: { findMany } } }));

import { clearCache, getCachedRecentIncidents } from '@/lib/realtime-cache';

describe('recent incident realtime authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCache();
  });

  it('uses the canonical private/public/watcher policy for scoped users', async () => {
    await getCachedRecentIncidents('user-1', 'USER', ['team-1']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { assigneeId: 'user-1' },
            { watchers: { some: { userId: 'user-1' } } },
            {
              AND: [
                { visibility: 'PUBLIC' },
                {
                  OR: [{ teamId: { in: ['team-1'] } }, { service: { teamId: { in: ['team-1'] } } }],
                },
              ],
            },
          ],
        },
      })
    );
  });

  it('keeps global readers on the canonical unrestricted scope', async () => {
    await getCachedRecentIncidents('admin-1', 'ADMIN', []);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
