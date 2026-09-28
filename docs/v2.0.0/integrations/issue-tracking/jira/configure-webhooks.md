---
title: Configure Jira webhooks
description: Authenticate Jira lifecycle events and synchronize linked incident state.
type: how-to
product_area: jira
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/jira/webhook/route.ts, src/lib/jira-sync.ts]
---

# Configure Jira webhooks

## Before you begin

Connect Jira and generate a webhook secret in the Jira integration settings.

1. In Jira, create a webhook targeting
   `https://YOUR_OPSKNIGHT_HOST/api/jira/webhook`.
2. Configure the same secret using `x-jira-webhook-secret` or the supported
   bearer transport.
3. Select the issue lifecycle events used by your workflow.
4. Update a linked test issue.
5. Verify the linked OpsKnight incident records the synchronized change once.

Production requests fail closed when no webhook secret is configured. The
endpoint applies a 60-request-per-minute client limit and uses Jira delivery and
issue mutation fences to prevent duplicate or racing updates.

