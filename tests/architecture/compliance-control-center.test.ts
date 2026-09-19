import { describe, it, expect } from 'vitest';
import { getComplianceControlCenterData } from '@/lib/compliance/control-center';

describe('compliance control center architecture contract', () => {
  it('strictly forbids compliance pass/fail, percentage or certification wording in models', async () => {
    const forbiddenKeywords = ['COMPLIANT', 'CERTIFIED', 'PASSED', 'FAILED', 'SCORE', 'PERCENTAGE'];

    const mockPrisma = {
      complianceControlState: {
        findMany: () => Promise.resolve([]),
      },
      complianceEvidence: {
        findMany: () => Promise.resolve([]),
      },
    };

    const overview = await getComplianceControlCenterData({
      prisma: mockPrisma as never,
    });

    const overviewRecord = overview as unknown as Record<string, unknown>;

    for (const kw of forbiddenKeywords) {
      expect(overviewRecord[kw.toLowerCase()]).toBeUndefined();
      expect(overviewRecord[kw]).toBeUndefined();
    }

    expect(overview.runtime).toBeDefined();
    expect(overview.attention).toBeDefined();
    expect(overview.evidence).toBeDefined();
    expect(overview.frameworks).toBeDefined();
  });

  it('guarantees control center DTO is strictly free of personally identifiable user data', async () => {
    const mockPrisma = {
      complianceControlState: {
        findMany: () => Promise.resolve([]),
      },
      complianceEvidence: {
        findMany: () => Promise.resolve([]),
      },
    };

    const overview = await getComplianceControlCenterData({
      prisma: mockPrisma as never,
    });

    const serialized = JSON.stringify(overview).toLowerCase();

    // Must not contain PII fields or privacy search endpoints
    expect(serialized).not.toContain('"email"');
    expect(serialized).not.toContain('"password"');
    expect(serialized).not.toContain('"users"');
    expect(serialized).not.toContain('"discoversubjectdata"');
  });
});
