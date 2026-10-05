---
title: Authentication
description: Understand OpsKnight local credentials, OIDC federation, identity linking, session enforcement, and emergency access.
type: concept
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-05
  evidence:
    - src/lib/auth.ts
    - src/lib/local-auth-policy.ts
    - src/lib/oidc.ts
    - src/lib/oidc-validation.ts
    - src/lib/oidc-identity-resolution.ts
    - src/lib/oidc-linking-approval.ts
---

# Authentication

Authentication establishes who a person is; authorization decides what that identity may do. In OpsKnight, local credentials, OIDC federation, application sessions, and SCIM lifecycle are separate controls that meet at the user record.

## Authentication paths

OpsKnight can admit users through:

- **Local email/password** — useful for bootstrap, controlled local access, and an emergency administrator.
- **OIDC single sign-on** — delegates interactive authentication to one configured enterprise/workforce identity provider.

SCIM is not a sign-in method. It provisions/deprovisions users and groups while OIDC authenticates a browser session.

Local authentication and OIDC are intentionally independent. Enabling OIDC does not disable passwords. Disabling local login does not delete password hashes or disable OIDC.

## OIDC identity boundary

OIDC users are bound by normalized issuer plus provider subject (`iss` + `sub`). Email, UPN, username, display name, department, and job title are mutable profile attributes and are not the permanent identity key.

An existing OpsKnight account is not automatically linked just because the provider returns the same email. An administrator must explicitly allow first-time OIDC linking. The approval is time-bounded, provider/configuration-scoped, expected-email-bound, and consumed once on successful linking.

When JIT provisioning is enabled, an eligible unknown identity can create a user and its OIDC identity atomically. When JIT is disabled, the account must already exist and any first link must be approved.

## Provider and organization policy

Provider-specific controls determine the organization boundary:

- Microsoft Entra requires a tenant-specific workforce issuer; broad `common`, `organizations`, and `consumers` authorities are rejected.
- Google Workspace allowed-domain policy uses the signed `hd` claim.
- Auth0 can require a signed `org_id` and can additionally apply verified email-domain policy.
- Okta and generic OIDC allowed-domain policy requires an exact email-domain match with verified email assurance.

Organization policy is re-evaluated on every OIDC sign-in, including for identities that are already linked.

## SSO enforcement and break-glass

For enterprise deployments, the normal end state is often OIDC for ordinary users plus a deliberately isolated local emergency administrator:

```env
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=emergency-admin@example.com
```

With this policy, normal credential login is rejected server-side and only the designated break-glass account can use a local password. OpsKnight does not automatically re-enable passwords if the identity provider fails.

Prepare and test the emergency account before enforcement. Password-reset APIs are disabled while normal local authentication is disabled, so the break-glass credential must already exist and be stored outside the federation dependency.

## Sessions and revocation

OIDC sessions are not trusted indefinitely after the provider redirects back. OpsKnight continues to enforce:

- maximum/renewal lifetime;
- idle timeout;
- reauthentication policy;
- user status;
- user token/security version; and
- OIDC configuration version.

Security-relevant OIDC configuration changes invalidate existing OIDC sessions by advancing the provider configuration version. User role/status/security changes can also invalidate sessions through the user's token version.

Provider logout is best-effort; local OpsKnight sign-out remains authoritative. A provider may still have its own SSO browser session and can reuse it during a later login.

## Operational model

Treat identity configuration as a production change:

1. configure and validate discovery;
2. perform a real pilot login;
3. verify account linking/JIT, role claims, denied users, logout, and session behavior;
4. prepare and test break-glass access;
5. only then enforce SSO-only login; and
6. monitor authentication and audit events during rollout.

See [Configure OIDC single sign-on](../guides/identity/configure-oidc/) for the complete provider setup, SSO-only enforcement, session policy, migration, and troubleshooting workflow. See [Configure SCIM](../guides/identity/configure-scim/) for directory lifecycle.