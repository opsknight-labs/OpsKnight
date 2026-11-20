import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/sidebar-stats/route';
import prisma from '@/lib/prisma';
import { parseResponse } from '../helpers/api-test';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10 }),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      groupBy: vi.fn(),
    },
    statusPage: {
      findMany: vi.fn(),
    },
  },
}));

describe('API Route - Sidebar Stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no enabled status pages
    vi.mocked(prisma.statusPage.findMany).mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await GET();
    const { status } = await parseResponse(res);

    expect(status).toBe(401);
  });

  it('counts active incidents for admin without access filter', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'admin@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamMemberships: [],
    } as never);

    vi.mocked(prisma.incident.groupBy).mockResolvedValue([
      { urgency: 'HIGH', _count: { _all: 3 } },
    ] as never);

    vi.mocked(prisma.statusPage.findMany).mockResolvedValue([
      { id: 'sp-1', name: 'OpsKnight Status', slug: null, isDefault: true },
    ] as never);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.activeIncidentsCount).toBe(3);
    expect(data.dataState).toBe('available');
    expect(Number.isNaN(Date.parse(data.calculatedAt))).toBe(false);
    expect(data.statusPages).toHaveLength(1);
    expect(data.statusPages[0].name).toBe('OpsKnight Status');
    expect(data.isStatusPageAdmin).toBe(true);
    expect(prisma.incident.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: { in: ['OPEN', 'ACKNOWLEDGED'] } }),
          ]),
        }),
      })
    );
  });

  it('scopes active incidents for standard users', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }, { teamId: 'team-2' }],
    } as never);

    vi.mocked(prisma.incident.groupBy).mockResolvedValue([
      { urgency: 'LOW', _count: { _all: 1 } },
    ] as never);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.activeIncidentsCount).toBe(1);
    expect(data.statusPages).toHaveLength(0);
    expect(data.isStatusPageAdmin).toBe(false);
    expect(prisma.incident.groupBy).toHaveBeenCalled();
  });
});
