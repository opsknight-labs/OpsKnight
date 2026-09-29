---
title: Configure OIDC single sign-on
description: Register Microsoft Entra, Google Workspace, Okta, Auth0, or a generic OIDC provider and safely roll out sign-in.
type: how-to
product_area: identity
audience: [administrator, operator]
keywords: [OIDC login, configure SSO, OpenID Connect, Entra, Google Workspace, Okta, Auth0]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/components/settings/SsoSettingsForm.tsx
    - src/app/(app)/settings/security/actions.ts
    - src/lib/oidc.ts
    - src/lib/oidc-validation.ts
    - src/lib/oidc/provider-policy.ts
    - src/lib/oidc/scopes.ts
    - src/lib/oidc-identity-resolution.ts
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

**Test Connection** validates discovery and metadata, not a real user login.
OpsKnight requires an HTTPS issuer, exact issuer agreement with discovery,
usable authorization/token/JWKS endpoints, approved asymmetric signing
configuration, and safe public endpoint resolution. It rejects unsafe
redirects, private-network discovery targets, and endpoint changes associated
with DNS rebinding.

Real sign-in additionally validates state, nonce, PKCE, token issuer and
signature, stable subject, organization policy, email assurance, account-link
policy, and server-side authorization. An explicit `email_verified: false` is
rejected. Email is required when creating or first-linking an account; an
already-linked identity can continue when a later token omits email.

Default requested scopes are:

```text
openid email profile
```

Do not add those again. OpsKnight does not store or use OIDC refresh tokens and
rejects `offline_access`.

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

After finishing the provider registration:

1. Open **Settings → System → SSO / OIDC**.
2. Choose the provider template. For Okta or Auth0 custom domains, this choice
   keeps the appropriate stricter provider policy; it cannot make an arbitrary
   issuer inherit Google or Entra trust.
3. Enter the issuer, client ID, client secret, and matching token endpoint
   authentication method.
4. Select **Test Connection**. Continue only when discovery validates.
5. Enter a provider label if the sign-in button needs an organization-specific
   name.
6. Decide whether **JIT Account Auto-Provisioning** is allowed. When disabled,
   unknown external identities are denied.
7. Set allowed domains or Auth0 organization ID only when they represent the
   intended security boundary.
8. Add only provider-supported custom scopes. Built-in scopes are automatic.
9. Add claim-to-role rules. Rules can assign `USER`, `AUDITOR`, `RESPONDER`, or
   `ADMIN`; use exact, stable claim values and give elevated groups narrow
   membership.
10. Optionally map bounded claims to department, job title, and avatar fields.
11. Save the configuration, then test a real sign-in in a private browser with
   a non-administrator pilot account.

Connection testing does not prove callback, user assignment, consent, claims,
or account-link behavior. A real pilot login is mandatory.

## Existing users and first-time linking

OpsKnight never links an OIDC subject to an existing user merely because their
email addresses match. For each existing user who will sign in through OIDC:

1. Open **Users** as an administrator.
2. Find the active or invited user.
3. Select **Allow OIDC linking** and confirm the expected account.
4. Ask the user to complete a fresh OIDC sign-in before the approval expires.
5. Confirm the user now shows as linked and has the intended role.

Approvals are time-limited, renewable, revocable, scoped to the current issuer
and provider configuration, tied to the expected email, and consumed atomically
on successful linking. Once linked, later sign-ins resolve by `(issuer, sub)`.

When JIT provisioning is enabled, an eligible unknown identity can create an
account and identity link atomically. Domain/organization and role policies are
still enforced. Disable JIT if directory assignment must precede every account.

## Role and profile lifecycle

Claim rules are evaluated at sign-in. OpsKnight records whether the role source
is manual, OIDC, or SCIM. If an OIDC-managed elevated claim disappears, the
OIDC-owned role can be reduced according to the current mapping rather than
remaining as an unexplained manual grant.

Before enabling role mapping broadly, test:

- a normal user with no privileged claim;
- every privileged mapping;
- removal of a privileged group or role;
- an unexpected claim type or missing claim; and
- Entra group overage if groups are used at scale.

Never map a broad all-employees group to `ADMIN`.

## Roll out safely

1. Preserve and test a local break-glass account.
2. Assign a small provider-side pilot group.
3. Test allowed, unassigned, wrong-domain, deactivated, and existing-account
   users.
4. Verify role and profile mappings, logout, and session expiry.
5. Deactivate a pilot at the provider and confirm the expected access outcome.
6. Expand assignments in stages while monitoring authentication audit events.
7. Disable local login only after break-glass recovery is rehearsed.

Local credential login is controlled by `AUTH_LOCAL_LOGIN_ENABLED`. Emergency
access uses `AUTH_BREAK_GLASS_ENABLED` and `AUTH_BREAK_GLASS_EMAIL`. Keep its
credential outside the SSO dependency and protect use through an operational
runbook.

OIDC sessions have independent absolute, idle, renewal, and update-age settings
under the `AUTH_SSO_*` configuration family. Requiring a new OpsKnight OIDC
session does not necessarily force the identity provider to prompt for a
password because the provider can reuse its own SSO session.

## Change the issuer or rotate the secret

Rotating only the client secret does not change identity ownership. Create the
replacement at the provider, update OpsKnight, test login, and revoke the old
secret within the planned overlap.

Changing issuer changes the identity trust boundary—even when it represents the
same Okta/Auth0 tenant behind a custom domain. OpsKnight requires explicit
issuer-migration confirmation and invalidates affected sessions and outstanding
link approvals. Pilot the new issuer, prepare new linking approvals as needed,
verify stable subjects and roles, and only then retire the old issuer.

## Troubleshooting

### The SSO button is missing

Confirm the configuration is enabled, discovery still validates, and the
encrypted client secret can be decrypted with the current encryption key.

### The provider reports redirect URI mismatch

Compare the provider entry with the callback displayed by OpsKnight character
for character. Check HTTPS termination, forwarded host/scheme, port, path, and
trailing slash. Correct public URL settings rather than registering an internal
callback.

### Test Connection succeeds but login fails

Connection testing does not perform authorization. Check application
assignment, consent, client authentication method, callback, emitted ID-token
claims, allowed domain/organization policy, and first-link approval. Capture a
request ID and provider error without recording authorization codes or tokens.

### Entra login is rejected

Use a tenant-specific `/v2.0` issuer. Do not use `common`, `organizations`, or
`consumers`. Confirm the user is assigned to the enterprise application and
that app roles or group claims are present in the ID token.

### Google Workspace user is rejected

Check that the account's signed `hd` claim exactly matches an allowed domain.
An email suffix alone is insufficient.

### Auth0 organization login is rejected

Confirm the configured value is the organization ID (`org_...`), the user is a
member, the application supports organization login, and the ID token contains
the matching `org_id`.

### An existing user cannot sign in

Check whether an identity is already linked. If not, create or renew the user's
OIDC linking approval. Do not delete and recreate the user or enable email-only
linking.

### A mapped role is missing

Inspect the provider's ID token claim configuration without copying a token
into a ticket or chat. Claim name, value, type, and case must match the rule.
For Entra, check group overage; for Okta/Auth0, ensure the claim is emitted for
the selected authorization server, application, and connection.

### Login loops after a hostname change

Confirm `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, proxy forwarded headers, cookies,
issuer configuration, and provider callback/logout allowlists all refer to the
same public HTTPS origin.

For error-specific diagnosis, see
[OIDC access problems](../../troubleshooting/login/oidc-access/). For account
lifecycle, continue with [SCIM provisioning](configure-scim/).
