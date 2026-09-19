import type { FrameworkControlMapping } from '../types';

export const craMappings: readonly FrameworkControlMapping[] = [
  {
    id: 'CRA-SEC-SECAUTH001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-AUTH-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'OIDC authentication and provider identity verification provide technical baseline evidence supporting access control boundaries.',
  },
  {
    id: 'CRA-SEC-SECAUTHZ001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-AUTHZ-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'Centralized RBAC policies support role-scoped access control over system resources and operational endpoints.',
  },
  {
    id: 'CRA-SEC-SECSESSION001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-SESSION-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Token-version revocation and session-age controls contribute technical protection for user sessions.',
  },
  {
    id: 'CRA-SEC-SECENC001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-ENC-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'RUNTIME',
    rationale:
      'AES-256-GCM envelope encryption provides technical evidence of cryptographic protection for stored secrets at rest.',
  },
  {
    id: 'CRA-SEC-SECSECRETS001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-SECRETS-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Automated secret scanning in CI inspects repository commits to detect unencrypted credentials prior to distribution.',
  },
  {
    id: 'CRA-SEC-SECAUDIT001',
    framework: 'CRA',
    requirementId: 'CRA-ANNEX-I-SECURITY',
    controlId: 'SEC-AUDIT-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Audit logging records operational changes and access events with structured actor metadata.',
  },
  {
    id: 'CRA-SBOM-SECSBOM001',
    framework: 'CRA',
    requirementId: 'CRA-SBOM-DOCUMENTATION',
    controlId: 'SEC-SBOM-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'CycloneDX SBOM generation and CI schema validation provide a documented inventory of dependencies and digital components.',
  },
  {
    id: 'CRA-VULN-SECSAST001',
    framework: 'CRA',
    requirementId: 'CRA-VULN-HANDLING',
    controlId: 'SEC-SAST-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Automated static analysis scans codebases to detect security vulnerabilities during development cycles.',
  },
  {
    id: 'CRA-VULN-SECSCA001',
    framework: 'CRA',
    requirementId: 'CRA-VULN-HANDLING',
    controlId: 'SEC-SCA-001',
    relationship: 'TECHNICAL_EVIDENCE',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Software composition analysis scans dependencies against known vulnerability databases to identify unpatched packages.',
  },
  {
    id: 'CRA-VULN-CRAVULN001',
    framework: 'CRA',
    requirementId: 'CRA-VULN-HANDLING',
    controlId: 'CRA-VULN-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Documented vulnerability disclosure policy and SECURITY.md provide reporting and coordinated disclosure channels.',
  },
  {
    id: 'CRA-SUPPORT-CRASUPPORT001',
    framework: 'CRA',
    requirementId: 'CRA-SUPPORT-LIFECYCLE',
    controlId: 'CRA-SUPPORT-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Documented security support period establishes release versioning and patch delivery commitments.',
  },
  {
    id: 'CRA-ART14-CRAVULN001',
    framework: 'CRA',
    requirementId: 'CRA-ART-14-REPORTING',
    controlId: 'CRA-VULN-001',
    relationship: 'PROCESS_SUPPORT',
    evidenceExpectation: 'REPOSITORY',
    rationale:
      'Vulnerability handling procedure establishes intake and evaluation workflows supporting timely notification of severe incidents.',
  },
] as const;
