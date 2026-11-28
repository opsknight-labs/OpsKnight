import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { team: { findMany: m.findMany } } }));

import { listRunbookTeamOptions } from '@/lib/runbooks/team-options';

describe('listRunbookTeamOptions', () => {
  it('asks for every team by name, with no row cap', async () => {
    m.findMany.mockResolvedValue([{ id: 'team-201', name: 'Zulu' }]);

    await expect(listRunbookTeamOptions()).resolves.toEqual([{ id: 'team-201', name: 'Zulu' }]);

    expect(m.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(m.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  });
});
