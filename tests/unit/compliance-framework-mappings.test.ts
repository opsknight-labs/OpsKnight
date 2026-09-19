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
    const dpdpRetentionReq = getFrameworkRequirement('DPDP-RETENTION-SPECIFIED');
    expect(dpdpRetentionReq).toBeDefined();
    expect(dpdpRetentionReq?.effectiveFrom).toBe('2026-11-13');

    // Prior to commencement date
    const beforeDate = new Date('2026-09-19T00:00:00Z');
    expect(resolveRequirementLifecycle(dpdpRetentionReq!, beforeDate)).toBe('FUTURE');

    // After commencement date
    const afterDate = new Date('2026-11-20T00:00:00Z');
    expect(resolveRequirementLifecycle(dpdpRetentionReq!, afterDate)).toBe('ACTIVE');

    // Grievance redressal (18-month staged commencement: 2027-05-13)
    const grievanceReq = getFrameworkRequirement('DPDP-GRIEVANCE-REDRESSAL');
    expect(grievanceReq?.effectiveFrom).toBe('2027-05-13');
    expect(resolveRequirementLifecycle(grievanceReq!, beforeDate)).toBe('FUTURE');
    expect(resolveRequirementLifecycle(grievanceReq!, new Date('2027-06-01T00:00:00Z'))).toBe(
      'ACTIVE'
    );
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
