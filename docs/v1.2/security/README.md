---
order: 7
title: Security
description: Identity, encryption, and secure operations for OpsKnight
---

# Security

This section covers identity management, data encryption, and secure operations for OpsKnight.

## In This Section

| Guide                          | Description                                                           |
| ------------------------------ | --------------------------------------------------------------------- |
| [OIDC SSO Setup](./oidc-setup) | Configure single sign-on with Google, Okta, Azure, and more           |
| [Encryption](./encryption)     | How secrets are encrypted at rest and how to configure the master key |

## Key Concepts

- **Authentication** is handled by NextAuth.js with OIDC support. See [Authentication](./administration/authentication) for the full guide.
- **Encryption at rest** uses AES-256-CBC envelope encryption. The master key is supplied via the `ENCRYPTION_KEY` environment variable.
- **Secrets management** — Never commit `NEXTAUTH_SECRET` or `ENCRYPTION_KEY` to source control. Use a secrets manager in production.

## Related Administration Topics

- [Authentication](./administration/authentication) — Local auth, SSO, sessions, and security settings
- [Audit Logs](./administration/audit-logs) — Security event tracking and compliance
