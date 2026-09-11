---
order: 1
title: Jira Cloud
description: Connect one Jira Cloud workspace, map services, create or link issues, and synchronize supported metadata safely.
---

# Jira Cloud

OpsKnight connects one Jira Cloud workspace to incident and action-item workflows. It can create or link Jira issues, durably queue OpsKnight incident notes as Jira comments, and receive Jira status/assignee metadata by webhook.

This is not full two-way workflow mirroring: Jira transitions do not change an OpsKnight incident's lifecycle, and OpsKnight does not transition Jira workflows. Treat OpsKnight as the incident system of record and Jira as linked engineering-work tracking.

## What is supported

| Workflow                     | Direction                  | Result                                                                                           |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Create issue for incident    | OpsKnight → Jira           | Creates the configured issue type and stores one owned Jira link.                               |
| Link existing issue          | Jira → OpsKnight reference | Fetches and stores key, URL, status, and assignee; the same Jira issue cannot have two owners. |
| Create issue for action item | OpsKnight → Jira           | Creates the service-mapped action-item issue type.                                               |
| Incident note                | OpsKnight → Jira           | Durably queues a formatted Jira comment without blocking the OpsKnight note on provider failure. |
| Jira issue update webhook    | Jira → OpsKnight           | Refreshes stored Jira metadata and mirrors action-item completion state.                         |
| Jira issue delete webhook    | Jira → OpsKnight           | Preserves the historical link, marks it failed/deleted, and leaves the OpsKnight entity intact. |

GitHub Issues, Linear, and Asana do not have equivalent native issue-sync workflows in v1.5.

## Prerequisites and permissions

- A Jira Cloud site and an Atlassian user with access to the target projects.
- An Atlassian API token for that user.
- Permission to create the configured issue types, read issues, and add comments.
- An OpsKnight **Admin** for the workspace connection and service mappings.
- A public HTTPS OpsKnight URL for Jira webhooks.
- `ENCRYPTION_KEY` or `ENCRYPTION_KEYS` configured in production so API tokens and webhook secrets remain decryptable after restarts.

Use a dedicated least-privilege Jira service account where possible. Changes to that account's projects or permissions affect every mapped OpsKnight service.

## Connect the workspace

1. In Atlassian account security, create an API token for the integration account.
2. Open **Settings → Integrations → Jira** in OpsKnight.
3. Enter the Jira Site URL, Jira User Email, and API Token.
4. Generate a long random Webhook Secret and enter it.
5. Select **Test Connection** and confirm the connected Jira identity.
6. Turn on **Jira Workspace → Enabled** and save the configuration.

OpsKnight normalizes a bare `example.atlassian.net` site value to HTTPS. Use the exact Cloud site, not a project or board URL.

On later edits, leaving a masked API token unchanged reuses the stored encrypted token **only for the same Jira origin**. Changing the Jira site origin requires re-entering a fresh API token before the configuration can be saved. A masked webhook secret can be left unchanged when the workspace origin is unchanged.

**Test Connection validates the Jira credentials and identity only.** It does not validate service project keys, issue types, components, or create permissions for every mapped service; verify those mappings separately.

## Configure the Jira webhook

The Jira settings page displays the callback URL:

```text
https://ops.example.com/api/jira/webhook
```

Configure Jira to deliver at least `jira:issue_updated` and `jira:issue_deleted`. OpsKnight also accepts Jira issue-created/generic issue event names, but only supported status/assignee/deletion data is applied.

Send the configured webhook secret using one of the supported mechanisms:

```http
x-jira-webhook-secret: YOUR_SECRET
```

or:

```http
Authorization: Bearer YOUR_SECRET
```

For Jira Cloud webhook configuration that cannot send a custom header, use the exact generated callback URL from the Jira settings page, which can include the secret as a query parameter. Treat that URL as a credential: do not publish it, paste it into tickets, or expose it in logs.

In production, OpsKnight rejects Jira webhooks if no webhook secret is configured. Secret comparison is constant-time. Limit the Jira webhook with JQL to projects used by OpsKnight when practical.

