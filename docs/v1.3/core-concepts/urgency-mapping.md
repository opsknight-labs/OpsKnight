---
title: Urgency and severity mapping
description: Understand how provider severity becomes incident urgency and how urgency differs from priority and notification channels.
order: 14
---

# Urgency and severity mapping

Inbound integrations normalize provider-specific alert fields into the Events API's four severity values. Event processing then assigns one of three incident urgency values.

## Canonical mapping

| Event severity | Incident urgency | Intended meaning                              |
| -------------- | ---------------- | --------------------------------------------- |
| `critical`     | **High**         | Immediate, severe operational impact.         |
| `error`        | **Medium**       | Significant fault requiring response.         |
| `warning`      | **Medium**       | Degradation or risk requiring attention.      |
| `info`         | **Low**          | Informational, recovery, or low-impact event. |

Unknown severity cannot pass the published Events API schema. Integration adapters commonly normalize an unrecognized provider value to `warning`, which then becomes Medium urgency; the exact fallback is adapter-specific.

Urgency does not automatically choose SMS, push, Slack, or email. Delivery is determined by escalation-step data, user preferences, service notification selections, provider configuration, and recipient data. Some provider implementations format High urgency differently, but do not treat urgency alone as a channel-routing policy.

## Urgency, priority, and service health

- **Urgency** is High, Medium, or Low and is derived from event severity unless a responder changes it.
- **Priority** is an optional P1–P5 business-impact classification set on the incident.
- Service health treats active High-urgency incidents as critical in its calculated status.
- Priority-specific SLA targets can take precedence over the service defaults when configured.

Keep these classifications separate. For example, a noisy technical alert may be High urgency but need priority review, while a broad customer-impact issue may require a higher business priority than its source initially supplied.

## Common provider mappings

All resulting severity values pass through the canonical table above.

### AWS CloudWatch

| CloudWatch input                                     | Normalized severity         |
| ---------------------------------------------------- | --------------------------- |
| `OK`                                                 | `info` and a resolve action |
| `INSUFFICIENT_DATA`                                  | `warning`                   |
| `ALARM` description contains `CRITICAL` or `HIGH`    | `critical`                  |
| Description contains `WARNING`, `MEDIUM`, or `ERROR` | `error`                     |
| Description contains `INFO` or `LOW`                 | `info`                      |
| Other `ALARM`                                        | `critical`                  |

### Azure Monitor

| Azure input                          | Normalized severity |
| ------------------------------------ | ------------------- |
| `Sev0` or text containing `critical` | `critical`          |
| `Sev1` or text containing `error`    | `error`             |
| `Sev2` or text containing `warning`  | `warning`           |
| `Sev3`, `Sev4`, `info`, or `verbose` | `info`              |

`Fired` and `Activated` trigger; other monitor conditions resolve the matching incident.

### Datadog

| Datadog alert type | Normalized severity |
| ------------------ | ------------------- |
| `critical`         | `critical`          |
| `error`            | `error`             |
| `warning`          | `warning`           |
| Other              | `info`              |

`resolved`, `ok`, and `success` states resolve rather than trigger.

### Prometheus Alertmanager

| `severity` label         | Normalized severity |
| ------------------------ | ------------------- |
| `critical` or `page`     | `critical`          |
| `error`                  | `error`             |
| `warning`                | `warning`           |
| Missing or another value | `warning`           |

A resolved alert produces `info` and resolves its deduplication key.

### Sentry

| Sentry level      | Normalized severity |
| ----------------- | ------------------- |
| `fatal`           | `critical`          |
| `error`           | `error`             |
| `warning`         | `warning`           |
| `info` or `debug` | `info`              |

Resolved events resolve; ignored, assigned, or unassigned actions acknowledge; created, reopened, or triggered actions trigger.

### Uptime integrations

Pingdom down states, UptimeRobot outage alerts, and Uptime Kuma down states normalize to `critical`; their recovery/up states normalize to `info` and resolve. Consult the provider guide for the exact payload fields and stable deduplication key.

## Generic Events API payload

Supply one of the four lowercase severity values:

```json
{
  "event_action": "trigger",
  "dedup_key": "database/high-cpu",
  "payload": {
    "summary": "Database CPU above 90%",
    "source": "capacity-monitor",
    "severity": "critical",
    "custom_details": {
      "region": "us-east-1"
    }
  }
}
```

Reuse the same `dedup_key` for acknowledge and resolve actions. See the [Events API](../api/events.md) for authentication, schema, limits, and responses.

## Validate a mapping

1. Send a representative test payload through the service integration.
2. Confirm action, service, title, source, urgency, and deduplication behavior.
3. Acknowledge or resolve using the same provider identity/key.
4. Confirm the existing incident changes state instead of creating a duplicate.
5. Test the provider's unknown/default severity and recovery payload.

## Troubleshooting

### Warning becomes Medium, not Low

This is intentional in v1.3. The central mapping treats both `error` and `warning` as Medium.

### A resolved alert creates or leaves an open incident

Compare the trigger and recovery deduplication keys and service integration keys. Resolution can only find an incident within the same service and matching key.

### The wrong notification channel is used

Inspect the policy step, user's preferences/contact data, service notification settings, and workspace provider. Severity-to-urgency mapping does not select a delivery channel by itself.

## Related topics

- [Events API](../api/events.md)
- [Incident management](incidents.md)
- [Escalation policies](escalation-policies.md)
- [Integration directory](../integrations/README.md)
