---
title: Notification rate limits and admission reference
description: Understand provider throttling, concurrency admission, retry hints, deferred delivery, and safe capacity response.
type: reference
product_area: notifications
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/lib/notification-capacity/defaults.ts, src/lib/notification-capacity/hard-limits.ts, src/lib/notification-capacity/resolver.ts, src/lib/notification-delivery.ts, src/lib/notification-control-plane.ts]
---

# Notification rate limits and admission reference

## Safe channel defaults

These are OpsKnight's built-in starting values when neither a stored provider
capacity row nor a valid legacy environment override supplies a value.

| Channel | Rate per second | Maximum in flight |
|---|---:|---:|
| Email | 8 | 5 |
| SMS | 20 | 10 |
| Voice | 1 | 2 |
| WhatsApp | 50 | 10 |
| Push | 100 | 20 |
| Slack | 1 | 2 |
| Webhook | 20 | 10 |
| Microsoft Teams | 2 | 2 |

These values govern OpsKnight admission; they are not promises about a
provider account's quota or end-to-end throughput. Provider throttling can make
the effective throughput lower.

## Resolution order

For a channel/provider pair, OpsKnight resolves capacity in this order:

1. A database `NotificationProviderCapacity` row. `CUSTOM` uses its stored
   rate and in-flight values; missing values fall back to the channel defaults.
   `AUTO` deliberately uses the channel defaults. Stored bulk-share and
   adaptive-backpressure choices still apply.
2. When there is no database row, valid provider-scoped or channel-scoped
   `NOTIFICATION_*` environment values. Missing individual values use safe
   channel defaults.
3. When neither exists, the safe channel defaults above.

Provider-scoped environment values win over channel-scoped values. Invalid or
out-of-range environment values are ignored rather than silently widened.
`WEBHOOK` and `SLACK` may use the corresponding `default` provider database row
when no provider-specific row exists.

The deployment ceiling and adaptive backpressure apply after configuration is
resolved, so `effectiveRatePerSecond` can be lower than the configured rate.

## Absolute safety boundaries

These bounds are enforced in code and are not configurable without a code
change:

| Setting | Minimum | Maximum |
|---|---:|---:|
| Rate per second | 1 | 10,000 |
| Maximum in flight | 1 | 5,000 |
| Bulk share | 5% | 95% |
| Bulk queue low watermark | 100 | 1,000,000 |
| Bulk queue high watermark | 1,000 | 1,000,000 |
| Quota block size | 1 | 1,000 |

The default bulk share is 80%, the default low/high queue watermarks are
5,000/25,000, the default quota block size is 100, and adaptive backpressure is
enabled by default. At least one in-flight slot is retained outside the bulk
share whenever the configured concurrency is greater than one.

## Deferral and retry behavior

Provider concurrency/admission can defer delivery without consuming it as a permanent failure. Explicit rate-limit results, `429`, or provider retry hints schedule a later attempt; absent an explicit hint, the control-plane fallback deferral is 60 seconds.

Monitor per-provider attempts/outcomes, deferred count, oldest age, concurrency, retry volume, and worker health. Do not repeatedly run tests or manual sends during throttling. Provider capacity, queue capacity, database capacity, and policy timing are different bottlenecks.

A raised concurrency setting cannot exceed provider account limits safely and can amplify throttling. Change only after measuring throughput/oldest age and retaining critical-notification capacity.

## Operator checklist

1. Record the provider account quota and any per-destination limit.
2. Compare configured and effective rates in notification metrics/operations.
3. Watch oldest queued age, deferred volume, in-flight work, retries, and
   critical-versus-bulk behavior during a controlled test.
4. Change one dimension at a time. Raising rate and concurrency together makes
   throttling or database pressure harder to diagnose.
5. Roll back when `429`/retry volume, oldest age, provider errors, or critical
   delivery latency gets worse.