The inbound webhook updates only fields actually present in the Jira event, so an omitted assignee or status field does not erase previously synchronized metadata. Jira status changes do not transition the OpsKnight incident lifecycle.

When Jira supplies a stable delivery identity (or OpsKnight can derive one from stable issue/changelog/comment/timestamp identifiers), webhook deliveries are durably claimed so completed duplicates are ignored. Same-issue webhook mutation chains are serialized across replicas. When Jira's issue `updated` timestamp is available, it is used as the ordering clock so an older event cannot overwrite newer accepted Jira metadata or roll an action item's completion state backward.

For linked **action items**, OpsKnight intentionally mirrors only completion state: a Jira status categorized as Done marks a non-completed action item `COMPLETED`; if that Jira issue later leaves Done, a currently `COMPLETED` action item is reopened to `OPEN`. Jira non-Done states do not overwrite an action item that is already `IN_PROGRESS` or `BLOCKED`.

For `jira:issue_deleted`, OpsKnight preserves the Jira key/URL as historical evidence, marks the link as failed with status `Deleted in Jira`, clears the synchronized assignee, and does not delete the OpsKnight incident or action item.

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

The workspace connection can be configured before or after mappings, but auto-create requires an enabled workspace connection and a valid mapping. Verify project keys, issue-type names, and components against Jira; the free-text form validates their format but cannot guarantee that the Jira project metadata or permissions are correct.

## Incident workflow

On an incident's Jira controls, an authorized responder can:

- create a new issue using the service mapping;
- link an existing Jira key or a URL containing a Jira key;
- refresh supported Jira metadata;
- open the issue in Jira;
- unlink it from the incident without deleting the Jira issue.

A Jira issue can be owned by only one OpsKnight incident or action item. Concurrent attempts to link the same Jira key are serialized and competing owners are rejected rather than merged into one link.

Incident notes are durably queued to every linked Jira issue in this form:

```text
[OpsKnight Note by RESPONDER_NAME]:
NOTE_TEXT
```

The OpsKnight note and its Jira delivery intent are committed together. A Jira outage therefore does not roll back the incident note; Jira delivery is handled separately from the source incident mutation. Monitor operations after a prolonged provider outage or rate-limit window and retry/reconcile operationally if delivery remains ambiguous or failed.

OpsKnight incident lifecycle transitions are **not** Jira workflow transitions and are not documented as automatically posting lifecycle comments in v1.5.

## Action-item workflow

From **Action Items** or the action-item section of its postmortem, create a Jira issue using the action item's incident service mapping, or link an existing Jira issue. The same persisted action item and Jira link are shown consistently across the global Action Items board, postmortem detail/edit views, and the incident postmortem tab.

OpsKnight stores the external key, URL, status, assignee, sync state, and last accepted sync time. An action item with an existing Jira link must be refreshed rather than given a second active Jira link; stale Create/Link requests are rejected server-side.

An action item without an incident/service mapping cannot create a correctly routed Jira issue. Fix the association or mapping first.

## Reliability behavior

Jira provider calls use bounded request timeouts and do not follow HTTP redirects with credentials. Durable Jira create/comment operations use provider correlation/idempotency markers to reconcile ambiguous outcomes before another provider mutation, reducing duplicate Jira issues or comments after lost responses.

Jira `Retry-After` values and transient provider failures are recorded in the external-operation/provider-admission state and can delay subsequent Jira work. Delivery remains asynchronous, so operators should monitor operations after long rate-limit or outage windows and explicitly retry/reconcile work that remains `AMBIGUOUS` or reaches `FAILED`. The v1.5 documentation does not guarantee that every deferred operation will automatically run until terminal completion across an arbitrarily long provider cooldown.

Normal incident page rendering uses stored Jira metadata and does not perform hidden live Jira HTTP requests.

## Disable, remove, or rotate credentials

**Disable Jira** when you want a reversible pause. Disabling the workspace integration stops operational Jira workflows and inbound synchronization while preserving credentials, service mappings, and existing Jira links. Historical links remain available as read-only references where supported.

