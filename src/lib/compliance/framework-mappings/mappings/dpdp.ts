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
      'Encrypted personal data export generation provides technical evidence supporting security safeguards during data extraction and handling.',
  },
  {
    id: 'DPDP-ERASURE-PRIVERASURE001',
    framework: 'DPDP',
    requirementId: 'DPDP-ERASURE',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure workflow provides technical evidence supporting fulfillment of Section 12(3) Data Principal erasure requests.',
  },
  {
    id: 'DPDP-ERASURE-PRIV001',
    framework: 'DPDP',
    requirementId: 'DPDP-ERASURE',
    controlId: 'PRIV-001',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Deployment privacy notice provides disclosures to Data Principals describing available erasure request mechanisms and organizational contacts.',
  },
  {
    id: 'DPDP-RET-SECRETENTION001',
    framework: 'DPDP',
    requirementId: 'DPDP-RETENTION-SPECIFIED',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Configurable retention policies and automated cleanup provide technical controls supporting Rule 8 erasure obligations upon purpose completion.',
  },
  {
    id: 'DPDP-RET-PRIV002',
    framework: 'DPDP',
    requirementId: 'DPDP-RETENTION-SPECIFIED',
    controlId: 'PRIV-002',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'ORGANIZATIONAL',
    rationale:
      'Data minimization reviews support purpose limitation by evaluating stored incident and profile attributes against operational necessity.',
  },
] as const;
