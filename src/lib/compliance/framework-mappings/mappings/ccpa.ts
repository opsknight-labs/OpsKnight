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
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Deployment privacy notice documentation provides Notice at Collection disclosures detailing personal information categories and consumer rights mechanisms.',
  },
  {
    id: 'CCPA-DELETE-PRIVERASURE001',
    framework: 'CCPA',
    requirementId: 'CCPA-RIGHT-TO-DELETE',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure engine provides technical evidence executing permanent consumer data deletion across registered domains upon verified request.',
  },
  {
    id: 'CCPA-RET-PRIV002',
    framework: 'CCPA',
    requirementId: 'CCPA-RETENTION-LIMITATION',
    controlId: 'PRIV-002',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'ORGANIZATIONAL',
    rationale:
      'Data minimization reviews support proportionality principles by evaluating whether collected incident attributes remain reasonably necessary for operational purposes.',
  },
  {
    id: 'CCPA-RET-SECRETENTION001',
    framework: 'CCPA',
    requirementId: 'CCPA-RETENTION-LIMITATION',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated retention policy enforcement provides technical evidence supporting data retention limitation and proportionality rules.',
  },
] as const;
