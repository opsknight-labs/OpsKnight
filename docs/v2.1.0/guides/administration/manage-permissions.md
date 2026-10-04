---
title: Manage roles and permissions
description: Assign workspace and team roles, verify resource scope, and audit effective access.
type: tutorial
product_area: authorization
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Grant, verify, review, and remove least-privileged access.
keywords: [RBAC, roles, permissions, team owner, API scopes, access review]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/authorization.ts
    - src/lib/authorization-policy.ts
    - src/lib/authorization-filters.ts
    - src/lib/authorization-actors.ts
    - src/lib/rbac.ts
    - src/lib/teams/membership-commands.ts
---

# Manage roles and permissions

OpsKnight authorization combines four independent facts:

1. the account is active and authenticated;
2. its workspace role grants the required capability;
3. the requested team, service, schedule, or incident is in scope; and
4. for API keys, the key also has the required API scope.

An action is permitted only when every applicable layer allows it. A hidden
button or sidebar entry is not a security boundary; server actions and API
routes make the authoritative decision.

## Before you begin

Sign in as an administrator. Write down the business task, affected resources,
and required duration before granting access. Keep a second active
administrator, use a low-risk test account for verification, and read the
[roles and permissions reference](../../reference/permissions/) for the current
role/capability contract.

## Choose the workspace role

Use the narrowest stable role that supports the person's normal work:

| Role | Choose it for | Do not choose it merely for |
| --- | --- | --- |
| `ADMIN` | Organization configuration, identity/security administration, user management, retention/privacy/encryption operations | Responding to incidents or viewing all incidents |
| `RESPONDER` | Organization-wide incident operations, sensitive incident context, service/schedule visibility, report export | Changing system settings, users, audit access, or compliance controls |
| `AUDITOR` | Organization-wide read access, Audit Log, compliance evidence, privacy/retention/encryption status | Incident response or any mutation workflow |
| `USER` | Read-only team-scoped services, schedules, metrics, reports, and eligible incidents | Organization-wide visibility or response actions |

`ADMIN` contains all application capabilities. `RESPONDER` is an operational
role, not a limited administrator. `AUDITOR` can read sensitive governance state
and export compliance evidence but cannot mutate it. `USER` is genuinely
resource-scoped and should be the default when broad operational access is not
needed.

## Understand resource scope

Workspace role answers “what kind of operation?” Resource policy answers “on
which object?”

For a `USER`:

- a service is visible when its owning team is one of the user's teams;
- a schedule is visible when the user participates in it or it relates to one
  of their teams;
- an incident can be visible through assignment, watch relationship, or a
  public incident associated with an authorized service/assigned team; and
- scoped metrics require an authorized service or team filter rather than an
  organization-wide query.

Admin, Responder, and Auditor roles have global read capabilities for the main
operational resources, with mutations still determined by their capability
bundle. Private incidents are not made visible to a scoped user merely because
some unrelated public resource shares a name.

Never infer scope from a page the person once visited. Membership, assignment,
watcher state, incident visibility, and resource ownership are evaluated from
current server-side records.

## Workspace roles and team roles are different

Team membership uses `OWNER`, `ADMIN`, or `MEMBER` within one team. These roles
do not grant workspace `ADMIN`.

- A workspace Admin can administer every team.
- A non-Auditor team `OWNER` can administer their own team.
- An Auditor remains read-only even when a legacy membership says `OWNER`.
- Team membership controls scope to team-owned services and related schedules.
- Removing membership can remove access to services, incidents, schedules, and
  scoped metrics.

Keep at least one team owner. Before removing or demoting an owner, appoint and
verify the replacement. Review team-owned services, schedules, escalation
policies, and open incidents after membership changes.

## Assign or change a workspace role

1. Open **Users** and search for the account.
2. Open the user's detail page and review status, current role, role source,
   teams, schedules, policies, and audit activity.
3. Select **Edit** or the card's role action.
4. Choose `ADMIN`, `RESPONDER`, `AUDITOR`, or `USER` and save.
5. Confirm the `user.role.updated` audit event.
6. Have the user start a fresh authenticated session.
7. Run the role verification checklist below.

The action is denied when an administrator tries to change their own role or
when a demotion would leave no active administrator. Role changes increment the
account's session security version. Do not rely on a still-rendered browser page
as evidence that stale authorization remains valid; make a new server request.

If the role source is OIDC or SCIM, decide which system is authoritative before
editing. A supported manual role change sets the source to `MANUAL`. If OIDC
claim mapping should remain authoritative, make the change at the identity
provider and verify it through a new sign-in instead.

## Grant team-scoped access

Use team membership when a `USER` needs access to a defined operational area:

1. Open **Teams** and choose the team.
2. Add the active user as `MEMBER` unless team administration is required.
3. Use `ADMIN` for delegated team administration that does not require final
   ownership.
4. Use `OWNER` only for people accountable for team membership and ownership.
5. Save, then verify one team-owned and one unrelated resource.

Alternatively, an administrator can use **Users → Assign team**, which adds the
person as `MEMBER`. Use the team page for owner/admin assignments.

