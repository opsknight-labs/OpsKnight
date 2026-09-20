import { describe, expect, it } from 'vitest';
import { hasCapability, CAPABILITIES, AppRole } from '@/lib/authorization';

describe('Gate 3: RBAC & Permission Boundaries Certification', () => {
  it('validates the complete compliance permission boundary matrix', () => {
    // 1. Verify existence of all continuous compliance capabilities
    expect(CAPABILITIES.COMPLIANCE_READ).toBe('compliance.read');
    expect(CAPABILITIES.COMPLIANCE_EVALUATE).toBe('compliance.evaluate');
    expect(CAPABILITIES.COMPLIANCE_EVIDENCE_READ).toBe('compliance.evidence.read');
    expect(CAPABILITIES.COMPLIANCE_EXPORT).toBe('compliance.export');
    expect(CAPABILITIES.COMPLIANCE_DRIFT_MANAGE).toBe('compliance.drift.manage');

    // 2. Administrator role capabilities
    const adminRole: AppRole = 'ADMIN';
    expect(hasCapability(adminRole, CAPABILITIES.COMPLIANCE_READ)).toBe(true);
    expect(hasCapability(adminRole, CAPABILITIES.COMPLIANCE_EVALUATE)).toBe(true);
    expect(hasCapability(adminRole, CAPABILITIES.COMPLIANCE_EVIDENCE_READ)).toBe(true);
    expect(hasCapability(adminRole, CAPABILITIES.COMPLIANCE_EXPORT)).toBe(true);
    expect(hasCapability(adminRole, CAPABILITIES.COMPLIANCE_DRIFT_MANAGE)).toBe(true);

    // 3. Auditor role capabilities
    const auditorRole: AppRole = 'AUDITOR';
    expect(hasCapability(auditorRole, CAPABILITIES.COMPLIANCE_READ)).toBe(true);
    expect(hasCapability(auditorRole, CAPABILITIES.COMPLIANCE_EVIDENCE_READ)).toBe(true);
    expect(hasCapability(auditorRole, CAPABILITIES.COMPLIANCE_EXPORT)).toBe(true);
    // Auditor cannot mutate state, trigger runtime evaluations, or acknowledge drift
    expect(hasCapability(auditorRole, CAPABILITIES.COMPLIANCE_EVALUATE)).toBe(false);
    expect(hasCapability(auditorRole, CAPABILITIES.COMPLIANCE_DRIFT_MANAGE)).toBe(false);

    // 4. Standard User and Responder role boundaries
    const responderRole: AppRole = 'RESPONDER';
    const userRole: AppRole = 'USER';

    expect(hasCapability(responderRole, CAPABILITIES.COMPLIANCE_READ)).toBe(false);
    expect(hasCapability(responderRole, CAPABILITIES.COMPLIANCE_DRIFT_MANAGE)).toBe(false);
    expect(hasCapability(responderRole, CAPABILITIES.COMPLIANCE_EXPORT)).toBe(false);

    expect(hasCapability(userRole, CAPABILITIES.COMPLIANCE_READ)).toBe(false);
    expect(hasCapability(userRole, CAPABILITIES.COMPLIANCE_EVALUATE)).toBe(false);
    expect(hasCapability(userRole, CAPABILITIES.COMPLIANCE_DRIFT_MANAGE)).toBe(false);
  });
});
