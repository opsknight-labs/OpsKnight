---
order: 7
title: Security
description: Identity, authorization, encryption, signature verification, and secure operations for OpsKnight
---

# Security

This section covers identity management, authorization, cryptographic data protection, webhook signature verification, and secure operations for OpsKnight. These controls can contribute evidence to your security program; installing OpsKnight does not by itself make a deployment compliant with a standard or regulation.

## In This Section

| Guide                                          | Description                                                           |
| :--------------------------------------------- | :-------------------------------------------------------------------- |
| [OIDC SSO Setup](./oidc-setup)                 | Configure single sign-on with Google, Okta, Azure AD, and Keycloak    |
| [Authorization and Roles](./authorization)     | Apply workspace roles, team roles, and resource ownership safely      |
| [Envelope Encryption](./encryption)            | AES-256-CBC envelope encryption for integration secrets and tokens    |
| [Webhook Verification](./webhook-verification) | HMAC-SHA256 signature verification and timing-safe payload validation |

## Key Concepts

- **Authentication** is handled by NextAuth.js with OIDC support. See [Authentication](../administration/authentication) for the full guide.
- **Encryption at rest** uses AES-256-CBC envelope encryption. The master key is supplied via the `ENCRYPTION_KEY` environment variable.
- **Signature verification** validates provider-specific tokens or raw-body HMACs when a signature secret is configured. Only modes that include and validate a timestamp provide an application-level replay-age check; use the exact [webhook contract](./webhook-verification).

## Authentication boundary

v1.4 does not provide native MFA, passkey/WebAuthn login, SAML, or email magic-link authentication. Enforce MFA through the configured OIDC provider or a trusted access proxy when required. The mobile platform-authenticator prompt is only a privacy overlay.

## Related Administration Topics

- [Authentication](../administration/authentication) — Local auth, SSO, sessions, and security settings
- [Audit Logs](../administration/audit-logs) — Supported evidence, retention, and compliance boundaries
