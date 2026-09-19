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
      'Scheduled data retention enforcement satisfies PII retention disposal controls in Clause 7.2.8.',
  },
  {
    id: 'ISO27701-RET-PRIV002',
    framework: 'ISO27701',
    requirementId: 'ISO27701-RETENTION-DISPOSAL',
    controlId: 'PRIV-002',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Legal hold exception handling ensures PII preservation obligations override scheduled disposal.',
  },
  {
    id: 'ISO27701-RET-PRIVHOLD001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-RETENTION-DISPOSAL',
    controlId: 'PRIV-HOLD-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Runtime hold checks protect against accidental deletion of PII subject to statutory hold rules.',
  },
  {
    id: 'ISO27701-SUBJ-PRIV001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Privacy request tracking workflow facilitates fulfillment of PII principal access and correction requests.',
  },
  {
    id: 'ISO27701-SUBJ-PRIVERASURE001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure engine executes permanent disposal across registered data domains.',
  },
  {
    id: 'ISO27701-SUBJ-PRIVEXPORT001',
    framework: 'ISO27701',
    requirementId: 'ISO27701-PII-SUBJECT-RIGHTS',
    controlId: 'PRIV-EXPORT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Encrypted personal data export enables fulfillment of PII principal access and data portability requests.',
  },
] as const;
