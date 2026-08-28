import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as incidentRoute from '@/app/api/incidents/route';
import prisma from '@/lib/prisma';
import { createMockRequest, parseResponse } from '../helpers/api-test';
import * as apiAuth from '@/lib/api-auth';
import * as rateLimit from '@/lib/rate-limit';

const mocks = vi.hoisted(() => ({
  executeIdempotentIncidentCreation: vi.fn(),
}));

vi.mock('@/lib/api-auth');
vi.mock('@/lib/rate-limit');
vi.mock('@/lib/incidents/idempotent-commands', () => ({
  executeIdempotentIncidentCreation: mocks.executeIdempotentIncidentCreation,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findMany: vi.fn(),
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
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60000,
      count: 1,
    });
    mocks.executeIdempotentIncidentCreation.mockResolvedValue({
      value: { id: 'inc-new', outcome: 'CREATED' },
      replayed: false,
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
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'USER',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);

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
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);
      vi.mocked(prisma.incident.findMany).mockResolvedValue(mockIncidents as never);

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
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'auditor-1',
        role: 'AUDITOR',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);
      vi.mocked(prisma.incident.findMany).mockResolvedValue([]);

      const req = await createMockRequest('GET', '/api/incidents');
      const res = await incidentRoute.GET(req);

      expect(res.status).toBe(200);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('POST /api/incidents', () => {
    function allowCreate() {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['incidents:write'],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'svc-1',
        teamId: 'team-1',
      } as never);
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-new',
        title: 'New Incident',
        serviceId: 'svc-1',
        urgency: 'HIGH',
        description: null,
        priority: null,
        status: 'OPEN',
        service: { id: 'svc-1', name: 'Svc 1' },
        assignee: null,
        createdAt: new Date('2026-08-28T09:00:00.000Z'),
      } as never);
    }

    it('delegates valid REST creation to the centralized creation engine', async () => {
      allowCreate();
      const incidentData = {
        title: 'New Incident',
        serviceId: 'svc-1',
        urgency: 'HIGH',
      };

      const req = await createMockRequest('POST', '/api/incidents', incidentData);
      const res = await incidentRoute.POST(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(201);
      expect(data.incident.title).toBe('New Incident');
      expect(data.outcome).toBe('CREATED');
      expect(mocks.executeIdempotentIncidentCreation).toHaveBeenCalledWith(
        {
          title: 'New Incident',
          description: null,
          serviceId: 'svc-1',
          urgency: 'HIGH',
          priority: null,
          source: 'REST_API',
          actor: { id: 'user-1' },
        },
        undefined
      );
    });

    it('passes Idempotency-Key through the API-key namespace and marks replays', async () => {
      allowCreate();
      mocks.executeIdempotentIncidentCreation.mockResolvedValue({
        value: { id: 'inc-new', outcome: 'CREATED' },
        replayed: true,
      });

      const req = await createMockRequest(
        'POST',
        '/api/incidents',
        { title: 'New Incident', serviceId: 'svc-1', urgency: 'HIGH' },
        { 'Idempotency-Key': 'deploy-42' }
      );
      const res = await incidentRoute.POST(req);

      expect(res.status).toBe(201);
      expect(res.headers.get('Idempotency-Replayed')).toBe('true');
      expect(mocks.executeIdempotentIncidentCreation).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: 'svc-1' }),
        { key: 'deploy-42', principalId: 'key-1' }
      );
    });

    it('should return 400 for invalid data', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-1',
        userId: 'user-1',
        scopes: ['incidents:write'],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);

      const req = await createMockRequest('POST', '/api/incidents', { serviceId: 'svc-1' });
      const res = await incidentRoute.POST(req);
      const { status, data } = await parseResponse(res);

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
      expect(mocks.executeIdempotentIncidentCreation).not.toHaveBeenCalled();
    });

    it('denies incident writes when an old write key belongs to an Auditor', async () => {
      vi.mocked(apiAuth.authenticateApiKey).mockResolvedValue({
        id: 'key-audit',
        userId: 'auditor-1',
        scopes: ['incidents:write'],
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'auditor-1',
        role: 'AUDITOR',
        status: 'ACTIVE',
        teamMemberships: [],
      } as never);
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'svc-1',
        teamId: 'team-1',
      } as never);

      const req = await createMockRequest('POST', '/api/incidents', {
        title: 'Must not be created',
        serviceId: 'svc-1',
        urgency: 'HIGH',
      });
      const res = await incidentRoute.POST(req);
      const { data } = await parseResponse(res);

      expect(res.status).toBe(403);
      expect(data.error).toContain('Incident creation access denied');
      expect(mocks.executeIdempotentIncidentCreation).not.toHaveBeenCalled();
    });
  });
});
