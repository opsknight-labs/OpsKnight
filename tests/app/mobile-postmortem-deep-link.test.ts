import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/prisma', () => ({ default: { postmortem: { findFirst: m.findFirst } } }));
vi.mock('next/navigation', () => ({ notFound: m.notFound, redirect: vi.fn() }));
vi.mock('@/lib/access/server', () => ({ requirePageAccess: vi.fn() }));
vi.mock('@/lib/request-actor-context', () => ({
  getRequestActorContext: vi.fn().mockResolvedValue({
    actor: { id: 'user-1', role: 'RESPONDER', status: 'ACTIVE', teamIds: [] },
  }),
}));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn().mockResolvedValue({ isResponderOrAbove: true }),
}));
vi.mock('@/lib/authorization-filters', () => ({ postmortemReadWhere: () => ({}) }));
vi.mock('@/components/squire/MobileSquireMount', () => ({ default: () => null }));

import MobilePostmortemDetailPage from '@/app/(mobile)/m/postmortems/[id]/page';

describe('mobile postmortem page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findFirst.mockResolvedValue(null);
  });

  it('resolves the incident id a desktop link carries as well as the postmortem id', async () => {
    await expect(
      MobilePostmortemDetailPage({ params: Promise.resolve({ id: 'inc-42' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    const where = (m.findFirst.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND).toContainEqual({ OR: [{ id: 'inc-42' }, { incidentId: 'inc-42' }] });
  });
});
