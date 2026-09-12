---
order: 1
title: Authentication
description: Operate local credentials, enterprise OIDC, sessions, recovery, linking, and SCIM safely.
---

# Authentication

OpsKnight v1.5 supports local email/password authentication and one workspace OIDC provider. Either method can be enabled independently. Authentication proves identity; [authorization](../security/authorization.md) determines what the signed-in user may do.

## Production prerequisites

Use a stable public HTTPS origin and preserve authentication secrets:

| Setting | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | Exact public authentication origin used for callbacks and secure-cookie selection. |
| `NEXTAUTH_SECRET` | Signs/encrypts session tokens; changing it invalidates existing sessions. |
| `ENCRYPTION_KEYS` / `ENCRYPTION_KEY` | Encrypt stored OIDC and other protected credentials. |
| `NEXT_PUBLIC_APP_URL` | Public origin used in user-facing links; normally matches `NEXTAUTH_URL`. |

The reverse proxy must forward the original host and scheme. Back up authentication/encryption secrets outside PostgreSQL.

## Bootstrap the first Admin

When no user exists, open `/setup`, create the first Admin, store the generated password securely, sign in, change it, and create a second Admin. Setup stops accepting another bootstrap after a user exists.

## Local credentials

Admins can invite users from **Users**. Invitation and reset links are credentials and should only be shared through approved channels.

Credential sessions retain the existing local-session policy:

- normal credential session: up to seven days;
- **Remember me** credential session: up to one year.

Password reset increments the user's token version so existing sessions are invalidated.

## SSO-only mode

Local credential login can be disabled without disabling OIDC:

```text
AUTH_LOCAL_LOGIN_ENABLED=false
```

In SSO-only mode:

- the OIDC button remains available on desktop and mobile login;
- the local email/password form is hidden;
- password-recovery entry points do not provide a bypass around SSO-only policy.

If neither OIDC nor local authentication is available, the login page shows an explicit configuration error instead of silently presenting a broken form.

## Break-glass access

A dedicated emergency local account can be allowed even when normal local login is disabled:

```text
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=admin@example.com
```

Use a dedicated Admin identity, store its password outside the normal SSO dependency, audit its use, and disable emergency access again after recovery.

## Configure OIDC

1. Register a confidential OIDC web application at the identity provider.
2. Register this callback:

   ```text
   https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc
   ```

3. Open **Settings → System → Single Sign-On (OIDC)**.
4. Enter the HTTPS issuer, client ID, client secret, and provider-specific settings.
5. Select **Test connection** to validate discovery, issuer consistency, endpoints, JWKS, and signing configuration.
6. Configure provisioning, organization/domain restrictions, roles, and profile mappings.
7. Save and test with a non-Admin account before relying on SSO for administrators.

See [OIDC SSO Setup](../security/oidc-setup.md) for provider-specific Entra, Google, Okta, Auth0, and generic OIDC behavior.

## Stable identity and email safety

OpsKnight treats the normalized OIDC issuer plus provider subject (`sub`) as the permanent external identity.

```text
issuer + sub -> OpsKnight user
```

Email, UPN, username, and display name are not permanent identity keys.

This means:

- changing a user's email does not silently create or move an existing identity;
- an already-linked identity can continue to authenticate without an email claim;
- email is required when OpsKnight must first-link or create an account;
- an explicit `email_verified: false` is rejected;
- provider-specific handling applies when a provider legitimately omits `email_verified`.

Microsoft Entra is the important example: validated Entra workforce issuers can legitimately omit the standard `email_verified` claim, so missing-claim handling differs from strict generic OIDC while an explicit false claim is still rejected.

## First-time OIDC linking

OpsKnight does not silently attach an unrecognized OIDC subject to an existing user just because the email matches.

For an existing **Active** or supported **Invited** account that has not linked OIDC yet:

1. Sign in as an Admin and open **Users**.
2. Open the user's actions.
3. Select **Allow OIDC linking**.
4. Review and confirm the approval.
5. Ask the user to sign in through OIDC.

Linking approvals are time-limited, renewable, revocable, scoped to the OIDC provider/configuration and issuer trust boundary, tied to the expected email, and consumed atomically when the link succeeds.

Once linked, later logins use `(issuer, sub)` rather than email matching.

Do not use approval to bypass a wrong issuer, wrong tenant/organization, explicit unverified-email claim, missing subject, or an external identity already owned by another user.

## Automatic provisioning

When auto-provisioning is enabled, an eligible first OIDC login can create a new active user. User creation and external-identity creation are committed atomically.

When auto-provisioning is disabled, unknown external identities are denied.

Provider-specific organization controls still apply to both new and already-linked identities. For example:

- Entra must remain inside the configured tenant trust boundary;
- Google Workspace uses the signed `hd` claim;
- Auth0 can enforce a signed `org_id`.

## Role ownership and mapping

OpsKnight tracks role ownership so manually managed roles can be distinguished from roles managed by OIDC or SCIM.

OIDC role rules support:

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

When OIDC is authoritative for a user's role, removing the matching IdP claim can de-provision the corresponding OpsKnight privilege on a later login. Missing/over-limit group claims are not silently treated as a normal empty-group result where that would be unsafe.

## Profile mapping

OIDC can synchronize bounded claims to:

- `department`
- `jobTitle`
- `avatarUrl`

Invalid claim types are not converted from arbitrary objects into profile strings.

