---
title: Connect Jira
description: Link OpsKnight services and incidents to Jira projects and issues.
type: how-to
product_area: jira
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/jira-sync.ts
    - src/lib/jira-validation.ts
---

# Connect Jira

## Before you begin

Obtain Jira credentials with access to the intended project and issue type.

1. Configure and test Jira under **Settings → Integrations → Jira**.
2. Create a linked issue from a test incident and verify synchronization.

Configure the Jira base URL and encrypted credentials, test connectivity, and
map each OpsKnight service to the intended Jira project. On a synthetic incident,
create or link an issue and verify its key, URL, status, assignee, and sync state.

Rendering an incident does not perform hidden Jira network calls. Persisted state
is refreshed by explicit actions, webhooks, or background processing. Diagnose
credentials, project permissions, webhook delivery, and mapping independently.

Use a Jira identity restricted to the mapped projects and the issue operations
OpsKnight needs. Confirm the configured issue type accepts every required field
and that user identities used for assignment can be resolved in the target Jira
site. A successful connection test alone does not validate project mapping.

For webhook-driven updates, expose only the documented endpoint, validate its
shared authentication, and prevent duplicate delivery from producing duplicate
links or transitions. If synchronization stalls, capture the OpsKnight incident
ID, Jira issue key, last successful direction, operation timestamp, and sanitized
provider response before retrying.
