---
order: 3
title: Better Stack Uptime
description: Send Better Stack incident webhooks to OpsKnight with an explicit v1.4 payload and lifecycle contract
---

# Better Stack Uptime

OpsKnight's integration is named **Better Uptime** for compatibility with the provider's former product name. Use a Better Stack Uptime outgoing incident webhook and customize or transform its JSON into the v1.4 adapter shape.

## Create the OpsKnight integration

1. Open **Services**, select the target service, and open **Integrations**.
2. Add **Better Uptime**.
3. Copy the complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/better-uptime?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The URL contains a credential. Do not publish it.

## Configure Better Stack

In Better Stack Uptime, open **Integrations → Exporting data → Outgoing webhooks**, configure an **Incident webhook**, and paste the complete OpsKnight URL. Select incident creation/reopen, acknowledgment, and resolution events as required.

Customize the request or use an intermediary so the rendered JSON has this contract:

```json
{
  "incident": {
    "id": "stable-provider-incident-id",
    "name": "Checkout is unavailable",
    "status": "started",
    "severity": "critical",
    "cause": "Health check returned 503",
    "started_at": "2026-08-23T12:00:00Z",
    "resolved_at": null,
    "url": "https://uptime.betterstack.com/team/example/incidents/123"
  }
}
```

Use the variables available in Better Stack's current webhook template editor; do not send the literal example values. Capture a provider test delivery to verify the final shape.

## Lifecycle and correlation

| `incident.status` or top-level `status`                      | OpsKnight action                  |
| ------------------------------------------------------------ | --------------------------------- |
| `started`, `open`, `reopened`, or another non-recovery value | Trigger                           |
| Value containing `ack`/`acknowledge`                         | Acknowledge the matching incident |
| `resolved`, `closed`, `recovered`, `ok`, or `up`             | Resolve                           |

Correlation uses `incident.id`. If absent, OpsKnight falls back to a normalized incident/top-level name. The same stable ID must appear on started, acknowledged, reopened, and resolved events.

Summary uses incident name, top-level name, then cause. Severity uses incident severity or top-level severity and defaults to warning. Final urgency still follows service urgency rules.

## Signature boundary

The v1.4 route verifies a signing secret only through its generic contract: unprefixed HMAC-SHA256 over the exact raw body in `X-Signature` or `X-Webhook-Signature`. Do not configure an OpsKnight signing secret unless Better Stack or your intermediary sends exactly that contract.

For direct delivery without that header, leave the signing secret unset and protect the URL with HTTPS, restricted access, and rotation. Use a gateway when policy requires stronger sender verification.

## Validate end to end

1. Send Better Stack's webhook test and confirm HTTP `202`.
2. Start a disposable provider incident and confirm one OpsKnight incident appears on the intended service.
3. Confirm the payload includes a stable `incident.id` and record the OpsKnight key.
4. Acknowledge and resolve the provider incident.
5. Confirm those events update the same OpsKnight incident.
6. Confirm an actual OpsKnight notification reaches the intended responder.

## Troubleshooting

**No incident appears**

Inspect Better Stack's delivered JSON. Its default outgoing webhook shape can evolve; ensure your customization/intermediary emits the nested `incident` fields above and that the webhook is subscribed to incident events.

**Resolution creates a second incident**

The recovery payload omitted or changed `incident.id`. Keep the same provider incident identifier across the lifecycle.

**OpsKnight returns `401`**

Restore the complete URL and current integration key. If a signing secret is configured, supply the exact generic signature or remove it for direct delivery.

**OpsKnight returns `429`**

The default is 100 requests per 60 seconds per integration. Honor retry/reset headers and avoid subscribing one service integration to unrelated monitors.

**The event arrives but no one is paged**

Check the OpsKnight incident urgency, escalation policy, schedule, user preferences, and provider delivery history. Webhook acceptance and outbound paging are separate checks.

## Related topics

- [Better Stack outgoing webhooks](https://betterstack.com/docs/uptime/webhooks/)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
