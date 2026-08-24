---
order: 17
title: Authentication and session security
description: Understand local and OIDC identity, login protection, sessions, revocation, audit evidence, and v1.4 boundaries.
---

# Authentication and session security

OpsKnight v1.4 supports local email/password accounts and one workspace OIDC provider. Authentication establishes identity; workspace/team roles and resource checks separately determine authorization.

For setup and recovery procedures, use [Authentication](../administration/authentication). This page explains the security model and its operational boundaries.

## Supported identity model

| Capability                          | v1.4 behavior                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Local credentials                   | Email plus a bcrypt-hashed password.                                                                    |
| OIDC                                | One configurable generic OIDC provider, with domain, role, profile, provisioning, and linking controls. |
| Sessions                            | Signed/encrypted JWT sessions with token-version revocation.                                            |
| Password recovery                   | One-time, time-limited reset token with uniform request responses.                                      |
| SAML, email magic links, native MFA | Not provided by v1.4. Enforce MFA at the OIDC identity provider or access proxy when required.          |
| Passkeys/WebAuthn login             | Not provided. The optional mobile platform-authenticator prompt is only a client-side privacy screen.   |

Keep at least one tested local break-glass Admin while introducing OIDC, and protect that credential through your external privileged-access process.

## Local password and login protection

New passwords must be 10–128 characters and contain at least one lower-case letter, upper-case letter, number, and supported special character.

Local credential failures are tracked by normalized email plus client IP. Five consecutive failures produce the first lockout; repeated five-attempt groups progress through approximately 1, 5, 15, and 60-minute lockouts. A successful login clears the key, and a record expires after one hour without another failure.

This login-attempt store is process-local memory. It is not shared across replicas and is cleared when a process restarts. Client IP is derived from forwarded request headers, so configure the trusted reverse proxy correctly. For an internet-facing or multi-replica deployment, add independent edge rate limiting and OIDC-provider protections; do not treat the application lockout as the only brute-force control.

Login errors do not deliberately reveal whether the user exists. Preserve that behavior in proxies and custom login integrations.

## Session lifetime and revocation

| Client choice               | Session ceiling |
| --------------------------- | --------------- |
| Web without **Remember me** | 7 days          |
| Web with **Remember me**    | 1 year          |
| Mobile client detection     | 1 year          |

There is no separate configurable idle-timeout policy in v1.4. Session state can refresh during activity, subject to the ceiling.

Session cookies are HTTP-only where appropriate and use `SameSite=Lax`. When `NEXTAUTH_URL` begins with `https://`, OpsKnight enables Secure cookies and secure cookie-name prefixes (`__Host-authjs.csrf-token`, `__Secure-authjs.pkce.code_verifier`, etc.). The public origin and proxy scheme/host forwarding must agree or users can enter a login loop.

**Settings → Security → Revoke all sessions** increments the current user's token version. Password reset, new user onboarding invitation acceptance, user-management security actions, and status checks also increment `tokenVersion` and invalidate active sessions across all devices. Database-backed role/status changes are verified on session validation, ensuring disabled accounts cannot make authenticated requests.

## OIDC identity boundary

An established OIDC identity is bound to normalized issuer plus provider subject, not email alone. First-time linking to an existing account requires a stable subject, an explicitly verified email, administrator provisioning evidence, and an identity not already linked elsewhere. Auto-provisioning strictly requires a verified email claim from the identity provider, preventing unauthorized account creation on unverified IdP accounts.

OIDC role mappings can promote or demote a user on login. Use claims controlled by the identity administrator, restrict auto-provisioning domains, and test both allowed and denied cases. See [OIDC setup](../security/oidc-setup) for the exact workflow.

## Authentication evidence

The application logger records authentication events. Login success, failed/blocked attempts, and selected password/session actions can also write `AuditLog` rows. A database audit-write failure is logged but does not intentionally fail the login flow.

Consequently, the built-in audit table is useful for investigation but is not a guaranteed, immutable authentication ledger. Export durable application logs, restrict database access, set retention, and test each event required by your control framework. See [Audit logs](../administration/audit-logs) and [System logs](../administration/system-logs).

## Production checklist

- [ ] `NEXTAUTH_URL` is the exact external HTTPS origin and trusted proxy headers are correct.
- [ ] `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` are stable, backed up, and identical across replicas.
- [ ] A second local Admin and an independent break-glass procedure are tested.
- [ ] Edge login throttling and IdP MFA are enabled where the threat model requires them.
- [ ] OIDC linking, domain, provisioning, and role mappings are tested with non-Admin accounts.
- [ ] Revoke-all, user disable, password reset, and IdP offboarding are verified.
- [ ] Authentication logs are exported to durable access-controlled storage.

## Related topics

- [Authentication operations](../administration/authentication)
- [Authorization and roles](../security/authorization)
- [OIDC setup](../security/oidc-setup)
- [Encryption](../security/encryption)
- [Audit logs](../administration/audit-logs)
- [Troubleshooting](../troubleshooting)
