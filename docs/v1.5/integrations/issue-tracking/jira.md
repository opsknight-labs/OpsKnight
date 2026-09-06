---
order: 1
title: Jira Cloud
description: Connect one Jira Cloud workspace, map services, create or link issues, and synchronize supported metadata safely.
---

# Jira Cloud

OpsKnight connects one Jira Cloud workspace to incident and action-item workflows. It can create or link Jira issues, post OpsKnight incident notes and lifecycle updates as Jira comments, and receive Jira status/assignee metadata by webhook.

This is not full two-way workflow mirroring: Jira transitions do not change an OpsKnight incident's lifecycle, and OpsKnight does not transition Jira workflows. Treat OpsKnight as the incident system of record and Jira as linked engineering-work tracking.

## What is supported

| Workflow                       | Direction                  | Result                                                                       |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| Create issue for incident      | OpsKnight → Jira           | Creates the configured issue type and stores a link.                         |
| Link existing issue            | Jira → OpsKnight reference | Fetches and stores key, URL, status, and assignee.                           |
| Create issue for action item   | OpsKnight → Jira           | Creates the service-mapped action-item issue type.                           |
| Incident note/lifecycle update | OpsKnight → Jira           | Adds a best-effort formatted Jira comment to linked issues.                  |
| Jira issue update webhook      | Jira → OpsKnight           | Refreshes stored Jira status and assignee metadata.                          |
| Jira issue delete webhook      | Jira → OpsKnight           | Event is accepted; it does not delete the OpsKnight incident or action item. |

GitHub Issues, Linear, and Asana do not have equivalent native issue-sync workflows in v1.4.

## Prerequisites and permissions

- A Jira Cloud site and an Atlassian user with access to the target projects.
- An Atlassian API token for that user.
- Permission to create the configured issue types, read issues, and add comments.
- An OpsKnight **Admin** for the workspace connection and service mappings.
- A public HTTPS OpsKnight URL for Jira webhooks.
- `ENCRYPTION_KEY` configured in production so API tokens and webhook secrets remain decryptable after restarts.

Use a dedicated least-privilege Jira service account where possible. Changes to that account's projects or permissions affect every mapped OpsKnight service.

## Connect the workspace

1. In Atlassian account security, create an API token for the integration account.
2. Open **Settings → Integrations → Jira** in OpsKnight.
3. Enter the Jira Site URL, Jira User Email, and API Token.
4. Generate a long random Webhook Secret and enter it.
5. Select **Enable Jira workflows** and save.
6. Select **Test Connection** and confirm the connected Jira identity.

OpsKnight normalizes a bare `example.atlassian.net` site value to HTTPS. Use the exact Cloud site, not a project or board URL. On later edits, leaving the masked token/secret unchanged preserves the stored encrypted values.

## Configure the Jira webhook

The Jira settings page displays the exact callback URL:

```text
https://ops.example.com/api/jira/webhook
```

Create a Jira webhook for `jira:issue_updated` and `jira:issue_deleted`. Send the configured secret as either:

```http
x-jira-webhook-secret: YOUR_SECRET
```

or:

```http
Authorization: Bearer YOUR_SECRET
```

In production, OpsKnight rejects Jira webhooks if no webhook secret is configured. The comparison is constant-time. Limit the Jira webhook with JQL to projects used by OpsKnight when practical.

The inbound webhook updates only the linked issue's stored external status and assignee when those fields are present. It does not change incident status, assignment, urgency, or action-item status.

## Map each service

Open **Service → Settings → Jira Workflow Mapping** and configure:

| Field                      | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| Project Key                | Jira project that receives this service's work.                             |
| Default Component          | Optional Jira component name.                                               |
| Incident Issue Type        | Issue type used for incident-created issues; defaults to `Bug` in the form. |
| Action Item Issue Type     | Issue type used for follow-up work; defaults to `Task`.                     |
| Default Labels             | Comma-separated labels; the initial form suggests `opsknight`.              |
| Auto-create incident issue | Creates a Jira issue when a new incident qualifies.                         |
| Auto-create urgency        | High, Medium, and/or Low incidents eligible for auto-create.                |
| Sync Jira status metadata  | Controls service-level metadata sync behavior.                              |

The workspace connection can be configured before or after mappings, but auto-create requires an enabled workspace connection and a valid mapping. Verify project keys, issue-type names, and components against Jira; the free-text form cannot guarantee that they exist.

## Incident workflow

On an incident's Jira card, an authorized responder can:

- create a new issue using the service mapping;
- link an existing Jira key or a URL containing a Jira key;
- refresh supported Jira metadata;
- open the issue in Jira;
- unlink it from the incident without deleting the Jira issue.

An external Jira issue can be linked only once in OpsKnight. Incident notes are posted to every linked Jira issue in this form:

```text
[OpsKnight Note by RESPONDER_NAME]:
NOTE_TEXT
```

Lifecycle updates are posted as `[OpsKnight Update]: ...` comments. Comment sync is best-effort: a Jira failure does not block the OpsKnight incident action, so inspect the link's sync state and Jira when the comment matters.

## Action-item workflow

From **Action Items**, create a Jira issue using the action item's incident service mapping, or link an existing Jira issue. OpsKnight stores the same external key, URL, status, assignee, sync state, and last-sync time.

An action item without an incident/service mapping cannot create a correctly routed Jira issue. Fix the association or mapping first.

## Disable or rotate credentials

- Disabling the workspace integration stops Jira workflows but preserves configuration, mappings, and existing links.
- Rotating the API token requires saving the new token and running **Test Connection**.
- Rotating the webhook secret requires updating Jira and OpsKnight together; otherwise inbound requests return 401.
- Removing an OpsKnight link does not delete the Jira issue.

## Verification checklist

- [ ] Test Connection returns the intended least-privilege Jira account.
- [ ] Each production service maps to an existing project, component, and issue type.
- [ ] A manual incident issue is created with the expected labels and link.
- [ ] An existing issue can be linked and duplicate linking is rejected.
- [ ] An incident note appears as a Jira comment.
- [ ] A Jira status or assignee update refreshes the stored metadata.
- [ ] A test action item creates or links the intended issue type.
- [ ] Auto-create is tested for one selected and one excluded urgency.
- [ ] Invalid webhook secrets return 401 without changing metadata.

## Troubleshooting

| Symptom                                      | Check                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Test Connection returns 401                  | Jira email/token pair, revoked token, and site URL.                                   |
| Create returns 400/404                       | Project key, issue type, component, labels, and service-account permissions.          |
| “already linked”                             | The same external Jira issue already belongs to an OpsKnight incident or action item. |
| Webhook returns 401                          | Stored webhook secret and the Jira header/Bearer value must match exactly.            |
| Webhook returns 204                          | The event name is not one of the two handled names.                                   |
| Webhook says `updated: 0`                    | No stored link matches the Jira issue ID or key.                                      |
| Jira changed but incident did not transition | Expected limitation: inbound Jira changes update external metadata only.              |
| OpsKnight note missing in Jira               | Comment permission, API token, linked issue, Jira availability, and application logs. |

## Security notes

Jira API tokens and webhook secrets are encrypted at rest with the application encryption layer. HTTPS is still required in transit. Do not put the API token in a Jira webhook or expose it in logs; the webhook uses its separate shared secret.

## Related topics

- [Action items](../../core-concepts/action-items)
- [Incidents](../../core-concepts/incidents)
- [Services](../../core-concepts/services)
- [Encryption](../../security/encryption)
