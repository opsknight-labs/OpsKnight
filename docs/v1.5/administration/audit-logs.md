---
order: 7
title: Audit Logs
description: Review administrative changes recorded by OpsKnight and understand the evidence boundary.
---

# Audit Logs

The audit log answers a focused question: **who changed supported OpsKnight configuration, what changed, and when?** Use it during access reviews and change investigations. It is not a complete authentication, request, or compliance event stream.

## Open the audit log

1. Sign in to OpsKnight.
2. Under **Insights**, select **Audit Log**.
3. Read entries from newest to oldest.

The page shows records newest first in pages of 50. Search by actor, action, or entity ID, narrow results by entity type, and move through result pages. **Export CSV** exports the currently visible page. Use an operator-controlled PostgreSQL export for a complete large-range extract.

> **Access boundary:** The Audit Log page (`/audit`) and its settings link are strictly restricted to Administrators (`ADMIN` role only). Users and Responders cannot access this page and will not see it in the sidebar navigation or settings overview. Treat audit metadata as sensitive and restrict application access at the identity or reverse-proxy layer when policy requires tighter separation.

## What an entry contains

| Column        | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| **Timestamp** | When OpsKnight wrote the record, displayed in the viewer's time zone.                  |
| **Actor**     | The matching user, or **System** when no actor is attached.                            |
| **Action**    | The emitted action identifier, such as `user.role.updated`.                            |
| **Entity**    | `USER`, `TEAM`, `TEAM_MEMBER`, `SERVICE`, or `ESCALATION_POLICY`, plus an optional ID. |
| **Details**   | Workflow-specific JSON metadata; its shape is not a published API contract.            |

Records can also hold a target email and source IP when the writer supplies them, although the table does not render those fields.

## Recorded change families

| Area                      | Representative actions                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Users and access          | `user.invited`, `user.role.updated`, deactivate/reactivate/delete, password update, `session.revoked_all` |
| Teams                     | create/update/delete, membership, role, and notification changes                                          |
| Services and integrations | service changes; integration create/delete, status, secret rotation/clear                                 |
| Escalation policies       | policy and step create/update/delete, move, and reorder                                                   |
| Configuration             | OIDC, Slack OAuth, Jira mapping, ChatOps, and webhook-integration changes                                 |

This is an implemented-family summary, not a guarantee that every UI action creates a record. Confirm the action in a test environment before relying on it as a control.

## Investigation workflow

1. Record the incident window and affected user, team, service, or policy.
2. Search and filter for relevant rows, then preserve the relevant result pages before the retention period expires.
3. Match actor and entity IDs to current records; names and membership may have changed.
4. Correlate with application, identity-provider, proxy, and database evidence.
5. Preserve evidence externally according to your incident-response procedure.

If an expected row is absent, verify the change completed and its workflow has an audit writer. Do not treat absence from this page as proof an action did not occur.

## Retention and compliance boundary

The **Audit & Event History** retention setting controls `AuditLog` and incident-event cleanup, alongside stored application logs. New installations default to one year; existing saved policies are not changed automatically. The 2-, 5-, and 7-year presets retain audit and event history for their stated duration.

OpsKnight has no legal-hold, immutable-store, or tamper-evident audit capability. Do not run destructive cleanup for records subject to a hold; export them to approved, access-controlled storage first.

For high-assurance use, back up PostgreSQL, export audit records to access-controlled immutable storage, define external retention, restrict database access, and validate coverage for each intended control. These records can contribute evidence, but do not by themselves make a deployment compliant.

## Related topics

- [System logs](system-logs.md)
- [Data retention](data-retention.md)
- [Authentication](authentication.md)
- [Security](../security/README.md)
- [Backup and restore](../deployment/docker.md#backup-and-restore-postgresql)
