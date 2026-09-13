# General Data Protection Regulation readiness

Scope: Personal data processing and individual rights.

[Primary source](https://eur-lex.europa.eu/eli/reg/2016/679/oj). Reviewed 2026-09-12. Mapping is by engineering topic; no certification or exhaustive conformity claim.

## SEC-AUTHZ-001 — Centralized authorization

Status: Implemented. Responsibility: maintainer.

Roles grant capabilities; resource policies restrict scoped access.

Evidence: [src/lib/authorization.ts](../../../src/lib/authorization.ts), [src/lib/authorization-policy.ts](../../../src/lib/authorization-policy.ts), [src/lib/rbac.ts](../../../src/lib/rbac.ts).

Remaining: Operator owns access reviews; registry is not proof that every route is secure.

## SEC-ENC-001 — Stored secret encryption

Status: Partial. Responsibility: maintainer.

New protected secrets use AES-256-GCM v3 envelopes. Legacy CBC remains readable.

Evidence: [src/lib/encryption.ts](../../../src/lib/encryption.ts), [docs/v1.5/security/encryption.md](../../../docs/v1.5/security/encryption.md).

Remaining: Legacy ciphertext and plaintext compatibility paths remain; no complete migration claim. Operators retain all keys needed to recover stored data.

## SEC-BACKUP-001 — Backup procedures

Status: Implemented. Responsibility: operator.

Documented database and key recovery set, storage protection and RPO/RTO planning.

Evidence: [docs/v1.5/deployment/backup-restore.md](../../../docs/v1.5/deployment/backup-restore.md).

Remaining: Each operator must provide actual encrypted backups, access controls and retention evidence.

## SEC-AUDIT-001 — Audit trail

Status: Partial. Responsibility: maintainer.

AuditLog stores actor snapshots and event details; audit access is capability protected.

Evidence: [src/lib/audit.ts](../../../src/lib/audit.ts), [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: Database rows are not immutable storage. PII minimization, external archival and access evidence remain gaps.

## SEC-RETENTION-001 — Configurable retention

Status: Partial. Responsibility: operator.

Policy provides configurable incident, alert, log and metrics retention.

Evidence: [src/lib/retention-policy.ts](../../../src/lib/retention-policy.ts), [src/lib/cron-scheduler.ts](../../../src/lib/cron-scheduler.ts), [docs/v1.5/administration/data-retention.md](../../../docs/v1.5/administration/data-retention.md).

Remaining: Coverage is not a subject-erasure engine or a legal-hold system. Domain-specific choices remain operator responsibilities.

## PRIV-001 — Deployment privacy notice

Status: Missing. Responsibility: organization.

Self-hosted operators must publish a notice describing their actual processing.

Evidence: [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: An approved deployment-specific notice, legal basis and recipient/transfer assessment are not established by source code.

## PRIV-002 — Data minimization

Status: Partial. Responsibility: organization.

Structured identities coexist with free-text incident content, logs and integration payloads.

Evidence: [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: Optional profile attributes, free text, payload copies and recipient data require a minimization review.

## PRIV-ERASURE-001 — Subject erasure

Status: Missing. Responsibility: maintainer.

No end-to-end subject erasure service is established.

Evidence: [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: Deactivation and relation cascades do not erase every occurrence of personal data. Planned for phases 2/3.

## PRIV-EXPORT-001 — Subject access export

Status: Missing. Responsibility: maintainer.

Operational exports do not constitute a complete subject access export.

Evidence: [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: Request verification, scope review and safe delivery belong to a later phase.

## PRIV-HOLD-001 — Legal holds

Status: Missing. Responsibility: maintainer.

No coordinated legal-hold service is established.

Evidence: [src/lib/retention-policy.ts](../../../src/lib/retention-policy.ts).

Remaining: Policy exceptions and hold-aware retention require a later phase.

## Organizational responsibility

Determine applicability and scope, appoint accountable owners, assess risks, retain operating evidence and obtain independent review where appropriate. This code catalogue does not establish a lawful basis, fulfill all individual rights, issue an attestation, or certify a management system.
