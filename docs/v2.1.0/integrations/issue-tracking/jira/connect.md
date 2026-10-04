---
title: Configure the Jira connection
description: Configure Jira credentials, project defaults, and issue creation.
type: how-to
product_area: jira
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Configure Jira Cloud credentials, test the connection, map a service, and create a linked issue.
keywords: [connect Jira, Jira integration, Jira credentials, Jira service mapping]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/jira-sync.ts, src/app/api/jira/test/route.ts]
---

# Configure the Jira connection

## Before you begin

Create Jira credentials with access to the intended project and issue type, and
sign in to OpsKnight as an administrator.

For Jira Cloud, use the Atlassian account email and an API token created for a dedicated least-privilege integration identity. Confirm it can browse/create/edit/comment in intended projects and use the configured issue types/required fields.

## Open the feature

Open **Settings → Integrations → Jira**.

## Configure the connection

1. Enter the Jira site base URL, without an issue path.
2. Enter the integration account email and API token through the encrypted credential fields.
3. Save, then select **Test connection**.
4. Open **Services → select service → Jira** and enter the intended project key plus supported issue mapping/options.
5. Save the service mapping.
6. Open a controlled incident and select the Jira issue action to create/link work.

## What OpsKnight does

OpsKnight calls Jira REST API v3 with the stored connection, serializes provider/issue mutations, and stores durable issue identity/link/sync state. Rendering an incident does not make hidden Jira requests; synchronization occurs through explicit actions, webhooks, or background work.

## Verify it worked

Confirm the connection test, service mapping, and issue creation separately. The issue must appear in the intended project/type with expected summary/description/link; the incident must show issue key/URL/provider identity and healthy sync state. Add a controlled comment/status update and verify the configured sync direction.

## Remove or rotate the connection

Create a replacement API token, update OpsKnight, test, create/update a pilot issue, then revoke the old token. Before disconnecting or changing site/project, inventory linked incidents/action items and service mappings; remote issues are not deleted automatically.

Store credentials only through the encrypted settings flow. Project permission
and issue-type availability are validated by Jira, not inferred by OpsKnight.

## Troubleshooting

**Connection test fails:** verify base URL, email/token, account activity, outbound DNS/TLS, and Jira response.

**Issue creation fails after test succeeds:** check service project mapping, issue type, required fields/components, and project permissions.

**Issue may have been created after timeout:** inspect incident operation and Jira search before retrying to avoid duplicate work.

## Next steps

- [Configure webhooks](./configure-webhooks)
- [Troubleshoot Jira](./troubleshooting)
