---
title: Configure SCIM provisioning
description: Configure isolated SCIM connectors, rotate credentials, and safely bind directory groups to operational teams.
type: tutorial
product_area: identity
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Configure and verify SCIM user and group provisioning end to end.
keywords:
  [
    SCIM provisioning,
    Entra provisioning,
    Okta provisioning,
    SCIM users,
    SCIM groups,
    team synchronization,
    identity lifecycle,
  ]
verification:
  level: source
  verified_at: 2026-10-21
  evidence:
    - src/lib/scim.ts
    - src/app/api/scim/v2/Users/route.ts
    - src/app/api/scim/v2/Users/[id]/route.ts
    - src/app/api/scim/v2/Groups/route.ts
    - src/app/api/scim/v2/Groups/[id]/route.ts
    - src/app/api/scim/v2/ServiceProviderConfig/route.ts
    - src/app/api/scim/v2/ResourceTypes/route.ts
    - src/app/api/scim/v2/Schemas/route.ts
    - tests/api/scim-users.test.ts
    - tests/api/scim-groups.test.ts
    - tests/api/scim-metadata.test.ts
    - src/components/settings/ScimSettingsSection.tsx
---

# Configure SCIM provisioning

SCIM manages directory identities independently from SSO. OIDC controls sign-in and
its explicit role mapping; SCIM profile changes never change system roles or role
ownership. Dedicated emergency accounts and credentials are separate database
principals and cannot be targeted through SCIM Users.

## Upgrade existing connections

Run the database migrations before deploying application replicas that use the new
registry. The migrations retain existing SCIM user and group IDs. Directory groups
are copied from teams with a non-null legacy external ID, including directory user
memberships. Operational teams, services, incidents, escalation rules, dashboard
references, owners and manually granted memberships remain in place.

Existing teams are **not automatically bound**. Review each directory group in the
SCIM workspace and approve a team binding after viewing its impact. Previously
provisioned teams without a stable external ID require administrator review; they
are not exposed to directory credentials by matching their names.

Historical profile-only SCIM writes that overwrote the role source of an OIDC-linked
account are repaired to OIDC authority. Re-evaluate privileged mappings during the
pilot rollout. The migration grants no new roles.

The `legacy` connector initially uses the existing database configuration or, only
when no database configuration exists, `SCIM_BEARER_TOKEN`. A disabled database
configuration, invalid database token, or database outage never falls back to an
environment token. Creating the first registry credential retires the legacy lane
immediately and replaces the legacy database record with a disabled migration marker so older replicas cannot restore its environment fallback. Drain SCIM traffic to old application versions before the cutover. Copy and verify the replacement in the provider during a maintenance
window; the legacy lane has no overlap after that transition.

## Create and configure a connection

Open **Settings → System → SCIM → Connections**. Name the connection, select Entra,
Okta or Generic, and enable provisioning. Select **Save as a new connection** for a
separate directory authority. Users, groups and credentials are isolated by
connection; knowing another connector's internal resource ID grants no access.

Choose which profile attributes the connection owns (name, email, title, department, photos). Updates to fields owned elsewhere are rejected; omitted fields owned elsewhere are preserved. Account status is owned by the approved lifecycle connection, while roles remain OIDC or manual.

Use the displayed base URL:

```text
https://opsknight.example.com/api/scim/v2
Authorization: Bearer <one-time-secret>
```

In **Security**, create a credential with a descriptive purpose, the required
`users:read`, `users:write`, `groups:read`, and `groups:write` scopes, an expiration
of 1–365 days, and a previous-credential overlap of 0–1,440 minutes. The default is
90 days and 60 minutes of overlap. Store the secret in the provider immediately.
Only its SHA-256 digest and last four characters are stored. The new secret is
shown once and cleared from the screen after five minutes. It cannot be revealed
later.

Credential creation, rotation, revocation, source changes, binding approvals and
restoration approvals require a current administrator who signed in within the
existing two-hour freshness window. Emergency recovery timing is unchanged.

During registry rotation, existing credentials expire no later than the chosen
overlap deadline. Test the new credential before retiring the previous credential.
You can return the provider to the previous token during its remaining overlap.
Immediate revocation has no overlap. Credential validity and write admission are
checked against PostgreSQL on every replica.

Disabling a connection blocks provisioning without deleting users, groups, teams
or operational associations. It does not itself offboard users: disable accounts
through the provider before disconnecting when access removal is intended.

## Map provider attributes

Configure an immutable directory object identifier as `externalId` on creation.
RFC 7643 makes this attribute optional, but the OpsKnight connector contract
requires it to prevent unsafe identity adoption and ambiguous retries.

Map the login email to `userName`. The single supported work email must equal
`userName`. Map `displayName`, `name.formatted`, `name.givenName`,
`name.familyName`, `active`, `title`, and the enterprise-user extension
`department` as needed. Profile images accept HTTP(S) URLs. Unmapped attributes,
privilege changes and unsupported PATCH paths fail with SCIM errors.

For Entra, use Enterprise applications → Provisioning → Automatic. Enter the Tenant
URL and one-time Secret Token. Map `objectId` to `externalId` and the intended login
email to `userName`. Enable group provisioning only after reviewing the directory
to operational-team boundary.

