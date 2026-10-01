---
title: Configure SCIM provisioning
description: Connect Microsoft Entra, Okta, or another SCIM 2.0 client and verify user, group, and team-membership lifecycle management.
type: tutorial
product_area: identity
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Configure and verify SCIM user and group provisioning end to end.
keywords: [SCIM provisioning, Entra provisioning, Okta provisioning, SCIM users, SCIM groups, team synchronization, identity lifecycle]
verification:
  level: source
  verified_at: 2026-10-01
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

OpsKnight exposes SCIM 2.0 **Users** and **Groups** APIs. Use them to manage
accounts, account state, teams, and team membership from an identity provider:

```text
OIDC -> authentication and sign-in claims
SCIM Users -> account provisioning and deprovisioning
SCIM Groups -> OpsKnight teams and team membership
```

SCIM group membership does not assign an OpsKnight system role. Keep role
management in OIDC claims or OpsKnight, with one documented authority for
elevated access.

## Before you begin

You need administrator access to the provider and OpsKnight, an externally
reachable HTTPS origin, a high-entropy token, and a low-risk pilot scope.
Inventory existing OpsKnight teams before enabling groups: a SCIM Group maps
directly to a Team, and group deletion deletes the team and removes its
associations.

## Generate the SCIM credential

Open **Settings -> System -> SSO -> SCIM Provisioning**.

1. Copy the displayed **Tenant URL**.
2. Select **Generate SCIM Token**.
3. Copy the revealed token directly into the identity provider.
4. Confirm **Active & Ready**, **UI Managed**, and the expected token hint.
5. Hide the value after use. Never put it in tickets, screenshots, or logs.

Generation, rotation, and revocation are audited. Existing deployments can
instead set `SCIM_BEARER_TOKEN` to at least 32 random characters:

```bash
openssl rand -hex 32
```

Store it in a secret manager and restart affected web replicas. The UI reports
**Environment Fallback**; a UI-managed credential takes precedence.

The base URL and authentication header are:

```text
https://opsknight.example.com/api/scim/v2
Authorization: Bearer <SCIM_BEARER_TOKEN>
```

## Discovery endpoints

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/ServiceProviderConfig` | Supported SCIM capabilities and authentication |
| `GET` | `/ResourceTypes` | User and Group definitions |
| `GET` | `/ResourceTypes/{User\|Group}` | One resource type |
| `GET` | `/Schemas` | User and Group schemas |
| `GET` | `/Schemas/{schema-URN}` | One schema |

Discovery advertises PATCH and filtering, with at most 100 results. Bulk,
sorting, password changes, and ETags are not supported.

## Users contract

The schema is `urn:ietf:params:scim:schemas:core:2.0:User`.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET`, `POST` | `/Users` | List/filter users or create one user |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/Users/{id}` | Read, replace, update, or deprovision a user |

`externalId` is the required immutable directory identifier; `userName` is the
required normalized email. `displayName`, `emails`, an HTTP(S) `photos` value,
and `active` are supported. Duplicate email or external ID returns `409` rather
than adopting an unmanaged account.

The collection uses one-based `startIndex`, a maximum `count` of 100, and only:

```text
externalId eq "directory-object-id"
userName eq "person@example.com"
```

`PUT` can replace email, name, state, and photo, but not `externalId`. `PATCH`
accepts add/replace for `active`, `displayName`, `name`/`name.formatted`, and
`photos`/`avatarUrl`, including a pathless object. Text booleans are normalized.

## Groups contract

The schema is `urn:ietf:params:scim:schemas:core:2.0:Group`. Each Group is an
OpsKnight Team; group members become team members with role `MEMBER`.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET`, `POST` | `/Groups` | List/filter teams or create a team |
| `GET`, `PUT`, `PATCH`, `DELETE` | `/Groups/{id}` | Read, replace, update, or delete a team |

`displayName` is required, unique, and limited to 100 characters. `externalId`
is optional. A member value may be an OpsKnight user ID or that user's SCIM
`externalId`. Responses include the internal ID, `/Users/{id}` reference, and
display name.

`GET /Groups` includes teams created inside OpsKnight. It uses one-based
pagination, a maximum `count` of 100, and these filters:

```text
displayName eq "Platform Engineering"
externalId eq "directory-group-id"
id eq "opsknight-team-id"
```

Create rejects a duplicate name or external ID. OpsKnight deduplicates resolved
members and ignores unknown references, so provision users before groups and
treat missing members as synchronization failures.

`PUT` replaces all membership only when `members` is present; otherwise it
preserves membership. `PATCH` supports add, remove, and replace, including:

```text
members[value eq "directory-user-id"]
```

Removing `members` without a value removes everyone. Pathless objects can
update `displayName`, `externalId`, and membership. Changes emit
`scim.group.created`, `.updated`, `.patched`, and `.deleted` audit actions.

### Group deletion is destructive

`DELETE /Groups/{id}` removes all team membership, clears this team from
services, incidents, escalation-rule targets, and dashboards, and then deletes
the team. It returns `204`; there is no disabled group record.

Before production rollout, learn whether provider unassignment or group
deletion sends SCIM DELETE. Test only with a disposable team that owns no
production resources, and preserve a break-glass administration path.

## Configure Microsoft Entra

1. Open **Identity -> Applications -> Enterprise applications**, then select
   the OpsKnight application.
