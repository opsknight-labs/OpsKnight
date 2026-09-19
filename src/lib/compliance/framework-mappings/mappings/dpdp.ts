import type { FrameworkControlMapping } from '../types';

export const dpdpMappings: readonly FrameworkControlMapping[] = [
  {
    id: 'DPDP-SEC-PRIVEXPORT001',
    framework: 'DPDP',
    requirementId: 'DPDP-SECURITY-SAFEGUARDS',
    controlId: 'PRIV-EXPORT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Encrypted personal data export generation provides technical evidence of reasonable security safeguards during data extraction and handling.',
  },
  {
    id: 'DPDP-ERASURE-PRIVERASURE001',
    framework: 'DPDP',
    requirementId: 'DPDP-ERASURE',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure engine provides technical evidence supporting fulfillment of Section 12(3) Data Principal erasure requests.',
  },
  {
    id: 'DPDP-ERASURE-PRIV001',
    framework: 'DPDP',
    requirementId: 'DPDP-ERASURE',
    controlId: 'PRIV-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Privacy request management provides administrative tracking for processing and resolving erasure requests from Data Principals.',
  },
  {
    id: 'DPDP-RET-SECRETENTION001',
    framework: 'DPDP',
    requirementId: 'DPDP-RETENTION-SPECIFIED',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Configurable retention policies and automated cleanup provide technical controls ready to enforce Rule 4 erasure upon purpose completion once operative.',
  },
  {
    id: 'DPDP-RET-PRIV002',
    framework: 'DPDP',
    requirementId: 'DPDP-RETENTION-SPECIFIED',
    controlId: 'PRIV-002',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Legal hold management ensures preservation overrides prevent premature data destruction where ongoing legal proceedings require retention.',
  },
] as const;
