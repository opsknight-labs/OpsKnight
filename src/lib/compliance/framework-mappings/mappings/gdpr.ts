import type { FrameworkControlMapping } from '../types';

export const gdprMappings: readonly FrameworkControlMapping[] = [
  {
    id: 'GDPR-ART32-SECENC001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-32',
    controlId: 'SEC-ENC-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Stored-secret AES-256-GCM envelope encryption and key verification provide technical evidence relevant to Article 32 security of processing and confidentiality safeguards.',
  },
  {
    id: 'GDPR-ART32-SECAUTHZ001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-32',
    controlId: 'SEC-AUTHZ-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Centralized RBAC and scoped resource policies provide technical evidence restricting access to personal data to authorized roles.',
  },
  {
    id: 'GDPR-ART32-SECBACKUP001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-32',
    controlId: 'SEC-BACKUP-001',
    relationship: 'OPERATOR_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Documented backup procedures support restoration planning; operators must implement and verify deployment backups.',
  },
  {
    id: 'GDPR-ART32-SECAUDIT001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-32',
    controlId: 'SEC-AUDIT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Audit logging records administrative actions and operational events, supporting Article 32 access monitoring and security accountability.',
  },
  {
    id: 'GDPR-ART13-PRIV001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-13',
    controlId: 'PRIV-001',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Deployment privacy notice documentation provides transparency regarding personal data processing purposes, legal bases, and data subject rights channels.',
  },
  {
    id: 'GDPR-ART51E-SECRETENTION001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-5-1-E',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Scheduled data cleanup and configurable retention policies provide technical evidence supporting Article 5(1)(e) storage limitation principles.',
  },
  {
    id: 'GDPR-ART51C-PRIV002',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-5-1-C',
    controlId: 'PRIV-002',
    relationship: 'ORGANIZATIONAL_DEPENDENCY',
    evidenceExpectation: 'ORGANIZATIONAL',
    rationale:
      'Data minimization reviews support Article 5(1)(c) by evaluating whether collected incident and user attributes remain strictly necessary for operational needs.',
  },
  {
    id: 'GDPR-ART15-PRIVEXPORT001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-15',
    controlId: 'PRIV-EXPORT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Encrypted portable export generation provides technical evidence enabling data subjects to receive personal data undergoing processing.',
  },
  {
    id: 'GDPR-ART17-PRIVERASURE001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-17',
    controlId: 'PRIV-ERASURE-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Automated personal data erasure engine executes permanent deletion across registered data domains upon request.',
  },
  {
    id: 'GDPR-ART17-PRIVHOLD001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-17',
    controlId: 'PRIV-HOLD-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Runtime legal hold checks provide technical evidence that active preservation orders suspend automated erasure routines.',
  },
] as const;
