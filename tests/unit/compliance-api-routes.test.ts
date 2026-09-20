import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthorizationError } from '@/lib/authorization';

const { mockAssertCapability, mockPrisma, mockEvaluateControls } = vi.hoisted(() => {
  const mockPrisma = {
    complianceControlState: {
      findMany: vi.fn(),
    },
    complianceEvaluation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    complianceEvidence: {
      findMany: vi.fn(),
    },
  };

  return {
    mockAssertCapability: vi.fn().mockResolvedValue({
      id: 'usr-admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'ADMIN',
    }),
    mockPrisma,
    mockEvaluateControls: vi.fn().mockResolvedValue({
      batchId: 'batch-test-123',
      evaluations: [
        {
          controlId: 'SEC-ENC-001',
          status: 'IMPLEMENTED',
          evaluatorId: 'encryption.at-rest',
          evaluatorVersion: '1',
          summary: 'Clean',
        },
      ],
      summary: {
        total: 1,
        implemented: 1,
        partial: 0,
        actionRequired: 0,
        unverified: 0,
        notApplicable: 0,
      },
    }),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

vi.mock('@/lib/compliance/evaluation', () => ({
  evaluateControls: (...args: unknown[]) => mockEvaluateControls(...args),
}));

import { GET as getControls } from '@/app/api/compliance/controls/route';
import { POST as postEvaluations } from '@/app/api/compliance/evaluations/route';
import { GET as getControlEvaluations } from '@/app/api/compliance/controls/[id]/evaluations/route';
import { GET as getControlEvidenceRoute } from '@/app/api/compliance/controls/[id]/evidence/route';
import { GET as getEvaluationEvidenceRoute } from '@/app/api/compliance/evaluations/[id]/evidence/route';
import { GET as getEvidenceCatalogRoute } from '@/app/api/compliance/evidence/route';

describe('Compliance API Routes Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/compliance/controls', () => {
    it('enforces COMPLIANCE_READ capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('You lack compliance.read', 'compliance.read')
      );

      const req = new NextRequest('http://localhost:3000/api/compliance/controls');
      const res = await getControls(req);

      expect(res.status).toBe(403);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.read');
    });

    it('returns controls with current runtime states when authorized', async () => {
      mockAssertCapability.mockResolvedValueOnce({
        id: 'usr-auditor-1',
        email: 'auditor@example.com',
        role: 'AUDITOR',
      });

      mockPrisma.complianceControlState.findMany.mockResolvedValueOnce([
        {
          controlId: 'SEC-ENC-001',
          status: 'IMPLEMENTED',
          latestEvaluationId: 'eval-1',
          evaluatorId: 'encryption.at-rest',
          evaluatorVersion: '1',
          evaluatedAt: new Date('2026-09-19T20:00:00Z'),
          validUntil: null,
          summary: 'All encrypted on active key',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/compliance/controls');
      const res = await getControls(req);

      expect(res.status).toBe(200);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.read');

      const body = await res.json();
      expect(body.data.controls).toBeDefined();
      const encControl = body.data.controls.find((c: { id: string }) => c.id === 'SEC-ENC-001');
      expect(encControl).toBeDefined();
      expect(encControl.runtimeState).toEqual(
        expect.objectContaining({
          status: 'IMPLEMENTED',
          isVersionCurrent: true,
          evaluatorVersion: '1',
        })
      );
    });

    it('falls back to UNVERIFIED if evaluator version in state is outdated', async () => {
      mockPrisma.complianceControlState.findMany.mockResolvedValueOnce([
        {
          controlId: 'SEC-ENC-001',
          status: 'IMPLEMENTED',
          latestEvaluationId: 'eval-old-1',
          evaluatorId: 'encryption.at-rest',
          evaluatorVersion: '0', // Outdated version
          evaluatedAt: new Date('2026-09-19T20:00:00Z'),
          validUntil: null,
          summary: 'Old result',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/compliance/controls');
      const res = await getControls(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      const encControl = body.data.controls.find((c: { id: string }) => c.id === 'SEC-ENC-001');
      expect(encControl.runtimeState.status).toBe('UNVERIFIED');
      expect(encControl.runtimeState.isVersionCurrent).toBe(false);
      expect(encControl.runtimeState.summary).toContain('Evaluator version changed');
    });
  });

  describe('POST /api/compliance/evaluations', () => {
    it('enforces COMPLIANCE_EVALUATE capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('You lack compliance.evaluate', 'compliance.evaluate')
      );

      const req = new NextRequest('http://localhost:3000/api/compliance/evaluations', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await postEvaluations(req);

      expect(res.status).toBe(403);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.evaluate');
    });

    it('successfully triggers evaluation batch with actor info', async () => {
      mockAssertCapability.mockResolvedValueOnce({
        id: 'usr-admin-1',
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'ADMIN',
      });

      const req = new NextRequest('http://localhost:3000/api/compliance/evaluations', {
        method: 'POST',
        body: JSON.stringify({ controlIds: ['SEC-ENC-001'] }),
      });
      const res = await postEvaluations(req);

      expect(res.status).toBe(200);
      expect(mockEvaluateControls).toHaveBeenCalledWith({
        controlIds: ['SEC-ENC-001'],
        trigger: 'API',
        actor: {
          id: 'usr-admin-1',
          email: 'admin@example.com',
          name: 'Admin User',
        },
      });

      const body = await res.json();
      expect(body.data.batchId).toBe('batch-test-123');
      expect(body.data.evaluations).toHaveLength(1);
    });

    it('rejects invalid json payload gracefully', async () => {
      const req = new NextRequest('http://localhost:3000/api/compliance/evaluations', {
        method: 'POST',
        body: 'invalid-json{{{',
      });
      const res = await postEvaluations(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /api/compliance/controls/[id]/evaluations', () => {
    it('returns 404 if control id is not in registry', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/UNKNOWN-999/evaluations'
      );
      const res = await getControlEvaluations(req, {
        params: Promise.resolve({ id: 'UNKNOWN-999' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('returns evaluations history for valid control id', async () => {
      mockPrisma.complianceEvaluation.findMany.mockResolvedValueOnce([
        {
          id: 'eval-1',
          controlId: 'SEC-ENC-001',
          status: 'IMPLEMENTED',
          evaluatedAt: new Date(),
        },
      ]);

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/SEC-ENC-001/evaluations'
      );
      const res = await getControlEvaluations(req, {
        params: Promise.resolve({ id: 'SEC-ENC-001' }),
      });

      expect(res.status).toBe(200);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.read');
      const body = await res.json();
      expect(body.data.controlId).toBe('SEC-ENC-001');
      expect(body.data.evaluations).toHaveLength(1);
    });
  });

  describe('GET /api/compliance/controls/[id]/evidence', () => {
    it('enforces COMPLIANCE_EVIDENCE_READ capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('You lack compliance.evidence.read', 'compliance.evidence.read')
      );

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/SEC-ENC-001/evidence'
      );
      const res = await getControlEvidenceRoute(req, {
        params: Promise.resolve({ id: 'SEC-ENC-001' }),
      });

      expect(res.status).toBe(403);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.evidence.read');
    });

    it('returns 404 for unknown control ID', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/UNKNOWN-001/evidence'
      );
      const res = await getControlEvidenceRoute(req, {
        params: Promise.resolve({ id: 'UNKNOWN-001' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid evidence type parameter', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/SEC-ENC-001/evidence?type=INVALID_TYPE'
      );
      const res = await getControlEvidenceRoute(req, {
        params: Promise.resolve({ id: 'SEC-ENC-001' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('returns evidence records for valid control', async () => {
      mockPrisma.complianceEvidence.findMany.mockResolvedValueOnce([
        {
          id: 'ev-1',
          evaluationId: 'eval-1',
          controlId: 'SEC-ENC-001',
          type: 'VERIFICATION_RESULT',
          collectorId: 'encryption.at-rest',
          collectorVersion: '1',
          title: 'Verification Run',
          description: null,
          resourceType: 'EncryptionMigrationRun',
          resourceId: 'run-1',
          observedAt: new Date(),
          collectedAt: new Date(),
          validUntil: null,
          contentHash: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          metadata: { clean: true },
        },
      ]);

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/controls/SEC-ENC-001/evidence'
      );
      const res = await getControlEvidenceRoute(req, {
        params: Promise.resolve({ id: 'SEC-ENC-001' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.controlId).toBe('SEC-ENC-001');
      expect(body.data.evidence).toHaveLength(1);
      expect(body.data.evidence[0].title).toBe('Verification Run');
    });
  });

  describe('GET /api/compliance/evaluations/[id]/evidence', () => {
    it('enforces COMPLIANCE_EVIDENCE_READ capability', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('You lack compliance.evidence.read', 'compliance.evidence.read')
      );

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/evaluations/eval-1/evidence'
      );
      const res = await getEvaluationEvidenceRoute(req, {
        params: Promise.resolve({ id: 'eval-1' }),
      });

      expect(res.status).toBe(403);
      expect(mockAssertCapability).toHaveBeenCalledWith('compliance.evidence.read');
    });

    it('returns 404 for non-existent evaluation', async () => {
      mockPrisma.complianceEvaluation.findUnique.mockResolvedValueOnce(null);

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/evaluations/non-existent/evidence'
      );
      const res = await getEvaluationEvidenceRoute(req, {
        params: Promise.resolve({ id: 'non-existent' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns evidence records for valid evaluation', async () => {
      mockPrisma.complianceEvaluation.findUnique.mockResolvedValueOnce({
        id: 'eval-1',
        controlId: 'SEC-ENC-001',
      });

      mockPrisma.complianceEvidence.findMany.mockResolvedValueOnce([
        {
          id: 'ev-1',
          evaluationId: 'eval-1',
          controlId: 'SEC-ENC-001',
          type: 'VERIFICATION_RESULT',
          collectorId: 'encryption.at-rest',
          collectorVersion: '1',
          title: 'Verification Run',
          description: null,
          resourceType: null,
          resourceId: null,
          observedAt: new Date(),
          collectedAt: new Date(),
          validUntil: null,
          contentHash: 'sha256:abcd',
          metadata: {},
        },
      ]);

      const req = new NextRequest(
        'http://localhost:3000/api/compliance/evaluations/eval-1/evidence'
      );
      const res = await getEvaluationEvidenceRoute(req, {
        params: Promise.resolve({ id: 'eval-1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.evaluationId).toBe('eval-1');
      expect(body.data.evidence).toHaveLength(1);
    });
  });

  describe('GET /api/compliance/evidence', () => {
    it('returns evidence across controls with pagination', async () => {
      mockPrisma.complianceEvidence.findMany.mockResolvedValueOnce([
        {
          id: 'ev-1',
          evaluationId: 'eval-1',
          controlId: 'SEC-ENC-001',
          type: 'VERIFICATION_RESULT',
          collectorId: 'encryption.at-rest',
          collectorVersion: '1',
          title: 'Evidence 1',
          description: null,
          resourceType: null,
          resourceId: null,
          observedAt: new Date(),
          collectedAt: new Date(),
          validUntil: null,
          contentHash: 'sha256:1111',
          metadata: {},
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/compliance/evidence?limit=10');
      const res = await getEvidenceCatalogRoute(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.evidence).toHaveLength(1);
    });
  });
});
