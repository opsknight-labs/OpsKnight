import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getDashboards, POST as createDashboard } from '@/app/api/dashboards/route';
import {
  GET as getDashboardById,
  PUT as updateDashboard,
  DELETE as deleteDashboard,
} from '@/app/api/dashboards/[id]/route';

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    dashboard: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    dashboardWidget: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getServerSession: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: mocks.getServerSession,
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('Dashboards API CRUD Contract', () => {
  const mockUser = {
    id: 'user-1',
    email: 'user@example.com',
    teamMemberships: [{ teamId: 'team-1' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: mockUser.email } });
    mocks.prisma.user.findUnique.mockResolvedValue(mockUser);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma)
    );
  });

  describe('GET /api/dashboards', () => {
    it('returns 401 when unauthenticated', async () => {
      mocks.getServerSession.mockResolvedValue(null);
      const res = await getDashboards();
      expect(res.status).toBe(401);
    });

    it('returns user dashboards and team dashboards', async () => {
      mocks.prisma.dashboard.findMany
        .mockResolvedValueOnce([{ id: 'd-1', name: 'My Dashboard' }]) // userDashboards
        .mockResolvedValueOnce([{ id: 'd-2', name: 'Team Dashboard' }]) // teamDashboards
        .mockResolvedValueOnce([{ id: 'd-3', name: 'Template', isTemplate: true }]); // publicDashboards

      const res = await getDashboards();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.dashboards).toHaveLength(1);
      expect(body.teamDashboards).toHaveLength(1);
      expect(body.templates).toHaveLength(1);
    });
  });

  describe('POST /api/dashboards', () => {
    it('rejects creation when name is empty', async () => {
      const req = new NextRequest('http://localhost/api/dashboards', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      });
      const res = await createDashboard(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid dashboard configuration');
    });

    it('creates a dashboard with widgets and sourceTemplate provenance', async () => {
      mocks.prisma.dashboard.create.mockResolvedValue({
        id: 'new-dash',
        name: 'New Custom Dashboard',
        templateId: 'executive-summary',
        widgets: [
          { id: 'w-1', widgetType: 'metric', metricKey: 'totalIncidents', widgetDefinitionId: 'total-incidents' },
        ],
      });

      const req = new NextRequest('http://localhost/api/dashboards', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Custom Dashboard',
          description: 'A test dashboard',
          sourceTemplate: 'executive-summary',
          visibility: 'PRIVATE',
          widgets: [
            {
              widgetType: 'metric',
              metricKey: 'totalIncidents',
              widgetDefinitionId: 'total-incidents',
              title: 'Total Incidents',
              position: { x: 0, y: 0, w: 1, h: 1 },
              config: {},
            },
          ],
        }),
      });

      const res = await createDashboard(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mocks.prisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Custom Dashboard',
            templateId: 'executive-summary',
            widgets: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  widgetType: 'metric',
                  metricKey: 'totalIncidents',
                  widgetDefinitionId: 'total-incidents',
                }),
              ]),
            }),
          }),
        })
      );
    });

    it('rejects TEAM visibility if user is not in the team', async () => {
      const req = new NextRequest('http://localhost/api/dashboards', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Team Dashboard',
          visibility: 'TEAM',
          teamId: 'other-team',
          widgets: [],
        }),
      });

      const res = await createDashboard(req);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/dashboards/[id]', () => {
    it('returns dashboard with edit permissions for owner', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-1',
        name: 'My Dashboard',
        userId: mockUser.id,
        visibility: 'PRIVATE',
        widgets: [],
      });

      const res = await getDashboardById(
        new NextRequest('http://localhost/api/dashboards/d-1'),
        { params: Promise.resolve({ id: 'd-1' }) }
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.permissions.canEdit).toBe(true);
      expect(body.dashboard.id).toBe('d-1');
    });

    it('returns 403 for private dashboard owned by someone else', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-other',
        name: 'Secret',
        userId: 'other-user',
        visibility: 'PRIVATE',
        widgets: [],
      });

      const res = await getDashboardById(
        new NextRequest('http://localhost/api/dashboards/d-other'),
        { params: Promise.resolve({ id: 'd-other' }) }
      );
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/dashboards/[id]', () => {
    it('updates widgets and metadata in transaction', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-1',
        userId: mockUser.id,
        visibility: 'PRIVATE',
      });
      mocks.prisma.dashboard.update.mockResolvedValue({
        id: 'd-1',
        name: 'Updated Dashboard',
        widgets: [
          { id: 'w-new', widgetType: 'chart', metricKey: 'trendSeries', widgetDefinitionId: 'incident-trend' },
        ],
      });

      const req = new NextRequest('http://localhost/api/dashboards/d-1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Updated Dashboard',
          widgets: [
            {
              widgetType: 'chart',
              metricKey: 'trendSeries',
              widgetDefinitionId: 'incident-trend',
              position: { x: 0, y: 0, w: 2, h: 2 },
              config: { chartType: 'count' },
            },
          ],
        }),
      });

      const res = await updateDashboard(req, { params: Promise.resolve({ id: 'd-1' }) });
      expect(res.status).toBe(200);
      expect(mocks.prisma.dashboardWidget.deleteMany).toHaveBeenCalledWith({
        where: { dashboardId: 'd-1' },
      });
      expect(mocks.prisma.dashboard.update).toHaveBeenCalled();
    });

    it('rejects PUT from non-owner with 403', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-1',
        userId: 'another-user',
        visibility: 'PRIVATE',
      });

      const req = new NextRequest('http://localhost/api/dashboards/d-1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Hacked' }),
      });

      const res = await updateDashboard(req, { params: Promise.resolve({ id: 'd-1' }) });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/dashboards/[id]', () => {
    it('deletes dashboard for owner', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-1',
        userId: mockUser.id,
        isTemplate: false,
      });

      const res = await deleteDashboard(
        new NextRequest('http://localhost/api/dashboards/d-1'),
        { params: Promise.resolve({ id: 'd-1' }) }
      );
      expect(res.status).toBe(200);
      expect(mocks.prisma.dashboard.delete).toHaveBeenCalledWith({ where: { id: 'd-1' } });
    });

    it('prevents deleting templates', async () => {
      mocks.prisma.dashboard.findUnique.mockResolvedValue({
        id: 'd-template',
        userId: mockUser.id,
        isTemplate: true,
      });

      const res = await deleteDashboard(
        new NextRequest('http://localhost/api/dashboards/d-template'),
        { params: Promise.resolve({ id: 'd-template' }) }
      );
      expect(res.status).toBe(403);
    });
  });
});
