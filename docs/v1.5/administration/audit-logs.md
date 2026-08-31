---
order: 7
title: Audit Logs
description: Review administrative changes recorded by OpsKnight and understand the evidence boundary.
---

# Audit Logs

The audit log answers a focused question: **who changed supported OpsKnight configuration, what changed, and when?** Use it during access reviews, compliance verifications, and change investigations.

## Open the audit log

1. Sign in to OpsKnight.
2. Under **Security & Compliance**, select **Audit Log**.
3. Inspect entries from newest to oldest.

The page shows records newest first in pages of 50. Search by actor name/email, action, or entity ID, narrow results by entity type, and move through result pages. **Export CSV** exports the currently visible page.

> **Access boundary:** The Audit Log page (`/audit`) is strictly restricted to Administrators (`ADMIN` and `AUDITOR` roles). Standard users and responders cannot access this page.

## Interactive inspection features

- **Interactive Details Drawer / Modal**: Clicking any audit row opens a slide-over modal displaying the complete, unclipped JSON payload, formatted with syntax highlighting and a one-click **"Copy JSON"** button with copied feedback.
- **Semantic Action Badges**:
  - 🟢 **Creation & Auth**: `CREATE`, `LOGIN_SUCCESS`, `INVITE`, `ACTIVATE` _(Emerald)_
  - 🔵 **Modifications**: `UPDATE`, `EDIT`, `ASSIGN`, `TRANSFER` _(Blue)_
  - 🔴 **Destructive & Security**: `DELETE`, `REMOVE`, `REVOKE`, `SUSPEND`, `LOGIN_FAILED` _(Rose)_
  - 🟡 **System & Alerts**: `WARNING`, `TRIGGER`, `BREACH` _(Amber)_
- **Direct Entity & Profile Deep Links**: Click on an actor to navigate to their user profile (`/users/[id]`), or click on the entity identifier to open the related incident (`/incidents/[id]`), service (`/services/[id]`), team (`/teams/[id]`), policy (`/policies/[id]`), or schedule (`/schedules/[id]`).

## What an entry contains

| Column        | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Timestamp** | When OpsKnight wrote the record, displayed in the viewer's configured time zone.          |
| **Actor**     | Avatar, name, email, and user profile link, or **SYS** when no actor is attached.         |
| **Action**    | Color-coded semantic action badge.                                                        |
| **Entity**    | `USER`, `TEAM`, `SERVICE`, `INCIDENT`, `POLICY`, or `SCHEDULE` with deep navigation link. |
| **Details**   | Interactive truncated preview; click row to open the full JSON Details Modal.             |

## Recorded change families

| Area                      | Representative actions                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Users and access          | `user.invited`, `user.role.updated`, deactivate/reactivate/delete, password update, `session.revoked_all` |
| Teams                     | create/update/delete, membership, role, and notification changes                                          |
| Services and integrations | service changes; integration create/delete, status, secret rotation/clear                                 |
| Escalation policies       | policy and step create/update/delete, move, and reorder                                                   |
| Configuration             | OIDC, Slack OAuth, Jira mapping, ChatOps, and webhook-integration changes                                 |

## Investigation workflow

1. Record the incident window and affected user, team, service, or policy.
2. Search and filter for relevant rows, then export the filtered view.
3. Click any row to inspect the complete recorded payload in the JSON modal.
4. Follow entity links directly to audit current configurations.

## Retention and compliance boundary

The **Audit & Event History** retention setting controls `AuditLog` and incident-event cleanup, alongside stored application logs. New installations default to one year; 2-, 5-, and 7-year presets retain audit history for their stated duration.

## Related topics

- [System logs](system-logs.md)
- [Data retention](data-retention.md)
- [Authentication](authentication.md)
- [Security](../security/README.md)
