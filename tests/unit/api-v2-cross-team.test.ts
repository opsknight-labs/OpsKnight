import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

// Ensure mockPrisma has missing models/methods
(prisma as any).integration = {
  findMany: vi.fn().mockResolvedValue([]),
  findFirst: vi.fn().mockResolvedValue(null),
  findUnique: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue({}),
};
(prisma.incident as any).groupBy = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));

vi.mock('@/lib/actor-metrics', () => ({
  calculateActorSLAMetrics: vi.fn().mockResolvedValue({
    windowDays: 30,
    totalIncidents: 12,
    resolvedIncidents: 10,
    mttd: 4.5,
    mttr: 25.0,
    slaCompliance: 95.5,
    statusMix: [{ status: 'RESOLVED', count: 10 }, { status: 'OPEN', count: 2 }],
  }),
}));

vi.mock('@/lib/escalation', () => ({
  resolveEscalationTarget: vi.fn().mockResolvedValue(['usr_oncall_1']),
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueIncidentUpdateSideEffects: vi.fn().mockResolvedValue(undefined),
  enqueueWarRoomSideEffects: vi.fn().mockResolvedValue(undefined),
  enqueueSideEffects: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth to allow test actors
let currentMockActor: any = null;
let currentMockApiKey: any = null;

vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn().mockImplementation(async () => {
      if (!currentMockActor) {
        throw new Error('No mock actor configured');
      }
      return {
        apiKey: currentMockApiKey || { id: 'key_test', scopes: ['admin:manage'] },
        actor: currentMockActor,
      };
    }),
  };
});

import { GET as getIntegrationsRoute } from '@/app/api/v2/integrations/route';
import { GET as getScheduleOnCallRoute } from '@/app/api/v2/schedules/[id]/on-call/route';
import { GET as getMetricsRoute } from '@/app/api/v2/reports/metrics/route';
import { POST as postAssignRoute } from '@/app/api/v2/incidents/[id]/assign/route';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { decodeCursor, encodeCursor } from '@/lib/api-v2/pagination';
import { AppError } from '@/lib/errors';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { enqueueIncidentUpdateSideEffects, enqueueWarRoomSideEffects } from '@/lib/event-outbox';

