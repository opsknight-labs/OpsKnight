---
title: Configure SCIM user provisioning
description: Connect Microsoft Entra, Okta, or another SCIM client and verify user provisioning and deprovisioning.
type: how-to
product_area: identity
audience: [administrator, operator]
keywords: [SCIM provisioning, Entra provisioning, Okta provisioning, SCIM users, identity lifecycle]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/scim.ts
    - src/app/api/scim/v2/Users/route.ts
    - src/app/api/scim/v2/Users/[id]/route.ts
    - tests/api/scim-users.test.ts
---

# Configure SCIM user provisioning

OpsKnight exposes a SCIM 2.0 **Users** API for directory-driven account
creation, updates, activation, and deactivation. Use OIDC for interactive login
and SCIM for lifecycle management:

```text
OIDC -> authentication and sign-in claims
SCIM -> account provisioning and deprovisioning
```

OpsKnight 2.0 does not expose a SCIM Groups resource. Configure team membership
inside OpsKnight and use [OIDC role mapping](configure-oidc/) or provider-side
assignment policy for broad authorization lifecycle. Do not configure a
provider to call `/Groups`.

## Before you begin

You need:

- administrator access to the identity provider and the OpsKnight deployment;
- an externally reachable HTTPS OpsKnight origin;
- a high-entropy bearer token stored in the deployment secret manager; and
- a small pilot group containing synthetic or low-risk test users.

Generate at least 32 random characters. For example:

```bash
openssl rand -hex 32
```

Store the value as the `SCIM_BEARER_TOKEN` runtime secret and restart affected
web replicas according to your deployment method. Do not reuse the OIDC client
secret, put the value in source control, or paste it into tickets.

The base URL is:

```text
https://opsknight.example.com/api/scim/v2
```

The Users collection is:

```text
https://opsknight.example.com/api/scim/v2/Users
```

Clients send the token as:

```http
Authorization: Bearer <SCIM_BEARER_TOKEN>
```

OpsKnight rejects a missing or configured token shorter than 32 characters and
compares the supplied bearer credential using timing-safe comparison.

## Supported contract

The supported resource schema is:

