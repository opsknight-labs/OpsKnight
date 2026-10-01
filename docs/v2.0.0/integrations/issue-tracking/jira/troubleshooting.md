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

Classify the response: DNS/TLS failure is the network boundary; `401` is the
account/token pair; `403` is product or project permission; `404` often means a
wrong cloud base URL or project; `429` requires backoff. For Jira Cloud, use the
site base URL rather than a copied issue URL. Do not put the API token in a URL.

## Issue creation fails

Verify the project key and issue type exist and that required Jira fields are
available. Inspect the incident operation before retrying.

Check the configured project key and issue-type ID against the same Jira site.
Inspect Jira's field error response for required custom fields, invalid option
IDs, or unavailable reporter/assignee. Before retrying an ambiguous timeout,
search Jira and the OpsKnight link record for the incident key so a successful
remote create is not duplicated.

## Webhook updates do not appear

Confirm the integration is enabled, the shared secret matches, and Jira is
sending a handled event. Check for `429` responses and preserve the Atlassian
webhook identifier when diagnosing duplicate or delayed delivery.

Confirm the Jira webhook URL is the current OpsKnight URL, event subscriptions
include the documented issue transitions, and the shared secret is the matching
revision. Compare the Atlassian webhook identifier and timestamp with ingress and
OpsKnight logs. A `2xx` with no visible change may be an ignored event or an issue
that is not linked to an OpsKnight incident.

## Direction and loop checks

Determine whether the missing change is OpsKnight → Jira or Jira → OpsKnight.
Check the outbound operation for the former and webhook delivery for the latter.
When both directions are enabled, verify origin markers prevent the same update
from bouncing repeatedly. Do not fix a loop by disabling all synchronization
without preserving the failing event and link evidence.

## Verify and escalate

Create a test issue from a non-production incident, change one supported field in
Jira, and confirm one correlated update returns to OpsKnight. Preserve incident
ID, Jira issue key, operation ID, webhook ID, response status/body, field errors,
and timestamps. Redact email addresses and credentials.
