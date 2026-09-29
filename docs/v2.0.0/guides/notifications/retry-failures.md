---
title: Retry failed notifications safely
description: Classify retryable, permanent, deferred, or superseded notification outcomes before replaying delivery.
type: how-to
product_area: notifications
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Diagnose and safely retry a failed notification.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/notification-delivery.ts, src/lib/notification-control-plane.ts, src/lib/notification-provider-feedback.ts]
---

# Retry failed notifications safely

## Before you begin

Identify incident/event/generation, logical intent, recipient/endpoint, provider attempt, latest outcome, provider ID, and current incident state. Determine whether retry remains operationally useful.

## Open the feature

Open notification history from the incident or **Settings → Notifications → History** and select the failed/deferred operation.

## Configure the recovery

Classify the outcome:

- retryable/transient or provider `429` with retry hint;
- deferred by provider admission/capacity;
- permanent invalid/auth/endpoint failure;
- superseded because incident/generation/state changed;
- successful request awaiting/with provider feedback.

Correct permanent credential/endpoint/routing failures before any new attempt.

## Complete the action

1. Inspect existing automatic retry schedule/count.
2. Remove the underlying transient/capacity/configuration problem.
3. Use supported retry/requeue only if current state still warrants delivery.
4. Avoid creating a new manual notification that bypasses stable identity.
5. Observe the next attempt and provider feedback.

## What OpsKnight does

Stable identity makes one logical intent retry-safe. Before retry, OpsKnight checks whether incident state or escalation generation superseded it. Provider rate-limit hints defer rather than convert immediately to permanent failure.

## Verify it worked

Confirm the same logical intent reaches a terminal appropriate outcome without duplicate human delivery, queue oldest age recovers, and current incident projections remain correct.

## Change or undo a retry

An external message already sent cannot be recalled. Stop further attempts through supported incident/routing/provider correction, notify unintended recipients, and preserve audit evidence.

## Troubleshooting

**Retry never runs:** inspect scheduled time, worker lane/heartbeat, provider admission, and superseded state.

**Repeated permanent failure:** stop retries and repair/revoke the bad endpoint/credential.

## Next steps

- [Inspect delivery](./inspect-delivery)
- [Notification troubleshooting](../../troubleshooting/notifications/not-delivered)

