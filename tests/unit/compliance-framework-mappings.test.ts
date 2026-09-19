// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  getFramework,
  getAllFrameworks,
  getFrameworkRequirements,
  getFrameworkRequirement,
  getMappingsForRequirement,
  getMappingsForControl,
  getFrameworksForControl,
  resolveRequirementLifecycle,
  getFrameworkSummaryView,
  getFrameworkRequirementDetailView,
  getControlFrameworkMappingsView,
} from '@/lib/compliance/framework-mappings';

describe('framework mapping engine (unit)', () => {
  it('retrieves framework definitions and requirements by framework ID', () => {
    const gdpr = getFramework('GDPR');
    expect(gdpr).toBeDefined();
    expect(gdpr?.version).toBe('Regulation (EU) 2016/679');
    expect(gdpr?.authoritativeSource).toBe('EUR-Lex');

    const allFrameworks = getAllFrameworks();
    expect(allFrameworks.length).toBe(7);

    const gdprReqs = getFrameworkRequirements('GDPR');
    expect(gdprReqs.length).toBeGreaterThanOrEqual(4);
    for (const req of gdprReqs) {
      expect(req.framework).toBe('GDPR');
    }

    const art32 = getFrameworkRequirement('GDPR-ART-32');
    expect(art32).toBeDefined();
    expect(art32?.reference).toBe('Article 32');
    expect(art32?.title).toBe('Security of Processing');
  });

  it('safely handles unknown framework and requirement IDs', () => {
    expect(getFramework('UNKNOWN' as never)).toBeUndefined();
    expect(getFrameworkRequirements('UNKNOWN' as never)).toEqual([]);
    expect(getFrameworkRequirement('NON-EXISTENT')).toBeUndefined();
    expect(getMappingsForRequirement('NON-EXISTENT')).toEqual([]);
    expect(getMappingsForControl('NON-EXISTENT')).toEqual([]);
    expect(getFrameworksForControl('NON-EXISTENT')).toEqual([]);
    expect(getFrameworkSummaryView('UNKNOWN' as never)).toBeUndefined();
  });

  it('retrieves mappings for controls with bidirectional accuracy', () => {
    const encMappings = getMappingsForControl('SEC-ENC-001');
    expect(encMappings.length).toBe(4);

    const mappedFrameworks = getFrameworksForControl('SEC-ENC-001');
    expect(mappedFrameworks).toEqual(expect.arrayContaining(['GDPR', 'CRA', 'SOC2', 'ISO27001']));

    const art32Mappings = getMappingsForRequirement('GDPR-ART-32');
    const controlIds = art32Mappings.map(m => m.controlId);
    expect(controlIds).toEqual(
      expect.arrayContaining(['SEC-ENC-001', 'SEC-AUTHZ-001', 'SEC-BACKUP-001'])
    );
  });

  it('resolves DPDP lifecycle dynamically based on reference dates', () => {
    const dpdpReqIds = [
      'DPDP-SECURITY-SAFEGUARDS',
      'DPDP-RETENTION-SPECIFIED',
      'DPDP-ERASURE',
      'DPDP-GRIEVANCE-REDRESSAL',
    ] as const;

    const beforeDate = new Date('2026-09-19T00:00:00Z');
    const afterDate = new Date('2027-06-01T00:00:00Z');

    for (const id of dpdpReqIds) {
      const req = getFrameworkRequirement(id);
      expect(req).toBeDefined();
      expect(req?.effectiveFrom).toBe('2027-05-13');
      expect(resolveRequirementLifecycle(req!, beforeDate)).toBe('FUTURE');
      expect(resolveRequirementLifecycle(req!, afterDate)).toBe('ACTIVE');
    }
  });

  it('resolves CRA lifecycle dynamically distinguishing Article 14 from substantive obligations', () => {
    const art14 = getFrameworkRequirement('CRA-ART-14-REPORTING');
    expect(art14).toBeDefined();
    expect(art14?.effectiveFrom).toBe('2026-09-11');

    // Article 14 active today (post 11 Sep 2026)
    const today = new Date('2026-09-19T00:00:00Z');
    expect(resolveRequirementLifecycle(art14!, today)).toBe('ACTIVE');
    expect(resolveRequirementLifecycle(art14!, new Date('2026-08-01T00:00:00Z'))).toBe('FUTURE');

    // Substantive obligations (Annex I, SBOM, Vuln Handling, Support) apply from 2027-12-11
    const substantiveIds = [
      'CRA-ANNEX-I-SECURITY',
      'CRA-VULN-HANDLING',
      'CRA-SBOM-DOCUMENTATION',
      'CRA-SUPPORT-LIFECYCLE',
    ] as const;

    for (const id of substantiveIds) {
      const req = getFrameworkRequirement(id);
      expect(req).toBeDefined();
      expect(req?.effectiveFrom).toBe('2027-12-11');
      expect(resolveRequirementLifecycle(req!, today)).toBe('FUTURE');
      expect(resolveRequirementLifecycle(req!, new Date('2028-01-01T00:00:00Z'))).toBe('ACTIVE');
    }
  });

  it('resolves ISO 27701:2019 legacy requirements as SUPERSEDED following withdrawal', () => {
    const iso27701ReqIds = [
      'ISO27701-PII-SECURITY',
      'ISO27701-RETENTION-DISPOSAL',
      'ISO27701-PII-SUBJECT-RIGHTS',
      'ISO27701-PRIVACY-BY-DESIGN',
    ] as const;

    const today = new Date('2026-09-19T00:00:00Z');

    for (const id of iso27701ReqIds) {
      const req = getFrameworkRequirement(id);
      expect(req).toBeDefined();
      expect(req?.effectiveUntil).toBe('2025-10-14');
      expect(resolveRequirementLifecycle(req!, today)).toBe('SUPERSEDED');
    }

    const isoFramework = getFramework('ISO27701');
    expect(isoFramework?.version).toContain('withdrawn');
    expect(isoFramework?.version).toContain('superseded by ISO/IEC 27701:2025');
  });

  it('computes factual framework inventory counts without scores or percentages', () => {
    const summary = getFrameworkSummaryView('GDPR');
    expect(summary).toBeDefined();
    expect(summary?.mappedRequirementsCount).toBeGreaterThanOrEqual(4);
    expect(summary?.mappedControlsCount).toBeGreaterThanOrEqual(5);
    expect(summary?.runtimeBackedCount).toBeGreaterThan(0);
    expect(summary?.operatorDependencyCount).toBeGreaterThan(0);

    // Explicitly assert lack of score, percentage, or pass/fail
    const summaryObj = summary as unknown as Record<string, unknown>;
    expect(summaryObj.score).toBeUndefined();
    expect(summaryObj.percentage).toBeUndefined();
    expect(summaryObj.status).toBeUndefined();
    expect(summaryObj.compliant).toBeUndefined();
  });

  it('builds detailed requirement view preserving independent control states without collapsing', async () => {
    const mockPrisma = {
      complianceControlState: {
        findUnique: ({ where }: { where: { controlId: string } }) => {
          if (where.controlId === 'SEC-ENC-001') {
            return Promise.resolve({
              controlId: 'SEC-ENC-001',
              status: 'IMPLEMENTED',
              evaluatorId: 'encryption.at-rest',
              evaluatorVersion: '1',
              summary: 'Stored-secret verification passed.',
              evaluatedAt: new Date('2026-09-19T12:00:00Z'),
              latestEvaluationId: 'eval-enc-1',
              validUntil: null,
            });
          }
          if (where.controlId === 'SEC-AUTHZ-001') {
            return Promise.resolve({
              controlId: 'SEC-AUTHZ-001',
              status: 'ACTION_REQUIRED',
              evaluatorId: 'authorization.rbac',
              evaluatorVersion: '1',
              summary: 'Authorization policy review required.',
              evaluatedAt: new Date('2026-09-19T13:00:00Z'),
              latestEvaluationId: 'eval-authz-1',
              validUntil: null,
            });
          }
          return Promise.resolve(null);
        },
      },
      complianceEvidence: {
        findMany: () => Promise.resolve([]),
      },
    };

    const detailView = await getFrameworkRequirementDetailView('GDPR-ART-32', {
      prisma: mockPrisma as never,
    });

    expect(detailView).toBeDefined();
    expect(detailView?.requirement.id).toBe('GDPR-ART-32');
    expect(detailView?.mappings.length).toBeGreaterThanOrEqual(3);

    const encMapping = detailView?.mappings.find(m => m.controlId === 'SEC-ENC-001');
    expect(encMapping?.runtimeState?.status).toBe('IMPLEMENTED');

    const authzMapping = detailView?.mappings.find(m => m.controlId === 'SEC-AUTHZ-001');
    expect(authzMapping?.runtimeState?.status).toBe('ACTION_REQUIRED');

    // Both controls must preserve their own individual status — NOT collapsed to a requirement status
    const detailViewObj = detailView as unknown as Record<string, unknown>;
    expect(detailViewObj.status).toBeUndefined();
    expect(detailViewObj.compliance).toBeUndefined();
  });

  it('resolves runtime status to UNVERIFIED if evaluation validUntil is expired', async () => {
    const mockPrisma = {
      complianceControlState: {
        findUnique: () =>
          Promise.resolve({
            controlId: 'SEC-ENC-001',
            status: 'IMPLEMENTED',
            evaluatorId: 'encryption.at-rest',
            evaluatorVersion: '1',
            summary: 'Stored-secret verification passed.',
            evaluatedAt: new Date('2026-09-18T12:00:00Z'),
            latestEvaluationId: 'eval-enc-old',
            validUntil: new Date('2026-09-19T10:00:00Z'), // Expired relative to query time below
          }),
      },
      complianceEvidence: {
        findMany: () => Promise.resolve([]),
      },
    };

    const detailView = await getFrameworkRequirementDetailView('GDPR-ART-32', {
      prisma: mockPrisma as never,
      now: new Date('2026-09-19T12:00:00Z'),
    });

    const encMapping = detailView?.mappings.find(m => m.controlId === 'SEC-ENC-001');
    expect(encMapping?.runtimeState?.status).toBe('UNVERIFIED');
    expect(encMapping?.runtimeState?.summary).toContain('Evaluation validity expired');
    expect(encMapping?.runtimeState?.isVersionCurrent).toBe(false);
  });

  it('resolves runtime status to UNVERIFIED if evaluatorVersion does not match current evaluator', async () => {
    const mockPrisma = {
      complianceControlState: {
        findUnique: () =>
          Promise.resolve({
            controlId: 'SEC-ENC-001',
            status: 'IMPLEMENTED',
            evaluatorId: 'encryption.at-rest',
            evaluatorVersion: '0', // Current active version is '1'
            summary: 'Stored-secret verification passed under older evaluator.',
            evaluatedAt: new Date('2026-09-19T12:00:00Z'),
            latestEvaluationId: 'eval-enc-v0',
            validUntil: null,
          }),
      },
      complianceEvidence: {
        findMany: () => Promise.resolve([]),
      },
    };

    const detailView = await getFrameworkRequirementDetailView('GDPR-ART-32', {
      prisma: mockPrisma as never,
    });

    const encMapping = detailView?.mappings.find(m => m.controlId === 'SEC-ENC-001');
    expect(encMapping?.runtimeState?.status).toBe('UNVERIFIED');
    expect(encMapping?.runtimeState?.summary).toContain('Evaluator version changed');
    expect(encMapping?.runtimeState?.isVersionCurrent).toBe(false);
  });

  it('returns control framework mappings view for control detail pages', () => {
    const view = getControlFrameworkMappingsView('SEC-ENC-001');
    expect(view.length).toBe(4);

    const gdprItem = view.find(v => v.framework === 'GDPR');
    expect(gdprItem).toBeDefined();
    expect(gdprItem?.requirementTitle).toBe('Security of Processing');
    expect(gdprItem?.reference).toBe('Article 32');
    expect(gdprItem?.relationship).toBe('TECHNICAL_EVIDENCE');
  });
});
