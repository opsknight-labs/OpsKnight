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

Configure the Jira base URL and encrypted credentials, test connectivity, and
map each OpsKnight service to the intended Jira project. On a synthetic incident,
create or link an issue and verify its key, URL, status, assignee, and sync state.

Rendering an incident does not perform hidden Jira network calls. Persisted state
is refreshed by explicit actions, webhooks, or background processing. Diagnose
credentials, project permissions, webhook delivery, and mapping independently.

