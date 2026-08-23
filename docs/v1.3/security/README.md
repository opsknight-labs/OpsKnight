---
order: 7
title: Security
description: Identity, encryption, signature verification, and secure operations for OpsKnight
---

# Security & Compliance

This section covers identity management, cryptographic data protection, webhook signature verification, and secure operations for OpsKnight.

## In This Section

| Guide | Description |
| :--- | :--- |
| [OIDC SSO Setup](./security/oidc-setup) | Configure single sign-on with Google, Okta, Azure AD, and Keycloak |
| [Envelope Encryption](./security/encryption) | AES-256-CBC envelope encryption for integration secrets and tokens |
| [Webhook Verification](./security/webhook-verification) | HMAC-SHA256 signature verification and timing-safe payload validation |

## Key Concepts

- **Authentication** is handled by NextAuth.js with OIDC support. See [Authentication](./administration/authentication) for the full guide.
- **Encryption at rest** uses AES-256-CBC envelope encryption. The master key is supplied via the `ENCRYPTION_KEY` environment variable.
- **Signature Verification** ensures incoming webhooks from Datadog, GitHub, Sentry, Grafana, and generic webhooks originate from authenticated senders and protects against tampering or replay attacks.

## Related Administration Topics

- [Authentication](./administration/authentication) — Local auth, SSO, sessions, and security settings
- [Audit Logs](./administration/audit-logs) — Security event tracking and compliance