2. Open **Provisioning**, choose **New configuration**, and use **Automatic**.
3. Enter the SCIM base URL as **Tenant URL** and the bearer token as **Secret
   Token**, then select **Test Connection**.
4. Under user mappings, map Entra object ID to `externalId`, sign-in email to
   `userName`, display name to `displayName`, and enabled state to `active`.
   Remove unsupported mappings and match on the stable object ID.
5. Under group mappings, map group object ID to `externalId`, group name to
   `displayName`, and membership to `members`.
6. Scope synchronization to assigned users and groups, add an operator contact,
   and configure accidental-deletion protection for your policy.
7. Assign only a pilot group whose users are assigned. Provision one user on
   demand before provisioning the group.
8. Confirm the account, OpsKnight team, and membership. Rename the group and
   add/remove one member to prove incremental synchronization.
9. Test deletion only with a disposable unassociated team.

**Test Connection** proves discovery and authentication, not lifecycle
correctness. Entra OIDC and SCIM use different credentials.

## Configure Okta

1. Enable SCIM provisioning for the OpsKnight application.
2. Under **Provisioning -> Integration**, enter the base URL, choose **HTTP
   Header**, enter the bearer token, and select **Test API Credentials**.
3. Map Okta's stable user ID to `externalId`, email to `userName`, name to
   `displayName`, and lifecycle state to `active`.
4. Under **To App**, enable create users, update attributes, and deactivate
   users. Verify one pilot user's create/update/deactivate/reactivate cycle.
5. Under **Push Groups**, select one disposable pilot group by name or rule.
6. Verify that Okta creates or deliberately links exactly one OpsKnight team.
   Add and remove a pilot user and confirm membership follows.
7. Determine the effect of **Unlink pushed group** and provider deletion in
   your Okta policy before permitting production group deletion.

Do not push a name that collides with an unrelated OpsKnight team. Verify the
exact target before accepting any offered link.

## Configure another client

1. Read `ServiceProviderConfig`, `ResourceTypes`, and `Schemas`.
2. Filter Users by pilot `externalId` and `userName`, then create the user.
3. Store the returned user `id`; update and disable the account once.
4. Create a uniquely named group with a stable `externalId` and pilot member.
5. Store its returned `id`; verify member values and `/Users/{id}` references.
6. Rename it, add/remove a member, and reconcile the final representation.
7. Exercise DELETE only in a test deployment after reviewing deletion behavior.

Do not infer bulk, sort, password, manager, phone, address, or entitlement
support from the general SCIM specification.

## Verify end to end

Verify all of the following in the pilot scope:

1. Missing and incorrect tokens return `401`.
2. Discovery lists User and Group and accurately reports capabilities.
3. A second user sync updates rather than duplicates the account.
4. User filters reconcile the same resource; updates and deactivation work.
5. One directory group creates one team with its expected external ID.
6. Add/remove membership and rename the group without creating duplicates.
7. Team membership does not unexpectedly grant a system role.
8. Unassigned users and groups stay outside the provisioning scope.
9. Successful group mutations are audited and failures are visible without
   exposing the token.
10. A disposable deletion behaves exactly as approved.

Never test deprovisioning with the only administrator or break-glass account.

## User deletion and roles

Setting `active=false` disables the user and invalidates existing access.
`DELETE /Users/{id}` also disables the account, clears its SCIM binding, and
retains the internal record for audit, incident history, and ownership. Plan
rehire behavior when the retained record still uses the same email.

SCIM `externalId` and OIDC `(issuer, sub)` are separate identities. Use SCIM
Groups for teams and membership; use OIDC claims or manual administration for
system roles. Do not assume membership assigns `ADMIN`, `RESPONDER`, `USER`, or
`AUDITOR`.

## Rotate or revoke the token

OpsKnight accepts one active credential. Pause provisioning, select **Rotate
Token**, update the provider, test one user and group update, then resume. There
is no dual-token overlap. **Revoke** disables the UI-managed credential without
deleting users or teams; remove `SCIM_BEARER_TOKEN` too for a complete shutdown.

## Troubleshooting

### Requests return `401`

Check the active token source and hint, minimum length, accidental whitespace,
stale provider secret, and replicas not restarted after environment rotation.

### Test connection returns `404`

Use the base URL ending in `/api/scim/v2`, not an OIDC callback, home page, or
resource URL. Confirm the proxy forwards `/api/scim/`.

### Provisioning returns `409`

Search users by `externalId` and `userName`; search groups by `externalId` and
`displayName`. Correct the mapping or intentional link. Do not delete an
unrelated account or production team to make a retry pass.

### A local user is absent from `/Users`

Only SCIM-managed users are returned; a local/OIDC account cannot be silently
adopted. In contrast, `/Groups` includes existing OpsKnight teams, so review
group-name collisions carefully.

### A group member is missing

Provision the user first. Confirm the value is the user's OpsKnight ID or exact
SCIM `externalId`. Unknown member references are ignored; retry membership once
the user exists and verify the final Group response.

### Group removal deleted a team

This is the implemented DELETE behavior. Stop the provider job, inspect service,
incident, escalation-rule, and dashboard associations, recover the intended
team configuration, and change provider deletion policy before resuming.

### Deactivated user history remains

This is expected: access is revoked while the internal record remains for
history. If a user appears signed in, verify the operation, shared session state
across replicas, and a new authenticated request rather than an old browser view.

Continue with [OIDC single sign-on](configure-oidc/) and
[manage users](../administration/manage-users/).