describe('API v2 Cross-Team Isolation & Domain Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v2/integrations cross-team isolation', () => {
    it('applies integrationReadWhere(actor) filter with only integrations:read scope', async () => {
      currentMockActor = {
        id: 'usr_alpha',
        role: 'USER',
        status: 'ACTIVE',
        teamIds: ['team_alpha'],
        apiKey: { id: 'key_alpha', scopes: ['integrations:read'] },
      };
      currentMockApiKey = { id: 'key_alpha', scopes: ['integrations:read'] };

      ((prisma as any).integration.findMany as any).mockResolvedValueOnce([
        {
          id: 'int_alpha_1',
          name: 'Alpha Events API',
          type: 'EVENTS_API_V2',
          enabled: true,
          serviceId: 'svc_alpha',
          createdAt: new Date('2026-10-13T10:00:00Z'),
          updatedAt: new Date('2026-10-13T10:00:00Z'),
          service: { id: 'svc_alpha', name: 'Alpha Service' },
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/v2/integrations');
      const res = await getIntegrationsRoute(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('int_alpha_1');

      // Verify Prisma query was filtered with actor team scope
      expect((prisma as any).integration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                service: { teamId: { in: ['team_alpha'] } },
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('GET /api/v2/schedules/[id]/on-call resource authorization', () => {
    it('returns 403 AUTHORIZATION_DENIED if caller does not have read access to target schedule', async () => {
      currentMockActor = {
        id: 'usr_beta',
        role: 'USER',
        status: 'ACTIVE',
        teamIds: ['team_beta'],
        apiKey: { id: 'key_beta', scopes: ['schedules:read'] },
      };
      currentMockApiKey = { id: 'key_beta', scopes: ['schedules:read'] };

      // Schedule exists in db, but not accessible to usr_beta (findFirst with scheduleReadWhere returns null)
      (prisma.onCallSchedule.findUnique as any).mockResolvedValueOnce({
        id: 'sched_secret',
        name: 'Executive Rotation',
        timeZone: 'UTC',
      });
      (prisma.onCallSchedule.findFirst as any).mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/v2/schedules/sched_secret/on-call');
      const res = await getScheduleOnCallRoute(req, { params: Promise.resolve({ id: 'sched_secret' }) });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('AUTHORIZATION_DENIED');
    });

    it('returns 200 when schedule is accessible to actor', async () => {
      currentMockActor = {
        id: 'usr_alpha',
        role: 'RESPONDER',
        status: 'ACTIVE',
        teamIds: ['team_alpha'],
        apiKey: { id: 'key_alpha', scopes: ['schedules:read'] },
      };
      currentMockApiKey = { id: 'key_alpha', scopes: ['schedules:read'] };

      (prisma.onCallSchedule.findUnique as any).mockResolvedValueOnce({
        id: 'sched_alpha',
        name: 'Alpha Schedule',
        timeZone: 'UTC',
      });
      (prisma.onCallSchedule.findFirst as any).mockResolvedValueOnce({
        id: 'sched_alpha',
      });

      (prisma.user.findMany as any).mockResolvedValueOnce([
        {
          id: 'usr_oncall_1',
          name: 'Primary OnCall',
          email: 'primary@example.com',
          role: 'RESPONDER',
          timeZone: 'UTC',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/v2/schedules/sched_alpha/on-call');
      const res = await getScheduleOnCallRoute(req, { params: Promise.resolve({ id: 'sched_alpha' }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.schedule.id).toBe('sched_alpha');
      expect(body.data.onCallUsers).toHaveLength(1);
      expect(body.data.onCallUsers[0].id).toBe('usr_oncall_1');
    });
  });

  describe('GET /api/v2/reports/metrics actor scoping', () => {
    it('scopes metrics to actor permissions via calculateActorSLAMetrics', async () => {
      currentMockActor = {
        id: 'usr_alpha',
        role: 'RESPONDER',
        status: 'ACTIVE',
        teamIds: ['team_alpha'],
        apiKey: { id: 'key_alpha', scopes: ['reports:read', 'incidents:read'] },
      };
      currentMockApiKey = { id: 'key_alpha', scopes: ['reports:read', 'incidents:read'] };

      ((prisma.incident as any).groupBy as any).mockResolvedValueOnce([
        { priority: 'P1', _count: { id: 3 } },
        { priority: 'P2', _count: { id: 5 } },
      ]);

      const req = new NextRequest('http://localhost:3000/api/v2/reports/metrics?days=30');
      const res = await getMetricsRoute(req);

      expect(res.status).toBe(200);
      expect(calculateActorSLAMetrics).toHaveBeenCalledWith(
        currentMockActor,
        expect.objectContaining({ windowDays: 30 })
      );

      // Verify priority group query was scoped with actor incident filter
      expect((prisma.incident as any).groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.anything(),
            ]),
          }),
        })
      );
    });
  });

  describe('Canonical Incident Assignment Domain Command', () => {
    it('clears opposing assignee and creates outbox events when assigning to a team', async () => {
      const mockTx = {
        incident: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'inc_123',
            title: 'Outage',
            assigneeId: 'usr_old',
            teamId: null,
          }),
          update: vi.fn().mockResolvedValue({
            id: 'inc_123',
            teamId: 'team_alpha',
            assigneeId: null,
          }),
        },
        team: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'team_alpha',
            name: 'Alpha Team',
          }),
        },
        incidentEvent: {
          create: vi.fn().mockResolvedValue({ id: 'evt_1' }),
        },
      } as any;

      const result = await assignIncidentDomainCommand(
        {
          incidentId: 'inc_123',
          teamId: 'team_alpha',
          actor: { id: 'usr_lead', name: 'Lead' },
        },
        mockTx
      );

      expect(result.teamId).toBe('team_alpha');
      expect(result.assigneeId).toBeNull();

      expect(mockTx.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            teamId: 'team_alpha',
            assigneeId: null,
          },
        })
      );

      expect(enqueueIncidentUpdateSideEffects).toHaveBeenCalledWith(
        mockTx,
        'inc_123',
        ['INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION']
      );
      expect(enqueueWarRoomSideEffects).toHaveBeenCalledWith(
        mockTx,
        'inc_123',
        expect.arrayContaining([
          expect.objectContaining({ effect: 'WAR_ROOM_INVITE_TEAM', teamId: 'team_alpha' }),
        ])
      );
    });
  });

  describe('HMAC Cursor Tamper Resistance', () => {
    it('rejects tampered or forged cursor payload with AppError', () => {
      const valid = encodeCursor({ id: 'inc_123', createdAt: '2026-10-13T12:00:00.000Z' });
      const decoded = decodeCursor(valid);
      expect(decoded.id).toBe('inc_123');

      // Tampering with payload part:
      const [payloadB64, sig] = valid.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ id: 'inc_hacked', createdAt: '2026-10-13T12:00:00.000Z' })).toString('base64url');
      const tamperedCursor = `${tamperedPayload}.${sig}`;

      expect(() => decodeCursor(tamperedCursor)).toThrowError();
      try {
        decodeCursor(tamperedCursor);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('INVALID_PAGINATION_CURSOR');
      }
    });
  });
});
