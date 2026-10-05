---
title: Configure OIDC single sign-on
description: Register Microsoft Entra, Google Workspace, Okta, Auth0, or a generic OIDC provider and safely roll out sign-in.
type: tutorial
product_area: identity
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Configure, pilot, verify, and safely enforce OIDC single sign-on.
keywords: [OIDC login, configure SSO, OpenID Connect, Entra, Google Workspace, Okta, Auth0]
verification:
  level: source
  verified_at: 2026-10-05
  evidence:
    - src/components/settings/SsoSettingsForm.tsx
    - src/app/(app)/settings/security/actions.ts
    - src/lib/oidc.ts
    - src/lib/oidc-validation.ts
    - src/lib/oidc/provider-policy.ts
    - src/lib/oidc/scopes.ts
    - src/lib/oidc/role-mapping.ts
    - src/lib/oidc-identity-resolution.ts
    - src/lib/oidc-linking-approval.ts
    - src/lib/oidc/issuer-migration.ts
    - src/lib/local-auth-policy.ts
    - src/app/login/page.tsx
    - src/app/login/LoginClient.tsx
    - src/app/(app)/users/oidc-actions.ts
    - src/app/api/auth/forgot-password/route.ts
    - src/app/api/auth/reset-password/route.ts
    - src/app/api/auth/oidc/logout-url/route.ts
---

# Configure OIDC single sign-on

OpsKnight supports one OpenID Connect provider configuration per workspace.
Use OIDC for interactive authentication and, when required, use
[SCIM](configure-scim/) separately for directory-driven user lifecycle.

OpsKnight identifies an external user by the normalized issuer and OIDC subject
(`iss` + `sub`). Email, UPN, username, and display name are profile attributes;
they are not the permanent identity key. This prevents a recycled or renamed
email address from silently taking over an existing identity.

## How OIDC works in OpsKnight

OpsKnight supports one enterprise/workforce OIDC provider configuration per workspace. The provider configuration is stored in the database; the client secret is encrypted at rest with the application's encryption key. Local email/password authentication is a separate deployment policy and can remain enabled, be disabled, or be retained only for one emergency administrator.

A successful OIDC sign-in follows these trust boundaries:

1. OpsKnight loads only an enabled provider whose encrypted secret can be decrypted and whose runtime discovery metadata validates.
2. The browser uses the authorization-code flow with PKCE, state, and nonce checks.
3. The runtime pins ID-token verification to RS256 and validates the provider's signing keys.
4. The external principal is identified by normalized issuer plus OIDC subject (`iss` + `sub`). Email is profile/discovery material, not the permanent identity key.
5. Provider-specific organization policy is checked on every sign-in.
6. Existing accounts require explicit first-link approval; otherwise an eligible new identity is created only when JIT provisioning is enabled.
7. Role and profile mappings are evaluated from the signed claims.
8. OpsKnight creates a server-controlled application session and continues to enforce account status, token-version revocation, OIDC configuration version, idle timeout, and reauthentication policy.

OpsKnight does not request or store OIDC refresh tokens. `offline_access` is rejected. A provider-side SSO session can still let the identity provider complete a later OpsKnight reauthentication without asking the user for a password again.

### Choose the sign-in mode before rollout

| Desired mode | Deployment policy | Result |
| --- | --- | --- |
| Local password + SSO | `AUTH_LOCAL_LOGIN_ENABLED=true` | Both normal local credentials and OIDC can sign in. Use this during bootstrap and pilot rollout. |
| SSO only | `AUTH_LOCAL_LOGIN_ENABLED=false`, break-glass disabled | Normal password sign-in is unavailable. If OIDC is unusable, no ordinary interactive login path remains. |
| SSO enforced with emergency recovery | `AUTH_LOCAL_LOGIN_ENABLED=false`, `AUTH_BREAK_GLASS_ENABLED=true`, `AUTH_BREAK_GLASS_EMAIL=<admin>` | OIDC is the normal sign-in path; only the designated emergency account can use local credentials. This is the recommended enterprise end state. |