Use **Remove Jira Workspace** when the Jira connection should be removed from OpsKnight entirely. Removal requires Admin access plus the explicit `REMOVE JIRA` confirmation. It removes encrypted Jira credentials and webhook secret, service mappings, OpsKnight Jira links, queued Jira external operations/jobs, Jira provider-admission state, and stale cached Jira projections in legacy postmortem action-item JSON.

Workspace removal does **not** delete Jira issues in Atlassian. OpsKnight also retains incident timeline entries and audit records as immutable operational history.

For credential rotation:

- Rotating the API token requires saving the new token and running **Test Connection**.
- Changing the Jira site origin requires a freshly entered API token; OpsKnight does not reuse a masked stored token across origins.
- Rotating the webhook secret requires updating Jira and OpsKnight together; otherwise inbound requests return 401.
- Removing an individual OpsKnight link does not delete the Jira issue.

## Verification checklist

- [ ] Test Connection returns the intended least-privilege Jira account.
- [ ] Enable/Disable hides and restores operational Jira controls as expected.
- [ ] Each production service maps to an existing project, component, and issue type.
- [ ] A manual incident issue is created with the expected labels and link.
- [ ] An existing issue can be linked and duplicate/cross-owner linking is rejected.
- [ ] An incident note appears as a Jira comment even though the OpsKnight note itself does not depend on Jira availability.
- [ ] A Jira status or assignee update refreshes the stored metadata.
- [ ] A repeated webhook delivery does not duplicate supported side effects when it has a durable delivery identity.
- [ ] An older Jira update does not overwrite a newer accepted status when provider ordering metadata is available.
- [ ] A Jira delete event preserves the historical key while marking the link deleted/failed.
- [ ] A linked action item shows the same Jira key on Action Items and postmortem surfaces.
- [ ] Jira Done marks a linked action item complete and reopening Jira reopens a currently completed item.
- [ ] A test action item creates or links the intended issue type.
- [ ] Auto-create is tested for one selected and one excluded urgency.
- [ ] Invalid webhook secrets return 401 without changing metadata.
- [ ] Changing the Jira origin without a fresh API token is rejected.
- [ ] Remove Jira Workspace clears OpsKnight Jira state without deleting the provider ticket.

## Troubleshooting

| Symptom                                      | Check                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Test Connection returns 401                  | Jira email/token pair, revoked token, and site URL.                                                      |
| Test Connection succeeds but Create fails    | Test Connection validates identity, not the service project/issue type/component/create permission.     |
| Save asks for the API token again            | The Jira site origin changed; re-enter a token rather than reusing the masked stored credential.         |
| Create returns 400/404                       | Project key, issue type, component, labels, and service-account permissions.                             |
| “already linked”                             | The Jira issue or action item already has an active OpsKnight Jira association.                          |
| Webhook returns 401                          | Stored webhook secret and the Jira header/Bearer/query-secret value must match exactly.                  |
| Webhook returns 204                          | The webhook event name is not recognized as a supported Jira issue event.                                |
| Webhook says `updated: 0`                    | No stored link matches, sync is disabled, the delivery is stale/duplicate, or no newer state was applied. |
| Jira link shows `Deleted in Jira`            | The provider issue was deleted; OpsKnight intentionally preserves the historical reference.             |
| Jira changed but incident did not transition | Expected limitation: inbound Jira changes do not change incident lifecycle state.                        |
| OpsKnight note missing in Jira               | Comment permission, API token, linked issue, Jira availability, retry/cooldown state, and application logs. |

## Security notes

Jira API tokens and webhook secrets are encrypted at rest with the application encryption layer. HTTPS is required in transit, provider redirects are not followed with Jira credentials, and stored API tokens are origin-bound so a masked credential cannot be silently redirected to a different Jira host.

Configured Jira base URLs reject embedded credentials, query/fragment confusion, loopback/link-local destinations, and common metadata-service targets. Do not put the API token in a Jira webhook or expose it in logs; the webhook uses its separate shared secret.

## Related topics

- [Action items](../../core-concepts/action-items)
- [Incidents](../../core-concepts/incidents)
- [Services](../../core-concepts/services)
- [Encryption](../../security/encryption)
