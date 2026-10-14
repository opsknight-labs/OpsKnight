/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { IncidentCreateV2Schema } from '@/lib/api-v2/validation';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));

vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn().mockResolvedValue({
    apiKey: { id: 'key_test', scopes: ['incidents:read', 'incidents:write', 'admin:manage'] },
    actor: {
      id: 'usr_admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamIds: ['team_admin'],
      apiKey: { id: 'key_test', scopes: ['incidents:read', 'incidents:write', 'admin:manage'] },
    },
  }),
}));

vi.mock('@/lib/incidents/idempotent-commands', () => ({
  executeIdempotentIncidentCreation: vi.fn().mockImplementation(async _input => ({
    value: { id: 'inc_created_123', outcome: 'CREATED' },
    replayed: false,
  })),
}));

vi.mock('@/lib/api-v2/audit', () => ({
  logV2Audit: vi.fn().mockResolvedValue(undefined),
}));

import { POST as createIncidentRoute } from '@/app/api/v2/incidents/route';
import { executeIdempotentIncidentCreation } from '@/lib/incidents/idempotent-commands';

describe('API v2 Incident Assignment Mutually Exclusive Semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('IncidentCreateV2Schema validation', () => {
    it('accepts assignment with only assigneeId', () => {
      const parsed = IncidentCreateV2Schema.parse({
        title: 'High latency',
        serviceId: 'svc_1',
        assigneeId: 'usr_alice',
      });
      expect(parsed.assigneeId).toBe('usr_alice');
      expect(parsed.teamId).toBeUndefined();
    });

    it('accepts assignment with only teamId', () => {
      const parsed = IncidentCreateV2Schema.parse({
        title: 'High latency',
        serviceId: 'svc_1',
        teamId: 'team_ops',
      });
      expect(parsed.teamId).toBe('team_ops');
      expect(parsed.assigneeId).toBeUndefined();
    });

    it('accepts creation with neither assigneeId nor teamId', () => {
      const parsed = IncidentCreateV2Schema.parse({
        title: 'High latency',
        serviceId: 'svc_1',
      });
      expect(parsed.assigneeId).toBeUndefined();
      expect(parsed.teamId).toBeUndefined();
    });

    it('rejects explicit conflicting assignment with both assigneeId and teamId', () => {
      expect(() =>
        IncidentCreateV2Schema.parse({
          title: 'High latency',
          serviceId: 'svc_1',
          assigneeId: 'usr_alice',
          teamId: 'team_ops',
        })
      ).toThrow(/Assign an incident to either a user or a team, not both/);
    });
  });

  describe('POST /api/v2/incidents route handler', () => {
    beforeEach(() => {
      // Service alpha has an associated team: team_service_alpha
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'svc_alpha',
        teamId: 'team_service_alpha',
      } as any);

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc_created_123',
        title: 'Test Incident',
        description: null,
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        serviceId: 'svc_alpha',
        assigneeId: 'usr_alice',
        teamId: null,
        visibility: 'PUBLIC',
        createdAt: new Date(),
        updatedAt: new Date(),
        acknowledgedAt: null,
        resolvedAt: null,
        service: { id: 'svc_alpha', name: 'Alpha Service' },
        assignee: { id: 'usr_alice', name: 'Alice', email: 'alice@example.com' },
      } as any);
    });

    it('does not implicitly assign service team when individual assignee is specified', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-assignee-only-1',
        },
        body: JSON.stringify({
          title: 'Database connection spike',
          serviceId: 'svc_alpha',
          assigneeId: 'usr_alice',
        }),
      });

      const res = await createIncidentRoute(req);
      expect(res.status).toBe(201);

      // Verify that teamId was set to null and NOT service.teamId
      expect(executeIdempotentIncidentCreation).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'svc_alpha',
          assigneeId: 'usr_alice',
          teamId: null,
        }),
        expect.anything(),
        // in-transaction audit hook
        expect.any(Function)
      );
    });

    it('assigns service team when no individual assignee is specified', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-fallback-team-1',
        },
        body: JSON.stringify({
          title: 'Database connection spike',
          serviceId: 'svc_alpha',
        }),
      });

      const res = await createIncidentRoute(req);
      expect(res.status).toBe(201);

      // Verify that teamId fell back to service.teamId
      expect(executeIdempotentIncidentCreation).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'svc_alpha',
          assigneeId: null,
          teamId: 'team_service_alpha',
        }),
        expect.anything(),
        // in-transaction audit hook
        expect.any(Function)
      );
    });

    it('assigns explicit team when provided without assigneeId', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-explicit-team-1',
        },
        body: JSON.stringify({
          title: 'Database connection spike',
          serviceId: 'svc_alpha',
          teamId: 'team_override_bravo',
        }),
      });

      const res = await createIncidentRoute(req);
      expect(res.status).toBe(201);

      expect(executeIdempotentIncidentCreation).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'svc_alpha',
          assigneeId: null,
          teamId: 'team_override_bravo',
        }),
        expect.anything(),
        // in-transaction audit hook
        expect.any(Function)
      );
    });

    it('returns 400 validation error when both assigneeId and teamId are provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-conflict-1',
        },
        body: JSON.stringify({
          title: 'Database connection spike',
          serviceId: 'svc_alpha',
          assigneeId: 'usr_alice',
          teamId: 'team_override_bravo',
        }),
      });

      const res = await createIncidentRoute(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(executeIdempotentIncidentCreation).not.toHaveBeenCalled();
    });
  });
});
