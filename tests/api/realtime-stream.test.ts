import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { GET } from '@/app/api/realtime/stream/route';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';

const { recentIncidentsMock, dashboardMetricsMock, changeListeners } = vi.hoisted(() => ({
  recentIncidentsMock: vi.fn(),
  dashboardMetricsMock: vi.fn(),
  changeListeners: new Set<(generation: string) => void | Promise<void>>(),
}));

vi.mock('@/lib/realtime-cache', () => ({
  getCachedRecentIncidents: recentIncidentsMock,
  getCachedDashboardMetrics: dashboardMetricsMock,
}));

vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: vi.fn().mockResolvedValue('10'),
  subscribeToRealtimeChanges: vi.fn(
    (_stream: string, _generation: string, listener: (generation: string) => void) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    }
  ),
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
    changeListeners.clear();
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

  it('refreshes projections only after the shared durable generation advances', async () => {
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
    await vi.waitFor(() => expect(changeListeners.size).toBe(1));
    expect(recentIncidentsMock).toHaveBeenCalledTimes(1);
    await Promise.all([...changeListeners].map(listener => listener('11')));

    expect(recentIncidentsMock).toHaveBeenNthCalledWith(2, 'user-1', 'ADMIN', [], '[]', '11');
    controller.abort();
  });
});
