import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';

const { mockAssertCapability, mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    complianceControlState: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    complianceEvidence: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  return {
    mockAssertCapability: vi.fn().mockResolvedValue({ id: 'usr-auditor-1', role: 'AUDITOR' }),
    mockPrisma,
  };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
  prisma: mockPrisma,
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

import { GET as getFrameworks } from '@/app/api/compliance/frameworks/route';
import { GET as getFrameworkById } from '@/app/api/compliance/frameworks/[id]/route';
import { GET as getRequirementsByFramework } from '@/app/api/compliance/frameworks/[id]/requirements/route';
import { GET as getRequirementDetail } from '@/app/api/compliance/frameworks/[id]/requirements/[requirementId]/route';
import { GET as getControlMappings } from '@/app/api/compliance/controls/[id]/framework-mappings/route';

describe('Compliance Framework Mappings API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCapability.mockResolvedValue({ id: 'usr-auditor-1', role: 'AUDITOR' });
  });

  describe('GET /api/compliance/frameworks', () => {
    it('returns all registered frameworks with factual summaries and fingerprint', async () => {
      const res = await getFrameworks();

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.data.frameworks).toBeDefined();
      expect(data.data.frameworks.length).toBe(7);
      expect(data.data.mappingFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Verify no scoring or certification claims exist in output
      const gdprSummary = data.data.frameworks.find(
        (f: { framework: { id: string } }) => f.framework.id === 'GDPR'
      );
      expect(gdprSummary).toBeDefined();
      expect(gdprSummary.score).toBeUndefined();
      expect(gdprSummary.percentage).toBeUndefined();
      expect(gdprSummary.status).toBeUndefined();
      expect(gdprSummary.compliant).toBeUndefined();
    });

    it('enforces RBAC and rejects unauthorized users', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('Insufficient permissions.', CAPABILITIES.COMPLIANCE_READ)
      );

      const res = await getFrameworks();

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Insufficient permissions');
    });
  });

  describe('GET /api/compliance/frameworks/[id]', () => {
    it('returns factual framework summary for known framework', async () => {
      const req = new NextRequest('http://localhost/api/compliance/frameworks/GDPR');
      const res = await getFrameworkById(req, {
        params: Promise.resolve({ id: 'GDPR' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.framework.framework.id).toBe('GDPR');
      expect(data.data.framework.mappedRequirementsCount).toBeGreaterThan(0);
      expect(data.data.framework.mappedControlsCount).toBeGreaterThan(0);
      expect(data.data.mappingFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('returns 404 for unknown framework', async () => {
      const req = new NextRequest('http://localhost/api/compliance/frameworks/UNKNOWN');
      const res = await getFrameworkById(req, {
        params: Promise.resolve({ id: 'UNKNOWN' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('Framework "UNKNOWN" not found');
    });
  });

  describe('GET /api/compliance/frameworks/[id]/requirements', () => {
    it('returns all requirements for framework', async () => {
      const req = new NextRequest('http://localhost/api/compliance/frameworks/GDPR/requirements');
      const res = await getRequirementsByFramework(req, {
        params: Promise.resolve({ id: 'GDPR' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.framework.id).toBe('GDPR');
      expect(data.data.requirements.length).toBeGreaterThan(0);

      const firstReq = data.data.requirements[0];
      expect(firstReq.requirement).toBeDefined();
      expect(firstReq.resolvedLifecycle).toBeDefined();
      expect(firstReq.mappings).toBeDefined();
    });

    it('returns 404 if framework does not exist', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/frameworks/INVALID/requirements'
      );
      const res = await getRequirementsByFramework(req, {
        params: Promise.resolve({ id: 'INVALID' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/compliance/frameworks/[id]/requirements/[requirementId]', () => {
    it('returns requirement detail when requirement belongs to framework', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/frameworks/GDPR/requirements/GDPR-ART-32'
      );
      const res = await getRequirementDetail(req, {
        params: Promise.resolve({ id: 'GDPR', requirementId: 'GDPR-ART-32' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.requirement.requirement.id).toBe('GDPR-ART-32');
      expect(data.data.requirement.requirement.framework).toBe('GDPR');
      expect(data.data.requirement.mappings.length).toBeGreaterThan(0);
    });

    it('returns 404 when requirement exists in different framework', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/frameworks/SOC2/requirements/GDPR-ART-32'
      );
      const res = await getRequirementDetail(req, {
        params: Promise.resolve({ id: 'SOC2', requirementId: 'GDPR-ART-32' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('not found in framework');
    });

    it('returns 404 for nonexistent requirement ID', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/frameworks/GDPR/requirements/NONEXISTENT'
      );
      const res = await getRequirementDetail(req, {
        params: Promise.resolve({ id: 'GDPR', requirementId: 'NONEXISTENT' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/compliance/controls/[id]/framework-mappings', () => {
    it('returns framework mappings for valid control ID', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/controls/SEC-ENC-001/framework-mappings'
      );
      const res = await getControlMappings(req, {
        params: Promise.resolve({ id: 'SEC-ENC-001' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.controlId).toBe('SEC-ENC-001');
      expect(data.data.mappings.length).toBeGreaterThan(0);

      const mapping = data.data.mappings[0];
      expect(mapping.framework).toBeDefined();
      expect(mapping.requirementId).toBeDefined();
      expect(mapping.relationship).toBeDefined();
      expect(mapping.rationale).toBeDefined();
    });

    it('returns 404 for invalid control ID', async () => {
      const req = new NextRequest(
        'http://localhost/api/compliance/controls/INVALID-CTRL/framework-mappings'
      );
      const res = await getControlMappings(req, {
        params: Promise.resolve({ id: 'INVALID-CTRL' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain('Control "INVALID-CTRL" not found');
    });
  });
});
