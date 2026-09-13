# Cyber Resilience Act readiness

Scope: Product security and vulnerability handling.

[Primary source](https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act). Reviewed 2026-09-12. Mapping is by engineering topic; no certification or exhaustive conformity claim.

## SEC-AUTH-001 — OIDC authentication

Status: Implemented. Responsibility: maintainer.

Issuer and subject identity binding, provider configuration and OIDC login are implemented.

Evidence: [src/lib/auth.ts](../../../src/lib/auth.ts), [src/lib/oidc-identity-resolution.ts](../../../src/lib/oidc-identity-resolution.ts).

Remaining: Operator must configure and test their IdP and MFA policy.

## SEC-AUTHZ-001 — Centralized authorization

Status: Implemented. Responsibility: maintainer.

Roles grant capabilities; resource policies restrict scoped access.

Evidence: [src/lib/authorization.ts](../../../src/lib/authorization.ts), [src/lib/authorization-policy.ts](../../../src/lib/authorization-policy.ts), [src/lib/rbac.ts](../../../src/lib/rbac.ts).

Remaining: Operator owns access reviews; registry is not proof that every route is secure.

## SEC-SESSION-001 — Session security

Status: Implemented. Responsibility: maintainer.

JWT sessions use token-version revocation and session-age enforcement. Cookies use SameSite=Lax.

Evidence: [src/lib/auth.ts](../../../src/lib/auth.ts), [src/lib/active-sessions.ts](../../../src/lib/active-sessions.ts).

Remaining: MFA is enforced at the IdP; no native server-verified second factor.

## SEC-ENC-001 — Stored secret encryption

Status: Partial. Responsibility: maintainer.

New protected secrets use AES-256-GCM v3 envelopes. Legacy CBC remains readable.

Evidence: [src/lib/encryption.ts](../../../src/lib/encryption.ts), [docs/v1.5/security/encryption.md](../../../docs/v1.5/security/encryption.md).

Remaining: Legacy ciphertext and plaintext compatibility paths remain; no complete migration claim. Operators retain all keys needed to recover stored data.

## SEC-SBOM-001 — Software bill of materials

Status: Partial. Responsibility: maintainer.

Security workflow generates CycloneDX; release container builds request SBOM and provenance.

Evidence: [.github/workflows/security.yml](../../../.github/workflows/security.yml), [.github/workflows/docker-image.yml](../../../.github/workflows/docker-image.yml).

Remaining: Generation is currently best-effort. Release-specific artifact availability and preservation require verification.

## SEC-SAST-001 — Static security analysis

Status: Partial. Responsibility: maintainer.

CodeQL and security ESLint run in CI.

Evidence: [.github/workflows/security.yml](../../../.github/workflows/security.yml).

Remaining: Scan steps allow errors; production release gating is not established by this configuration.

## SEC-SCA-001 — Dependency vulnerability scanning

Status: Partial. Responsibility: maintainer.

npm audit and Trivy produce findings in the security workflow.

Evidence: [.github/workflows/security.yml](../../../.github/workflows/security.yml).

Remaining: Triage, accepted risk and enforceable vulnerability gates need a later phase.

## SEC-SECRETS-001 — Secret scanning

Status: Partial. Responsibility: maintainer.

TruffleHog scans repository changes.

Evidence: [.github/workflows/security.yml](../../../.github/workflows/security.yml).

Remaining: Best-effort workflow does not prove no secrets exist or that findings were remediated.

## SEC-AUDIT-001 — Audit trail

Status: Partial. Responsibility: maintainer.

AuditLog stores actor snapshots and event details; audit access is capability protected.

Evidence: [src/lib/audit.ts](../../../src/lib/audit.ts), [prisma/schema.prisma](../../../prisma/schema.prisma).

Remaining: Database rows are not immutable storage. PII minimization, external archival and access evidence remain gaps.

## CRA-VULN-001 — Vulnerability disclosure

Status: Partial. Responsibility: maintainer.

A security policy describes reporting and response.

Evidence: [SECURITY.md](../../../SECURITY.md).

Remaining: Maintainers must verify the private reporting channel and record actual handling evidence.

## CRA-SUPPORT-001 — Supported versions

Status: Partial. Responsibility: maintainer.

Security policy supports the latest major version.

Evidence: [SECURITY.md](../../../SECURITY.md).

Remaining: A support period, release-specific EOL decisions and legal applicability assessment require maintainer approval.

## Organizational responsibility

Determine applicability and scope, appoint accountable owners, assess risks, retain operating evidence and obtain independent review where appropriate. This code catalogue does not establish a lawful basis, fulfill all individual rights, issue an attestation, or certify a management system.
