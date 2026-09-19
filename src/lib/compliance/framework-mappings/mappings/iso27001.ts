import type { FrameworkControlMapping } from '../types';

export const iso27001Mappings: readonly FrameworkControlMapping[] = [
  {
    id: 'ISO27001-A-SECAUTH001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-ACCESS-CONTROL',
    controlId: 'SEC-AUTH-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Federated OIDC identity authentication provides technical access control evidence satisfying A.5.15 and A.8.2 requirements.',
  },
  {
    id: 'ISO27001-A-SECAUTHZ001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-ACCESS-CONTROL',
    controlId: 'SEC-AUTHZ-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Centralized capability mapping restricts operational privilege and satisfies least-privilege access rules.',
  },
  {
    id: 'ISO27001-A-SECSESSION001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-ACCESS-CONTROL',
    controlId: 'SEC-SESSION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale: 'Session token validation and timeout bounds enforce active session access limits.',
  },
  {
    id: 'ISO27001-A-SECENC001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-CRYPTOGRAPHY',
    controlId: 'SEC-ENC-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'AES-256-GCM envelope encryption and key verification demonstrate compliance with Control A.8.24 cryptographic rules.',
  },
  {
    id: 'ISO27001-A-SECSBOM001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'SEC-SBOM-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Software bill of materials provides component transparency satisfying secure development controls in A.8.25.',
  },
  {
    id: 'ISO27001-A-SECSAST001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'SEC-SAST-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Static code analysis integrated into CI enforces security coding standards prior to production release.',
  },
  {
    id: 'ISO27001-A-SECSCA001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'SEC-SCA-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Automated dependency analysis detects vulnerable libraries and supports technical vulnerability management.',
  },
  {
    id: 'ISO27001-A-SECSECRETS001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'SEC-SECRETS-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Secret detection pre-commit and CI gates safeguard against hardcoded credentials in application sources.',
  },
  {
    id: 'ISO27001-A-CRAVULN001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'CRA-VULN-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Vulnerability handling policy establishes operational response procedures for vulnerability remediation.',
  },
  {
    id: 'ISO27001-A-CRASUPPORT001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-SECURE-DEVELOPMENT',
    controlId: 'CRA-SUPPORT-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Maintenance support policy specifies update frequency and patch management lifecycle.',
  },
  {
    id: 'ISO27001-A-SECBACKUP001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-BACKUP-RECOVERY',
    controlId: 'SEC-BACKUP-001',
    relationship: 'OPERATOR_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Backup operational documentation provides technical baseline; operator must maintain backup copies.',
  },
  {
    id: 'ISO27001-A-SECRESTORE001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-BACKUP-RECOVERY',
    controlId: 'SEC-RESTORE-001',
    relationship: 'OPERATOR_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Disaster recovery procedure provides restoration framework; operator must validate recovery readiness.',
  },
  {
    id: 'ISO27001-A-SECAUDIT001',
    framework: 'ISO27001',
    requirementId: 'ISO27001-A-LOGGING-MONITORING',
    controlId: 'SEC-AUDIT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Audit log generation provides activity records fulfilling Control A.8.15 logging requirements.',
  },
] as const;