```text
urn:ietf:params:scim:schemas:core:2.0:User
```

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/Users` | List or filter SCIM-managed users |
| `POST` | `/Users` | Create one user |
| `GET` | `/Users/{id}` | Read one SCIM-managed user |
| `PUT` | `/Users/{id}` | Replace supported user attributes |
| `PATCH` | `/Users/{id}` | Apply supported replace operations |
| `DELETE` | `/Users/{id}` | Deprovision and remove the SCIM identity binding |

The principal fields are:

| SCIM field | OpsKnight behavior |
| --- | --- |
| `id` | Stable OpsKnight user ID returned as the SCIM resource ID |
| `externalId` | Required stable directory identifier; immutable after creation |
| `userName` | Required, normalized email address |
| `displayName` | Display name; falls back to the email local part on creation |
| `emails` | Primary work-email representation returned by OpsKnight |
| `active` | Maps to active or disabled account status |

Creation requires a valid email-shaped `userName` and a non-empty `externalId`.
A duplicate email or external ID returns a conflict rather than adopting an
unmanaged account. Choose a directory object ID that is never reassigned to a
different person.

The collection supports one-based `startIndex` and bounded `count` pagination.
It supports these equality filters only:

```text
externalId eq "directory-object-id"
userName eq "person@example.com"
```

Unsupported filter expressions fail explicitly. A filter never exposes an
ordinary non-SCIM account, even when its email matches.

`PUT` can replace email, display name, and active state but cannot change
`externalId`. `PATCH` supports replace behavior for `active` and `displayName`;
unsupported operations and paths return a SCIM error.

## Configure Microsoft Entra provisioning

Create or reuse the Enterprise application associated with OpsKnight, then:

1. In Microsoft Entra admin center, open **Identity → Applications → Enterprise
   applications** and select the OpsKnight application.
2. Open **Provisioning** and choose **New configuration** or set provisioning
   mode to **Automatic**, depending on the portal view.
3. Under **Admin Credentials**, enter the OpsKnight SCIM base URL as **Tenant
   URL** and `SCIM_BEARER_TOKEN` as **Secret Token**.
4. Select **Test Connection**. A successful connection proves the URL and
   bearer credential, not the full lifecycle mapping.
5. Open **Mappings** or **Attribute Mapping**, select the user mapping, and
   remove mappings for attributes OpsKnight does not support.
6. Map a stable Entra object identifier to `externalId`, the sign-in email to
   `userName`, a readable name to `displayName`, and account enabled state to
   `active`.
7. Use `externalId` or the intended immutable source value as the matching
   property. Do not use display name.
8. Disable group-object provisioning because OpsKnight has no SCIM Groups
   endpoint.
9. Under **Settings**, scope synchronization to assigned users and groups, add
   an operator notification email, and preserve accidental-deletion protection
   where it fits the offboarding policy.
10. Assign only the pilot group and use **Provision on demand** for one test
    user.

Expected result: Entra reports successful creation and the user appears in
OpsKnight **Users** with the expected email, name, active state, and SCIM-owned
lifecycle. Then change the display name, disable the test account, and provision
again to prove update and deactivation before selecting **Start provisioning**.

Entra OIDC and Entra provisioning use different credentials. The OIDC client
secret must not be entered as the SCIM Secret Token.

## Configure Okta provisioning

In the Okta application used for OpsKnight:

1. Open the application and select **General**. If necessary, enable SCIM
   provisioning in the application's provisioning settings.
2. Open **Provisioning → Integration** and configure a SCIM 2.0 connection.
3. Enter the OpsKnight SCIM base URL.
4. Use **HTTP Header** authentication and enter `SCIM_BEARER_TOKEN` as the API
   token.
5. Set the unique identifier field to `userName` where the Okta connector asks
   for it, while mapping the stable Okta user ID to `externalId`.
6. Select **Test API Credentials** and save.
7. Under **To App**, enable **Create Users**, **Update User Attributes**, and
   **Deactivate Users**. Do not enable group push to OpsKnight.
8. Keep only supported mappings: email to `userName`, stable ID to `externalId`,
   readable name to `displayName`, and lifecycle status to `active`.
9. Assign one pilot user, inspect the provisioning task, then update and
   deactivate that user.

Expected result: Okta creates exactly one resource, subsequent synchronization
updates the same resource, and unassignment/deactivation disables access rather
than creating another account.

## Configure another SCIM client

Use SCIM 2.0 bearer authentication, the base URL above, and only the documented
Users operations and fields. Before enabling recurring synchronization, run a
controlled lifecycle:

1. `GET /Users?filter=userName eq "pilot@example.com"` and confirm no resource
   is returned.
2. `POST /Users` with `externalId`, `userName`, `displayName`, and `active:true`.
3. Store the returned `id`; use that OpsKnight ID in item URLs.
4. `GET /Users/{id}` and confirm the normalized representation.
5. Change `displayName` using a supported replace operation.
6. Set `active:false` and confirm sign-in/session access is revoked.
7. Reactivate only if that matches the organization's rehire policy.
8. Exercise `DELETE` in the test environment and verify the retention behavior
   below.

Do not infer Groups, bulk, sorting, arbitrary filter, password, manager, phone,
address, or entitlement support from general SCIM specifications. The table in
this page is the 2.0 product contract.

## Verify provisioning end to end

After provider connection succeeds, complete all of these checks:

1. **Authentication rejection** — a request with no token and one with a wrong
   token both return unauthorized.
2. **Create** — provision a unique test user and confirm one OpsKnight account
   is created.
3. **Reconciliation** — filter by both `externalId` and `userName`; each finds
   the same resource.
4. **Idempotence** — run provider synchronization again and confirm it updates
   rather than duplicates the account.
5. **Update** — change display name and email, then confirm only the intended
   user changes.
6. **Deactivate** — set `active=false`; confirm the account is disabled and an
   existing browser session can no longer continue.
7. **History** — confirm incident ownership, audit entries, and historical
   references remain intelligible.
8. **Reactivation** — if supported by policy, re-enable the user and confirm the
   intended state and role source.
9. **Scope** — verify an unassigned directory user is not provisioned.
10. **Failure visibility** — confirm provider alerts and OpsKnight logs expose a
    failed provisioning attempt without logging the bearer token.

Do this in a non-production or pilot scope. Do not test deprovisioning with the
only administrator or break-glass account.

## Deactivation and DELETE behavior

Setting `active=false` disables the account. Security-sensitive deactivation
increments the user's session/token version so existing access is invalidated
rather than waiting for the previous session lifetime.

`DELETE /Users/{id}` does **not** physically erase the internal user record.
OpsKnight:

1. disables the account;
2. invalidates sessions;
3. clears the SCIM external identity so it leaves the SCIM namespace; and
4. retains the disabled internal record for incident history, audit records,
   and ownership references.

After DELETE, `GET /Users/{id}` no longer exposes that user as the same
SCIM-managed resource. This retained record is expected and must not be treated
as a failed deletion. Decide how the identity provider should handle a later
rehire or re-provisioning event, especially when the same email is retained but
the prior SCIM binding was deliberately cleared.

## Coordinate SCIM, OIDC, and roles

SCIM `externalId` and OIDC `(issuer, sub)` are separate stable identities. Email
matching alone cannot transfer either identity to another account.

OpsKnight tracks whether a role is managed manually, by OIDC, or by SCIM. Pick
one authoritative path for elevated roles and document it:

- If OIDC claims own roles, change provider groups/app roles and let sign-in
  evaluate the current mapping.
- If administrators own roles, do not imply that SCIM group assignment manages
  them.
- Because SCIM Groups is unsupported, do not promise team membership or group
  push through the provisioning connector.

Offboarding should remove application assignment, deactivate the SCIM account,
and disable provider sign-in. Verify the actual deactivation result rather than
assuming one system automatically completes every step.

## Rotate the bearer token

`SCIM_BEARER_TOKEN` is a single configured credential; there is no application
UI for multiple simultaneous SCIM tokens. Plan rotation as a short maintenance
operation:

1. Pause provider provisioning jobs.
2. Generate and store the replacement token in the deployment secret manager.
3. Update OpsKnight and roll/restart the web service.
4. Update the provider's Secret Token/API Token immediately.
5. Test the connection and provision one pilot update.
6. Resume provisioning and securely remove the old value.

Because only one runtime token is accepted, do not describe rotation as a
long-lived dual-token overlap. Keep the pause short and monitor provider retry
queues afterward.

## Monitor and audit

Review provider provisioning logs and OpsKnight system logs for creates,
updates, deprovisioning, conflicts, and authorization failures. Record the HTTP
status, SCIM error detail, request time, provider job ID, and sanitized resource
ID. Never record the bearer token or full authorization header.

Set alerts for repeated `401`, `409`, or `5xx` responses and for a provisioning
job entering quarantine or stopping. A successful periodic job should still be
audited after directory mapping or scope changes.

## Troubleshooting

### Every request returns `401`

Confirm `SCIM_BEARER_TOKEN` is present in the running web service, contains at
least 32 characters, and matches the provider's bearer token. Check for an
accidental newline or stale replica after secret rotation. Do not print the
token while diagnosing.

### Test connection fails with `404`

Use the base URL ending in `/api/scim/v2`, not the OIDC callback, application
home page, or a `/Groups` path. Confirm the reverse proxy forwards `/api/scim/`.

### Provisioning returns `409`

Search by both `externalId` and `userName`. A duplicate email/external ID or an
attempt to change immutable `externalId` is a conflict. Correct the source
mapping; do not delete an unrelated account to make the retry pass.

### Lookup does not find an OpsKnight user

Only SCIM-managed users are returned. An ordinary local/OIDC account with the
same email is intentionally excluded and cannot be silently adopted.

### Deactivation did not remove historical data

That is expected. Deactivation and DELETE revoke access but preserve the
internal user needed for audit and incident history.

### The provider repeatedly calls `/Groups`

Disable group provisioning/group push for this connector. OpsKnight 2.0
supports Users only; use OIDC claim mapping or OpsKnight administration for
roles and teams.

### The user still appears signed in

Confirm the provider operation succeeded, the account is disabled in
OpsKnight, all web replicas share current database/session state, and the client
made a new authenticated request. Review session and audit events; do not wait
for the old browser UI to refresh as proof.

Continue with [OIDC single sign-on](configure-oidc/) for authentication and
[manage users](../administration/manage-users/) for manual account operations.
