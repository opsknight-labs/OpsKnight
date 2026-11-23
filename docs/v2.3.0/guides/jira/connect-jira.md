---
title: Connect Jira
description: Link OpsKnight services and incidents to Jira projects and issues.
type: tutorial
product_area: jira
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Connect Jira and validate incident-to-issue synchronization end to end.
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/jira-sync.ts
    - src/lib/jira-validation.ts
---

# Connect Jira

## Before you begin

Complete the prerequisites in [Connect Jira](../../integrations/issue-tracking/jira/connect), including a restricted Jira identity, reachable HTTPS base URL, target project/issue type, and accepted required fields.

## Open the feature

Open **Settings → Integrations → Jira** and keep a synthetic OpsKnight service and incident ready.

## Configure the end-to-end workflow

1. Follow [Connect Jira](../../integrations/issue-tracking/jira/connect) to save encrypted credentials and pass the connection test.
2. Map the synthetic service to the intended Jira project and issue type.
3. Follow [Configure Jira webhooks](../../integrations/issue-tracking/jira/configure-webhooks) and send a controlled webhook test.
4. Open the synthetic incident and select **Link Jira Issue** in the action bar under the title card, then **Create Jira Issue**.
5. Change one supported field from OpsKnight and verify Jira, then change one supported field in Jira and verify the webhook-driven OpsKnight state.

## What OpsKnight does

Rendering an incident performs no hidden Jira request. Explicit actions, webhooks, and background work update persisted link/sync state. Connection, project mapping, field validation, and webhook delivery therefore need separate verification.

## Verify the integration

Require the expected Jira key, URL, project, issue type, status, assignee, and last sync direction/time. Confirm repeated webhook delivery does not create a duplicate link or transition.

On the incident, linked issues share one **Jira** button in the action bar. It shows the first issue's key and status, and **+N** when more are linked. Select it to see every linked issue with its assignee and last sync, **Open in Jira**, **Sync** (pulls the latest status and assignee from Jira), and **Manage** to link, create, or unlink issues.

## Disconnect or undo

Stop webhook delivery, remove/disable mappings, and rotate/revoke credentials according to [Jira troubleshooting](../../integrations/issue-tracking/jira/troubleshooting). Existing Jira issues are not automatically deleted.

## Troubleshooting

Capture the OpsKnight incident ID, Jira key, direction, operation time, correlation ID, and sanitized provider response. Then use the dedicated [troubleshooting guide](../../integrations/issue-tracking/jira/troubleshooting).

## Next steps

- [Jira connection reference](../../integrations/issue-tracking/jira/connect)
- [Jira webhook configuration](../../integrations/issue-tracking/jira/configure-webhooks)
