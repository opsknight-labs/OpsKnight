import type { FrameworkControlMapping } from '../types';

export const soc2Mappings: readonly FrameworkControlMapping[] = [
  {
    id: 'SOC2-CC6-SECAUTH001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC6-LOGICAL-ACCESS',
    controlId: 'SEC-AUTH-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'OIDC federated authentication enforces identity binding before granting access to system assets.',
  },
  {
    id: 'SOC2-CC6-SECAUTHZ001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC6-LOGICAL-ACCESS',
    controlId: 'SEC-AUTHZ-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Role-based capability assignment restricts logical access to authorized administrative and user roles.',
  },
  {
    id: 'SOC2-CC6-SECSESSION001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC6-LOGICAL-ACCESS',
    controlId: 'SEC-SESSION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Session lifetime bounds and token-version invalidation ensure prompt revocation of terminated sessions.',
  },
  {
    id: 'SOC2-CC6-SECRETENTION001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC6-LOGICAL-ACCESS',
    controlId: 'SEC-RETENTION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Configurable data retention policies ensure logical records are pruned when no longer required.',
  },
  {
    id: 'SOC2-CC6-SECENC001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC6-ENCRYPTION',
    controlId: 'SEC-ENC-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Envelope encryption protects credentials and sensitive application tokens in persistent storage.',
  },
  {
    id: 'SOC2-CC7-SECAUDIT001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC7-SYSTEM-OPERATIONS',
    controlId: 'SEC-AUDIT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Operational audit trail logs security configuration changes, user management, and incident activities.',
  },
  {
    id: 'SOC2-CC7-CRAVULN001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC7-SYSTEM-OPERATIONS',
    controlId: 'CRA-VULN-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Vulnerability handling procedure establishes operational response paths for newly discovered security flaws.',
  },
  {
    id: 'SOC2-CC8-SECSBOM001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC8-CHANGE-MANAGEMENT',
    controlId: 'SEC-SBOM-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'SBOM validation certifies all software components incorporated during change cycles are catalogued.',
  },
  {
    id: 'SOC2-CC8-SECSAST001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC8-CHANGE-MANAGEMENT',
    controlId: 'SEC-SAST-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Automated code scanning prevents unverified vulnerabilities from advancing through deployment pipelines.',
  },
  {
    id: 'SOC2-CC8-SECSCA001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC8-CHANGE-MANAGEMENT',
    controlId: 'SEC-SCA-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Continuous SCA scanning gates dependency changes against known security vulnerabilities.',
  },
  {
    id: 'SOC2-CC8-SECSECRETS001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC8-CHANGE-MANAGEMENT',
    controlId: 'SEC-SECRETS-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Secret detection hooks prevent unencrypted secrets from being committed into release artifacts.',
  },
  {
    id: 'SOC2-CC8-CRASUPPORT001',
    framework: 'SOC2',
    requirementId: 'SOC2-CC8-CHANGE-MANAGEMENT',
    controlId: 'CRA-SUPPORT-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Documented release lifecycle governs controlled deployment of versioned software changes.',
  },
  {
    id: 'SOC2-A1-SECBACKUP001',
    framework: 'SOC2',
    requirementId: 'SOC2-A1-AVAILABILITY',
    controlId: 'SEC-BACKUP-001',
    relationship: 'OPERATOR_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Database backup procedures provide availability baseline; operator must maintain backup routines.',
  },
  {
    id: 'SOC2-A1-SECRESTORE001',
    framework: 'SOC2',
    requirementId: 'SOC2-A1-AVAILABILITY',
    controlId: 'SEC-RESTORE-001',
    relationship: 'OPERATOR_DEPENDENCY',
    evidenceExpectation: 'OPERATOR',
    rationale:
      'Database restoration documentation enables recovery; operator must execute periodic restoration drills.',
  },
  {
    id: 'SOC2-A1-PRIVHOLD001',
    framework: 'SOC2',
    requirementId: 'SOC2-A1-AVAILABILITY',
    controlId: 'PRIV-HOLD-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Legal hold protection prevents accidental or malicious loss of records required for ongoing availability obligations.',
  },
] as const;
