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
  verified_at: 2026-10-23
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
    - src/app/(app)/settings/system/scim-actions.ts
    - src/lib/scim/lifecycle/users.ts
    - src/lib/scim/lifecycle/membership.ts
    - src/lib/microsoft-teams/identity.ts
---

# Configure SCIM provisioning

SCIM manages directory identities independently from SSO. OIDC controls sign-in and
its explicit role mapping; SCIM profile changes never change system roles or role
ownership. Dedicated emergency accounts and credentials are separate database
principals and cannot be targeted through SCIM Users.

## Prerequisites

Before configuring SCIM provisioning:

- Ensure OpsKnight is running with a canonical public HTTPS URL.
- Verify you hold an active administrator session within the two-hour step-up window.
- Ensure your identity provider (Microsoft Entra ID, Okta, or generic SCIM 2.0 client) supports bearer token authentication.

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
   additions, removals, grant transfers, protected owners, affected users' session
   invalidations, services and escalation rules. Approve the preview. If contributing
   directory or team state changes, refresh the preview before approving.
5. Replace membership; verify manual memberships and owner privileges survive.
6. Disable the user; ordinary access is revoked. Review Activity for affected team
   memberships and future on-call shifts, and arrange operational coverage.
7. Reactivate through the same source and confirm the same identity is retained.
8. Delete the group; its solely directory-owned team memberships are revoked.
   Manual grants, owners and operational configuration remain intact.
9. Rotate and revoke credentials, then confirm retired tokens fail.

Pre-existing manual memberships and explicit local role changes establish manual authority. Directory synchronization
removes only membership rows it created and still owns. Deleting a group or detaching a binding revokes its directory-owned memberships
unless another approved group still grants them. Notification preferences never
convert a directory grant to manual ownership. Local role promotions and
pre-existing manual memberships remain. Revocation invalidates ordinary sessions
and clears a revoked member’s team-lead assignment; services, schedules and
escalation rules remain for coverage review. The API never receives authority to delete operational
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
create, read, rename, PUT, ordered atomic PATCH and grant-revocation-on-DELETE. Equality
filters support `displayName`, `externalId` and `id`. Group queries honor
`excludedAttributes=members` without loading member collections.

`startIndex` is a positive integer; `count` is a nonnegative integer capped at 100. `count=0` returns only the result count. Ordering is deterministic. Requests
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

Diagnostics compares local group/team bindings against stored directory intent
in pages of 25. Use the page controls to inspect bindings beyond the first page.
Preview and approve a binding again to repair missing
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

## Lifecycle and revocation policy

Creation defaults to active when `active` is omitted. Existing users retain their
current status on profile-only PUT/PATCH. Only an explicit `active: true` from the
approved lifecycle connector restores ordinary access. `active: false` retains
directory membership intent while denying ordinary sign-in and authorization.
DELETE disables and tombstones the identity, clears its directory memberships,
and revokes derived team grants atomically. Manual memberships and owners remain.
Restoration approval followed by reactivation does not restore old directory
team permissions: the provider must send new group membership assignments.

Ordinary session refresh reads PostgreSQL security state on every request;
process-local projection caching is bypassed for JWT security decisions. API
credential validation and resource permissions also read current database state.
There is no five-second cache allowance for these paths. Requests authorized
before a revocation commits may already be executing. Infrastructure latency,
replication configuration and non-SCIM authentication surfaces still require
production certification.

Credential creation/rotation preserves connection enablement. Enable/disable is
a separately audited connection update. Credential last-use writes are coalesced
to approximately one minute, while validity/revocation is checked each request.
`SCIM_CONNECTOR_REQUESTS_PER_MINUTE` defaults to 600 and is bounded to 1–1200.
Pre-authentication admission is process-local and bounded to 4096 pseudonymous
keys; repeated unknown tokens are negatively cached for at most five seconds.
It does not cache successful credential authorization. Network-wide abuse control
remains an ingress deployment responsibility.

## Upgrading legacy membership ownership

Imported legacy groups have no automatic operational team authority. Select the
imported group and its matching original team in **Users & Groups**. Preview the
binding to see eligible existing MEMBER rows, protected owners and routing usage.
Individually select only memberships independently verified as directory-owned,
then preview again and approve the pinned impact. Unselected manual memberships,
ADMIN/OWNER roles and existing grants remain unchanged. Adoption changes grant
provenance without deleting or recreating team memberships. Subsequent directory
removal can revoke only adopted or newly created directory grants.

## Large-group responses

Group collections default to 10 resources and at most 100 requested resources.
Full-member pages have a shared budget of 10,000 member entries; `itemsPerPage`
may therefore be less than `count`. Continue with `startIndex + itemsPerPage`.
Every returned group includes its entire membership; membership is never silently
truncated. Request `excludedAttributes=members` to enumerate metadata for up to
100 groups without loading member collections. Individual full representations
support up to 10,000 members. Oversized representations return SCIM 413; responses
also have an 8 MiB serialized byte limit. Reduce count or exclude members when
requested by the error. `count=0` still returns totals without representations.

### Case handling, optional fields and large diagnostics

