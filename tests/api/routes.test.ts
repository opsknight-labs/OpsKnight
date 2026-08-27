import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as incidentRoute from '@/app/api/incidents/route';
import prisma from '@/lib/prisma';
import { createMockRequest, parseResponse } from '../helpers/api-test';
import * as apiAuth from '@/lib/api-auth';
import * as rateLimit from '@/lib/rate-limit';

// Mock dependencies
vi.mock('@/lib/api-auth');
vi.mock('@/lib/rate-limit');
vi.mock('@/lib/escalation');
vi.mock('@/lib/service-notifications');
vi.mock('@/lib/status-page-webhooks');

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
  },
}));

describe('API Routes - Incidents', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default rate limit to allowed
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60000,
      count: 1,
    });
  });

  describe('GET /api/incidents', () => {
    it('should return 401 if unauthorized', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue(null);

      const req = await createMockRequest('GET', '/api/incidents');
      const res = await incidentRoute.GET(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(401);
      expect(data.error).toBeDefined();
    });

    it('should return 403 if missing scopes', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['read:other'],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(false);

      const req = await createMockRequest('GET', '/api/incidents');
      const res = await incidentRoute.GET(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(403);
      expect(data.error).toBeDefined();
    });

    it('should return incidents for authorized user', async () => {
      const mockIncidents = [
        { id: 'inc-1', title: 'Test 1', service: { name: 'Svc 1' }, assignee: null },
      ];

      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['incidents:read'],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(true);

      // Mock user context
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        teamMemberships: [],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.findMany).mockResolvedValue(mockIncidents as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const req = await createMockRequest('GET', '/api/incidents');
      const res = await incidentRoute.GET(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(200);
      expect(data.incidents).toHaveLength(1);
      expect(data.incidents[0].title).toBe('Test 1');
    });

    it('gives Auditor organization-wide read access', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-audit',
        userId: 'auditor-1',
        scopes: ['incidents:read'],
      } as never);
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'auditor-1',
        role: 'AUDITOR',
        teamMemberships: [],
      } as never);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([]);

      const req = await createMockRequest('GET', '/api/incidents');
      const res = await incidentRoute.GET(req);

      expect(res.status).toBe(200);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined })
      );
    });
  });

  describe('POST /api/incidents', () => {
    it('should create an incident with valid data', async () => {
      const incidentData = {
        title: 'New Incident',
        serviceId: 'svc-1',
        urgency: 'HIGH',
      };

      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['incidents:write'],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(true);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        teamMemberships: [],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'svc-1',
        teamId: 'team-1',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      vi.mocked(prisma.incident.create).mockResolvedValue({
        id: 'inc-new',
        ...incidentData,
        status: 'OPEN',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      // Second findUnique for webhook logic
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-new',
        ...incidentData,
        status: 'OPEN',
        service: { id: 'svc-1', name: 'Svc 1' },
        assignee: null,
        createdAt: new Date(),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const req = await createMockRequest('POST', '/api/incidents', incidentData);
      const res = await incidentRoute.POST(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(201);
      expect(data.incident.title).toBe('New Incident');
      expect(prisma.incident.create).toHaveBeenCalled();
    });

    it('should return 400 for invalid data', async () => {
      const invalidData = {
        // missing title
        serviceId: 'svc-1',
      };

      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['incidents:write'],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(true);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        teamMemberships: [],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const req = await createMockRequest('POST', '/api/incidents', invalidData);
      const res = await incidentRoute.POST(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('denies incident writes when an old write key belongs to an Auditor', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-audit',
        userId: 'auditor-1',
        scopes: ['incidents:write'],
      } as never);
      vi.mocked(apiAuth.hasApiScopes).mockReturnValue(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'auditor-1',
        role: 'AUDITOR',
        teamMemberships: [],
      } as never);

      const req = await createMockRequest('POST', '/api/incidents', {
        title: 'Must not be created',
        serviceId: 'svc-1',
        urgency: 'HIGH',
      });
      const res = await incidentRoute.POST(req);
      const { data } = await parseResponse(res);

      expect(res.status).toBe(403);
      expect(data.error).toContain('cannot manage incidents');
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });
  });
});
