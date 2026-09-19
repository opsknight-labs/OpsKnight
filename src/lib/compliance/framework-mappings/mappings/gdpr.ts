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
      'Automated backup procedures support the ability to restore personal data availability and access in a timely manner; operator must verify deployment backups.',
  },
  {
    id: 'GDPR-ART30-SECAUDIT001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-30',
    controlId: 'SEC-AUDIT-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Immutable structured audit logging records administrative actions and processing events relevant to Article 30 records of processing activities.',
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
    id: 'GDPR-ART15-PRIV001',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-15',
    controlId: 'PRIV-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Privacy request management provides workflow infrastructure for logging, tracking, and honoring data subject access requests.',
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
    id: 'GDPR-ART17-PRIV002',
    framework: 'GDPR',
    requirementId: 'GDPR-ART-17',
    controlId: 'PRIV-002',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Legal hold management prevents unauthorized premature erasure when preservation obligations or legal proceedings require data retention.',
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
      'Legal hold awareness in erasure workflows ensures statutory exceptions and preservation orders block automated deletion.',
  },
] as const;
