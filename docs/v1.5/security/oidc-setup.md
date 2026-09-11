---
order: 1
title: OIDC SSO Setup
description: Configure and operate enterprise OIDC SSO with provider-specific security controls
---

# OIDC Single Sign-On (SSO) Setup

OpsKnight v1.5 supports one workspace OIDC provider at a time. The OIDC implementation uses the provider issuer plus the OIDC subject (`iss` + `sub`) as the stable external identity. Email, UPN, username, and display name are profile attributes and are never used as the permanent identity key.

## Prerequisites

- OpsKnight Admin access
- A confidential OIDC web application at the identity provider
- A stable public HTTPS OpsKnight URL
- `NEXTAUTH_URL` set to that public origin
- `ENCRYPTION_KEYS` or `ENCRYPTION_KEY` configured in production so the client secret can be stored securely

## Callback URL

Register this exact redirect URI with the identity provider:

```text
https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc
```

The value shown in **Settings → System → Single Sign-On (OIDC)** should match the public authentication origin configured for OpsKnight.

## Configure SSO

1. Open **Settings → System → Single Sign-On (OIDC)**.
2. Choose the provider family.
3. Enter the HTTPS issuer URL, client ID, and client secret.
4. Optionally configure custom scopes, automatic provisioning, organization/domain restrictions, role mapping, profile mapping, and the provider label.
5. Select **Test connection**. This validates OIDC discovery, issuer consistency, provider endpoints, JWKS availability, and supported signing configuration. It does not perform a real user login.
6. Save the configuration.
7. Test sign-in with a non-Admin account before relying on SSO for administrators.

Default scopes are:

```text
openid email profile
```

## Security model

OpsKnight applies the following rules regardless of provider:

- HTTPS-only issuer and discovery endpoints.
- Exact discovery issuer matching.
- Authorization, token, and JWKS endpoints are validated before use.
- Discovery and JWKS access are protected against redirects, private-network access, and DNS-rebinding style endpoint changes.
- ID tokens must use the allowed asymmetric signing algorithm policy.
- Existing identities are resolved by normalized issuer plus `sub` before email is considered.
- An explicit `email_verified: false` claim is rejected.
- Email is required when OpsKnight must create or first-link a user, but an already-linked identity can continue to authenticate without an email claim.
- Callback URLs are restricted to the local OpsKnight origin.

## Provider-specific behavior

### Microsoft Entra ID

OpsKnight's built-in Microsoft Entra ID integration targets workforce tenants across Microsoft commercial and sovereign clouds. Use a tenant-specific workforce issuer:

```text
https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0
```

OpsKnight rejects broad, non-tenant-specific authorities:

```text
/common/v2.0
/organizations/v2.0
/consumers/v2.0
```

Supported workforce authority hosts include the Microsoft public cloud (`login.microsoftonline.com`, `sts.windows.net`) and sovereign clouds (`login.microsoftonline.us`, `login.partner.microsoftonline.cn`). Microsoft External ID / CIAM authorities (`*.ciamlogin.com`) and Azure AD B2C are not workforce authorities and are treated under generic OIDC policy.

Tenant membership is enforced by the tenant-specific authority in the issuer URL. If **Allowed Domains** are configured, OpsKnight applies them as an additional email domain filter for the tenant's authenticated users.

Microsoft Entra workforce tokens commonly do not include the standard OIDC `email_verified` claim. For a validated Entra issuer, a missing claim is accepted according to the Entra provider policy, while an explicit `email_verified: false` is still rejected.

For authorization, prefer Entra App Roles when possible. If group claims are used, OpsKnight detects group-overage conditions instead of silently treating an omitted groups claim as an empty group list.

### Google Workspace

Use:

```text
https://accounts.google.com
```

When restricting access to a Google Workspace domain, OpsKnight validates the signed `hd` claim. It does not treat the suffix of the email address as proof of Workspace membership.

For example, a Workspace restriction to `example.com` requires the token to contain:

```text
hd = example.com
```

### Okta

OpsKnight supports normal Okta issuers including organization and custom authorization-server forms, for example:

```text
https://example.okta.com
https://example.okta.com/oauth2/default
https://example.okta.com/oauth2/YOUR_SERVER_ID
```

Okta custom domains can also be used. Saving an Okta custom-domain issuer preserves the Okta provider policy rather than degrading it to generic OIDC behavior.

Okta supports both `client_secret_basic` (default) and `client_secret_post` token authentication. Ensure the selected **Token Endpoint Authentication** method in OpsKnight matches the client authentication configured in your Okta application.

If roles are mapped from an Okta `groups` claim, configure the claim in Okta so it is actually included in the ID token used by OpsKnight.

### Auth0

Use the tenant issuer or a configured Auth0 custom domain, for example:

```text
https://tenant.eu.auth0.com
https://login.example.com
```

Auth0 applications support both **Client Secret Basic** (HTTP Basic header) and **Client Secret Post** (body parameters). If your Auth0 application is set to POST, set **Token Endpoint Authentication** to `Client Secret Post` in OpsKnight.

When an Auth0 Organization ID (`org_...`) is configured:
1. OpsKnight passes `organization: <organizationId>` on the `/authorize` request so the user authenticates in the designated organization context.
2. OpsKnight validates the signed `org_id` claim in the received token on every login, failing closed if the claim is missing or does not match.