## Issuer changes

Changing the OIDC issuer crosses an identity trust boundary. OpsKnight requires explicit migration confirmation and revokes affected sessions and outstanding first-link approvals when the issuer changes.

Treat Okta/Auth0 custom-domain migrations as issuer migrations, not cosmetic URL edits.

## OIDC sessions

OIDC sessions use an enterprise policy separate from local credential Remember Me behavior.

Default OIDC values are:

| Control | Default |
| --- | ---: |
| Maximum session age | 12 hours |
| Session update age | 1 hour |
| Idle timeout | 4 hours |
| OpsKnight OIDC renewal boundary | 12 hours |

Configuration variables:

```text
AUTH_SSO_SESSION_MAX_AGE_SECONDS
AUTH_SSO_SESSION_UPDATE_AGE_SECONDS
AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS
AUTH_SSO_REAUTH_AFTER_SECONDS
```

> [!NOTE]
> Under OpsKnight's JWT session strategy, session lifecycle is governed per-request by absolute expiration (`AUTH_SSO_SESSION_MAX_AGE_SECONDS`), user-interaction idle timeout (`AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS`), and server-side config/token versions. `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS` configures NextAuth's database session update cadence and is retained for database session parity.

OpsKnight refreshes security-sensitive user state during server-side session evaluation so account disablement, token-version changes, SCIM deprovisioning, and trust/config-version changes can invalidate access without waiting for the original JWT lifetime.

The `AUTH_SSO_REAUTH_AFTER_SECONDS` control requires a new OpsKnight OIDC session; it does not guarantee that the upstream IdP prompts the user for credentials instead of reusing its own SSO session.

## Session revocation

**Settings → Security → Revoke all sessions** increments the user's token version and invalidates sessions. Password reset, account disablement, SCIM deprovisioning, and relevant OIDC trust changes also revoke or invalidate active access.

## SCIM provisioning

OIDC authenticates users who are signing in. SCIM provides lifecycle provisioning/deprovisioning from an identity platform.

OpsKnight v1.5 supports SCIM 2.0 Users operations with bearer authentication. Deprovisioning disables the internal user and invalidates sessions; DELETE also removes the resource from the SCIM namespace while preserving the internal disabled account for history/audit.

See [SCIM Provisioning](../security/scim-provisioning.md).

## Provider-specific notes

### Microsoft Entra ID

- Use a tenant-specific issuer.
- Broad `common`, `organizations`, and `consumers` authorities are rejected.
- Built-in Entra policy targets workforce tenants in commercial and sovereign clouds (External ID / CIAM is handled under generic OIDC).
- Tenant boundaries are cryptographically verified via the tenant-specific issuer; Allowed Domains is informational for Entra workforce tenants.
- Missing standard `email_verified` is handled under the validated Entra policy; explicit false is rejected.
- Prefer Entra App Roles for authoritative role mapping when possible.

### Google Workspace

- Workspace membership is enforced using the signed `hd` claim, not email suffix alone.

### Okta

- Organization and custom authorization-server issuers are supported.
- Custom domains retain Okta provider policy.
- Supports both `client_secret_basic` and `client_secret_post` token endpoint authentication.

### Auth0

- Tenant and custom-domain issuers are supported.
- Supports both `client_secret_basic` and `client_secret_post` token endpoint authentication.
- Configured Auth0 Organizations pass `organization` during authorization and enforce signed `org_id` on every login.

## Unsupported authentication methods

OpsKnight v1.5 does not provide native SAML, passkey/WebAuthn login, email magic-link login, or a native second factor. Enforce MFA at the OIDC provider or a trusted access proxy when required.

OpsKnight v1.5 also supports one OIDC provider configuration per workspace; multi-IdP selection is outside this release.

## Failure-safe rollout

- Keep a tested break-glass recovery path while introducing SSO-only mode.
- Use a tenant-/organization-specific provider boundary.
- Test normal login, denied organization/domain, disabled user, role de-provisioning, and first-link approval.
- Test issuer migration before changing a production issuer/custom domain.
- Verify session revocation and SCIM deprovisioning.
- Test a non-Admin account before migrating Admin access.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| SSO-only page has no password form | Expected when `AUTH_LOCAL_LOGIN_ENABLED=false`; use the OIDC button or configured break-glass account. |
| Redirect/cookie loop | `NEXTAUTH_URL`, reverse-proxy host/scheme forwarding, callback URI, and cookie policy. |
| Discovery test fails | HTTPS issuer, exact discovery issuer, public endpoints, JWKS, and signing metadata. |
| Existing user cannot first-link | Approval state/expiry, expected email, provider/config scope, stable subject, and provider assurance policy. |
| Existing linked user is denied | Account status plus current provider organization/tenant policy. |
| Google Workspace user denied | Signed `hd` claim. |
| Auth0 organization user denied | Signed `org_id`. |
| Role does not update | Claim presence, mapping rule, role ownership/source, and provider group-overage behavior. |
| Session ends earlier than local Remember Me | OIDC uses the separate enterprise session limits by design. |

## Related topics

- [OIDC SSO Setup](../security/oidc-setup.md)
- [SCIM Provisioning](../security/scim-provisioning.md)
- [Authorization](../security/authorization.md)
- [Users](../core-concepts/users.md)
- [Configuration Reference](../getting-started/configuration.md)
- [Troubleshooting](../troubleshooting.md)
