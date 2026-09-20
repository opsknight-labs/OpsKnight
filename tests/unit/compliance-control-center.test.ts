import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getComplianceControlCenterData } from '@/lib/compliance/control-center';
import { CAPABILITIES } from '@/lib/authorization';

const { mockAssertCapability, mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    complianceControlState: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    complianceEvidence: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
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

import { GET as getControlCenterRoute } from '@/app/api/compliance/control-center/route';

describe('compliance control center read model (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCapability.mockResolvedValue({ id: 'usr-auditor-1', role: 'AUDITOR' });
  });

  it('builds unified control center overview with factual inventories and zero score', async () => {
    mockPrisma.complianceControlState.findMany.mockResolvedValue([
      {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1',
        summary: 'Stored-secret verification passed.',
        evaluatedAt: new Date('2026-09-19T12:00:00Z'),
        latestEvaluationId: 'eval-enc-1',
        validUntil: null,
      },
      {
        controlId: 'SEC-RETENTION-001',
        status: 'ACTION_REQUIRED',
        evaluatorId: 'data.retention',
        evaluatorVersion: '1',
        summary: 'Retention settings require operator action.',
        evaluatedAt: new Date('2026-09-19T12:00:00Z'),
        latestEvaluationId: 'eval-ret-1',
        validUntil: null,
      },
    ]);

    mockPrisma.complianceEvidence.findMany.mockResolvedValue([]);
    mockPrisma.complianceEvidence.count.mockResolvedValue(0);
    mockPrisma.complianceEvidence.groupBy.mockResolvedValue([]);

    const data = await getComplianceControlCenterData({
      prisma: mockPrisma as never,
      now: new Date('2026-09-20T00:00:00Z'),
    });

    expect(data).toBeDefined();
    expect(data.runtime.total).toBe(6);
    expect(data.runtime.implemented).toBe(1);
    expect(data.runtime.actionRequired).toBe(1);
    expect(data.runtime.unverified).toBe(4);

    expect(data.frameworks.count).toBe(7);
    expect(data.frameworks.activeRequirements).toBeGreaterThan(0);
    expect(data.frameworks.futureRequirements).toBeGreaterThan(0);
    expect(data.frameworks.supersededRequirements).toBeGreaterThan(0);

    // Retention policy included
    expect(data.retentionPolicy).toBeDefined();
    expect(data.retentionPolicy.logRetentionDays).toBeGreaterThan(0);

    // Evidence integrity sample
    expect(data.evidence.integritySample).toBeDefined();
    expect(data.evidence.integritySample.checkedRecords).toBe(0);
    expect(data.evidence.integritySample.mismatches).toBe(0);

    // Assert lack of synthetic scores or percentages
    const dataObj = data as unknown as Record<string, unknown>;
    expect(dataObj.score).toBeUndefined();
    expect(dataObj.percentage).toBeUndefined();
    expect(dataObj.status).toBeUndefined();
    expect(dataObj.compliance).toBeUndefined();

    // Attention required contains SEC-RETENTION-001
    const retAttention = data.attention.find(a => a.controlId === 'SEC-RETENTION-001');
    expect(retAttention).toBeDefined();
    expect(retAttention?.type).toBe('ACTION_REQUIRED');
    expect(retAttention?.severity).toBe('HIGH');
  });

  it('falls back to UNVERIFIED for controls with expired validity or changed evaluator version', async () => {
    mockPrisma.complianceControlState.findMany.mockResolvedValue([
      {
        controlId: 'SEC-ENC-001',
        status: 'IMPLEMENTED',
        evaluatorId: 'encryption.at-rest',
        evaluatorVersion: '1',
        summary: 'Old validUntil evaluation.',
        evaluatedAt: new Date('2026-09-18T12:00:00Z'),
        latestEvaluationId: 'eval-old-1',
        validUntil: new Date('2026-09-19T10:00:00Z'), // Expired relative to now
      },
      {
        controlId: 'SEC-RETENTION-001',
        status: 'IMPLEMENTED',
        evaluatorId: 'data.retention',
        evaluatorVersion: '0', // Mismatch vs active version 1
        summary: 'Old evaluator evaluation.',
        evaluatedAt: new Date('2026-09-18T12:00:00Z'),
        latestEvaluationId: 'eval-old-2',
        validUntil: null,
      },
    ]);

    const data = await getComplianceControlCenterData({
      prisma: mockPrisma as never,
      now: new Date('2026-09-20T00:00:00Z'),
    });

    const encControl = data.controls.find(c => c.controlId === 'SEC-ENC-001');
    expect(encControl?.runtime?.status).toBe('UNVERIFIED');
    expect(encControl?.runtime?.summary).toContain('Evaluation validity expired');

    const retControl = data.controls.find(c => c.controlId === 'SEC-RETENTION-001');
    expect(retControl?.runtime?.status).toBe('UNVERIFIED');
    expect(retControl?.runtime?.summary).toContain('Evaluator version changed');
  });

  it('strictly contains no PII or raw secret material in controls DTO', async () => {
    const data = await getComplianceControlCenterData({
      prisma: mockPrisma as never,
      now: new Date('2026-09-20T00:00:00Z'),
    });

    for (const ctrl of data.controls) {
      const obj = ctrl as unknown as Record<string, unknown>;
      expect(obj.email).toBeUndefined();
      expect(obj.password).toBeUndefined();
      expect(obj.secret).toBeUndefined();
      expect(obj.subjectData).toBeUndefined();
    }
  });

  it('GET /api/compliance/control-center enforces COMPLIANCE_READ RBAC', async () => {
    const res = await getControlCenterRoute();
    expect(res.status).toBe(200);
    expect(mockAssertCapability).toHaveBeenCalledWith(CAPABILITIES.COMPLIANCE_READ);

    const json = await res.json();
    expect(json.data.runtime).toBeDefined();
    expect(json.data.attention).toBeDefined();
  });
});