For Okta, configure SCIM Integration with HTTP Header bearer authentication and
`userName` lookup. Map an immutable directory identifier to `externalId`; enable
create, update and deactivate. Push Groups creates directory groups. Team bindings
require separate approval.

## Verify lifecycle behavior

Provider Test Connection verifies connectivity and authentication, not the full
lifecycle. Use disposable accounts and groups:

1. Create a user; query it by `externalId` and confirm its stable returned ID.
2. Update its profile; verify role authority and session version are unchanged.
3. Create a group; add/remove users already provisioned through that connection.
4. View the group under **Users & Groups**, select an operational team and preview
   additions, protected owners, services and escalation rules. Approve the preview.
5. Replace membership; verify manual memberships and owner privileges survive.
6. Disable the user; ordinary access is revoked. Review Activity for affected team
   memberships and future on-call shifts, and arrange operational coverage.
7. Reactivate through the same source and confirm the same identity is retained.
8. Delete the group; the directory group is removed while team membership and
   operational routing remain intact.
9. Rotate and revoke credentials, then confirm retired tokens fail.

Local team edits establish manual membership authority. Directory synchronization
removes only membership rows it created and still owns. Detaching a binding retains
operational memberships. The API never receives authority to delete operational
teams through ordinary group deletion.

## Existing accounts, SSO and rehires

Email collisions return `409`; they never authorize account adoption. In
**Diagnostics**, an administrator can approve an existing account binding using a
verified OpsKnight user ID and immutable directory ID. The approval preserves
status and role authority and explicitly grants that connection lifecycle control.
One connection owns a user's lifecycle at a time.

Existing OIDC linking approval remains available. For Entra, an administrator may
opt into the trusted bridge only after binding the exact tenant, issuer and OIDC
client ID. Automatic linking requires matching verified tenant/object claims and
a live directory identity from that exact registered source. Ambiguous matches
are rejected. Email equality alone never authorizes the bridge.

SCIM-disabled users cannot reactivate through JIT sign-in. DELETE retains a
disabled account and identity tombstone for audit, preventing a new POST from
adopting it. Approve restoration in **Users & Groups**, then have the provider
reactivate the existing resource. Restoration approval alone does not enable
access.

## Supported protocol

Discovery endpoints include `/ServiceProviderConfig`, `/ResourceTypes`,
`/ResourceTypes/{User|Group}`, `/Schemas` and `/Schemas/{schema-URN}`. They advertise
core User/Group schemas and the supported enterprise-user extension. PATCH,
equality filters and offset pagination are supported. Bulk, sorting, password
changes and ETags are not advertised.

Users support create, read, PUT, ordered atomic PATCH, disable/reactivate and safe
DELETE. Equality filters support `externalId` and `userName`. Groups support
create, read, rename, PUT, ordered atomic PATCH and detach-on-DELETE. Equality
filters support `displayName`, `externalId` and `id`. Group queries honor
`excludedAttributes=members` without loading member collections.

`startIndex` is a positive integer; `count` is a nonnegative integer capped at
100. `count=0` returns only the result count. Ordering is deterministic. Requests
are capped at 1 MiB, 100 PATCH operations and 10,000 members per group mutation.
Each connector admits at most 600 requests per minute through a shared PostgreSQL
counter. Unsupported queries and paths fail explicitly.

Responses use `application/scim+json`, stable resource metadata and `Location` on
creation. Errors use SCIM bodies; `401` includes a bearer challenge, `403` denotes
missing scope, `409` denotes identity/security conflicts, and `429`/`503` include
`Retry-After`. Internal database errors and bearer secrets are never returned.

## Diagnostics and reconciliation

Activity is durable and written in the same transaction as lifecycle mutations.
A failed audit insert rolls the mutation back. `X-Request-ID` correlates API
responses with mutation activity. No raw bearer tokens or provider payloads are
stored in activity records.

Diagnostics compares the first 25 local group/team bindings against stored
directory intent. Preview and approve a binding again to repair missing
memberships. This comparison cannot infer the provider's current remote state;
use provider logs for assignments or changes the provider has not delivered.
Directory and activity lists use server pagination and bounded searches.

OpenTelemetry instruments `scim.requests`, `scim.request.duration` and
`scim.authentication.failures`; configure the application's OpenTelemetry
exporter to collect them. PostgreSQL credential last-use/expiry and activity
records provide durable operational history. Monitor database lock waits,
serialization retries, pool saturation and deactivation warnings alongside these
metrics. Profile-only updates do not revoke unrelated user sessions.

## Certification and rollout

See `plans/scim-enterprise/certification.md` in the
repository for reproducible unit, PostgreSQL, capacity, browser and multi-replica
checks and their limitations. Live Entra/Okta tenant certification is distinct
from local provider-shaped request tests. It remains a release gate when those
tenants are available.

Use a database backup and a pilot source before rollout. Restore a backup to an
isolated environment and rehearse the rollout. After adopting the isolated group
model, reverting to the old application would restore unsafe operational-team
semantics; rollback requires a reviewed application/database recovery procedure,
not automatically dropping identity or audit tables.

Authoritative compatibility inputs: [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644),
[Microsoft Entra SCIM guidance](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups),
and [Okta SCIM 2.0 guidance](https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/).