Adding a user to a team does not add them to an on-call schedule, escalation
policy, Slack/Teams destination, or service responder list automatically. Those
are separate operational configurations.

## Create least-privileged API keys

API key authority is an intersection, not an elevation:

```text
effective API access
= active owner
∩ owner's current workspace capability/resource scope
∩ key's explicit API scopes
```

Supported scopes are `events:write`, `incidents:read`, `incidents:write`,
`services:read`, `schedules:read`, `response-policy:read`, and
`response-policy:write`.

For each integration:

1. Use a dedicated active owner whose role and team scope match the integration.
2. Select only the endpoints/actions it needs.
3. Record owner, purpose, environment, creation date, and rotation date.
4. Test an allowed call and a deliberately unscoped call.
5. Rotate through the supported key workflow and revoke the old key.

A key with `incidents:write` cannot grant incident authority its owner lacks.
Disabling or demoting the owner can remove effective access even if the key
record still lists the scope. See [manage API keys](api-keys/).

## Verify a role or scope change

Use a private browser or isolated test account. Test direct URLs and server
mutations, not only navigation visibility.

### Admin

- Can open Users, System settings, Audit Log, Health Center, retention,
  encryption, privacy, and compliance administration.
- Can perform a controlled administrative mutation.
- Cannot deactivate, delete, or demote their own account through the protected
  user workflow.

### Responder

- Can view and operate an organization-wide incident.
- Can read services, schedules, metrics, users, and escalation policies.
- Can export incidents/reports.
- Is denied system settings, Audit Log, user mutation, retention/privacy/
  encryption mutation, and compliance mutation.

### Auditor

- Can read organization-wide incidents, services, metrics, schedules, users,
  policies, reports, and Audit Log.
- Can inspect privacy request, retention, encryption migration, compliance
  controls, and evidence state.
- Is denied incident acknowledgement/notes/escalation and every administrative
  mutation.

### User

- Can open a service and schedule belonging to their team.
- Can read an incident assigned to or watched by them and eligible public
  incidents in team scope.
- Is denied an unrelated team's service, schedule, incident, and metrics.
- Is denied Users, Escalation Policies, Audit Log, exports, and incident
  mutations.

For every denial, attempt the underlying direct URL or API operation. Expected
behavior is an authentication response for missing identity, an authorization
denial for a known actor without capability, or non-disclosing resource
behavior for an out-of-scope object.

## Interpret `401`, `403`, and missing resources

- `401` means the session/key was absent, invalid, expired, revoked, or owned by
  an inactive account.
- `403` means the actor is authenticated but lacks a required capability or API
  scope.
- A resource-scoped endpoint can intentionally avoid confirming that an
  inaccessible object exists. Do not treat a not-found-style response as proof
  the resource was deleted.

When debugging, record the actor ID, workspace role, active status, team IDs,
API key ID/scopes (never the secret), action, resource ID/type, and response
request ID.

## Temporary elevation

OpsKnight workspace roles do not include a built-in scheduled-expiry field.
When temporary Admin/Responder access is necessary:

1. Create an external change record with owner and expiration time.
2. Grant the minimum role at the start of the approved window.
3. Verify the intended operation and one denied boundary.
4. Remove the role manually at the end of the window.
5. Reauthenticate and confirm access is gone.
6. Review the audit events and close the change record.

Do not describe this as automatically expiring access. Automate reminders in
the organization's access-governance system if required.

## Run an access review

On the organization's review cadence:

1. Review active Admins and their break-glass purpose.
2. Review organization-wide Responders and Auditors.
3. Review team Owners/Admins and ensure each team retains an accountable owner.
4. Compare OIDC role claims and SCIM assignment with stored role source.
5. Review service ownership, schedule participation, incident watchers, and
   escalation targets for scoped users.
6. Inventory API keys by owner, scopes, last use, and rotation age.
7. Disable departed or dormant users and verify revocation.
8. Sample allowed and denied behavior with test identities.
9. Preserve review evidence according to the compliance process.

Navigation screenshots and exported user lists are incomplete evidence. Include
server-side negative tests because the authorization boundary is enforced below
the UI.

## Troubleshooting

### A user sees a resource after team removal

Check whether they are assigned to or watching the incident, participate in the
schedule, hold a global role, or have another team relationship. Start a new
session/request and test the direct resource. Do not assume team membership is
the only scope path.

### A team owner cannot administer the team

Confirm the membership is `OWNER`, the account is active, and the workspace
role is not `AUDITOR`. Confirm the action targets that same team rather than an
organization-wide administration route.

### An API key has the scope but gets `403`

Check the owner's active status, workspace capability, team/resource scope, and
the exact key scope. Key scope alone never elevates the owner.

### A demotion or deactivation is rejected

The target may be the acting administrator or the last active administrator.
Create and verify another active Admin, then have that administrator perform the
change.

### The sidebar and direct URL disagree

Treat the server result as authoritative and report the navigation mismatch.
Do not loosen a server guard to match a visible menu item without reviewing the
capability and resource policy.

### OIDC restores a role after a manual change

The external claim mapping may still be authoritative. Update the provider
group/app role or the OpsKnight mapping, then perform a fresh OIDC sign-in and
verify the stored role source.