For custom role/profile claims, use namespaced Auth0 claims where appropriate.

### Generic OIDC / Keycloak

Generic OIDC is intentionally strict. The issuer must expose valid OIDC discovery metadata and satisfy the same HTTPS, issuer, endpoint, JWKS, signing, state, nonce, and PKCE protections used by the built-in provider policies.

Typical Keycloak issuer:

```text
https://keycloak.example.com/realms/YOUR_REALM
```

## First-time account linking

OpsKnight never silently attaches a new OIDC subject to an existing account merely because the email matches.

For an existing account that has not yet linked OIDC, an Admin can authorize first-time linking from **Users**.

Linking approvals are:

- time limited;
- renewable and revocable;
- scoped to the provider configuration and issuer trust boundary;
- tied to the expected account email;
- consumed atomically when the first link succeeds.

Approvals are available for supported **Active** and **Invited** account flows. The provider still has to pass its identity, email-assurance, organization, and domain checks.

Once linked, future logins use the stored `(issuer, sub)` identity rather than email matching.

## Automatic provisioning

When **Auto-provision** is enabled, an eligible first OIDC login can create an OpsKnight account automatically.

Creation and identity binding are committed atomically so OpsKnight does not leave a half-created user when identity linking fails or races with another login.

When auto-provisioning is disabled, unknown external identities are denied.

## Organization and domain restrictions

Restrictions are provider-aware:

- **Microsoft Entra ID** — tenant-specific issuer/trust policy.
- **Google Workspace** — signed `hd` claim.
- **Auth0** — optional signed `org_id` boundary.
- **Okta / generic OIDC** — configured issuer plus any supported email/domain policy.

Do not rely on an email suffix as the sole proof of organizational membership when the provider exposes a stronger signed organization claim.

## Role mapping

Role rules are evaluated from bounded OIDC claims and can map to:

```text
USER
AUDITOR
RESPONDER
ADMIN
```

Example:

```json
[
  { "claim": "groups", "value": "opsknight-admins", "role": "ADMIN" },
  { "claim": "groups", "value": "on-call", "role": "RESPONDER" }
]
```

OpsKnight tracks whether a role is managed manually, by OIDC, or by SCIM. OIDC-managed access can therefore be de-provisioned when the authoritative mapped claim is removed, without confusing that state with a manually managed role.

## Profile mapping

The following profile fields can be synchronized from bounded claims:

- `department`
- `jobTitle`
- `avatarUrl`

Wrong claim types are rejected/ignored according to the mapping policy rather than being coerced from arbitrary objects.

## Issuer changes

Changing the issuer changes the external identity trust boundary. OpsKnight requires explicit confirmation for an issuer migration and invalidates affected sessions and outstanding first-link approvals as part of the change.

Do not change an Okta/Auth0 issuer to a custom domain without planning the identity migration first.

## SSO-only and break-glass access

Local credential login can be disabled with:

```text
AUTH_LOCAL_LOGIN_ENABLED=false
```

When disabled, the SSO button remains available and local password login/recovery is not exposed as a bypass.

For emergency recovery, configure a dedicated break-glass account with:

```text
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=admin@example.com
```

Keep the break-glass credentials outside the normal SSO dependency and restrict use to documented recovery procedures.

## OIDC session policy

OIDC sessions have separate enterprise limits from local credential sessions. Defaults are:

```text
Maximum OIDC session age: 12 hours
Idle timeout:             4 hours
OpsKnight SSO renewal:   12 hours
Session update age:       1 hour
```

These values are controlled by the `AUTH_SSO_*` settings documented in [Configuration Reference](../getting-started/configuration.md).

OpsKnight can require a new OpsKnight OIDC session after the configured period, but that is not the same as forcing the identity provider to prompt for credentials again; the IdP may reuse its own SSO session.

## Current scope

OpsKnight v1.5 currently supports **one OIDC provider configuration per workspace**. Multi-IdP selection is not part of this release.

For lifecycle provisioning and de-provisioning, see [SCIM Provisioning](./scim-provisioning.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| SSO button missing | OIDC is enabled and its client secret can be decrypted. |
| Discovery validation fails | HTTPS issuer, exact discovery issuer, reachable public endpoints, valid JWKS metadata. |
| Entra login denied | Use a tenant-specific issuer; do not use `common`, `organizations`, or `consumers`. |
| Google Workspace user denied | Verify the signed `hd` claim matches the configured Workspace domain. |
| Auth0 user denied | Verify the configured `org_id` and the token's signed organization claim. |
| Existing account cannot first-link | Review the Admin linking approval, expiry, provider/config scope, email, and provider assurance checks. |
| Existing linked user changed email | Identity should still resolve by `(issuer, sub)`; investigate issuer/subject changes instead of relinking by email. |
| Role does not update | Confirm the expected claim is present and the mapping value exactly matches. |
| Login loops after URL change | Confirm `NEXTAUTH_URL`, reverse-proxy host/scheme forwarding, and the registered callback URI all match. |

## Related topics

- [Authentication](../administration/authentication.md)
- [SCIM Provisioning](./scim-provisioning.md)
- [Users](../core-concepts/users.md)
- [Authorization and Roles](./authorization.md)
- [Configuration Reference](../getting-started/configuration.md)
