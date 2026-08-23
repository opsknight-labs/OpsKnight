---
order: 1
title: Authentication
description: Operate local credentials, OIDC, password recovery, and JWT session revocation safely.
---

# Authentication

OpsKnight v1.3 supports local email/password authentication and one workspace OIDC provider. Both can be available on the login page. Authentication proves identity; [authorization](../security/authorization.md) determines what the signed-in user may do.

## Production prerequisites

Set a stable public HTTPS origin and preserve the authentication secrets:

| Setting               | Purpose                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `NEXTAUTH_URL`        | Exact public origin used for callbacks and secure-cookie selection.                              |
| `NEXTAUTH_SECRET`     | Signs/encrypts session tokens; changing it invalidates existing sessions.                        |
| `ENCRYPTION_KEY`      | Stable 64-hex-character key used to encrypt the OIDC client secret and other stored credentials. |
| `NEXT_PUBLIC_APP_URL` | Public origin used in user-facing links; normally matches `NEXTAUTH_URL`.                        |

The reverse proxy must forward the original host and scheme. Back up secrets outside PostgreSQL; restoring the database without the matching encryption key does not restore usable OIDC credentials.

## Bootstrap the first Admin

When no user exists, open `/setup`, enter the Admin name and email, and create the account. OpsKnight displays a generated password once. Store it securely, sign in, change it immediately, and create a second Admin. Setup stops accepting another bootstrap after a user exists.

## Local accounts

Admins invite subsequent users from **Users**. An invitation is valid for seven days and earlier unused invite tokens are invalidated when a replacement is generated. Treat the link as a credential.

Passwords must be 10–128 characters and contain lowercase, uppercase, numeric, and special characters. These rules are fixed in v1.3; there is no configurable expiry, history, or complexity policy.

### Password recovery

The login page's **Forgot password** flow returns the same message for registered and unknown addresses. A reset token:

- expires after one hour;
- invalidates earlier unused reset tokens for the address;
- is delivered by configured email, with SMS fallback only when the user and provider permit it;
- increments the user's token version after use, revoking existing sessions.

If no delivery provider is available, an Admin can generate a reset link from the supported user-management workflow. Share any reset link only through an approved secret channel.

## Configure OIDC

You need `ADMIN` and a working `ENCRYPTION_KEY`.

1. Register a confidential OIDC web application at the identity provider.
2. Add this exact callback URL:

   ```text
   https://YOUR_OPSKNIGHT_URL/api/auth/callback/oidc
   ```

3. Go to **Settings** → **System** → **Single Sign-On (OIDC)**.
4. Enter the HTTPS issuer, client ID, client secret, and optional provider label/scopes.
5. Select **Test connection** to validate issuer discovery.
6. Configure provisioning restrictions and mappings before enabling OIDC.
7. Save, then test with a non-Admin account in a private browser session while retaining a working local Admin session.

Default scopes are `openid email profile`; custom scopes are appended. The provider's claims—not its brand—determine whether domain, role, and profile rules work. See [OIDC setup](../security/oidc-setup.md) for registration examples.

### Email and identity safety

OpsKnight requires an email. An explicit `email_verified: false` is rejected. Set `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT=true` to also reject a missing claim for all OIDC sign-ins.

An OIDC identity is bound to the normalized issuer plus the provider subject (`sub`). OpsKnight does not treat an email address by itself as a stable external identity. This prevents an unrelated OIDC identity that happens to present the same email from silently taking over an existing OpsKnight account.

For an existing account that does not yet have an OIDC identity, first-time linking requires all of the following:

- the configured OIDC provider returns a stable subject;
- the provider explicitly returns `email_verified: true`;
- the OpsKnight account has administrator-provisioning evidence, either from the normal invite flow or from an Admin explicitly allowing OIDC linking for that user;
- the issuer-plus-subject identity is not already linked to another OpsKnight user.

After the first successful link, later sign-ins use the stored issuer-plus-subject identity rather than email-only matching.

### Allow OIDC linking for an existing user

Use this when an existing **Active** user must start using OIDC but does not already have an OIDC identity link.

