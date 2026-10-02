---
title: Roles and permissions
description: Understand workspace roles, resource scope, team ownership, and API-key authority in OpsKnight.
type: reference
product_area: authorization
audience: [administrator, operator, developer]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/authorization.ts, src/lib/rbac.ts, src/lib/authorization-policy.ts, src/lib/authorization-filters.ts, src/config/navigation.ts, tests/architecture/rbac-page-guards.test.ts, tests/lib/rbac-read-guards.test.ts]
---

# Roles and permissions

OpsKnight combines a workspace role with resource scope. A role grants a bundle
of capabilities; server policy then limits scoped reads to teams, services,
incidents, and schedules the actor can access. Hiding a navigation item is only
a UI convenience—the server guard is authoritative.

## Workspace roles

### `ADMIN`

Administrators have every application capability. They can manage users,
settings, services, policies, schedules, providers, API keys, retention,
privacy, encryption, compliance, audit access, and operational workflows. Keep
at least two controlled administrator accounts and protect one as break glass.

### `RESPONDER`

Responders operate incidents across the organization. They can create and
manage incidents, read all services and schedules, view sensitive incident
details, export incidents and reports, and read the organization-wide Users and
Escalation Policies pages. They cannot perform administrator-only configuration,
read the Audit Log, or manage privacy, retention, encryption, and compliance.

### `AUDITOR`

Auditors have organization-wide read access to incidents, services, metrics,
schedules, users, policies, reports, and the Audit Log. They can inspect privacy
request state, retention settings and previews, encryption migration state, and
compliance controls/evidence. They cannot respond to incidents, administer
teams, modify configuration, perform erasure, or change retention/encryption.

### `USER`

Users have read-only scoped access. Service and schedule visibility follows
team membership. Incident visibility includes the actor's permitted team scope
and applicable assignment/watch relationships. Users can read scoped metrics
only when a permitted `serviceId` or `teamId` is supplied; they cannot query
organization-wide metrics. The Users and Escalation Policies pages are hidden
and denied by server guards.

## Common access by area

- **Incidents:** Admin and Responder can create, acknowledge, add notes,
  escalate, assign, and resolve subject to the action policy. Auditor reads all;
  User reads only authorized incidents and cannot operate them.
- **Services and schedules:** Admin, Responder, and Auditor read all. User reads
  resources belonging to their teams. Mutations require the feature's
  administrator/owner guard.
- **Teams:** Admin can administer any team. A non-Auditor team member with team
  role `OWNER` can administer that team. Workspace role and team role are
  separate; team ownership does not grant workspace administration.
- **Users and escalation policies:** Admin, Responder, and Auditor can list and
  view them. Only authorized mutation flows can change them. User is denied on
  both desktop and mobile routes.
- **Audit Log:** Admin and Auditor only.
- **Reports:** all four roles can read reports, but resource filters still apply;
  Admin, Responder, and Auditor also have report-export capability.
- **System Logs, Health Center, provider settings, retention mutation,
  encryption mutation, privacy processing, and compliance mutation:** Admin.
- **Service webhooks:** viewing follows service access; creating or editing a
  webhook requires permission to modify that service.

## Team ownership safeguards

Team `OWNER` is a membership role, not the workspace `ADMIN` role. Owners can
administer their own team unless their workspace role is `AUDITOR`. Preserve at
least one owner before removing or demoting the current last owner. Removing a
member can also change their service, schedule, and incident visibility; review
dependencies before offboarding.

## API keys

An API key has explicit scopes:

- `events:write`
- `incidents:read` and `incidents:write`
- `services:read`
- `schedules:read`
- `response-policy:read` and `response-policy:write`

A scope does not elevate its owner. Effective authority is the intersection of
the key's scopes, the owner's current active account and workspace role, and
resource authorization. Disabling or demoting the owner can therefore remove
access even when the key record still contains a scope. See [Manage API keys](../guides/administration/api-keys/).

## Authentication and denial behavior

A missing or invalid session produces an authentication error or login
redirect. An authenticated actor without the required capability receives an
authorization denial; resource-scoped endpoints may deliberately avoid
revealing whether an inaccessible object exists. API clients should distinguish
`401` (authentication/key failure) from `403` (authenticated but not allowed).

## Verify a role change

1. Change the role through the supported Users workflow or identity mapping.
2. End or revoke existing sessions when immediate enforcement is required.
3. Sign in as the affected user in a private browser session.
4. Test direct URLs as well as navigation: Users, Policies, Audit, Reports,
   Schedules, service webhooks, and the equivalent mobile routes.
5. Test one allowed read and one denied mutation against a resource inside and
   outside the user's team scope.
6. Review the Audit Log for the administrative change.

Do not validate authorization only by checking whether a sidebar link is
visible. If UI and server behavior disagree, treat the server decision as the
security boundary and report the UI mismatch.
