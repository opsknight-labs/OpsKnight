---
title: Troubleshoot Jira
description: Diagnose credentials, project mapping, issue creation, and webhook synchronization.
type: troubleshooting
product_area: jira
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover Jira connection, mapping, issue, and webhook synchronization failures.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/jira-sync.ts, src/app/api/jira/]
---

# Troubleshoot Jira

## Connection test fails

Confirm the base URL, credentials, project permission, and encrypted settings.
Run the test again only after correcting the visible failure.

## Issue creation fails

Verify the project key and issue type exist and that required Jira fields are
available. Inspect the incident operation before retrying.

## Webhook updates do not appear

Confirm the integration is enabled, the shared secret matches, and Jira is
sending a handled event. Check for `429` responses and preserve the Atlassian
webhook identifier when diagnosing duplicate or delayed delivery.
