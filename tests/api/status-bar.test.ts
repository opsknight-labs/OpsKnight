import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/status-bar/route';
import prisma from '@/lib/prisma';
import { getCoverageGapSummary } from '@/lib/dashboard/live-incidents';
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

vi.mock('@/lib/dashboard/live-incidents', () => ({
  getCoverageGapSummary: vi.fn().mockResolvedValue({ count: 0, first: null }),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    maintenanceWindow: {
      findMany: vi.fn(),
    },
    incidentWarRoom: { findMany: vi.fn() },
    runbookExecution: { count: vi.fn() },
    ingestionReceipt: { findFirst: vi.fn() },
    statusPage: {
      findMany: vi.fn(),
    },
  },
}));

describe('API Route - Status Bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no enabled status pages
    vi.mocked(prisma.statusPage.findMany).mockResolvedValue([]);
    vi.mocked(prisma.incident.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.incident.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.maintenanceWindow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.incidentWarRoom.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.runbookExecution.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.ingestionReceipt.findFirst).mockResolvedValue(null as never);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await GET();
    const { status } = await parseResponse(res);

    expect(status).toBe(401);
  });

  it('reports active maintenance and awaiting-ack counts', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'admin@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamMemberships: [],
    } as never);
    vi.mocked(prisma.incident.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.incident.count).mockResolvedValue(4 as never);
    vi.mocked(getCoverageGapSummary).mockResolvedValueOnce({
      count: 2,
      first: { id: 'sch-1', name: 'Primary' },
    });
    vi.mocked(prisma.maintenanceWindow.findMany).mockResolvedValue([
      {
        endsAt: new Date('2026-01-01T12:00:00Z'),
        services: [{ service: { id: 's1', name: 'Payments' } }],
      },
    ] as never);

    const { data } = await parseResponse(await GET());

    expect(data.health).toMatchObject({
      awaitingAck: 4,
      slaAtRisk: 0,
      coverageGap: { count: 2, scheduleId: 'sch-1', scheduleName: 'Primary' },
      maintenance: {
        count: 1,
        serviceId: 's1',
        serviceName: 'Payments',
        endsAt: '2026-01-01T12:00:00.000Z',
      },
    });
  });

  it("adds the current user's assigned and unacknowledged counts", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'user@example.com' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
      teamMemberships: [],
    } as never);
    vi.mocked(prisma.incident.groupBy).mockImplementation((async (args: { by: string[] }) =>
      args.by[0] === 'status'
        ? [
            { status: 'OPEN', _count: { _all: 2 } },
            { status: 'ACKNOWLEDGED', _count: { _all: 3 } },
          ]
        : [{ urgency: 'HIGH', _count: { _all: 9 } }]) as never);

    const res = await GET();
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.my).toEqual({ assigned: 5, unacked: 2 });
    expect(data.health).toMatchObject({
      awaitingAck: 0,
      slaAtRisk: 0,
      maintenance: null,
      warRooms: null,
      statusPage: null,
      runbooksRunning: 0,
      ingestionDelayed: false,
    });
    // Ingestion health is admin-only: a plain USER never triggers the read.
    expect(prisma.ingestionReceipt.findFirst).not.toHaveBeenCalled();
    // The awaiting-ack count is read-scoped like the incident list.
    expect(vi.mocked(prisma.incident.count).mock.calls[0][0]).toMatchObject({
      where: { AND: [expect.anything(), { status: 'OPEN' }] },
    });
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=10, stale-while-revalidate=30');
    expect(prisma.incident.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { assigneeId: 'user-1', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          ]),
        }),
      })
    );
  });
});
