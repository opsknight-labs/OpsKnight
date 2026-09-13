# Digital Personal Data Protection readiness

Scope: India; applicability and commencement require organizational assessment.

[Primary source](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa). Reviewed 2026-09-12. Mapping is by engineering topic; no certification or exhaustive conformity claim.

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

## Organizational responsibility

Determine applicability and scope, appoint accountable owners, assess risks, retain operating evidence and obtain independent review where appropriate. This code catalogue does not establish a lawful basis, fulfill all individual rights, issue an attestation, or certify a management system.
