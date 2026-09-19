import type { ComplianceControlDefinition } from './types';

export const complianceControls: readonly ComplianceControlDefinition[] = [
  {
    id: 'SEC-AUTH-001',
    title: 'OIDC authentication',
    description:
      'Issuer and subject identity binding, provider configuration and OIDC login are implemented.',
    status: 'IMPLEMENTED',
    catalogStatus: 'IMPLEMENTED',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'IMPLEMENTED',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'authorization.rbac',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'GDPR', 'SOC2', 'ISO27001'],
    implementation: 'Roles grant capabilities; resource policies restrict scoped access.',
    evidence: ['src/lib/authorization.ts', 'src/lib/authorization-policy.ts', 'src/lib/rbac.ts'],
    gaps: [
      'Verifies OpsKnight authorization architecture; organizations must review and govern individual user role assignments.',
    ],
  },
  {
    id: 'SEC-SESSION-001',
    title: 'Session security',
    description:
      'JWT sessions use token-version revocation and session-age enforcement. Cookies use SameSite=Lax.',
    status: 'IMPLEMENTED',
    catalogStatus: 'IMPLEMENTED',
    assessmentMode: 'CATALOG',
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
    description:
      'Stored secrets use AES-256-GCM v3 envelope encryption with key-rotation, retirement verification, and tamper-evident authentication.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'encryption.at-rest',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'GDPR', 'SOC2', 'ISO27001'],
    implementation:
      'Protected secrets use AES-256-GCM envelope encryption with non-destructive preview, CAS migration, and verified key-retirement readiness.',
    evidence: [
      'src/lib/encryption.ts',
      'src/lib/encryption/migration.ts',
      'docs/v1.5/security/encryption-migration.md',
    ],
    gaps: [
      'Operators must maintain active encryption keys in the deployment environment and execute verified retirement of old keys.',
    ],
  },
  {
    id: 'SEC-SBOM-001',
    title: 'Software bill of materials',
    description:
      'Security workflow generates CycloneDX; release container builds request SBOM and provenance.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'IMPLEMENTED',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    description:
      'Policy provides configurable incident, alert, log, metrics, and privacy request retention with hold-aware cleanup.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'data.retention',
    owner: 'OPERATOR',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation:
      'Policy provides configurable retention limits enforced by an advisory-locked, hold-aware background cleanup engine.',
    evidence: [
      'src/lib/retention-policy.ts',
      'src/lib/retention/holds.ts',
      'src/lib/data-cleanup.ts',
      'docs/v1.5/administration/data-retention.md',
    ],
    gaps: [
      'Organizations determine their legal retention requirements and domain-specific preservation choices.',
    ],
  },
  {
    id: 'PRIV-001',
    title: 'Deployment privacy notice',
    description: 'Self-hosted operators must publish a notice describing their actual processing.',
    status: 'MISSING',
    catalogStatus: 'MISSING',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    description:
      'End-to-end subject erasure workflow with discovery, manual verification, cascading cleanup, and auditable execution.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'privacy.erasure',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation:
      'Subject erasure execution model evaluates subject discovery, blocks on conflicting retention holds, anonymizes personal data, and logs execution audit records.',
    evidence: [
      'src/lib/privacy/registry.ts',
      'src/lib/privacy/discovery.ts',
      'src/lib/privacy/erasure/execute.ts',
    ],
    gaps: [
      'Operators must verify requester identity and assess conflicting legal-hold obligations before executing destructive erasure.',
    ],
  },
  {
    id: 'PRIV-EXPORT-001',
    title: 'Subject access export',
    description:
      'Subject access export pipeline generates encrypted artifacts with deterministic discovery and time-limited download expiry.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'privacy.export',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701', 'DPDP', 'CCPA'],
    implementation:
      'Privacy request workflow generates password-protected, encrypted subject data exports with automatic artifact retention expiry.',
    evidence: [
      'src/lib/privacy/registry.ts',
      'src/lib/privacy/discovery.ts',
      'src/lib/privacy/export/exporter.ts',
    ],
    gaps: [
      'Operators must verify requester identity and deliver artifacts through secure external channels.',
    ],
  },
  {
    id: 'PRIV-HOLD-001',
    title: 'Legal holds',
    description:
      'OpsKnight provides hold-aware lifecycle protection across user, incident, and privacy-request scopes with conflict fencing.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'RUNTIME',
    evaluatorId: 'privacy.holds',
    owner: 'MAINTAINER',
    frameworks: ['GDPR', 'ISO27701'],
    implementation:
      'DataRetentionHold service coordinates active holds across users, incidents, and privacy requests to block destructive erasure and automated retention cleanup.',
    evidence: ['src/lib/retention/holds.ts', 'src/lib/data-cleanup.ts'],
    gaps: [
      'Organizations determine their legal preservation obligations and establish external hold management procedures.',
    ],
  },
  {
    id: 'CRA-VULN-001',
    title: 'Vulnerability disclosure',
    description: 'A security policy describes reporting and response.',
    status: 'PARTIAL',
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
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
    catalogStatus: 'PARTIAL',
    assessmentMode: 'CATALOG',
    owner: 'MAINTAINER',
    frameworks: ['CRA', 'SOC2', 'ISO27001'],
    implementation: 'Security policy supports the latest major version.',
    evidence: ['SECURITY.md'],
    gaps: [
      'A support period, release-specific EOL decisions and legal applicability assessment require maintainer approval.',
    ],
  },
];
