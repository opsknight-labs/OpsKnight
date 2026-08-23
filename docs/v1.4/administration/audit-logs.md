---
order: 7
title: Audit Logs
description: Review the administrative changes recorded by OpsKnight v1.4 and understand the evidence boundary.
---

# Audit Logs

The audit log answers a focused question: **who changed supported OpsKnight configuration, what changed, and when?** Use it during access reviews and change investigations. It is not a complete authentication, request, or compliance event stream.

## Open the audit log

1. Sign in to OpsKnight.
2. Under **Insights**, select **Audit Log**.
3. Read entries from newest to oldest.

The page shows the newest **250** records. v1.4 has no audit search, filtering, pagination, or export. Query or export the PostgreSQL `AuditLog` table through an operator-controlled process if an investigation needs older records.

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
2. Capture relevant rows before newer activity pushes them outside the 250-row view.
3. Match actor and entity IDs to current records; names and membership may have changed.
4. Correlate with application, identity-provider, proxy, and database evidence.
5. Preserve evidence externally according to your incident-response procedure.

If an expected row is absent, verify the change completed and its workflow has an audit writer. Do not treat absence from this page as proof an action did not occur.

## Retention and compliance boundary

The **System Logs** retention setting deletes `LogEntry` records; it does **not** delete `AuditLog` records. v1.4 has no configurable audit-retention/export job and does not claim append-only or tamper-evident storage.

For high-assurance use, back up PostgreSQL, export audit records to access-controlled immutable storage, define external retention, restrict database access, and validate coverage for each intended control. These records can contribute evidence, but do not by themselves make a deployment compliant.

## Related topics

- [System logs](system-logs.md)
- [Data retention](data-retention.md)
- [Authentication](authentication.md)
- [Security](../security/README.md)
- [Backup and restore](../deployment/docker.md#backup-and-restore-postgresql)
