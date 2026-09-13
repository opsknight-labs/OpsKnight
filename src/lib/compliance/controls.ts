import type { ComplianceControl } from './types';

export const complianceControls = [
  {
    id: 'SEC-AUTH-001',
    title: 'OIDC authentication',
    description:
      'Issuer and subject identity binding, provider configuration and OIDC login are implemented.',
    status: 'IMPLEMENTED',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation:
      'Issuer and subject identity binding, provider configuration and OIDC login are implemented.',
    evidence: ['src/lib/auth.ts', 'src/lib/oidc-identity-resolution.ts'],
    gaps: ['Operator must configure and test their IdP and MFA policy.'],
  },
  {
    id: 'SEC-AUTHZ-001',
    title: 'Centralized authorization',
    description: 'Roles grant capabilities; resource policies restrict scoped access.',
    status: 'IMPLEMENTED',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'GDPR', 'SOC2', 'ISO27001'],
    implementation: 'Roles grant capabilities; resource policies restrict scoped access.',
    evidence: ['src/lib/authorization.ts', 'src/lib/authorization-policy.ts', 'src/lib/rbac.ts'],
    gaps: ['Operator owns access reviews; registry is not proof that every route is secure.'],
  },
  {
    id: 'SEC-SESSION-001',
    title: 'Session security',
    description:
      'JWT sessions use token-version revocation and session-age enforcement. Cookies use SameSite=Lax.',
    status: 'IMPLEMENTED',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation:
      'JWT sessions use token-version revocation and session-age enforcement. Cookies use SameSite=Lax.',
    evidence: ['src/lib/auth.ts', 'src/lib/active-sessions.ts'],
    gaps: ['MFA is enforced at the IdP; no native server-verified second factor.'],
  },
  {
    id: 'SEC-ENC-001',
    title: 'Stored secret encryption',
    description: 'New protected secrets use AES-256-GCM v3 envelopes. Legacy CBC remains readable.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'GDPR', 'SOC2', 'ISO27001'],
    implementation:
      'New protected secrets use AES-256-GCM v3 envelopes. Legacy CBC remains readable.',
    evidence: ['src/lib/encryption.ts', 'docs/v1.5/security/encryption.md'],
    gaps: [
      'Legacy ciphertext and plaintext compatibility paths remain; no complete migration claim.',
      'Operators retain all keys needed to recover stored data.',
    ],
  },
  {
    id: 'SEC-SBOM-001',
    title: 'Software bill of materials',
    description:
      'Security workflow generates CycloneDX; release container builds request SBOM and provenance.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation:
      'Security workflow generates CycloneDX; release container builds request SBOM and provenance.',
    evidence: ['.github/workflows/security.yml', '.github/workflows/docker-image.yml'],
    gaps: [
      'Generation is currently best-effort. Release-specific artifact availability and preservation require verification.',
    ],
  },
  {
    id: 'SEC-SAST-001',
    title: 'Static security analysis',
    description: 'CodeQL and security ESLint run in CI.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'CodeQL and security ESLint run in CI.',
    evidence: ['.github/workflows/security.yml'],
    gaps: [
      'Scan steps allow errors; production release gating is not established by this configuration.',
    ],
  },
  {
    id: 'SEC-SCA-001',
    title: 'Dependency vulnerability scanning',
    description: 'npm audit and Trivy produce findings in the security workflow.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'npm audit and Trivy produce findings in the security workflow.',
    evidence: ['.github/workflows/security.yml'],
    gaps: ['Triage, accepted risk and enforceable vulnerability gates need a later phase.'],
  },
  {
    id: 'SEC-SECRETS-001',
    title: 'Secret scanning',
    description: 'TruffleHog scans repository changes.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'TruffleHog scans repository changes.',
    evidence: ['.github/workflows/security.yml'],
    gaps: [
      'Best-effort workflow does not prove no secrets exist or that findings were remediated.',
    ],
  },
  {
    id: 'SEC-BACKUP-001',
    title: 'Backup procedures',
    description:
      'Documented database and key recovery set, storage protection and RPO/RTO planning.',
    status: 'IMPLEMENTED',
    owner: 'OPERATOR',
    frameworks: ['SOC2', 'ISO27001', 'GDPR'],
    implementation:
      'Documented database and key recovery set, storage protection and RPO/RTO planning.',
    evidence: ['docs/v1.5/deployment/backup-restore.md'],
    gaps: [
      'Each operator must provide actual encrypted backups, access controls and retention evidence.',
    ],
  },
  {
    id: 'SEC-RESTORE-001',
    title: 'Restore validation',
    description: 'A CI restore drill and verification script exist.',
    status: 'PARTIAL',
    owner: 'OPERATOR',
    frameworks: ['SOC2', 'ISO27001'],
    implementation: 'A CI restore drill and verification script exist.',
    evidence: ['.github/workflows/enterprise-readiness.yml', 'scripts/verify-backup-restore.sh'],
    gaps: [
      'CI fixtures are not evidence of restoring a production deployment. Scheduled operator drills and measured RPO/RTO remain required.',
    ],
  },
  {
    id: 'SEC-AUDIT-001',
    title: 'Audit trail',
    description:
      'AuditLog stores actor snapshots and event details; audit access is capability protected.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'GDPR', 'SOC2', 'ISO27001'],
    implementation:
      'AuditLog stores actor snapshots and event details; audit access is capability protected.',
    evidence: ['src/lib/audit.ts', 'prisma/schema.prisma'],
    gaps: [
      'Database rows are not immutable storage. PII minimization, external archival and access evidence remain gaps.',
    ],
  },
  {
    id: 'SEC-RETENTION-001',
    title: 'Configurable retention',
    description: 'Policy provides configurable incident, alert, log and metrics retention.',
    status: 'PARTIAL',
    owner: 'OPERATOR',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA', 'SOC2'],
    implementation: 'Policy provides configurable incident, alert, log and metrics retention.',
    evidence: [
      'src/lib/retention-policy.ts',
      'src/lib/cron-scheduler.ts',
      'docs/v1.5/administration/data-retention.md',
    ],
    gaps: [
      'Coverage is not a subject-erasure engine or a legal-hold system. Domain-specific choices remain operator responsibilities.',
    ],
  },
  {
    id: 'PRIV-001',
    title: 'Deployment privacy notice',
    description: 'Self-hosted operators must publish a notice describing their actual processing.',
    status: 'MISSING',
    owner: 'ORGANIZATION',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation:
      'Self-hosted operators must publish a notice describing their actual processing.',
    evidence: ['prisma/schema.prisma'],
    gaps: [
      'An approved deployment-specific notice, legal basis and recipient/transfer assessment are not established by source code.',
    ],
  },
  {
    id: 'PRIV-002',
    title: 'Data minimization',
    description:
      'Structured identities coexist with free-text incident content, logs and integration payloads.',
    status: 'PARTIAL',
    owner: 'ORGANIZATION',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation:
      'Structured identities coexist with free-text incident content, logs and integration payloads.',
    evidence: ['prisma/schema.prisma'],
    gaps: [
      'Optional profile attributes, free text, payload copies and recipient data require a minimization review.',
    ],
  },
  {
    id: 'PRIV-ERASURE-001',
    title: 'Subject erasure',
    description: 'No end-to-end subject erasure service is established.',
    status: 'MISSING',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation: 'No end-to-end subject erasure service is established.',
    evidence: ['prisma/schema.prisma'],
    gaps: [
      'Deactivation and relation cascades do not erase every occurrence of personal data. Planned for phases 2/3.',
    ],
  },
  {
    id: 'PRIV-EXPORT-001',
    title: 'Subject access export',
    description: 'Operational exports do not constitute a complete subject access export.',
    status: 'MISSING',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation: 'Operational exports do not constitute a complete subject access export.',
    evidence: ['prisma/schema.prisma'],
    gaps: ['Request verification, scope review and safe delivery belong to a later phase.'],
  },
  {
    id: 'PRIV-HOLD-001',
    title: 'Legal holds',
    description: 'No coordinated legal-hold service is established.',
    status: 'MISSING',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701', 'SOC2'],
    implementation: 'No coordinated legal-hold service is established.',
    evidence: ['src/lib/retention-policy.ts'],
    gaps: ['Policy exceptions and hold-aware retention require a later phase.'],
  },
  {
    id: 'CRA-VULN-001',
    title: 'Vulnerability disclosure',
    description: 'A security policy describes reporting and response.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'A security policy describes reporting and response.',
    evidence: ['SECURITY.md'],
    gaps: [
      'Maintainers must verify the private reporting channel and record actual handling evidence.',
    ],
  },
  {
    id: 'CRA-SUPPORT-001',
    title: 'Supported versions',
    description: 'Security policy supports the latest major version.',
    status: 'PARTIAL',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'Security policy supports the latest major version.',
    evidence: ['SECURITY.md'],
    gaps: [
      'A support period, release-specific EOL decisions and legal applicability assessment require maintainer approval.',
    ],
  },
] as const satisfies readonly ComplianceControl[];
