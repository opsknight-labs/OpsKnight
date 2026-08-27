---
order: 2
title: Authorization and Roles
description: Apply workspace roles, team roles, and resource ownership using least privilege.
---

# Authorization and Roles

OpsKnight has workspace-wide application roles and independent team-scoped roles. Always evaluate both, plus resource assignment and ownership, when deciding who can perform an operation.

## Workspace roles

| Role        | Operational boundary                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `USER`      | Standard signed-in user. Resource checks may allow incidents, services, schedules, or metrics related to their assignment/team. |
| `AUDITOR`   | Read-only organization-wide incidents, services, schedules, reports, metrics, and audit evidence. No operational mutations.     |
| `RESPONDER` | Global response operations, including broad incident and operational-resource management, but not Admin-only governance.        |
| `ADMIN`     | Workspace governance, users, providers, system/security settings, and destructive administrative operations.                    |

The implementation uses a central capability registry in `src/lib/authorization.ts`. Server guards enforce capabilities and then apply resource scope where required. UI checks are usability hints only; server enforcement remains authoritative.

## Resource checks for a User

The central v1.5 checks allow a regular `USER` to:

- view or modify an incident when assigned to it or a member of the service's owning team;
- modify a service when a member of its owning team;
- view a schedule when assigned to a layer or referenced by an override;
- read scoped service/team metrics only for teams they belong to.

Responders and Admins bypass those central resource checks for global operational access. Auditors bypass read scope only and cannot mutate operational resources. An unscoped metrics request from a regular User is denied.

## Team roles

| Team role | Scope                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| `MEMBER`  | Team participation and routing eligibility.                                                     |
| `ADMIN`   | Elevated team classification; it does not grant workspace Admin.                                |
| `OWNER`   | Team governance, including elevated team-role and membership operations implemented for Owners. |

Application Admins and Responders can create/edit teams and add Members. Only application Admins or that team's Owners can assign `OWNER`/`ADMIN`; removal and sensitive membership operations use Admin-or-Owner checks. Only an application Admin can delete a team. The last Owner cannot be removed or demoted.

## High-impact task matrix

| Task                                                          | Minimum implemented authority                                |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Manage workspace users and application roles                  | Application Admin                                            |
| Configure OIDC, providers, retention, and system settings     | Application Admin                                            |
| View System Logs                                              | Application Admin                                            |
| View audit evidence organization-wide                         | Auditor or Application Admin                                 |
| Create/manage incidents globally                              | Responder or Admin                                           |
| Create/edit services, schedules, policies, and teams globally | Responder or Admin                                           |
| Delete a team or perform protected destructive governance     | Application Admin                                            |
| Assign elevated team roles                                    | Application Admin or that team's Owner                       |
| Access a User-scoped operational resource                     | Assignment/team relationship required by that resource check |

Consult the task guide because some workflows add stricter checks. The Audit Log and system/security settings are Admin-only; operational pages additionally apply incident, service, schedule, and team scope checks.

## Least-privilege workflow

1. Grant `USER` by default.
2. Use team membership and assignment for scoped participation.
3. Grant `RESPONDER` only for people who need workspace-wide response operations.
4. Grant `AUDITOR` for compliance personnel who require evidence without operational control.
5. Grant `ADMIN` only for governance and security duties.
6. Keep at least two active Admins and two Owners on critical teams.
7. Review application roles, team roles, assignments, OIDC mappings, and API keys separately.
8. Revoke sessions and IdP access for urgent removals; then test affected response paths.

## API keys

API key scopes narrow the owning user's current authority; they never expand it. A write scope owned by a user who is later changed to `AUDITOR` or `USER` cannot continue performing global incident mutations. Revoke unused keys and retest integrations after role changes.

## OIDC role-mapping warning

Role mapping runs on OIDC login and can change application roles. Protect mapped claims at the IdP, put Admin rules first only when intentional, and test both promotion and demotion. Team roles are not assigned by the OIDC role-mapping rules.

## Verification checklist

- [ ] A User cannot open Admin-only settings or system logs.
- [ ] A User can access only expected assigned/team resources.
- [ ] A Responder can operate incidents without administering identity or providers.
- [ ] An Auditor can inspect organization-wide evidence but cannot change incidents or settings.
- [ ] Team Owner does not imply workspace Admin.
- [ ] Removing membership removes the expected resource scope.
- [ ] OIDC group removal changes access as designed on the next login.
- [ ] Break-glass Admin access and session revocation are tested.

## Related topics

- [Authentication](../administration/authentication.md)
- [Users](../core-concepts/users.md)
- [Teams](../core-concepts/teams.md)
- [API authentication](../api/README.md#authentication)
- [Audit logs](../administration/audit-logs.md)
