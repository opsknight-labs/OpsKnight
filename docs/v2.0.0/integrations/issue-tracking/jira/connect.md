---
title: Configure the Jira connection
description: Configure Jira credentials, project defaults, and issue creation.
type: how-to
product_area: jira
audience: [administrator]
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

1. Open **Settings → Integrations → Jira**.
2. Enter the Jira base URL and credentials.
3. Select the default project key and issue type.
4. Save, then run the visible connection test.
5. Open a test incident and create a Jira issue.
6. Verify the issue link and provider identity appear on the incident.

Store credentials only through the encrypted settings flow. Project permission
and issue-type availability are validated by Jira, not inferred by OpsKnight.
