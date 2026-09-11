---
order: 7
title: Security
description: Identity, authorization, encryption, signature verification, and secure operations for OpsKnight
---

# Security

- [Enterprise readiness and assurance](enterprise-readiness.md)
- [Audit evidence checklist](audit-evidence-checklist.md)

This section covers identity management, authorization, cryptographic data protection, webhook signature verification, and secure operations for OpsKnight. These controls can contribute evidence to your security program; installing OpsKnight does not by itself make a deployment compliant with a standard or regulation.

## In This Section

| Guide | Description |
| :--- | :--- |
| [OIDC SSO Setup](./oidc-setup.md) | Configure enterprise OIDC with Microsoft Entra ID, Google Workspace, Okta, Auth0, and strict generic OIDC. |
| [SCIM Provisioning](./scim-provisioning.md) | Provision, update, deactivate, and remove users from the SCIM namespace. |
| [Authorization and Roles](./authorization.md) | Apply workspace roles, team roles, role ownership, and resource authorization safely. |
| [Envelope Encryption](./encryption.md) | Authenticated AES-256-GCM envelope encryption and keyring rotation. |
| [Webhook Verification](./webhook-verification.md) | HMAC-SHA256 signature verification and timing-safe payload validation. |

## Key Concepts

- **Authentication** uses local credentials and/or one workspace OIDC provider. Stable OIDC identity is based on issuer plus subject, not email. See [Authentication](../administration/authentication.md).
- **Lifecycle provisioning** can use SCIM 2.0 Users operations. OIDC authenticates a user; SCIM manages account lifecycle.
- **SSO-only mode** can disable ordinary local credential login while retaining OIDC and an explicitly configured break-glass account.
- **Session revocation** uses user security/token versioning so password reset, account disablement, SCIM deprovisioning, and relevant trust changes can invalidate access.
- **Encryption at rest** uses authenticated AES-256-GCM envelope encryption for protected values. Keys are supplied through `ENCRYPTION_KEYS` or the single-key `ENCRYPTION_KEY` compatibility setting.
- **Signature verification** validates provider-specific tokens or raw-body HMACs when a signature secret is configured. Only modes that include and validate a timestamp provide an application-level replay-age check; use the exact [webhook contract](./webhook-verification.md).

## Authentication boundary

OpsKnight v1.5 does not provide native SAML, passkey/WebAuthn login, email magic-link login, or a native second factor. Enforce MFA through the configured OIDC provider or a trusted access proxy when required. The mobile platform-authenticator prompt is a privacy overlay rather than server authentication.

OpsKnight v1.5 currently supports one OIDC provider configuration per workspace; multi-IdP selection is not part of this release.

## Related Administration Topics

- [Authentication](../administration/authentication.md) — Local auth, SSO-only mode, linking, sessions, and recovery
- [Users](../core-concepts/users.md) — Account status, role ownership, provisioning, and offboarding
- [Configuration Reference](../getting-started/configuration.md) — Authentication and SCIM environment settings
- [Audit Logs](../administration/audit-logs.md) — Supported evidence, retention, and compliance boundaries
