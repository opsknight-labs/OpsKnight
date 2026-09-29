---
title: Slack rate limits and retry behavior
description: Understand Slack throttling boundaries, queued retries, convergence, and safe operator response.
type: reference
product_area: chatops
audience: [administrator, operator]
keywords: [Slack rate limit, 429, retry]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/slack.ts, src/lib/chatops/]
---

# Slack rate limits and retry behavior

Slack enforces workspace/API-method limits and can return throttling responses with a retry interval. OpsKnight delivery is asynchronous; an incident remains authoritative while its Slack projection is delayed.

Do not repeatedly send tests or manually repost incident messages during throttling. Inspect provider response, operation state, queue oldest age, and credential/channel access. Allow the bounded retry path to run, then verify the existing projection converges.

Alert on sustained throttling, growing oldest-delivery age, repeated terminal provider errors, and worker backlog. Reduce avoidable tests/noise, confirm destinations are intentional, and request/provider-plan capacity only after measuring the actual constraint.

Rate-limit recovery does not fix revoked credentials, missing channel membership, invalid scopes, or a deleted channel. Diagnose those separately.

## Related pages

- [Inspect delivery](../../../guides/notifications/inspect-delivery)
- [Troubleshoot Slack](./troubleshooting)