1. Sign in as an Admin.
2. Open **Users**.
3. Find the existing Active user.
4. Select **Allow OIDC linking** for that user.
5. Ask the user to sign in through the configured OIDC provider.
6. Confirm the identity provider returns the same account email and `email_verified: true`.

The action does not change the user's application role or account status and does not create a usable invitation link. It records administrator-provisioning evidence that the authentication flow can use for the next safe first-time link. If the user already has an OIDC identity, OpsKnight reports that no additional linking approval is required.

Do not use this control to work around an email mismatch, an unverified email claim, a missing subject, or an identity already linked to another user. Correct the identity-provider configuration instead.

Users still in **Invited** status already have administrator-provisioning evidence from the supported invite workflow and do not need this additional action.

### Auto-provisioning and domains

When auto-provisioning is disabled, an unknown OIDC user is denied. When enabled, an eligible first login creates an active `USER` account. A non-empty allowed-domain list requires an exact lower-case email-domain match.

OIDC sign-in can reactivate an existing linked disabled user. If deactivation must remain authoritative, remove or block the identity at the IdP as part of offboarding.

### Role mapping

Rules are evaluated in order; the first exact scalar or array-value match wins:

```json
[
  { "claim": "groups", "value": "opsknight-admins", "role": "ADMIN" },
  { "claim": "groups", "value": "on-call", "role": "RESPONDER" }
]
```

Valid targets are `USER`, `RESPONDER`, and `ADMIN`. A newly provisioned user begins as `USER`; if no rule matches, an existing user's current role is retained. Mapping can both promote and demote on later login, so use a dedicated, tightly governed Admin group.

### Profile mapping

Map IdP claim names to `department`, `jobTitle`, and `avatarUrl`. Non-empty values synchronize on login. An avatar uploaded locally under `/uploads/` is not overwritten by OIDC profile synchronization.

## Sessions

Sessions are JWT based. Web login without **Remember me** has a seven-day ceiling; remembered web sessions and mobile sessions have a one-year ceiling. Activity refreshes session state at most hourly, but there is no separate configurable idle-timeout control in v1.3.

Cookies are HTTP-only where appropriate and use `SameSite=Lax`. `NEXTAUTH_URL` beginning with `https://` enables Secure cookies and secure name prefixes; an origin mismatch commonly causes login loops.

**Settings** → **Security** offers **Revoke all sessions**. It increments the user's token version; v1.3 does not list or revoke individual devices. Role/status changes may take effect after the authentication user-cache refresh, so use session revocation for urgent access removal and remove access at the IdP too.

## Failure-safe rollout

- Keep a tested local break-glass Admin while introducing OIDC.
- Restrict auto-provision domains before enabling it.
- Test normal, denied-domain, missing-claim, disabled-user, and Admin-group cases.
- Confirm role mapping cannot grant Admin through a user-controlled claim.
- Verify first-time linking for an explicitly approved existing test user before migrating production accounts.
- Verify revoke-all and IdP disable behavior.
- Record the rollback: disable OIDC using the retained local Admin session.

## Troubleshooting

| Symptom                       | Check                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Redirect/cookie loop          | Exact HTTPS `NEXTAUTH_URL`, forwarded host/scheme, and browser cookie policy.                                   |
| Discovery test fails          | Issuer is HTTPS and exposes valid OIDC discovery metadata from the app network.                                 |
| Existing local user is denied | User is invited or explicitly approved for OIDC linking, email is verified, subject exists, and identity is free. |
| New user is denied            | Auto-provision setting, exact allowed domain, email and verification claims.                                    |
| Role does not update          | Requested custom scope, actual ID-token/profile claim, JSON rule order and exact value.                         |
| Secret cannot decrypt         | Restore the matching `ENCRYPTION_KEY` or enter a new client secret.                                             |

## Related topics

- [Authorization](../security/authorization.md)
- [OIDC setup](../security/oidc-setup.md)
- [Users](../core-concepts/users.md)
- [Configuration](../getting-started/configuration.md)
- [Troubleshooting](../troubleshooting.md)
