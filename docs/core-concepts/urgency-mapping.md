---
order: 12
---

# Urgency and Severity Mapping

OpsKnight normalizes alerts into a standard Severity and Urgency model so notifications are consistent across providers.

## Severity (Event Level)

| Severity | Meaning                               | Maps to Urgency |
| -------- | ------------------------------------- | --------------- |
| Critical | System down or unusable               | HIGH            |
| Error    | Significant degradation               | MEDIUM          |
| Warning  | Minor issue or approaching limits     | LOW             |
| Info     | Informational / recovery / normal ops | LOW             |

## Urgency (Notification Level)

| Urgency | Behavior                                                  |
| ------- | --------------------------------------------------------- |
| HIGH    | Pages on-call immediately (SMS, Push, Phone)              |
| MEDIUM  | Standard notification (Slack, Email)                      |
| LOW     | Logged for visibility, optional low-priority notification |

## Provider Mappings

### AWS CloudWatch

| State             | Severity | Urgency |
| ----------------- | -------- | ------- |
| ALARM             | Critical | HIGH    |
| OK                | Info     | LOW     |
| INSUFFICIENT_DATA | Warning  | LOW     |

### Azure Monitor

| Azure Severity | Severity | Urgency |
| -------------- | -------- | ------- |
| Sev0           | Critical | HIGH    |
| Sev1           | Error    | MEDIUM  |
| Sev2           | Warning  | LOW     |
| Sev3+          | Info     | LOW     |

### Datadog

| Status  | Severity | Urgency |
| ------- | -------- | ------- |
| error   | Critical | HIGH    |
| warning | Warning  | LOW     |
| info    | Info     | LOW     |

### Prometheus / Alertmanager

| Label (`severity`) | Severity | Urgency |
| ------------------ | -------- | ------- |
| critical / page    | Critical | HIGH    |
| error              | Error    | MEDIUM  |
| warning            | Warning  | LOW     |
| other              | Warning  | LOW     |

### Sentry

| Level   | Severity | Urgency |
| ------- | -------- | ------- |
| fatal   | Critical | HIGH    |
| error   | Error    | MEDIUM  |
| warning | Warning  | LOW     |
| info    | Info     | LOW     |

### Uptime Tools

| Status        | Severity | Urgency |
| ------------- | -------- | ------- |
| down / open   | Critical | HIGH    |
| up / resolved | Info     | LOW     |

## Custom Webhooks

You can set severity directly in your payload:

```json
{
  "summary": "Database High CPU",
  "severity": "critical",
  "source": "custom-script"
}
```

## Notes

- Mapping logic lives in integration adapters and event processing.
- Use consistent severity values for predictable escalation.
