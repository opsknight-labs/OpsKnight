---
title: Configure Jira webhooks
description: Authenticate Jira lifecycle events and synchronize linked incident state.
type: how-to
product_area: jira
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Configure, authenticate, test, and rotate the Jira synchronization webhook.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/jira/webhook/route.ts, src/lib/jira-sync.ts]
---

# Configure Jira webhooks

## Before you begin

Connect Jira and generate a webhook secret in the Jira integration settings.

## Open the feature

Open **Settings → Integrations → Jira** and generate/store a high-entropy webhook secret. In Jira administration, open the webhook configuration for the site.

## Configure the webhook

1. In Jira, create a webhook targeting
   `https://YOUR_OPSKNIGHT_HOST/api/jira/webhook`.
2. Configure the same secret using `x-jira-webhook-secret` or the supported
   bearer transport.
3. Select only handled issue lifecycle events: created, updated/generic, and deleted according to the workflow.
4. Scope the webhook to intended projects/issues when Jira supports the required filter.
5. Save, update a linked test issue, then delete only a disposable linked issue when testing deletion behavior.

## What OpsKnight does

The endpoint rejects missing/mismatched production secrets, applies a 60-request-per-minute client limit, and uses Jira delivery and issue-mutation fences to prevent duplicate/racing updates. It synchronizes only supported events for known linked issues.

## Verify it worked

Confirm one event updates the linked OpsKnight record once, retains the Jira issue key/URL, and records expected sync/audit state. Repeat/redeliver one event and verify it does not create duplicate links or conflicting transitions.

## Revoke or rotate the webhook secret

Pause or expect brief sync interruption, replace the secret in OpsKnight and Jira together, send a pilot event, then remove the old value. There is one active shared secret boundary; mismatched rotation fails closed.

Production requests fail closed when no webhook secret is configured. The
endpoint applies a 60-request-per-minute client limit and uses Jira delivery and
issue mutation fences to prevent duplicate or racing updates.

## Troubleshooting

**Unauthorized:** compare configured secret/header or bearer value and confirm proxy preservation.

**No update after 2xx:** verify event type, issue link, project/filter scope, and supported mutation.

**429 or concurrency response:** stop rapid replay, allow current mutation to finish, then retry one provider delivery.

## Next steps

- [Create and verify the connection](./connect)
- [Troubleshoot Jira](./troubleshooting)