`AUTH_LOCAL_LOGIN_ENABLED` is intentionally independent from the OIDC **Enabled** switch. Disabling OIDC does not automatically re-enable passwords, and an OIDC outage never causes OpsKnight to fail open to local credentials.

Disabling local login is an authentication policy, not credential deletion. Existing password hashes are not erased. Normal credential authorization is blocked server-side, and the forgot/reset-password API is disabled while local login is disabled.

## Before you begin

You need:

- OpsKnight administrator access;
- a stable public HTTPS OpsKnight origin;
- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` set to that origin;
- a confidential web application at the identity provider;
- permission to create its client secret and configure token claims; and
- a tested local break-glass administrator before changing sign-in policy.

Open **Settings → System → SSO / OIDC** and copy the displayed callback URL. It
has this exact form:

```text
https://opsknight.example.com/api/auth/callback/oidc
```

Register that value exactly. Scheme, host, port, path, and trailing slash
behavior matter. Do not register wildcards. If the displayed host is internal
or uses HTTP, correct the public URL and reverse-proxy configuration before
continuing.

## What OpsKnight validates

**Test Connection** validates the provider's public OIDC discovery and signing-key contract. It does not perform a user authorization flow.

During connection validation OpsKnight requires:

- an HTTPS issuer without a query string or fragment;
- a canonical discovery response whose `issuer` exactly matches the configured issuer after safe normalization;
- HTTPS authorization, token, and JWKS endpoints;
- no discovery redirect;
- endpoints that do not resolve to blocked private, loopback, link-local, or other restricted network ranges;
- a provider policy compatible with the issuer (for example, tenant-specific Microsoft Entra workforce authorities);
- authorization-code/PKCE-compatible metadata where advertised;
- the selected `client_secret_basic` or `client_secret_post` token authentication method to be supported where the provider advertises methods; and
- a usable RSA signing-key set compatible with OpsKnight's RS256 runtime policy.

Discovery and JWKS response sizes are bounded, and the network path is rechecked at connection time to reduce SSRF and DNS-rebinding risk.

**Test Connection does not validate** the client ID, client secret, redirect URI registration, provider-side user assignment, consent, application roles/groups, emitted claims, or the actual token exchange. A real pilot login is therefore mandatory before enforcement.

At sign-in OpsKnight additionally validates PKCE, state, nonce, ID-token signature/issuer, stable subject, provider-specific organization policy, email assurance for first binding, account-link approval, account status, and server-side authorization.

An explicit `email_verified: false` is rejected for every provider. Microsoft Entra workforce tokens may omit the standard `email_verified` claim; that omission is handled by the Entra-specific policy rather than treated as an automatic failure.

## Microsoft Entra ID

Use a tenant-specific workforce application. OpsKnight rejects the broad
`common`, `organizations`, and `consumers` authorities.

### Register the Entra application

1. In the Microsoft Entra admin center, open **Identity → Applications → App
   registrations** and select **New registration**.
2. Enter a recognizable name such as `OpsKnight Production`.
3. Choose the account type for accounts in this organizational directory.
4. Under **Redirect URI**, choose **Web** and paste the exact OpsKnight callback
   URL.
5. Select **Register** and record the **Application (client) ID** and
   **Directory (tenant) ID**.
6. Open **Certificates & secrets → Client secrets → New client secret**. Choose
   the shortest practical lifetime allowed by policy, create it, and copy its
   **Value** immediately. The secret ID is not the client secret.
7. Ensure the web redirect URI remains listed under **Authentication**. Do not
   enable implicit ID-token flow; OpsKnight uses authorization code flow.

Use this issuer, replacing the tenant identifier:

```text
https://login.microsoftonline.com/<tenant-id>/v2.0
```

Microsoft sovereign-cloud workforce authorities supported by the issuer policy
include `login.microsoftonline.us` and `login.partner.microsoftonline.cn`.
Microsoft External ID/CIAM and Azure AD B2C are not treated as Entra workforce
authorities; configure them as generic OIDC only after validating their issuer
contract.

### Configure Entra role claims

Prefer application roles because their values are specific to the application:

1. Open **App roles → Create app role**.
2. Create stable values such as `OpsKnight.Admin`, `OpsKnight.Responder`, and
   `OpsKnight.Auditor`; allow **Users/Groups**.
3. In the corresponding **Enterprise application**, open **Users and groups**
   and assign users or groups to those roles.
4. In OpsKnight, map the `roles` claim values to `ADMIN`, `RESPONDER`, or
   `AUDITOR`.

If you use groups instead, open **Token configuration → Add groups claim** and
select only the necessary group representation. OpsKnight detects Entra group
overage rather than treating an omitted oversized groups claim as an empty list.
Do not enter `groups` or `roles` in **Custom OIDC Scopes** for Entra: these are
token claims, not OAuth scopes.

Entra workforce tokens can legitimately omit `email_verified`; OpsKnight
accepts that omission only under validated Entra policy. An explicit false
value remains a rejection. Tenant membership is enforced by the tenant-specific
issuer, not by a mutable email-domain suffix.

## Google Workspace

### Register the Google client

1. In Google Cloud Console, select or create the project owned by the Workspace
   organization.
2. Configure the OAuth consent screen/Google Auth Platform branding and choose
   the appropriate internal or external audience.
3. Add the minimum identity scopes needed for `openid`, `email`, and `profile`.
4. Open **Clients** (or **APIs & Services → Credentials**) and create an
   **OAuth client ID** of type **Web application**.
5. Add the exact OpsKnight callback under **Authorized redirect URIs**.
6. Create the client and record its client ID and client secret.

Use this issuer:

```text
https://accounts.google.com
```

In OpsKnight, put approved Workspace domains in **Allowed Email Domains**. For
Google, OpsKnight validates the signed hosted-domain (`hd`) claim, not merely
the email suffix. A consumer Google account with a matching-looking email does
not satisfy that boundary. Do not add `groups` or `roles` as Google OAuth
scopes; Google group membership is not supplied as a normal OIDC ID-token scope.

If the consent screen is in testing, add pilot users as test users and account
for provider-side test-user and publishing limits. Confirm the application is
owned and recoverable by more than one authorized administrator.

## Okta

### Create the Okta application integration

1. In the Okta Admin Console, open **Applications → Applications → Create App
   Integration**.
2. Select **OIDC - OpenID Connect**, then **Web Application**.
3. Enter the exact OpsKnight callback under **Sign-in redirect URIs**.
4. Add the OpsKnight public origin or the sign-out return URL allowed by your
   sign-out policy under **Sign-out redirect URIs**.
5. Under **Assignments**, limit access to a pilot group first.
6. Save and copy the client ID and client secret.
7. Note whether the application uses **Client Secret Basic** or **Client Secret
   Post** and select the identical method in OpsKnight.

Issuer examples are:

```text
https://example.okta.com
https://example.okta.com/oauth2/default
https://example.okta.com/oauth2/<authorization-server-id>
```

The issuer must match the authorization server that produces the ID token. If
you need a groups claim, configure the claim/filter in the relevant Okta
authorization server or application and add `groups` to OpsKnight's custom
scopes when the Okta claim configuration requires it. Then map exact claim
values in OpsKnight. Test with both a member and a non-member.

Okta custom domains can retain Okta policy when the provider template is set to
Okta. Changing from the Okta tenant domain to a custom domain changes the
issuer, however, and must be treated as an identity migration.

## Auth0

### Create the Auth0 application

1. In Auth0 Dashboard, open **Applications → Applications → Create
   Application**.
2. Select **Regular Web Applications**.
3. In **Settings**, put the exact OpsKnight callback in **Allowed Callback
   URLs**.
4. Put the OpsKnight public origin in **Allowed Logout URLs** and **Allowed Web
   Origins** when those fields are used by your tenant policy.
5. Save, then copy **Domain**, **Client ID**, and **Client Secret**.
6. Under **Credentials**, confirm whether token endpoint authentication uses
   `client_secret_basic` or `client_secret_post`; select the same method in
   OpsKnight.
7. Under **Connections**, enable only the identity connections intended for
   this application.

Use the Auth0 tenant or custom-domain issuer, including HTTPS:

```text
https://tenant.eu.auth0.com
https://login.example.com
```

If the application is restricted to an Auth0 Organization, copy its `org_...`
identifier into **Organization ID**. OpsKnight sends that organization in the
authorization request and requires the signed `org_id` claim to match on every
login. Missing or mismatched organization claims fail closed.

For custom roles or profile values, emit namespaced claims through an Auth0
Action and map the exact namespaced claim in OpsKnight. Test the Action on the
same connection and organization used by the application.

## Generic OIDC and Keycloak

Create a confidential authorization-code client at the provider and register
the exact callback. The issuer must publish valid discovery at its standard
well-known location and support the authentication method selected in
OpsKnight. The current runtime signing policy requires RS256-compatible ID
tokens.

A typical Keycloak issuer is:

```text
https://keycloak.example.com/realms/<realm>
```

Use the realm issuer, not the admin-console URL or token endpoint. In the
Keycloak client, enable the standard flow, set the exact valid redirect URI,
use a confidential client with client authentication, and add protocol mappers
for any group, role, department, or title claims you intend to consume.

For generic providers, configured allowed domains require both an exact email
domain match and `email_verified: true`. If the provider cannot assert verified
mailbox ownership, do not use the email-domain field as an organization
boundary.

## Configure OpsKnight

Open **Settings → System → SSO / OIDC**. The form is divided into the same operational areas used by the runtime.

### Connection & Credentials

1. Select the provider template. The template controls safe provider-specific behavior and display defaults; it cannot make an arbitrary hostname inherit Google or Entra trust.
2. Enter the exact issuer URL.
3. Enter the client ID and client secret.
4. Select the token endpoint authentication method that matches the provider: **Client Secret Basic** or **Client Secret Post**.
5. Optionally set a provider label for the sign-in button.
6. Select **Test Connection** and resolve every discovery/JWKS error before saving.
7. Enable the configuration and save it.

The client secret is encrypted before storage. Saving uses optimistic concurrency: if another administrator changed the SSO configuration after the form was loaded, OpsKnight rejects the stale write rather than silently overwriting the newer security settings.

### Roles & Claims

Built-in scopes are always `openid email profile`. Add only provider-supported custom scopes; `offline_access` is not supported.

Role mappings support exact string or string-array claim matches and are evaluated in order: **first matching rule wins**. Supported target roles are `USER`, `AUDITOR`, `RESPONDER`, and `ADMIN`. If no rule matches, the default OIDC role is `USER` for OIDC-managed roles.

Do not map a broad workforce group to `ADMIN`. For Microsoft Entra group mappings, OpsKnight detects the group-overage signal and does not grant a mapped elevated role when the full groups claim is unavailable.

Profile mapping can copy selected signed claims into:

- department;
- job title; and
- avatar URL.

Department and job-title values are bounded before storage. OIDC avatar updates must be HTTPS URLs and do not overwrite an existing local uploaded avatar.

### Access & Session Policies

Configure:

- **JIT Account Auto-Provisioning** — whether an unknown eligible OIDC identity may create a new OpsKnight user;
- **Allowed Email Domains** — provider-dependent organization boundary described below;
- **Auth0 Organization ID** — when using Auth0 Organizations;
- **Maximum session lifetime**; and
- **Idle inactivity timeout**.

SCIM is configured separately. OIDC authenticates a principal; SCIM provisions and deprovisions directory objects. Enabling one does not automatically enable or configure the other.

### Save behavior and security versioning

Security-relevant provider changes increment the OIDC configuration version. This includes issuer, client ID, client-secret replacement, enabled state, provider family, Auth0 organization, token endpoint authentication method, role mapping, custom scopes, and allowed-domain changes.

Outstanding unused OIDC-link approvals are revoked when that trust configuration changes. Existing OIDC sessions carry the configuration version and are rejected when it no longer matches the active configuration.

Provider label, JIT enablement, profile mapping, and session-policy edits are handled according to their own runtime behavior rather than being treated as an issuer migration.

## Existing users and first-time linking

OpsKnight never attaches a new OIDC subject to an existing user merely because the email addresses match. Stable identity is `(issuer, sub)`; email is used only after stable-identity lookup misses.

For each existing `ACTIVE` or `INVITED` user who needs first-time OIDC linking:

1. Open **Users** as an administrator.
2. Open the target user and select **Allow OIDC linking**.
3. Confirm that the OpsKnight email is the identity you expect the provider to return.
4. Ask the user to complete a fresh OIDC sign-in before the approval expires.
5. Confirm the user reports a linked OIDC identity and has the expected role.

The approval is deliberately narrow:

- it expires after 168 hours (7 days);
- it is tied to the target user and expected email;
- it is scoped to the current provider configuration;
- it records a trust fingerprint derived from issuer + client ID;
- it is tied to the current OIDC configuration version;
- it can be renewed or revoked before use; and
- it is consumed atomically by the successful first link so the same approval generation cannot be replayed.

Changing security-relevant OIDC configuration makes outstanding approvals stale or revokes them. Renew the approval under the new provider configuration instead of trying to reuse it.

Once an identity is linked, later sign-ins resolve by `(issuer, sub)`. A later token may omit email and still resolve the already-linked principal, but current provider organization policy is re-evaluated on every login and an explicitly unverified email claim is still rejected.

### JIT provisioning

When **JIT Account Auto-Provisioning** is enabled and no existing identity or existing email account needs linking, an eligible external identity can create an OpsKnight user. User creation and immutable OIDC-identity creation occur in one serializable transaction so one cannot commit without the other.

JIT does not bypass provider policy, allowed-domain/organization checks, role mapping, or disabled-account protection. Disable JIT when every account must be created by an administrator or SCIM before first sign-in.

When JIT is disabled, an unknown identity is rejected. For a pre-created user, create the explicit OIDC-link approval before the first SSO login.

## Role and profile lifecycle

Role rules are evaluated at every OIDC sign-in. Rules are ordered and exact: the first rule whose claim contains the configured value wins. Claims can be a string or an array of strings.

- A matching rule can assign `USER`, `AUDITOR`, `RESPONDER`, or `ADMIN`.
- If no rule matches, an OIDC-managed role falls back to `USER`.
- If a previously OIDC-managed elevated claim disappears, OpsKnight can reduce that OIDC-owned role on the next sign-in rather than leaving an unexplained privilege behind.
- A manually managed role is not silently rewritten merely because no OIDC rule matched; check `roleSource` before deciding which system owns the role.
- A role change advances the user's security state so stale authorization sessions do not continue with the previous privilege.

For Microsoft Entra group mapping, test group overage at realistic directory size. If Entra signals that groups were omitted because of overage, OpsKnight does not interpret that as membership and does not grant the mapped elevated role.

Profile claims can update department, job title, and an HTTPS avatar URL. Profile mapping is deliberately narrower than identity: changing profile claims does not change the immutable `(issuer, sub)` binding.

Before enabling mappings broadly, test:

1. a normal user with no privileged claim;
2. every privileged mapping;
3. removal of each privileged group or role;
4. an unexpected claim type or missing claim;
5. Entra group overage if `groups` is used; and
6. a user whose local profile avatar must not be overwritten.

## Roll out safely

Use a staged rollout. Do not make SSO the only ordinary login path until a real user flow and the emergency path have both been proven.

1. Preserve and test a local administrator with a known password.
2. Configure the provider and complete **Test Connection**.
3. Assign a small provider-side pilot group.
4. Complete real OIDC sign-in for a normal pilot user and an administrator.
5. Test allowed, unassigned, wrong-organization/domain, disabled, existing-account, and unknown-account users.
6. Verify account linking/JIT behavior, role/profile mappings, logout, session expiry, and session revocation.
7. Deactivate a pilot at the provider or in OpsKnight and verify the expected denial path.
8. Expand provider assignments in stages while reviewing authentication and audit events.
9. Only then disable normal local login.

## Enforce SSO-only login

OIDC configuration is managed in the OpsKnight UI, but **local password admission is a deployment policy**. For an enterprise deployment, the recommended final state is SSO for normal users plus one deliberately isolated break-glass administrator.

Configure the web/integrated runtime with:

```env
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=emergency-admin@example.com
```

Restart every web/integrated replica after changing these environment variables. They are read by the authentication runtime; editing only one replica can create inconsistent login behavior behind a load balancer.

### What changes in SSO-only mode

When `AUTH_LOCAL_LOGIN_ENABLED=false`:

- normal email/password authorization is rejected server-side;
- the normal local-login form is not offered;
- forgot-password and reset-password API requests are rejected because normal local authentication is disabled;
- existing password hashes are not deleted; and
- OpsKnight does not automatically restore local login if the IdP becomes unavailable.

If break-glass is enabled with an email, the credentials provider remains available only for that exact normalized account. The login page labels the local form as emergency break-glass recovery and every other email is rejected before password verification.

### Prepare the break-glass administrator before enforcement

Do this **before** setting `AUTH_LOCAL_LOGIN_ENABLED=false`:

1. Use a dedicated OpsKnight `ADMIN` account that already has a working local password.
2. Confirm the account is `ACTIVE` and can sign in locally while normal local login is still enabled.
3. Store the credential in an approved password vault outside the normal IdP dependency.
4. Set the three environment variables above and restart all authentication-serving replicas.
5. In a private browser, verify a normal user's password is rejected.
6. Verify the break-glass account can still sign in with its local password.
7. Verify normal OIDC sign-in still works.
8. Record the drill and owner in the operational runbook.

The password-reset endpoints are disabled while normal local login is disabled, including for the break-glass identity. Therefore the emergency account must have a tested credential **before** enforcement. Losing that credential while the IdP is unavailable can remove the recovery path.

### Failure behavior

OpsKnight deliberately fails closed:

- If OIDC runtime validation fails and normal local login is disabled, ordinary users are not given password fallback.
- If break-glass is configured correctly, only that account retains local credential access.
- If both OIDC and the break-glass credential are unavailable, interactive administration is unavailable until the deployment policy or IdP is repaired.

For an emergency rollback, temporarily set `AUTH_LOCAL_LOGIN_ENABLED=true` and restart all web replicas. This re-enables local authentication for **every account that has a usable password**, not only administrators, so treat it as a controlled incident action and revert it after recovery.

### Authentication-policy reference

| Variable | Default/fallback | Purpose |
| --- | --- | --- |
| `AUTH_LOCAL_LOGIN_ENABLED` | `true` | Enables normal email/password sign-in. Set `false` to enforce SSO for normal users. |
| `AUTH_BREAK_GLASS_ENABLED` | `false` | Allows an emergency local credential exception when normal local login is disabled. |
| `AUTH_BREAK_GLASS_EMAIL` | unset | Exact emergency account email permitted to use credentials when break-glass is enabled. |
| `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT` | `true` | Requires verified email assurance for first binding on providers that support the standard claim; Entra uses provider-aware handling for a missing claim. |

## Configure OIDC session policy

OIDC sessions have server-enforced renewal, idle, absolute-expiry, and revocation boundaries in addition to the identity provider's own session. The **Access & Session Policies** UI can override maximum lifetime and idle timeout. Environment values provide the deployment defaults.

| Control | Supported range | Environment default | Built-in fallback |
| --- | --- | --- | --- |
| Maximum session lifetime | 15 minutes to 30 days | `AUTH_SSO_SESSION_MAX_AGE_SECONDS` | 12 hours |
| Idle inactivity timeout | 5 minutes to 7 days, and no longer than maximum lifetime | `AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS` | 4 hours |
| Reauthentication window | 15 minutes to 30 days | `AUTH_SSO_REAUTH_AFTER_SECONDS` | 12 hours |
| Session update interval | 1 minute to 24 hours | `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS` | 1 hour |

The UI overrides the first two controls. When maximum lifetime is explicitly overridden in the UI, it also becomes the effective OpsKnight reauthentication window. Invalid environment values fall back to the built-in value, and an idle timeout longer than maximum lifetime is clamped or rejected according to where it is configured.

Reauthentication means OpsKnight requires a new OIDC authentication cycle. It does **not** guarantee that the provider will show a password/MFA prompt: the IdP can reuse its own SSO session according to provider policy.

OpsKnight sessions also end when:

- the user's token/security version changes;
- the user becomes disabled or no longer resolves as an operational identity;
- the OIDC configuration version carried by the session no longer matches the active trust configuration;
- the idle or reauthentication boundary is reached; or
- the session reaches its effective expiry.

Shorten these settings only after testing responder workflows. An aggressive idle or reauthentication boundary can interrupt an active incident response session.

## Runtime availability and performance behavior

OIDC discovery is not fetched on every authenticated request. OpsKnight caches validated runtime metadata and uses single-flight refresh behavior:

- known-good metadata is fresh for about 5 minutes;
- it can be served stale for up to about 1 hour while validation is refreshed in the background;
- failed background validation uses a short backoff to avoid an IdP polling storm; and
- cold-start validation failures are negatively cached briefly.

This stale-while-revalidate behavior protects login-page and session-path performance during short discovery outages. It does **not** make the IdP itself optional: the authorization and token endpoints must still be reachable for a new OIDC login.

Saving OIDC configuration clears the authentication/configuration/metadata caches so an administrator's change takes effect without waiting for the normal cache TTL.

## Sign out behavior

Local OpsKnight sign-out is authoritative. For an OIDC-authenticated session, OpsKnight also uses the provider's validated `end_session_endpoint` when one is advertised and safe, passing the configured client ID and a same-origin post-logout redirect.

Provider logout is best-effort. If the provider does not advertise a supported logout endpoint or that request cannot be prepared, the OpsKnight session is still ended. A later SSO login can appear immediate if the IdP still has its own active browser session.

## Change the issuer, client registration, or secret

Treat identity-provider changes according to the trust boundary they affect.

### Rotate only the client secret

Create the replacement secret at the provider, enter it in OpsKnight, save, complete a real login, and revoke the old secret within the planned overlap. Secret replacement increments the OIDC configuration version, so existing OIDC sessions must authenticate again and unused first-link approvals are revoked.

### Change the client ID

A client-ID change changes the OIDC trust fingerprint and may also change subjects for providers that use pairwise identifiers. Save the new registration, create fresh linking approvals where required, and pilot existing accounts before broad rollout. Do not assume matching email makes the new client registration the same identity.

### Change the issuer

Changing issuer crosses the permanent identity trust boundary even when it represents the same vendor or tenant behind a different hostname. OpsKnight requires an explicit issuer-migration confirmation before saving.

On an issuer migration OpsKnight:

- increments the OIDC configuration version;
- revokes outstanding unused link approvals;
- advances the security/token version for users linked to the previous issuer so affected sessions are revoked; and
- requires fresh authentication under the new issuer.

Pilot the new issuer, verify stable subject behavior and role claims, issue new first-link approvals where needed, and only then retire the old issuer/provider registration.

Changing an Okta/Auth0 tenant to a custom domain is still an issuer change. Do not treat it as cosmetic.

## Troubleshooting

### The SSO button is missing

Check **Settings → System → SSO / OIDC** and confirm the configuration is enabled. Then verify the encrypted client secret can be decrypted and runtime metadata validation succeeds. OpsKnight only displays SSO when the authentication runtime considers the provider ready.

If discovery worked earlier but the provider is currently unreachable, inspect application logs and provider availability. Known-good metadata has a bounded stale-while-revalidate window; a cold start or fully expired cache still needs successful validation.

### OpsKnight says SSO is enabled but not configured correctly

Check the issuer, encryption key/keyring, client secret, token endpoint authentication method, and provider discovery/JWKS endpoints. If the encryption key changed without preserving the old decrypt key, the stored client secret can no longer be loaded.

### The provider reports redirect URI mismatch

Compare the provider entry with the callback displayed by OpsKnight character for character. Check HTTPS termination, forwarded host/scheme, port, path, and trailing-slash behavior. Correct public URL settings rather than registering an internal callback.

### Test Connection succeeds but login fails

That is possible by design: **Test Connection does not use the client credentials or perform an authorization callback**. Check provider application assignment, consent, client ID/secret, client authentication method, callback registration, emitted ID-token claims, allowed domain/organization policy, and first-link approval.

### An existing user receives Access denied

Check the user's OIDC linking state in **Users**. If no current identity is linked, create or renew **Allow OIDC linking** and retry with a fresh login. Expired, revoked, consumed, or stale approvals cannot be reused. A provider security change can intentionally invalidate an approval.

Do not delete/recreate the user and do not enable email-only automatic linking to work around this control.

### Microsoft Entra login is rejected

Use a tenant-specific workforce `/v2.0` issuer. `common`, `organizations`, and `consumers` are rejected. Confirm the user is assigned to the Enterprise Application and that expected app-role/group claims are emitted.

If a `groups` role rule works for small users but not highly-grouped users, check Entra group overage. OpsKnight deliberately avoids granting a mapped elevated role when the groups claim is omitted due to overage.

### Google Workspace user is rejected

When allowed domains are configured, check the signed `hd` claim. An email suffix alone is not accepted as proof of Workspace membership.

### Auth0 organization login is rejected

Confirm the configured value is the Auth0 organization ID (`org_...`), the user belongs to that organization, the authorization request uses Organizations, and the signed ID token contains the exact `org_id`. If allowed email domains are also configured, those checks apply as well.

### A generic/Okta identity is rejected by allowed domains

Allowed-domain enforcement for generic/Okta providers requires an exact email-domain match and `email_verified: true`. Do not use allowed domains as an organization boundary if the provider cannot securely assert mailbox verification.

### A mapped role is missing or unexpectedly reduced

Check claim name, value, type, case, mapping order, and `roleSource`. Mapping is first-match-wins and uses exact values. If an OIDC-managed elevated claim disappears, the OIDC-owned role can fall back to `USER` on a later sign-in.

### Break-glass login does not work

Verify all of the following:

- `AUTH_LOCAL_LOGIN_ENABLED=false`;
- `AUTH_BREAK_GLASS_ENABLED=true`;
- `AUTH_BREAK_GLASS_EMAIL` exactly matches the account email after lowercase/trim normalization;
- the account is not disabled;
- the account already has a usable password; and
- every authentication-serving replica was restarted with the same environment.

Password recovery is intentionally unavailable while normal local login is disabled. Repair the deployment policy from the host/orchestrator if the emergency credential was never prepared.

### A normal user's password still works after SSO enforcement

Check the effective environment on **every** web/integrated replica. If any replica still has `AUTH_LOCAL_LOGIN_ENABLED=true`, traffic routed to that replica can continue to admit normal credentials. Restart/roll out the complete workload and retest through the public load-balanced endpoint.

### Forgot password returns Local password authentication is disabled

This is expected in SSO-only mode. Password reset is part of normal local authentication and is blocked when `AUTH_LOCAL_LOGIN_ENABLED=false`.

### Login loops after a hostname change

Confirm `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, proxy forwarded headers, cookies, issuer configuration, provider callback/logout allowlists, and the browser-visible public HTTPS origin all agree.

### Users are signed out after an SSO configuration change

This is expected after security-relevant provider changes. The OIDC configuration version changes and existing sessions are rejected. Sign in again and investigate only if the new authentication flow fails.

### Sign out returns to login but SSO signs back in immediately

OpsKnight has ended its local session, but the identity provider may still have an active SSO browser session. Confirm the provider advertises a usable end-session endpoint and review the IdP's own logout/session policy.

For error-specific diagnosis and a symptom matrix, continue with [OIDC access problems](../../troubleshooting/login/oidc-access/). For directory lifecycle, continue with [SCIM provisioning](configure-scim/).
