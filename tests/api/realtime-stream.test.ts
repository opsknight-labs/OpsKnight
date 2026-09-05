import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { GET } from '@/app/api/realtime/stream/route';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';

const { recentIncidentsMock, dashboardMetricsMock } = vi.hoisted(() => ({
  recentIncidentsMock: vi.fn(),
  dashboardMetricsMock: vi.fn(),
}));

vi.mock('@/lib/realtime-cache', () => ({
  getCachedRecentIncidents: recentIncidentsMock,
  getCachedDashboardMetrics: dashboardMetricsMock,
}));

vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('API Route - Realtime Stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recentIncidentsMock.mockResolvedValue({ data: [], changed: true, hash: '[]' });
    dashboardMetricsMock.mockResolvedValue(null);
  });

  it('returns SSE stream for authenticated users', async () => {
    const controller = new AbortController();
    const currentUser: Awaited<ReturnType<typeof getCurrentUser>> = {
      id: 'user-1',
      role: 'ADMIN',
      email: 'admin@example.com',
      name: 'Admin User',
      timeZone: 'UTC',
      status: 'ACTIVE',
      tokenVersion: 0,
      invitationGeneration: 0,
      gender: null,
      department: null,
      jobTitle: null,
      avatarUrl: null,
      phoneNumber: null,
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      pushNotificationsEnabled: false,
      whatsappNotificationsEnabled: false,
    };
    const streamUser = {
      id: 'user-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 0,
      teamMemberships: [],
    } satisfies Prisma.UserGetPayload<{
      select: {
        id: true;
        role: true;
        status: true;
        tokenVersion: true;
        teamMemberships: { select: { teamId: true } };
      };
    }>;
    vi.mocked(getCurrentUser).mockResolvedValue(currentUser);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(streamUser as never);
    vi.mocked(prisma.incident.findMany).mockResolvedValue([]);
    vi.mocked(prisma.incident.count).mockResolvedValue(0);

    const req = new NextRequest('http://localhost:3000/api/realtime/stream', {
      signal: controller.signal,
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    controller.abort();
  });

  it('commits the empty incident hash as the next polling baseline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      email: 'admin@example.com',
      name: 'Admin',
      timeZone: 'UTC',
      status: 'ACTIVE',
      tokenVersion: 0,
      invitationGeneration: 0,
      gender: null,
      department: null,
      jobTitle: null,
      avatarUrl: null,
      phoneNumber: null,
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      pushNotificationsEnabled: false,
      whatsappNotificationsEnabled: false,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 0,
      teamMemberships: [],
    } as never);

    const response = await GET(
      new NextRequest('http://localhost:3000/api/realtime/stream', {
        signal: controller.signal,
      })
    );
    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(recentIncidentsMock).toHaveBeenNthCalledWith(2, 'user-1', 'ADMIN', [], '[]');
    controller.abort();
    vi.useRealTimers();
  });
});