`userName` equality is case-insensitive, including explicitly linked existing accounts whose
stored email uses mixed case. A non-unique PostgreSQL `lower(email)` index supports these
lookups without rewriting historical accounts. SCIM creates, renames and new directory
bindings reject conflicting case-insensitive names rather than silently adopting an account.
Existing historical duplicates need administrator review; the migration neither merges nor
deletes them. The additive index uses ordinary `CREATE INDEX`, which blocks writes
to the User table while it builds; rehearse its duration on a production-sized
restored copy before rollout. Email-formatted login names and a single matching work email remain the
supported OpsKnight contract.

Group member objects may include the standard `type: "User"` subattribute. Nested
`type: "Group"` memberships are unsupported and rejected. Removing optional `displayName`
falls back to the remaining formatted/structured name or the login-name prefix. Required
login attributes, lifecycle status and role authority remain protected.

The legacy credential warning is independent of credentials on other connections and is
visible while using another connection. Registry cutover on the legacy connection requires
fresh administrator authorization and explicit acknowledgement: its old environment or
database token stops working immediately. The overlap setting applies to registry
credentials, not to the old legacy token. Disabled connections label unexpired credentials
as blocked rather than active.

Drift diagnostics return up to 25 binding summaries using PostgreSQL counts and anti-joins.
They do not return directory/team member arrays to the application. Desired team access is
the union of every bound source; manual memberships are counted separately. Changing legacy
adoption selections invalidates the preview and disables approval until it is refreshed.

New user inserts and email renames share a PostgreSQL canonical-email reservation,
including invitations, OIDC JIT and SQL writes. Historical case variants remain
unchanged; their reservation lasts until the last holder changes address or is
deleted. Case-only edits do not merge accounts. The seventh migration backfills
reservation counts under a User-table write lock; rehearse its duration on a
production-sized restored snapshot before scheduling the upgrade. Backups and
restores must include the reservation table and its database trigger.
The reservation migration explicitly wraps its lock, backfill and trigger
installation in one transaction. If an earlier version was already applied in a
shared environment, reconcile migration history before deploying the revised file.

Name-only PATCH requests preserve local custom avatars when photos are not
explicitly modified; generated default avatars can refresh their initials. Group
mutation responses are serialized and checked against the byte budget before
commit. A 413 rolls back directory changes and their audit events. Providers can
request `excludedAttributes=members` for a bounded success representation.

### Profile-photo removal

For connections owning `photos`, PATCH removal and a replacement PUT omitting
`photos` reset the profile to its generated default avatar. The removed directory
photo is absent from the mutation response and subsequent GET. Name-only PATCH
preserves an untouched custom avatar. Connections without photo ownership preserve
omitted photos and reject explicit attempts to change them.

### Complete administration and pinned binding repairs

The connection picker supports search and pages of 25, while keeping the selected
connection available even when it lies outside the current page. Security lists
credentials with server-side Active, Expired, Revoked and All filters and paging;
All prioritizes unrevoked, unexpired credentials. Older active credentials remain
individually revocable. Credential pages never include token hashes or raw secrets.
Diagnostics can page through all local bindings. Team search is paginated and
retains the selected repair target even outside the current search/page.

Binding preview and execution share a read-only reconciliation planner. Preview
shows additions, removals, grant transfers, protected owners and the number of
users whose sessions will be invalidated. The approval revision pins every
contributing group, binding and grant, not only the selected group. Changes require
a fresh preview; approval also compares actual counts before committing. Existing
grant ownership is retained while its directory source still desires the member.

Microsoft Teams automatic linking requires an existing verified link or an
unambiguous enabled Entra connector match on tenant and immutable directory object
ID. Microsoft Graph email matching no longer authorizes automatic linking, even
for a single email match. Email-only users must complete the signed-in account-link
challenge. Historical case-variant email accounts are never chosen arbitrarily.
Existing verified Teams links continue to work.

### Admission and reconciliation deployment budgets

Before database credential lookup, each application process admits at most two
unknown-credential verifications concurrently, with a queue of 16 and a maximum
100 ms wait. Unknown credentials have a shared 1,200-attempt/minute budget and,
when a trusted client address is available, a 120-attempt/minute address budget.
Recently verified credentials use a separate two-verification lane; this hint
never replaces database authorization or revocation checks. New credentials can
receive retryable 429 responses during sustained overload.

Configure the existing trusted-proxy settings only behind an ingress that
overwrites forwarding headers and blocks direct backend access. Untrusted client
headers do not establish an address. Enforce network-wide ingress limits as well:
local budgets multiply with application replicas and do not certify deployed WAF
or PostgreSQL/PgBouncer capacity.

Team reconciliation aggregates overlapping group membership in PostgreSQL before
joining grant provenance and returning desired users to the application. Approval
previews fingerprint all contributing groups; ordinary execution avoids computing
an unused approval revision, and manual memberships and owner protections remain in
force. Group membership changes reconcile the users added or removed by that
mutation; user DELETE reconciles that user. Their grants and session changes
commit with the directory mutation. Approval, repair, detachment and group DELETE
still reconcile the complete team. No revocation is deferred to a background job.
Local tests cover 25, 50 and 100 overlapping groups of 10,000 members under
concurrent revocation, including competing diagnostics and database traffic.
Disjoint memberships can produce a larger distinct-user
set; production memory, database I/O, pool waits and incident-processing latency
still need a deployment-specific rehearsal.
