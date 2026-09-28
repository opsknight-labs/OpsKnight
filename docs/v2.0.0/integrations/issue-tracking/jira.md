---
title: Jira
description: Configure Jira issue creation, linking, synchronization, and webhooks.
type: integration
product_area: jira
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/jira-sync.ts
    - src/app/api/jira/webhook/route.ts
---

# Jira

Jira connects a service to a project and lets responders create or link issues
from incidents. Configure and test encrypted credentials, map services, and
register the webhook contract before enabling operational use.

Use the complete [Jira integration guide](./jira/) for connection, authenticated
webhooks, verification, and troubleshooting.

Issue state stored in OpsKnight is updated by explicit sync, background work, or
validated webhooks. Verify webhook authenticity, project permissions, issue-type
availability, and mapping before retrying a failed operation.
