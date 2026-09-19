import type { FrameworkControlMapping } from '../types';

export const iso27701Mappings: readonly FrameworkControlMapping[] = [
  {
    id: 'ISO27701-RET-SECRETENTION001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-RETENTION-DISPOSAL',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Scheduled data retention cleanup provides technical evidence relevant to PII retention and disposal practices under Clause 7.2.8.',
  },
  {
    id: 'ISO27701-RET-PRIVHOLD001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-RETENTION-DISPOSAL',
    controlId: 'PRIV-HOLD-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Runtime legal hold checks provide evidence that active preservation orders suspend automated disposal.',
  },
  {
    id: 'ISO27701-SUBJ-PRIV001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-001',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Deployment privacy notice provides disclosures regarding personal data collection, processing purposes, and principal rights mechanisms.',
  },
  {
    id: 'ISO27701-SUBJ-PRIVERASURE001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure workflow supports fulfillment of PII principal erasure requests under Clause 7.3.3.',
  },
  {
    id: 'ISO27701-SUBJ-PRIVEXPORT001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-EXPORT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Encrypted personal data export supports fulfillment of PII principal access and data portability requests under Clause 7.3.2.',
  },
  {
    id: 'ISO27701-PBD-PRIV002',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PRIVACY-BY-DESIGN',
    controlId: 'PRIV-002',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'ORGANIZATIONAL',
    rationale:
      'Data minimization reviews support Clause 7.4.2 by evaluating whether collected incident payloads and user attributes remain strictly necessary.',
  },
] as const;
