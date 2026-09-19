import type { FrameworkControlMapping } from '../types';

export const ccpaMappings: readonly FrameworkControlMapping[] = [
  {
    id: 'CCPA-KNOW-PRIVEXPORT001',
    framework: 'CCPA',
    requirementId: 'CCPA-RIGHT-TO-KNOW',
    controlId: 'PRIV-EXPORT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Encrypted personal data export generation provides technical evidence enabling businesses to deliver personal information in response to consumer Right to Know requests.',
  },
  {
    id: 'CCPA-KNOW-PRIV001',
    framework: 'CCPA',
    requirementId: 'CCPA-RIGHT-TO-KNOW',
    controlId: 'PRIV-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Privacy request management workflow provides verification and processing tracking for consumer Right to Know submissions.',
  },
  {
    id: 'CCPA-DELETE-PRIVERASURE001',
    framework: 'CCPA',
    requirementId: 'CCPA-RIGHT-TO-DELETE',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure engine provides technical evidence executing permanent consumer data deletion across registered domains.',
  },
  {
    id: 'CCPA-DELETE-PRIV002',
    framework: 'CCPA',
    requirementId: 'CCPA-RIGHT-TO-DELETE',
    controlId: 'PRIV-002',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Legal hold management ensures statutory deletion exceptions (e.g. security incident detection or legal compliance) prevent unintended deletion.',
  },
  {
    id: 'CCPA-RET-SECRETENTION001',
    framework: 'CCPA',
    requirementId: 'CCPA-RETENTION-LIMITATION',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated retention policy enforcement provides technical evidence demonstrating data is not retained longer than reasonably necessary for disclosed purposes.',
  },
] as const;
