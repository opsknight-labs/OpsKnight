import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import { GET as getDriftList } from '@/app/api/compliance/drift/route';
import { GET as getDriftDetail } from '@/app/api/compliance/drift/[id]/route';
import { POST as acknowledgeDrift } from '@/app/api/compliance/drift/[id]/acknowledge/route';
import { GET as getMonitoringStatus } from '@/app/api/compliance/monitoring/route';
import { POST as triggerMonitoringRun } from '@/app/api/compliance/monitoring/runs/route';

const { mockAssertCapability, mockHasCapability, mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    complianceDriftEvent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    backgroundJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    complianceMonitoringRun: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  return {
    mockAssertCapability: vi.fn(),
    mockHasCapability: vi.fn(),
    mockPrisma,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

vi.mock('@/lib/authorization', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/authorization')>();
  return {
    ...actual,
    hasCapability: (...args: unknown[]) => mockHasCapability(...args),
  };
});

describe('compliance drift API routes RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/compliance/drift', () => {
    it('rejects unauthenticated or unauthorized users lacking COMPLIANCE_READ', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError(
          'User lacks compliance.read capability',
          CAPABILITIES.COMPLIANCE_READ
        )
      );

      const req = new NextRequest('http://localhost:3000/api/compliance/drift');
      const res = await getDriftList(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBeDefined();
    });

    it('allows authorized users with COMPLIANCE_READ', async () => {
      mockAssertCapability.mockResolvedValueOnce({ id: 'usr-1', role: 'AUDITOR' });
      mockPrisma.complianceDriftEvent.findMany.mockResolvedValueOnce([]);

      const req = new NextRequest('http://localhost:3000/api/compliance/drift');
      const res = await getDriftList(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data).toEqual([]);
    });
  });

  describe('GET /api/compliance/drift/[id]', () => {
    it('returns 404 when drift event does not exist', async () => {
      mockAssertCapability.mockResolvedValueOnce({ id: 'usr-1', role: 'ADMIN' });
      mockPrisma.complianceDriftEvent.findUnique.mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/compliance/drift/event-404');
      const res = await getDriftDetail(req, { params: Promise.resolve({ id: 'event-404' }) });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBeDefined();
    });

    it('restricts evidence details if user lacks COMPLIANCE_EVIDENCE_READ', async () => {
      mockAssertCapability.mockResolvedValueOnce({ id: 'usr-1', role: 'VIEWER' });
      mockHasCapability.mockReturnValue(false); // No evidence read permission
      mockPrisma.complianceDriftEvent.findUnique.mockResolvedValueOnce({
        id: 'event-1',
        controlId: 'ENC-01',
        kind: 'EVIDENCE_INTEGRITY_MISMATCH',
        details: { mismatches: 1 },
      });

      const req = new NextRequest('http://localhost:3000/api/compliance/drift/event-1');
      const res = await getDriftDetail(req, { params: Promise.resolve({ id: 'event-1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.evidenceRestricted).toBe(true);
      expect(json.data.evidence).toBeNull();
    });
  });

  describe('POST /api/compliance/drift/[id]/acknowledge', () => {
    it('requires COMPLIANCE_DRIFT_MANAGE capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError(
          'User lacks compliance.drift.manage capability',
          CAPABILITIES.COMPLIANCE_DRIFT_MANAGE
        )
      );

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/drift/event-1/acknowledge',
        {
          method: 'POST',
          body: JSON.stringify({ notes: 'Acknowledged' }),
        }
      );
      const res = await acknowledgeDrift(req, { params: Promise.resolve({ id: 'event-1' }) });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBeDefined();
    });
  });

  describe('POST /api/compliance/monitoring/runs', () => {
    it('requires COMPLIANCE_EVALUATE capability to trigger on-demand sweep', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError(
          'User lacks compliance.evaluate capability',
          CAPABILITIES.COMPLIANCE_EVALUATE
        )
      );

      const req = new NextRequest('http://localhost:3000/api/compliance/monitoring/runs', {
        method: 'POST',
      });
      const res = await triggerMonitoringRun(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBeDefined();
    });

    it('queues a monitoring sweep job and returns 202 Accepted', async () => {
      mockAssertCapability.mockResolvedValueOnce({ id: 'usr-1', role: 'ADMIN' });
      mockPrisma.complianceMonitoringRun.create.mockResolvedValueOnce({
        id: 'run-123',
        scheduledFor: new Date('2026-09-20T12:00:00.000Z'),
        status: 'PENDING',
      });
      mockPrisma.backgroundJob.create.mockResolvedValueOnce({
        id: 'job-123',
      });

      const req = new NextRequest('http://localhost:3000/api/compliance/monitoring/runs', {
        method: 'POST',
      });
      const res = await triggerMonitoringRun(req);
      const json = await res.json();

      expect(res.status).toBe(202);
      expect(json.data).toMatchObject({
        monitorRunId: 'run-123',
        status: 'PENDING',
      });
    });
  });

  describe('GET /api/compliance/monitoring', () => {
    it('requires COMPLIANCE_READ capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError(
          'User lacks compliance.read capability',
          CAPABILITIES.COMPLIANCE_READ
        )
      );

      const req = new NextRequest('http://localhost:3000/api/compliance/monitoring');
      const res = await getMonitoringStatus(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBeDefined();
    });
  });
});
